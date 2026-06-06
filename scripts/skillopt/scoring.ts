/**
 * AC-04: Scoring.
 *
 * Blended score:  r = (w1 * hiddenTestPassRate + w2 * llmJudgeScore) / (w1 + w2)
 *
 * Defaults: w1 = 0.7, w2 = 0.3
 *
 * - `hiddenTestPassRate` is computed inside the rollout (before worktree cleanup)
 *   and stored in RolloutResult — it is NEVER placed in the agent-visible prompt.
 * - `llmJudgeScore` is obtained via a separate headless Copilot CLI call that
 *   reviews the diff against the task's judgeRubric.
 */

import { runCopilotCli, CopilotCliOptions } from './cli-driver';
import { Task } from './corpus';
import { RolloutResult } from './rollout';
import { extractStructuredOutput } from './extract';
import { referenceSimilarity, ReferenceWeights, DEFAULT_REFERENCE_WEIGHTS } from './reference-judge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoringWeights {
    /** Weight for hidden-test pass rate (default 0.7). */
    hiddenTestWeight: number;
    /** Weight for LLM judge score (default 0.3). */
    llmJudgeWeight: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
    hiddenTestWeight: 0.7,
    llmJudgeWeight: 0.3,
};

export interface ScoreResult {
    /** Blended r ∈ [0, 1]. */
    score: number;
    hiddenTestPassRate: number;
    llmJudgeScore: number;
    /** Reference-based similarity score (only set when judgeTarget="stdout"). */
    referenceScore?: number;
    /** Point-overlap F1 component of the reference score. */
    pointF1?: number;
    /** Holistic component of the reference score. */
    holisticScore?: number;
}

// ─── Pure blend ───────────────────────────────────────────────────────────────

/**
 * Computes the blended score from the two components.
 * Weights are normalised so the result is always in [0, 1].
 */
export function blendScores(
    hiddenTestPassRate: number,
    llmJudgeScore: number,
    weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
    const total = weights.hiddenTestWeight + weights.llmJudgeWeight;
    if (total === 0) return 0;
    return (
        (weights.hiddenTestWeight * hiddenTestPassRate +
            weights.llmJudgeWeight * llmJudgeScore) /
        total
    );
}

// ─── LLM judge ────────────────────────────────────────────────────────────────

/**
 * Calls the Copilot CLI as an LLM judge.
 * The judge prompt contains only the diff + rubric — NO hidden test commands.
 * Returns a score in [0, 1], defaulting to 0.5 on parse failure.
 */
export async function runLlmJudge(
    task: Task,
    rollout: RolloutResult,
    judgeModel: string,
    judgeWorkdir: string,
    options: CopilotCliOptions = {}
): Promise<number> {
    if (!task.judgeRubric) return 1.0;

    const judgePrompt = [
        'You are a code-quality judge. Review the diff below and output ONLY a decimal number between 0 and 1 indicating quality (1.0 = excellent, 0.0 = no relevant changes or broken).',
        '',
        `Rubric: ${task.judgeRubric}`,
        '',
        'Diff:',
        '```diff',
        rollout.diff.trim() || '(no changes produced)',
        '```',
        '',
        'Output ONLY a single decimal number between 0 and 1, nothing else.',
    ].join('\n');

    try {
        const result = await runCopilotCli(judgePrompt, judgeWorkdir, judgeModel, options);
        const match = result.stdout.trim().match(/\b(0(?:\.\d+)?|1(?:\.0*)?)\b/);
        if (match) {
            const s = parseFloat(match[1]);
            return Math.max(0, Math.min(1, s));
        }
        return 0.5;
    } catch {
        return 0.5;
    }
}

// ─── Reference-based scoring (judgeTarget="stdout") ────────────────────────────

/**
 * Scores a rollout against the task's `idealOutput` using the generic two-step
 * reference pipeline: extract candidate + ideal into structured points, then compute
 * similarity. Optionally averages over `samples` runs for self-consistency.
 *
 * Returns a ReferenceScore-like summary. The candidate text is the rollout stdout.
 */
async function scoreReference(
    task: Task,
    rollout: RolloutResult,
    judgeModel: string,
    judgeWorkdir: string,
    samples: number,
    weights: ReferenceWeights,
    options: CopilotCliOptions
): Promise<{ referenceScore: number; pointF1: number; holisticScore: number }> {
    const idealStructured = await extractStructuredOutput(task.idealOutput ?? '', judgeModel, judgeWorkdir, options);

    const runs = Math.max(1, samples);
    let sumScore = 0;
    let sumF1 = 0;
    let sumHolistic = 0;

    for (let i = 0; i < runs; i++) {
        const candidateStructured = await extractStructuredOutput(rollout.stdout, judgeModel, judgeWorkdir, options);
        const sim = await referenceSimilarity(
            candidateStructured,
            idealStructured,
            judgeModel,
            judgeWorkdir,
            weights,
            options
        );
        sumScore += sim.score;
        sumF1 += sim.pointF1;
        sumHolistic += sim.holisticScore;
    }

    return {
        referenceScore: sumScore / runs,
        pointF1: sumF1 / runs,
        holisticScore: sumHolistic / runs,
    };
}

// ─── Scoring options ──────────────────────────────────────────────────────────

export interface ScoreOptions extends CopilotCliOptions {
    /** Number of judge samples to average for self-consistency (default 1). */
    judgeSamples?: number;
    /** Blend weights for the reference-similarity components. */
    referenceWeights?: ReferenceWeights;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Computes the full blended score for a completed rollout.
 *
 * For `judgeTarget="diff"` (default) the LLM judge reviews the git diff against the
 * task rubric. For `judgeTarget="stdout"` the rollout's stdout is compared to the
 * task's `idealOutput` via the generic reference-similarity pipeline; that similarity
 * takes the place of the LLM-judge component in the outer blend.
 *
 * @param task         The task the rollout was for.
 * @param rollout      The RolloutResult (contains hiddenTestPassRate already).
 * @param judgeModel   Model for the LLM judge / extractor / similarity calls.
 * @param judgeWorkdir A valid git working directory for the judge CLI invocation.
 * @param weights      Outer blend weights (hidden-test vs. judge/reference).
 * @param options      CLI + reference options (timeout, judgeSamples, etc.).
 */
export async function scoreRollout(
    task: Task,
    rollout: RolloutResult,
    judgeModel: string,
    judgeWorkdir: string,
    weights: ScoringWeights = DEFAULT_WEIGHTS,
    options: ScoreOptions = {}
): Promise<ScoreResult> {
    const hiddenTestPassRate = rollout.hiddenTestPassRate;
    const { judgeSamples, referenceWeights, ...cliOptions } = options;

    if (task.judgeTarget === 'stdout') {
        const ref = await scoreReference(
            task,
            rollout,
            judgeModel,
            judgeWorkdir,
            judgeSamples ?? 1,
            referenceWeights ?? DEFAULT_REFERENCE_WEIGHTS,
            cliOptions
        );
        const score = blendScores(hiddenTestPassRate, ref.referenceScore, weights);
        return {
            score,
            hiddenTestPassRate,
            llmJudgeScore: ref.referenceScore,
            referenceScore: ref.referenceScore,
            pointF1: ref.pointF1,
            holisticScore: ref.holisticScore,
        };
    }

    const llmJudgeScore = await runLlmJudge(task, rollout, judgeModel, judgeWorkdir, cliOptions);
    const score = blendScores(hiddenTestPassRate, llmJudgeScore, weights);

    return { score, hiddenTestPassRate, llmJudgeScore };
}

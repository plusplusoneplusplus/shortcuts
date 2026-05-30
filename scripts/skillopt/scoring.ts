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

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Computes the full blended score for a completed rollout.
 *
 * @param task         The task the rollout was for.
 * @param rollout      The RolloutResult (contains hiddenTestPassRate already).
 * @param judgeModel   Model for the LLM judge call.
 * @param judgeWorkdir A valid git working directory for the judge CLI invocation.
 * @param weights      Blend weights.
 * @param options      CLI options (timeout etc.) for the judge call.
 */
export async function scoreRollout(
    task: Task,
    rollout: RolloutResult,
    judgeModel: string,
    judgeWorkdir: string,
    weights: ScoringWeights = DEFAULT_WEIGHTS,
    options: CopilotCliOptions = {}
): Promise<ScoreResult> {
    const hiddenTestPassRate = rollout.hiddenTestPassRate;
    const llmJudgeScore = await runLlmJudge(task, rollout, judgeModel, judgeWorkdir, options);
    const score = blendScores(hiddenTestPassRate, llmJudgeScore, weights);

    return { score, hiddenTestPassRate, llmJudgeScore };
}

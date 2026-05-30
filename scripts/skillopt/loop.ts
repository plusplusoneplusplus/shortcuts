/**
 * AC-07: SkillOpt main loop + artifact management.
 *
 * Wires AC-03..AC-06 into a bounded loop that:
 *   1. Scores the initial skill on the selection split (baseline).
 *   2. For each step:
 *      a. Runs rollouts on all train tasks.
 *      b. Scores each rollout.
 *      c. Calls the optimizer to propose one bounded edit.
 *      d. Scores the candidate skill on the selection split.
 *      e. Runs the validation gate (accept iff strictly improves).
 *      f. Writes history entry and, if accepted, updates best_skill.md atomically.
 *   3. Writes a final summary on completion or Ctrl-C.
 *
 * Artifacts (in output directory):
 *   best_skill.md       — best skill seen so far (atomic write via tmp → rename)
 *   history.jsonl       — one JSON line per completed step
 *   summary.json        — final summary written on exit
 */

import * as fs from 'fs';
import * as path from 'path';
import { Corpus, Task } from './corpus';
import { runRollout, RolloutResult, RolloutOptions } from './rollout';
import { scoreRollout, ScoreResult, ScoringWeights, DEFAULT_WEIGHTS } from './scoring';
import { proposeOptimizedSkill } from './optimizer';
import { evaluateGate, GateResult } from './gate';
import { CopilotCliOptions } from './cli-driver';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoopConfig {
    skillPath: string;
    corpusPath: string;
    outDir: string;
    repoRoot: string;
    targetModel: string;
    optimizerModel: string;
    maxSteps: number;
    weights: ScoringWeights;
    cliOptions: CopilotCliOptions;
}

export interface StepHistory {
    step: number;
    trainScores: Array<{ taskId: string; score: number }>;
    candidateScore: number;
    gate: GateResult;
    editType: string | null;
    editAnchor: string | null;
    parseNote: string;
}

export interface LoopSummary {
    totalSteps: number;
    acceptedSteps: number;
    initialScore: number;
    finalScore: number;
    bestSkillPath: string;
}

// ─── Atomic write ─────────────────────────────────────────────────────────────

/** Writes content to path atomically via a tmp file → rename. */
function atomicWrite(filePath: string, content: string): void {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filePath);
}

// ─── Scoring helper ───────────────────────────────────────────────────────────

async function scoreSkillOnTasks(
    skillContent: string,
    tasks: Task[],
    config: LoopConfig
): Promise<number> {
    let total = 0;
    for (const task of tasks) {
        const rolloutOpts: RolloutOptions = {
            skillContent,
            model: config.targetModel,
            repoRoot: config.repoRoot,
            ...config.cliOptions,
        };

        let rollout: RolloutResult;
        try {
            rollout = await runRollout(task, rolloutOpts);
        } catch (err) {
            // Failed rollout scores 0
            total += 0;
            continue;
        }

        const scored = await scoreRollout(
            task,
            rollout,
            config.optimizerModel,
            config.repoRoot,
            config.weights,
            config.cliOptions
        );
        total += scored.score;
    }
    return tasks.length > 0 ? total / tasks.length : 0;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runLoop(corpus: Corpus, config: LoopConfig): Promise<LoopSummary> {
    fs.mkdirSync(config.outDir, { recursive: true });

    const historyPath = path.join(config.outDir, 'history.jsonl');
    const bestSkillPath = path.join(config.outDir, 'best_skill.md');
    const summaryPath = path.join(config.outDir, 'summary.json');

    let currentSkill = fs.readFileSync(config.skillPath, 'utf-8');
    let bestSkill = currentSkill;

    // Score baseline on selection split
    console.log('[skillopt] Scoring baseline on selection split…');
    let bestScore = await scoreSkillOnTasks(currentSkill, corpus.selectionTasks, config);
    console.log(`[skillopt] Baseline score: ${bestScore.toFixed(4)}`);

    // Write initial best
    atomicWrite(bestSkillPath, bestSkill);

    let acceptedSteps = 0;
    const initialScore = bestScore;

    const summary: LoopSummary = {
        totalSteps: 0,
        acceptedSteps: 0,
        initialScore,
        finalScore: bestScore,
        bestSkillPath,
    };

    // Ctrl-C handler: flush summary before exit
    let interrupted = false;
    const sigintHandler = () => {
        interrupted = true;
        console.log('\n[skillopt] Interrupted — flushing summary…');
        summary.totalSteps = summary.totalSteps; // already tracked
        summary.finalScore = bestScore;
        summary.acceptedSteps = acceptedSteps;
        atomicWrite(summaryPath, JSON.stringify(summary, null, 2));
        process.exit(0);
    };
    process.on('SIGINT', sigintHandler);

    try {
        for (let step = 1; step <= config.maxSteps && !interrupted; step++) {
            console.log(`\n[skillopt] ── Step ${step}/${config.maxSteps} ──`);

            // 1. Rollouts on train tasks
            const rolloutResults: Array<{ rollout: RolloutResult; score: ScoreResult }> = [];
            for (const task of corpus.trainTasks) {
                console.log(`[skillopt]   Rolling out task: ${task.id}`);
                const rolloutOpts: RolloutOptions = {
                    skillContent: currentSkill,
                    model: config.targetModel,
                    repoRoot: config.repoRoot,
                    ...config.cliOptions,
                };

                let rollout: RolloutResult;
                try {
                    rollout = await runRollout(task, rolloutOpts);
                } catch (err) {
                    console.warn(`[skillopt]   Rollout failed for ${task.id}: ${(err as Error).message}`);
                    continue;
                }

                const scored = await scoreRollout(
                    task,
                    rollout,
                    config.optimizerModel,
                    config.repoRoot,
                    config.weights,
                    config.cliOptions
                );
                console.log(`[skillopt]   Score: ${scored.score.toFixed(4)} (hidden=${scored.hiddenTestPassRate}, judge=${scored.llmJudgeScore.toFixed(3)})`);
                rolloutResults.push({ rollout, score: scored });
            }

            // 2. Optimizer edit
            console.log('[skillopt]   Proposing optimizer edit…');
            const optResult = await proposeOptimizedSkill(
                currentSkill,
                rolloutResults,
                config.optimizerModel,
                config.repoRoot,
                config.cliOptions
            );

            if (optResult.edit === null || optResult.candidateSkill === currentSkill) {
                console.log(`[skillopt]   Optimizer no-op: ${optResult.parseNote}`);
            } else {
                console.log(`[skillopt]   Edit: ${optResult.edit.type} @ "${optResult.edit.anchor}"`);
            }

            // 3. Score candidate on selection split
            console.log('[skillopt]   Scoring candidate on selection split…');
            const candidateScore = await scoreSkillOnTasks(
                optResult.candidateSkill,
                corpus.selectionTasks,
                config
            );

            // 4. Gate
            const gate = evaluateGate(candidateScore, bestScore);
            console.log(`[skillopt]   Gate: ${gate.note}`);

            if (gate.accepted) {
                bestSkill = optResult.candidateSkill;
                currentSkill = optResult.candidateSkill;
                bestScore = candidateScore;
                acceptedSteps++;
                atomicWrite(bestSkillPath, bestSkill);
                console.log('[skillopt]   ✓ New best skill written.');
            }

            // 5. Write history entry
            const entry: StepHistory = {
                step,
                trainScores: rolloutResults.map(r => ({
                    taskId: r.rollout.taskId,
                    score: r.score.score,
                })),
                candidateScore,
                gate,
                editType: optResult.edit?.type ?? null,
                editAnchor: optResult.edit?.anchor ?? null,
                parseNote: optResult.parseNote,
            };
            fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n', 'utf-8');

            summary.totalSteps = step;
        }
    } finally {
        process.off('SIGINT', sigintHandler);
    }

    summary.totalSteps = config.maxSteps < 1 ? 0 : summary.totalSteps;
    summary.acceptedSteps = acceptedSteps;
    summary.finalScore = bestScore;

    atomicWrite(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\n[skillopt] Done. Best score: ${bestScore.toFixed(4)}. Artifacts in: ${config.outDir}`);

    return summary;
}

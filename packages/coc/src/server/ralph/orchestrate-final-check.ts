/**
 * AC-04/05 — Orchestrate the outcome of a completed final-check task.
 *
 * Responsibilities:
 *  1. Parse the checker AI response for a RALPH_FINAL_CHECK_RESULT block.
 *  2. Persist the result section in progress.md and update session.json.
 *  3. When gaps exist and the safety cap is not reached, start a same-session
 *     new loop with a focused gap-fix goal (AC-04).
 *  4. Repeat check → gap-loop → check until clean or cap reached (AC-05).
 *  5. Never create a Work Item or modify the session outside these boundaries.
 *
 * The caller (queue-executor-bridge) is responsible for supplying injected
 * callbacks so this module remains testable without a live queue.
 */

import { parseFinalCheckResult, type FinalCheckResult } from './final-check-result-parser';
import { RalphSessionStore } from './ralph-session-store';
import { buildRalphIterationTask } from './enqueue-iteration';
import type { RalphFinalCheckRecord } from './types';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { resolveRalphAdditionalIterations } from '../routes/ralph-route-utils';

// ============================================================================
// Injected dependencies (allow testability without a live bridge/WS)
// ============================================================================

export interface OrchestrateFinalCheckDeps {
    /** Persist final-check records and progress sections. */
    store: RalphSessionStore;
    /** Enqueue a task and return its assigned task ID. */
    enqueueTask: (payload: ReturnType<typeof buildRalphIterationTask>) => string;
    /**
     * Broadcast a ralph-session-complete WS event when the session is
     * genuinely finished (clean check or cap reached).
     */
    broadcastSessionComplete: (params: {
        workspaceId: string;
        sessionId: string;
        processId: string;
        totalIterations: number;
        reason: string;
    }) => void;
    /** Resolved `ralph.finalCheck.maxGapFixLoops` from config (default: 3). */
    maxGapFixLoops: number;
    /** Repo-scoped data root (e.g. `~/.coc`). Used for prompt overrides & prefs. */
    dataDir?: string;
    /** Working directory for gap-fix iteration tasks. */
    workingDirectory?: string;
    /** folderPath for gap-fix iteration tasks. */
    folderPath?: string;
    /** AI provider override for gap-fix iterations. */
    provider?: import('../tasks/task-types').ChatProvider;
    /** repoId for gap-fix iteration tasks. */
    repoId?: string;
}

export interface OrchestrateFinalCheckInput {
    workspaceId: string;
    sessionId: string;
    checkIndex: number;
    loopIndex: number;
    sourceIteration: number;
    taskId: string;
    processId: string;
    responseText: string;
    deps: OrchestrateFinalCheckDeps;
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Orchestrate the outcome of a completed final-check AI task.
 *
 * This function is intentionally async-void from the bridge's perspective:
 * all errors are logged and do not propagate.
 */
export async function orchestrateFinalCheck(input: OrchestrateFinalCheckInput): Promise<void> {
    const {
        workspaceId, sessionId, checkIndex, loopIndex, sourceIteration,
        taskId, processId, responseText, deps,
    } = input;
    const { store, enqueueTask, broadcastSessionComplete, maxGapFixLoops, dataDir } = deps;
    const logger = getLogger();

    // ── 1. Parse checker output ─────────────────────────────────────────────
    const parsed = parseFinalCheckResult(responseText);

    const nowIso = new Date().toISOString();

    // ── 2. Persist progress section ─────────────────────────────────────────
    const progressSection = buildProgressSection(checkIndex, loopIndex, parsed, nowIso);
    try {
        await store.appendFinalCheckSection(workspaceId, sessionId, progressSection);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Failed to append progress section for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        // A failure here must not silently report a clean result (AC-03 edge case).
        // We still update metadata so the record shows failed status.
    }

    // ── 3. Determine result and decide next action ───────────────────────────
    const session = await store.readSessionRecord(workspaceId, sessionId);
    const startedAt = session?.finalChecks?.find(c => c.checkIndex === checkIndex)?.startedAt ?? nowIso;
    const baseCheckRecord = buildBaseCheckRecord({ loopIndex, sourceIteration, taskId, processId }, startedAt, nowIso);

    if (parsed.status === 'unparseable' || parsed.status === 'invalid') {
        // Unparseable or contradictory response — record as failed, do not start gap loop
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Check ${checkIndex} ${parsed.status} for ${sessionId}: ${parsed.error ?? ''}`);
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
            status: 'failed',
            ...baseCheckRecord,
            hasGaps: false,
            gapCount: 0,
        }, logger);
        broadcastSessionComplete({ workspaceId, sessionId, processId, totalIterations: sourceIteration, reason: 'final-check-failed' });
        return;
    }

    if (!parsed.hasGaps || parsed.gaps.length === 0) {
        // ── Clean result ─────────────────────────────────────────────────────
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
            status: 'completed',
            ...baseCheckRecord,
            hasGaps: false,
            gapCount: 0,
            gapLoopStarted: false,
        }, logger);
        broadcastSessionComplete({ workspaceId, sessionId, processId, totalIterations: sourceIteration, reason: 'signal' });
        return;
    }

    // ── Gaps found — check safety cap ────────────────────────────────────────
    // Count how many gap-fix loops have already been started (not initial loop).
    const existingGapLoops = (session?.finalChecks ?? []).filter(c => c.gapLoopStarted === true).length;
    if (existingGapLoops >= maxGapFixLoops) {
        // Cap reached — persist and surface
        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Cap reached (${existingGapLoops}/${maxGapFixLoops}) for session ${sessionId}; stopping automation.`);
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
            status: 'completed',
            ...baseCheckRecord,
            hasGaps: true,
            gapCount: parsed.gaps.length,
            gapLoopStarted: false,
            capReached: true,
        }, logger);
        broadcastSessionComplete({ workspaceId, sessionId, processId, totalIterations: sourceIteration, reason: 'cap' });
        return;
    }

    // ── Start gap-fix loop (AC-04) ────────────────────────────────────────────
    // The parser already synthesizes gapFixGoal when absent (AC-02); use it directly.
    const gapFixGoal = (parsed.gapFixGoal ?? '').trim();
    const goalSynthesized = parsed.goalSynthesized ?? false;
    if (!gapFixGoal) {
        // Should never happen (parser guarantees gapFixGoal when hasGaps: true), but defensive
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] No gapFixGoal for ${sessionId} — falling back to gap titles.`);
    }

    const additionalIterations = resolveRalphAdditionalIterations(undefined, dataDir, workspaceId);

    let newLoopRecord;
    try {
        newLoopRecord = await store.startNewLoop(workspaceId, sessionId, gapFixGoal, additionalIterations, nowIso);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] startNewLoop failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        // Record that a gap loop was intended but failed to start.
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
            status: 'completed',
            ...baseCheckRecord,
            hasGaps: true,
            gapCount: parsed.gaps.length,
            gapLoopStarted: false,
            goalSynthesized,
        }, logger);
        broadcastSessionComplete({ workspaceId, sessionId, processId, totalIterations: sourceIteration, reason: 'final-check-gap-loop-start-failed' });
        return;
    }

    const newLoopIndex = newLoopRecord.loops?.[newLoopRecord.loops.length - 1]?.loopIndex ?? (loopIndex + 1);
    const nextIteration = newLoopRecord.currentIteration + 1;

    const taskInput = buildRalphIterationTask({
        workspaceId,
        workingDirectory: deps.workingDirectory,
        folderPath: deps.folderPath,
        sessionId,
        originalGoal: gapFixGoal,
        iteration: nextIteration,
        maxIterations: newLoopRecord.maxIterations,
        dataDir,
        provider: deps.provider,
        extraContext: { ralph: { loopIndex: newLoopIndex } },
    });

    let newTaskId: string;
    try {
        newTaskId = enqueueTask(taskInput);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] enqueue gap-fix failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
            status: 'completed',
            ...baseCheckRecord,
            hasGaps: true,
            gapCount: parsed.gaps.length,
            gapLoopStarted: false,
            goalSynthesized,
        }, logger);
        broadcastSessionComplete({ workspaceId, sessionId, processId, totalIterations: sourceIteration, reason: 'final-check-gap-enqueue-failed' });
        return;
    }

    logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Gap-fix loop ${newLoopIndex} enqueued as task ${newTaskId} for session ${sessionId}.`);

    await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
        status: 'completed',
        ...baseCheckRecord,
        hasGaps: true,
        gapCount: parsed.gaps.length,
        gapLoopStarted: true,
        gapLoopIndex: newLoopIndex,
        goalSynthesized: goalSynthesized || undefined,
    }, logger);
}

// ============================================================================
// Private helpers
// ============================================================================

function buildBaseCheckRecord(
    fields: Pick<RalphFinalCheckRecord, 'loopIndex' | 'sourceIteration' | 'taskId' | 'processId'>,
    startedAt: string,
    nowIso: string,
): Pick<RalphFinalCheckRecord, 'loopIndex' | 'sourceIteration' | 'taskId' | 'processId' | 'startedAt' | 'completedAt'> {
    return { ...fields, startedAt, completedAt: nowIso };
}

async function safeUpsertRecord(
    store: RalphSessionStore,
    workspaceId: string,
    sessionId: string,
    checkIndex: number,
    partial: Partial<RalphFinalCheckRecord> & Pick<RalphFinalCheckRecord, 'status'>,
    logger: ReturnType<typeof getLogger>,
): Promise<void> {
    try {
        await store.upsertFinalCheckRecord(workspaceId, sessionId, checkIndex, partial);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Failed to persist metadata for ${sessionId} check ${checkIndex}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function buildProgressSection(
    checkIndex: number,
    loopIndex: number,
    parsed: FinalCheckResult,
    nowIso: string,
): string {
    if (parsed.status === 'unparseable' || parsed.status === 'invalid') {
        return [
            `---`,
            `## Final Check ${checkIndex} - FAILED - ${nowIso}`,
            `Loop: ${loopIndex}`,
            ``,
            `The final-check task completed but produced no parseable RALPH_FINAL_CHECK_RESULT block.`,
            `Automation stopped. Manual review required.`,
            ...(parsed.error ? [`Error: ${parsed.error}`] : []),
        ].join('\n');
    }
    if (!parsed.hasGaps) {
        return [
            `---`,
            `## Final Check ${checkIndex} - CLEAN - ${nowIso}`,
            `Loop: ${loopIndex}`,
            ``,
            parsed.summary,
        ].join('\n');
    }
    const gapLines = parsed.gaps.map((g: FinalCheckResult['gaps'][number]) =>
        `- **${g.id}**: ${g.title}\n  Evidence: ${g.evidence}\n  Action: ${g.recommendedAction}${g.validation ? `\n  Validation: \`${g.validation}\`` : ''}`,
    ).join('\n');
    return [
        `---`,
        `## Final Check ${checkIndex} - GAPS - ${nowIso}`,
        `Loop: ${loopIndex}`,
        ``,
        parsed.summary,
        ``,
        `### Gaps (${parsed.gaps.length})`,
        gapLines,
        ``,
        `### Gap-fix goal`,
        parsed.gapFixGoal ?? '*(synthesized)*',
    ].join('\n');
}



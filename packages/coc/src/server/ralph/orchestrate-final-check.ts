/**
 * AC-04/05 — Orchestrate the outcome of a completed final-check task.
 *
 * Responsibilities:
 *  1. Ask coc-workflow/ralph for portable final-check action intents.
 *  2. Apply CoC-owned side effects: progress.md, session.json, queue, WS.
 *  3. When gaps exist and the safety cap is not reached, start a same-session
 *     new loop with a focused gap-fix goal (AC-04).
 *  4. Repeat check → gap-loop → check until clean or cap reached (AC-05).
 *  5. Never create a Work Item or modify the session outside these boundaries.
 *
 * The caller (queue-executor-bridge) supplies injected callbacks so this module
 * remains testable without a live queue.
 */

import {
    decideRalphFinalCheckActions,
    type RalphFinalCheckRecordPatch,
    type RalphStartGapFixLoopAction,
} from '@plusplusoneplusplus/coc-workflow/ralph';
import { RalphSessionStore } from './ralph-session-store';
import { buildRalphIterationTask } from './enqueue-iteration';
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
    /** Non-Ralph context to preserve when enqueueing gap-fix iterations. */
    extraContext?: Record<string, unknown>;
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
    const { store, broadcastSessionComplete, maxGapFixLoops } = deps;
    const logger = getLogger();

    const nowIso = new Date().toISOString();
    const session = await store.readSessionRecord(workspaceId, sessionId);
    const decision = decideRalphFinalCheckActions({
        responseText,
        taskId,
        processId,
        workspaceId,
        sessionId,
        checkIndex,
        loopIndex,
        sourceIteration,
        maxGapFixLoops,
        session,
        nowIso,
    });

    if (decision.result.status === 'unparseable' || decision.result.status === 'invalid') {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Check ${checkIndex} ${decision.result.status} for ${sessionId}: ${decision.result.error ?? ''}`);
    } else if (decision.result.hasGaps && decision.existingGapFixLoops >= decision.maxGapFixLoops) {
        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Cap reached (${decision.existingGapFixLoops}/${decision.maxGapFixLoops}) for session ${sessionId}; stopping automation.`);
    }

    for (const action of decision.actions) {
        switch (action.type) {
            case 'appendFinalCheckSection':
                try {
                    await store.appendFinalCheckSection(workspaceId, sessionId, action.section);
                } catch (err) {
                    logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Failed to append progress section for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
                    // A failure here must not silently report a clean result. We still
                    // apply subsequent metadata/broadcast actions from the decision.
                }
                break;

            case 'upsertFinalCheckRecord':
                await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, action.record, logger);
                break;

            case 'broadcastSessionComplete':
                broadcastSessionComplete({
                    workspaceId,
                    sessionId,
                    processId: action.processId,
                    totalIterations: action.totalIterations,
                    reason: action.reason,
                });
                break;

            case 'startGapFixLoop':
                await startGapFixLoop({
                    action,
                    deps,
                    store,
                    workspaceId,
                    sessionId,
                    checkIndex,
                    loopIndex,
                    sourceIteration,
                    processId,
                    nowIso,
                    logger,
                });
                break;
        }
    }
}

// ============================================================================
// Private helpers
// ============================================================================

interface StartGapFixLoopInput {
    action: RalphStartGapFixLoopAction;
    deps: OrchestrateFinalCheckDeps;
    store: RalphSessionStore;
    workspaceId: string;
    sessionId: string;
    checkIndex: number;
    loopIndex: number;
    sourceIteration: number;
    processId: string;
    nowIso: string;
    logger: ReturnType<typeof getLogger>;
}

async function startGapFixLoop(input: StartGapFixLoopInput): Promise<void> {
    const {
        action,
        deps,
        store,
        workspaceId,
        sessionId,
        checkIndex,
        loopIndex,
        sourceIteration,
        processId,
        nowIso,
        logger,
    } = input;

    const additionalIterations = resolveRalphAdditionalIterations(undefined, deps.dataDir, workspaceId);

    let newLoopRecord;
    try {
        newLoopRecord = await store.startNewLoop(workspaceId, sessionId, action.gapFixGoal, additionalIterations, nowIso);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] startNewLoop failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, action.failureRecord, logger);
        deps.broadcastSessionComplete({
            workspaceId,
            sessionId,
            processId,
            totalIterations: sourceIteration,
            reason: action.startFailureReason,
        });
        return;
    }

    const newLoopIndex = newLoopRecord.loops?.[newLoopRecord.loops.length - 1]?.loopIndex ?? (loopIndex + 1);
    const nextIteration = newLoopRecord.currentIteration + 1;

    const taskInput = buildRalphIterationTask({
        workspaceId,
        workingDirectory: deps.workingDirectory,
        folderPath: deps.folderPath,
        sessionId,
        originalGoal: action.gapFixGoal,
        iteration: nextIteration,
        maxIterations: newLoopRecord.maxIterations,
        dataDir: deps.dataDir,
        provider: deps.provider,
        continuationOfSessionId: sessionId,
        extraContext: { ...(deps.extraContext ?? {}), ralph: { loopIndex: newLoopIndex } },
    });

    let newTaskId: string;
    try {
        newTaskId = deps.enqueueTask(taskInput);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] enqueue gap-fix failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, action.failureRecord, logger);
        deps.broadcastSessionComplete({
            workspaceId,
            sessionId,
            processId,
            totalIterations: sourceIteration,
            reason: action.enqueueFailureReason,
        });
        return;
    }

    logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Gap-fix loop ${newLoopIndex} enqueued as task ${newTaskId} for session ${sessionId}.`);

    await safeUpsertRecord(store, workspaceId, sessionId, checkIndex, {
        ...action.successRecordBase,
        gapLoopIndex: newLoopIndex,
    }, logger);
}

async function safeUpsertRecord(
    store: RalphSessionStore,
    workspaceId: string,
    sessionId: string,
    checkIndex: number,
    partial: RalphFinalCheckRecordPatch,
    logger: ReturnType<typeof getLogger>,
): Promise<void> {
    try {
        await store.upsertFinalCheckRecord(workspaceId, sessionId, checkIndex, partial);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Failed to persist metadata for ${sessionId} check ${checkIndex}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

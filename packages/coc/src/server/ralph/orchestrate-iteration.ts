/**
 * CoC host adapter for orchestrating one completed Ralph iteration.
 *
 * Responsibilities:
 *  1. Ask coc-workflow/ralph for portable iteration action intents via
 *     decideRalphIterationActions.
 *  2. Apply CoC-owned side effects: journal writes, task enqueueing, WS broadcast.
 *  3. When the signal is RALPH_COMPLETE, enqueue a final-check task with
 *     in-memory + persistent idempotency guards.
 *
 * The queue-executor-bridge delegates to this function after a ralph-mode task
 * completes, making the bridge thin — it no longer directly encodes the
 * iteration/final-check branching policy.
 */

import { decideRalphIterationActions } from '@plusplusoneplusplus/coc-workflow/ralph';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from './ralph-session-store';
import { recordRalphIteration } from './record-iteration';
import { buildRalphIterationTask } from './enqueue-iteration';
import {
    buildFinalCheckTaskPayload,
    buildFinalCheckStartRecord,
    nextCheckIndex,
    sessionHasFinalCheckFor,
    wasFinalCheckEnqueued,
    markFinalCheckEnqueued,
} from './enqueue-final-check';

// ============================================================================
// Public interface
// ============================================================================

export interface OrchestrateRalphIterationDeps {
    /** Repo-scoped data root. Required for journal writes and final-check enqueue. */
    dataDir?: string;
    /** Enqueue a task and return its assigned task ID. */
    enqueueTask: (task: object) => string;
    /** Broadcast a ralph-session-complete WS/callback event. */
    broadcastSessionComplete: (params: {
        workspaceId: string;
        sessionId?: string;
        processId: string;
        totalIterations: number;
        reason: string;
    }) => void;
    /** Working directory for next-iteration and final-check tasks. */
    workingDirectory?: string;
    /** folderPath for next-iteration and final-check tasks. */
    folderPath?: string;
    /** AI provider override for next-iteration and final-check tasks. */
    provider?: import('../tasks/task-types').ChatProvider;
    /** repoId for next-iteration and final-check tasks. */
    repoId?: string;
    /**
     * The full payload context from the completed task (e.g. schedule context,
     * model overrides). Merged into the next iteration's context. This module
     * does not inspect the non-ralph fields; it passes them through opaquely.
     */
    existingPayloadContext?: Record<string, unknown>;
    /** The config from the completed task (carries model/reasoningEffort forward). */
    existingTaskConfig?: Record<string, unknown>;
}

export interface OrchestrateRalphIterationInput {
    responseText: string;
    /** Queue task ID of the completed iteration. */
    completedTaskId: string;
    processId: string;
    workspaceId?: string;
    sessionId?: string;
    originalGoal?: string;
    currentIteration?: number;
    maxIterations?: number;
    /** Epoch-ms timestamp of when this iteration began executing. */
    iterationStartMs?: number;
    /**
     * Host-owned adapter context passed through to iteration action intents
     * (e.g. schedule run metadata). Opaque to the portable decision layer.
     */
    adapterContext?: Record<string, unknown>;
    /** CoC-specific ralph context from the completed task's payload. */
    ralphCtx?: Record<string, unknown>;
    deps: OrchestrateRalphIterationDeps;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Orchestrate the outcome of one completed Ralph execution iteration.
 *
 * All errors from individual side-effect steps are logged and do not propagate,
 * matching the existing bridge error-tolerance contract.
 */
export async function orchestrateRalphIteration(input: OrchestrateRalphIterationInput): Promise<void> {
    const {
        responseText,
        completedTaskId,
        processId,
        workspaceId,
        sessionId,
        originalGoal,
        currentIteration,
        maxIterations,
        iterationStartMs,
        adapterContext,
        ralphCtx,
        deps,
    } = input;
    const logger = getLogger();

    const decision = decideRalphIterationActions({
        responseText,
        taskId: completedTaskId,
        processId,
        workspaceId,
        sessionId,
        originalGoal,
        currentIteration,
        maxIterations,
        iterationStartMs,
        adapterContext,
    });

    for (const action of decision.actions) {
        switch (action.type) {
            case 'recordIteration':
                await recordRalphIteration({
                    dataDir: deps.dataDir,
                    workspaceId: action.workspaceId,
                    sessionId: action.sessionId,
                    iteration: action.iteration,
                    maxIterations: action.maxIterations,
                    signal: action.signal,
                    progressBody: action.progressBody,
                    taskId: action.taskId,
                    processId: action.processId,
                    shouldContinue: action.shouldContinue,
                    originalGoal: action.originalGoal,
                    iterationStartMs: action.iterationStartMs,
                }).catch(err => {
                    logger.debug(LogCategory.AI, `[Ralph] journal persist failed for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                });
                break;

            case 'enqueueNextIteration': {
                const effectiveSessionId = action.sessionId ?? action.continuationOfSessionId;
                logger.debug(LogCategory.AI, `[Ralph] Enqueuing iteration ${action.iteration}/${action.maxIterations} for session ${effectiveSessionId}`);
                try {
                    const autoProviderRouting = isAutoProviderRoutingRequested(deps.existingPayloadContext);
                    const nextTask = buildRalphIterationTask({
                        workspaceId: action.workspaceId,
                        workingDirectory: deps.workingDirectory,
                        folderPath: deps.folderPath,
                        sessionId: effectiveSessionId,
                        originalGoal: action.originalGoal,
                        iteration: action.iteration,
                        maxIterations: action.maxIterations,
                        dataDir: deps.dataDir,
                        provider: autoProviderRouting ? undefined : deps.provider,
                        autoProviderRouting,
                        continuationOfSessionId: action.continuationOfSessionId,
                        displayName: action.displayName,
                        extraContext: deps.existingPayloadContext,
                    });
                    deps.enqueueTask({
                        ...nextTask,
                        repoId: deps.repoId,
                        payload: {
                            ...nextTask.payload,
                            context: {
                                ...nextTask.payload.context,
                                ...deps.existingPayloadContext,
                                ralph: {
                                    ...(ralphCtx ?? {}),
                                    ...nextTask.payload.context.ralph,
                                    originalGoal: action.originalGoal,
                                    currentIteration: action.iteration,
                                    maxIterations: action.maxIterations,
                                    sessionId: effectiveSessionId,
                                    phase: 'executing' as const,
                                },
                            },
                        },
                        config: deps.existingTaskConfig ?? nextTask.config,
                    });
                } catch (err) {
                    logger.warn(LogCategory.AI, `[Ralph] Failed to enqueue next iteration for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                }
                break;
            }

            case 'surfaceTerminalReason':
                logger.debug(LogCategory.AI, `[Ralph] Terminal reason for ${processId}: ${action.terminalReason} (${action.completionReason})`);
                break;

            case 'enqueueFinalCheck':
                await enqueueFinalCheckForSession({
                    workspaceId: action.workspaceId,
                    sessionId: action.sessionId,
                    sourceIteration: action.sourceIteration,
                    completedTaskId,
                    processId,
                    ralphCtx,
                    deps,
                }).catch(err => {
                    logger.warn(LogCategory.AI, `[Ralph] enqueueFinalCheckForSession failed: ${err instanceof Error ? err.message : String(err)}`);
                    if (action.workspaceId) {
                        deps.broadcastSessionComplete({
                            workspaceId: action.workspaceId,
                            sessionId: action.sessionId,
                            processId,
                            totalIterations: action.sourceIteration,
                            reason: 'final-check-enqueue-failed',
                        });
                    }
                });
                break;

            case 'completeSession':
                logger.debug(LogCategory.AI, `[Ralph] Session complete for ${processId} (reason: ${action.completionReason}, iterations: ${action.totalIterations})`);
                if (action.workspaceId) {
                    deps.broadcastSessionComplete({
                        workspaceId: action.workspaceId,
                        sessionId: action.sessionId,
                        processId: action.processId,
                        totalIterations: action.totalIterations,
                        reason: action.completionReason,
                    });
                }
                break;
        }
    }
}

// ============================================================================
// Private helpers
// ============================================================================

interface EnqueueFinalCheckInput {
    workspaceId?: string;
    sessionId?: string;
    sourceIteration: number;
    completedTaskId: string;
    processId: string;
    ralphCtx?: Record<string, unknown>;
    deps: OrchestrateRalphIterationDeps;
}

/**
 * Enqueue a final-check task after a RALPH_COMPLETE iteration, with
 * in-memory + persistent idempotency guards.
 *
 * Falls back to broadcasting a 'signal' session-complete event when no
 * dataDir is configured (no journal to check against).
 */
async function enqueueFinalCheckForSession(input: EnqueueFinalCheckInput): Promise<void> {
    const { workspaceId, sessionId, sourceIteration, completedTaskId, processId, ralphCtx, deps } = input;
    const logger = getLogger();

    if (!workspaceId || !sessionId) return;

    if (!deps.dataDir) {
        // No journal configured — fall back to direct session-complete signal.
        deps.broadcastSessionComplete({
            workspaceId,
            sessionId,
            processId: completedTaskId,
            totalIterations: sourceIteration,
            reason: 'signal',
        });
        return;
    }

    // ── In-memory idempotency guard ──────────────────────────────────────────
    if (wasFinalCheckEnqueued(sessionId, sourceIteration)) {
        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Duplicate completion event ignored for ${sessionId}:${sourceIteration}`);
        return;
    }

    // ── Persistent idempotency guard (survives server restart) ───────────────
    const store = new RalphSessionStore({ dataDir: deps.dataDir });
    const session = await store.readSessionRecord(workspaceId, sessionId);
    if (!session) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Session record missing for ${sessionId}; skipping final-check enqueue.`);
        deps.broadcastSessionComplete({
            workspaceId,
            sessionId,
            processId: completedTaskId,
            totalIterations: sourceIteration,
            reason: 'final-check-session-missing',
        });
        return;
    }

    if (sessionHasFinalCheckFor(session, sourceIteration)) {
        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Persistent duplicate: check for ${sessionId}:${sourceIteration} already exists.`);
        return;
    }

    markFinalCheckEnqueued(sessionId, sourceIteration);

    const checkIndex = nextCheckIndex(session);
    const loopIndex = (ralphCtx?.loopIndex as number | undefined)
        ?? (session.loops?.[session.loops.length - 1]?.loopIndex ?? 1);

    const progressPath = store.getProgressPath(workspaceId, sessionId);

    const taskPayload = buildFinalCheckTaskPayload({
        workspaceId,
        sessionId,
        originalGoal: session.originalGoal,
        checkIndex,
        sourceIteration,
        loopIndex,
        progressPath,
        workingDirectory: deps.workingDirectory,
        folderPath: deps.folderPath,
        repoId: deps.repoId,
        provider: isAutoProviderRoutingRequested(deps.existingPayloadContext) ? undefined : deps.provider,
        extraContext: deps.existingPayloadContext,
    });

    let newTaskId: string;
    try {
        newTaskId = deps.enqueueTask(taskPayload);
    } catch (err) {
        logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        deps.broadcastSessionComplete({
            workspaceId,
            sessionId,
            processId: completedTaskId,
            totalIterations: sourceIteration,
            reason: 'final-check-enqueue-failed',
        });
        return;
    }

    // Persist the queued-status record immediately so session observers see
    // the check is in progress before the AI response arrives.
    const startRecord = buildFinalCheckStartRecord(
        checkIndex, loopIndex, sourceIteration, newTaskId, undefined, new Date().toISOString(),
    );
    await store.upsertFinalCheckRecord(workspaceId, sessionId, checkIndex, startRecord).catch(err => {
        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Failed to persist start record: ${err instanceof Error ? err.message : String(err)}`);
    });

    logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Enqueued final-check task ${newTaskId} (check ${checkIndex}) for session ${sessionId}`);
}

function isAutoProviderRoutingRequested(context: Record<string, unknown> | undefined): boolean {
    const routing = context?.autoProviderRouting;
    return Boolean(
        routing
        && typeof routing === 'object'
        && !Array.isArray(routing)
        && (routing as Record<string, unknown>).requested === true
    );
}

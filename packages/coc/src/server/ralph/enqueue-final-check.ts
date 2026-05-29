/**
 * AC-01 helpers — final-check task construction and idempotency guards.
 *
 * Responsibilities:
 *  - Build the queue payload for a final-check task.
 *  - Provide a per-process in-memory Set that guards against duplicate enqueues
 *    (duplicate completion events for the same session + sourceIteration).
 *  - Provide pure helpers for computing the next checkIndex and detecting whether
 *    a check for a given sourceIteration already exists in the persisted record.
 */

import { buildFinalCheckPrompt } from './final-check-prompt';
import type { RalphFinalCheckRecord, RalphSessionRecord } from './types';

// ============================================================================
// In-memory idempotency guard (AC-01 §assumption 5)
// ============================================================================

/**
 * Key format: `<sessionId>:<sourceIteration>`
 * Guards against duplicate completion events within the lifetime of the server
 * process. Persistent duplicate detection uses `sessionHasFinalCheckFor`.
 */
const _enqueuedSet = new Set<string>();

export function finalCheckIdempotencyKey(sessionId: string, sourceIteration: number): string {
    return `${sessionId}:${sourceIteration}`;
}

export function wasFinalCheckEnqueued(sessionId: string, sourceIteration: number): boolean {
    return _enqueuedSet.has(finalCheckIdempotencyKey(sessionId, sourceIteration));
}

export function markFinalCheckEnqueued(sessionId: string, sourceIteration: number): void {
    _enqueuedSet.add(finalCheckIdempotencyKey(sessionId, sourceIteration));
}

/** Exposed for test isolation only. */
export function _clearFinalCheckEnqueuedSet(): void {
    _enqueuedSet.clear();
}

// ============================================================================
// Persistent duplicate detection
// ============================================================================

/**
 * Returns true when the session record already contains a final-check entry
 * whose `sourceIteration` matches the given value.
 *
 * This catches duplicates that survive a server restart (in-memory Set empty).
 */
export function sessionHasFinalCheckFor(
    session: RalphSessionRecord,
    sourceIteration: number,
): boolean {
    return (session.finalChecks ?? []).some(c => c.sourceIteration === sourceIteration);
}

// ============================================================================
// Check index helpers
// ============================================================================

/** Returns the 1-based index for the next final check. */
export function nextCheckIndex(session: RalphSessionRecord): number {
    return (session.finalChecks?.length ?? 0) + 1;
}

// ============================================================================
// Task payload builder
// ============================================================================

export interface BuildFinalCheckTaskInput {
    workspaceId: string;
    sessionId: string;
    originalGoal: string;
    checkIndex: number;
    sourceIteration: number;
    loopIndex: number;
    progressPath: string;
    workingDirectory?: string;
    folderPath?: string;
    repoId?: string;
    provider?: import('../tasks/task-types').ChatProvider;
    extraContext?: Record<string, unknown>;
}

/**
 * Build a `chat` queue task payload for a final-check run.
 *
 * The task uses `mode='ralph'` so it is routed to the ralph executor, which
 * calls `onRalphNext` on completion. The `context.ralph.finalCheck` field
 * signals the bridge to route the completion to `handleFinalCheckCompletion`
 * instead of enqueuing the next iteration.
 */
export function buildFinalCheckTaskPayload(input: BuildFinalCheckTaskInput) {
    const {
        workspaceId, sessionId, originalGoal, checkIndex, sourceIteration,
        loopIndex, progressPath, workingDirectory, folderPath, repoId, provider,
        extraContext,
    } = input;

    const prompt = buildFinalCheckPrompt({
        originalGoal,
        progressPath,
        sessionId,
        workspaceId,
        loopIndex,
        sourceIteration,
    });

    return {
        type: 'chat' as const,
        priority: 'normal' as const,
        repoId,
        folderPath,
        displayName: `Ralph final check ${checkIndex} (${sessionId})`,
        config: {},
        payload: {
            kind: 'chat' as const,
            mode: 'ralph' as const,
            prompt,
            workspaceId,
            workingDirectory,
            folderPath,
            provider,
            context: {
                ...(extraContext ?? {}),
                ralph: {
                    phase: 'executing' as const,
                    sessionId,
                    originalGoal,
                    currentIteration: sourceIteration,
                    maxIterations: sourceIteration,
                    finalCheck: {
                        kind: 'goal-gap-check' as const,
                        checkIndex,
                        sourceIteration,
                        loopIndex,
                    },
                },
            },
        },
    };
}

// ============================================================================
// Start-record builder
// ============================================================================

/** Build the initial (status=running) RalphFinalCheckRecord before the task runs. */
export function buildFinalCheckStartRecord(
    checkIndex: number,
    loopIndex: number,
    sourceIteration: number,
    taskId: string,
    processId?: string,
    nowIso?: string,
): RalphFinalCheckRecord {
    return {
        checkIndex,
        loopIndex,
        sourceIteration,
        taskId,
        processId,
        startedAt: nowIso ?? new Date().toISOString(),
        status: 'running',
    };
}

/**
 * Helper for finalizing orphaned streaming conversation turns.
 *
 * When a process is force-failed or detected as stale, the in-memory executor
 * session has already been torn down (or the server itself was restarted),
 * so there is no remaining buffer to flush. The store may still contain a
 * dangling `streaming=true` assistant turn from the last throttle window.
 *
 * This helper checks for such a turn and replaces it with a finalized
 * (`streaming=false`) turn carrying the same content/timeline. The matching
 * status update (`failed` + `endTime` + `error`) is applied atomically via
 * `appendConversationTurn`'s `additionalUpdates` so the UI never sees an
 * intermediate state where the process is failed but still streaming.
 *
 * If the process has no orphaned streaming turn — or the store does not
 * expose `getConversationTurns` — falls back to a simple status-only
 * `updateProcess()` call.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isChatFollowUp } from '../tasks/task-types';

/**
 * Reconcile an orphaned process's status and finalize any dangling streaming
 * turn. The target status is usually terminal (`failed`/`cancelled`), but a
 * process that a live re-enqueued task will resume is revived to `queued`
 * instead — the partial assistant turn is still recorded as interrupted, but
 * no `error`/`endTime` is set because the run is pending, not finished.
 *
 * Best-effort: errors are swallowed (with a fallback updateProcess) so callers
 * (stale detector, force-fail endpoints, restart recovery) don't block on
 * cleanup failures.
 */
export async function finalizeOrphanedProcess(
    store: ProcessStore,
    processId: string,
    error: string,
    options: { status?: 'failed' | 'cancelled' | 'queued'; workspaceId?: string } = {},
): Promise<void> {
    const status = options.status ?? 'failed';
    const endTime = status === 'queued' ? undefined : new Date();

    try {
        const turns = typeof store.getConversationTurns === 'function'
            ? await store.getConversationTurns(processId)
            : (await store.getProcess(processId, options.workspaceId))?.conversationTurns;

        const streamingTurn = turns?.find(t => t.role === 'assistant' && t.streaming);

        if (streamingTurn) {
            await store.appendConversationTurn(
                processId,
                (turnIndex) => ({
                    role: 'assistant' as const,
                    content: streamingTurn.content || `Error: ${error}`,
                    timestamp: new Date(),
                    turnIndex,
                    timeline: streamingTurn.timeline ?? [],
                    interrupted: true,
                    interruptionReason: status === 'cancelled' ? 'Process cancelled' : error,
                }),
                {
                    filterStreaming: true,
                    additionalUpdates: {
                        status,
                        ...(endTime ? { endTime } : {}),
                        ...(status === 'failed' ? { error } : {}),
                    },
                },
            );
            return;
        }
    } catch {
        // Fall through to status-only update
    }

    try {
        await store.updateProcess(processId, {
            status,
            ...(endTime ? { endTime } : {}),
            ...(status === 'failed' ? { error } : {}),
        });
    } catch {
        // Non-fatal: process may not exist in store
    }
}

/**
 * Collect the set of process IDs that live (queued/running) chat follow-up
 * tasks will resume. A chat follow-up carries the existing conversation's
 * process ID in `payload.processId`, so when the queue persistence layer
 * re-enqueues it after a restart the original process is recoverable — not
 * orphaned. The startup sweep uses this set to revive those processes to
 * `queued` rather than mark them failed.
 */
export function collectResumableFollowUpProcessIds(
    tasks: Array<{ payload?: Record<string, unknown> }>,
): Set<string> {
    const ids = new Set<string>();
    for (const task of tasks) {
        const payload = task.payload;
        if (payload && isChatFollowUp(payload) && payload.processId) {
            ids.add(payload.processId);
        }
    }
    return ids;
}

/**
 * Sweep the process store for processes still marked `running` (or
 * `cancelling`) at server startup. These are processes whose executor session
 * was torn down by an unclean shutdown (crash, SIGKILL, host reboot).
 *
 * Most such rows are genuinely orphaned and are finalized as `failed`
 * (`cancelling` → `cancelled`). The exception is a `running` process whose ID
 * appears in `protectedProcessIds`: the queue persistence layer has already
 * re-enqueued a chat follow-up that points its `payload.processId` back at this
 * conversation, so it is recoverable. Those are revived to `queued` (pending
 * retry) instead, matching the task the user still sees in the queue. A
 * `cancelling` process is never revived — the user asked to cancel it.
 *
 * Call this AFTER the queue persistence layer has restored its tasks, so the
 * protected set reflects the re-enqueued work.
 *
 * Returns the count of processes `finalized` (failed/cancelled) and `revived`
 * (reset to queued).
 */
export async function sweepOrphanedRunningProcesses(
    store: ProcessStore,
    options: { error?: string; protectedProcessIds?: ReadonlySet<string> } = {},
): Promise<{ finalized: number; revived: number }> {
    const error = options.error ?? 'Process orphaned by server restart';
    const protectedIds = options.protectedProcessIds;

    let candidates: Array<{ id: string; status: string }> = [];
    try {
        const running = await store.getAllProcesses({ status: 'running' });
        const cancelling = await store.getAllProcesses({ status: 'cancelling' as any });
        candidates = [
            ...running.map(p => ({ id: p.id, status: 'running' })),
            ...cancelling.map(p => ({ id: p.id, status: 'cancelling' })),
        ];
    } catch {
        return { finalized: 0, revived: 0 };
    }

    let finalized = 0;
    let revived = 0;
    for (const { id, status } of candidates) {
        // A still-`running` process that a live re-enqueued follow-up will
        // resume is recoverable — revive it to pending instead of failing it.
        if (status === 'running' && protectedIds?.has(id)) {
            await finalizeOrphanedProcess(store, id, error, { status: 'queued' });
            revived++;
            continue;
        }
        const finalStatus = status === 'cancelling' ? 'cancelled' : 'failed';
        await finalizeOrphanedProcess(store, id, error, { status: finalStatus });
        finalized++;
    }
    return { finalized, revived };
}

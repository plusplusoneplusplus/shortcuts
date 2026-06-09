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
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';

/**
 * Mark a process as failed and finalize any orphaned streaming turn.
 *
 * Best-effort: errors are swallowed (with a fallback updateProcess) so callers
 * (stale detector, force-fail endpoints, restart recovery) don't block on
 * cleanup failures.
 */
export async function finalizeOrphanedProcess(
    store: ProcessStore,
    processId: string,
    error: string,
    options: { status?: 'failed' | 'cancelled'; workspaceId?: string } = {},
): Promise<void> {
    const status = options.status ?? 'failed';
    const endTime = new Date();

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
                        endTime,
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
            endTime,
            ...(status === 'failed' ? { error } : {}),
        });
    } catch {
        // Non-fatal: process may not exist in store
    }
}

/**
 * Sweep the process store for processes still marked `running` (or
 * `cancelling`) at server startup and finalize them. These are processes
 * whose executor session was torn down by an unclean shutdown (crash,
 * SIGKILL, host reboot). The queue-restart policy assigns NEW task and
 * process IDs to any re-enqueued work, so every pre-existing `running`
 * row in the process store is definitionally orphaned.
 *
 * Returns the number of processes finalized.
 */
export async function sweepOrphanedRunningProcesses(
    store: ProcessStore,
    options: { error?: string } = {},
): Promise<number> {
    const error = options.error ?? 'Process orphaned by server restart';

    let candidates: Array<{ id: string; status: string }> = [];
    try {
        const running = await store.getAllProcesses({ status: 'running' });
        const cancelling = await store.getAllProcesses({ status: 'cancelling' as any });
        candidates = [
            ...running.map(p => ({ id: p.id, status: 'running' })),
            ...cancelling.map(p => ({ id: p.id, status: 'cancelling' })),
        ];
    } catch {
        return 0;
    }

    let count = 0;
    for (const { id, status } of candidates) {
        const finalStatus = status === 'cancelling' ? 'cancelled' : 'failed';
        await finalizeOrphanedProcess(store, id, error, { status: finalStatus });
        count++;
    }
    return count;
}

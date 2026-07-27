import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NoteTreeNode } from '../notesApi';
import { useCocClient } from '../../../repos/cloneRouting';
import { useQueueOptional } from '../../../contexts/QueueContext';

/**
 * Live "chat ongoing" signal for the notes tree (AC-01).
 *
 * A note's bound chat task (from `note_chat_bindings`, exposed via
 * `notes.listChatBindings()` → notePath → taskId) is "ongoing" when that task's
 * live status in the existing queue store is `running` or `cancelling`. No new
 * server endpoint or persistent state is introduced — the bindings listing and
 * QueueContext are both pre-existing sources.
 */

/** Task statuses that count as an in-progress chat. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['running', 'cancelling']);

/**
 * Pure predicate powering {@link useNoteChatRunning}. A page node shows the
 * indicator only when it has a binding whose taskId is currently running.
 * Folders (and any node without a binding, or bound to a finished/unknown task)
 * return `false` — there is no folder rollup (AC-02.3).
 */
export function isNoteChatRunningFor(
    node: NoteTreeNode,
    bindings: Record<string, string>,
    runningTaskIds: ReadonlySet<string>,
): boolean {
    if (node.type !== 'page') return false;
    const taskId = bindings[node.path];
    if (!taskId) return false;
    return runningTaskIds.has(String(taskId));
}

/**
 * Build the set of taskIds whose live queue status is running/cancelling for a
 * given workspace. Scans both the running and queued lists so a `cancelling`
 * task is caught regardless of which bucket the queue keeps it in.
 */
export function collectRunningTaskIds(
    repoQueueEntry: { running?: unknown[]; queued?: unknown[] } | undefined,
): Set<string> {
    const ids = new Set<string>();
    const scan = (tasks: unknown[] | undefined) => {
        for (const t of tasks ?? []) {
            const task = t as { id?: unknown; status?: unknown } | null;
            if (task && typeof task.status === 'string' && RUNNING_STATUSES.has(task.status) && task.id != null) {
                ids.add(String(task.id));
            }
        }
    };
    scan(repoQueueEntry?.running);
    scan(repoQueueEntry?.queued);
    return ids;
}

/**
 * Returns a predicate `isNoteChatRunning(node)` for the notes tree.
 *
 * The bindings map is (re)fetched on mount and again whenever the workspace's
 * live running-task set changes, so a chat started elsewhere (e.g. from a note's
 * chat panel) surfaces its notePath→taskId binding without a page reload, and a
 * settled run drops out within the normal status-refresh cadence (AC-01 DoD).
 */
export function useNoteChatRunning(workspaceId: string): (node: NoteTreeNode) => boolean {
    const cloneClient = useCocClient(workspaceId);
    const queue = useQueueOptional();
    const [bindings, setBindings] = useState<Record<string, string>>({});

    const runningTaskIds = useMemo(
        () => collectRunningTaskIds(queue?.state.repoQueueMap[workspaceId]),
        [queue?.state.repoQueueMap, workspaceId],
    );

    // A stable key over the running set so the bindings re-fetch fires only when
    // the set actually changes, not on every unrelated queue snapshot.
    const runningKey = useMemo(() => [...runningTaskIds].sort().join(','), [runningTaskIds]);

    useEffect(() => {
        let cancelled = false;
        // Access `.notes` inside the promise chain so a client without the notes
        // domain (isolated tests) rejects into .catch instead of throwing here.
        void Promise.resolve()
            .then(() => cloneClient.notes.listChatBindings(workspaceId))
            .then(res => {
                if (cancelled) return;
                const next: Record<string, string> = {};
                for (const [path, binding] of Object.entries(res.bindings ?? {})) {
                    next[path] = binding.taskId;
                }
                setBindings(next);
            })
            .catch(() => {
                // Best-effort: leave the last-known bindings in place on failure.
            });
        return () => { cancelled = true; };
    }, [workspaceId, cloneClient, runningKey]);

    return useCallback(
        (node: NoteTreeNode) => isNoteChatRunningFor(node, bindings, runningTaskIds),
        [bindings, runningTaskIds],
    );
}

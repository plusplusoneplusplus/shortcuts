/**
 * Workspace History REST API Routes
 *
 * DELETE /api/workspaces/:id/history/:processId — Delete a single history entry
 * DELETE /api/workspaces/:id/history            — Bulk-delete history entries
 *
 * These routes are the canonical server-side handlers for history deletion,
 * keyed by processId. They clean up both the in-memory queue and the persistent
 * process store (including child processes).
 */

import type http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toTaskId, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { NoteChatBindingStore } from '../notes/note-chat-binding-store';
import { collectDescendantProcessIds } from './process-subtree';

type DeleteOutcome = 'deleted' | 'notFound' | 'conflict';

/**
 * Attempt to delete a single history entry identified by processId.
 * Returns a status string instead of writing to `res`, so the bulk handler
 * can aggregate results without short-circuiting.
 */
async function tryDeleteHistoryEntry(
    processId: string,
    store: ProcessStore,
    bridge: MultiRepoQueueRouter,
    workspaceId: string | undefined,
    bindingStore: NoteChatBindingStore | undefined,
): Promise<DeleteOutcome> {
    let removedAnything = false;

    // 1. Remove from in-memory queue if this is a queue process.
    if (isQueueProcessId(processId)) {
        const taskId = toTaskId(processId);
        const mgr = bridge.findManagerForTask(taskId);
        if (mgr) {
            const task = mgr.getTask(taskId);
            if (task) {
                const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
                if (!TERMINAL.has(task.status)) {
                    return 'conflict';
                }
                mgr.removeHistoryEntry(taskId);
                removedAnything = true;
            }
        }
    }

    // 2. Remove from process store (children first, then parent).
    try {
        const proc = await store.getProcess(processId);
        if (proc) {
            // Recursively remove the entire spawned subtree (all descendants),
            // then the parent, so no grandchild is orphaned pointing at a
            // deleted parent.
            const descendants = await collectDescendantProcessIds(store, processId);
            for (const id of descendants) {
                await store.removeProcess(id);
            }
            await store.removeProcess(processId);
            removedAnything = true;
        }
    } catch {
        // Non-fatal; log but continue.
        process.stderr.write(`[History] error removing processId=${processId} from store\n`);
    }

    // 3. Drop any per-note binding pointing at this task so the Notes view
    //    doesn't resolve to a deleted chat next time it loads.
    if (removedAnything && bindingStore && workspaceId && isQueueProcessId(processId)) {
        try {
            bindingStore.unbindByTask(workspaceId, toTaskId(processId));
        } catch {
            // Non-fatal.
        }
    }

    return removedAnything ? 'deleted' : 'notFound';
}

export function registerWorkspaceHistoryRoutes(
    routes: Route[],
    store: ProcessStore,
    bridge: MultiRepoQueueRouter,
): void {
    const bindingStore = store instanceof SqliteProcessStore
        ? new NoteChatBindingStore(store.getDatabase())
        : undefined;

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/history/:processId — Single delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/history\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const processId = decodeURIComponent(match![2]);
            const outcome = await tryDeleteHistoryEntry(processId, store, bridge, workspaceId, bindingStore);

            switch (outcome) {
                case 'conflict':
                    return sendError(res, 409, 'Task is still running or queued; cannot delete');
                case 'notFound':
                    return sendError(res, 404, 'History entry not found');
                case 'deleted':
                    res.writeHead(204);
                    res.end();
                    return;
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/history — Bulk delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/history$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const body = await parseBody(req);
            const ids = body?.processIds;
            if (!Array.isArray(ids) || ids.length === 0) {
                return sendError(res, 400, 'processIds array required');
            }

            const results: Array<{ processId: string; status: DeleteOutcome }> = [];
            for (const pid of ids) {
                const outcome = await tryDeleteHistoryEntry(pid, store, bridge, workspaceId, bindingStore);
                results.push({ processId: pid, status: outcome });
            }
            sendJSON(res, 200, { results });
        },
    });
}

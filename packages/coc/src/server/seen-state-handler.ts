/**
 * Seen State REST API Handler
 *
 * HTTP API routes for managing read/unread (seen/unseen) state of processes.
 * Delegates to SqliteProcessStore's seen-state methods.
 */

import { sendJSON } from './api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';

// ============================================================================
// Types
// ============================================================================

/** Narrow interface for the seen-state store methods. */
export interface SeenStateStore {
    getSeenMap(workspaceId: string): Record<string, string>;
    markSeen(processId: string, seenAt: string): void;
    markManySeen(entries: Array<{ processId: string; seenAt: string }>): void;
    markUnseen(processId: string): void;
    getUnseenCount(workspaceId: string): number;
}

// ============================================================================
// Route registration
// ============================================================================

export function registerSeenStateRoutes(routes: Route[], store: SeenStateStore): void {
    // GET /api/workspaces/:id/seen-state — full seen map
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/seen-state$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const map = store.getSeenMap(workspaceId);
            sendJSON(res, 200, map);
        },
    });

    // PATCH /api/workspaces/:id/seen-state — batch update
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/seen-state$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const entries = body.entries;
            if (!Array.isArray(entries)) {
                sendJSON(res, 400, { error: 'Missing or invalid "entries" array' });
                return;
            }

            // Validate each entry
            for (const entry of entries) {
                if (typeof entry.processId !== 'string' || typeof entry.seenAt !== 'string') {
                    sendJSON(res, 400, { error: 'Each entry must have "processId" and "seenAt" strings' });
                    return;
                }
            }

            store.markManySeen(entries);
            const updatedMap = store.getSeenMap(workspaceId);
            sendJSON(res, 200, updatedMap);
        },
    });

    // DELETE /api/workspaces/:id/seen-state/:processId — mark unseen
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/seen-state\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![2]);
            store.markUnseen(processId);
            sendJSON(res, 200, { ok: true });
        },
    });

    // GET /api/workspaces/:id/seen-state/count — unseen count
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/seen-state\/count$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const unseenCount = store.getUnseenCount(workspaceId);
            sendJSON(res, 200, { unseenCount });
        },
    });
}

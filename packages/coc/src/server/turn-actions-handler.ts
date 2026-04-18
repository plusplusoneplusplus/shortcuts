/**
 * Turn Actions REST API Handler
 *
 * HTTP API routes for per-message delete, pin, and archive on conversation turns.
 * Follows the same narrow-interface pattern as `pin-archive-handler.ts`.
 */

import { sendJSON } from './api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import { handleAPIError, notFound } from './errors';
import type { Route } from './types';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

/** Narrow interface for the turn-action store methods. */
export interface TurnActionStore {
    softDeleteTurn(processId: string, turnIndex: number): void;
    restoreTurn(processId: string, turnIndex: number): void;
    hardDeleteTurn(processId: string, turnIndex: number): void;
    pinTurn(processId: string, turnIndex: number, pinnedAt: string): void;
    unpinTurn(processId: string, turnIndex: number): void;
    archiveTurn(processId: string, turnIndex: number): void;
    unarchiveTurn(processId: string, turnIndex: number): void;
    getPinnedTurns(processId: string): ConversationTurn[];
    getProcess(id: string): Promise<{ id: string } | undefined>;
}

// ============================================================================
// Route registration
// ============================================================================

export function registerTurnActionRoutes(routes: Route[], store: TurnActionStore): void {
    // DELETE /api/processes/:id/turns/:turnIndex — soft-delete a turn
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/processes\/([^/]+)\/turns\/(\d+)$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const turnIndex = parseInt(match![2], 10);

            const proc = await store.getProcess(processId);
            if (!proc) return handleAPIError(res, notFound('Process'));

            store.softDeleteTurn(processId, turnIndex);
            sendJSON(res, 200, { id: processId, turnIndex, deletedAt: new Date().toISOString() });
        },
    });

    // PATCH /api/processes/:id/turns/:turnIndex/restore — restore a soft-deleted turn
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/turns\/(\d+)\/restore$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const turnIndex = parseInt(match![2], 10);

            const proc = await store.getProcess(processId);
            if (!proc) return handleAPIError(res, notFound('Process'));

            store.restoreTurn(processId, turnIndex);
            sendJSON(res, 200, { id: processId, turnIndex, deletedAt: null });
        },
    });

    // PATCH /api/processes/:id/turns/:turnIndex/pin — toggle pin state
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/turns\/(\d+)\/pin$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const turnIndex = parseInt(match![2], 10);

            const proc = await store.getProcess(processId);
            if (!proc) return handleAPIError(res, notFound('Process'));

            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const pinned = (body as any).pinned;
            if (pinned === false) {
                store.unpinTurn(processId, turnIndex);
                sendJSON(res, 200, { id: processId, turnIndex, pinnedAt: null });
            } else {
                const pinnedAt = new Date().toISOString();
                store.pinTurn(processId, turnIndex, pinnedAt);
                sendJSON(res, 200, { id: processId, turnIndex, pinnedAt, archived: false });
            }
        },
    });

    // PATCH /api/processes/:id/turns/:turnIndex/archive — toggle archive state
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/turns\/(\d+)\/archive$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const turnIndex = parseInt(match![2], 10);

            const proc = await store.getProcess(processId);
            if (!proc) return handleAPIError(res, notFound('Process'));

            const body = await parseBodyOrReject(_req, res);
            if (body === null) return;

            const archived = (body as any).archived;
            if (archived === false) {
                store.unarchiveTurn(processId, turnIndex);
                sendJSON(res, 200, { id: processId, turnIndex, archived: false });
            } else {
                store.archiveTurn(processId, turnIndex);
                sendJSON(res, 200, { id: processId, turnIndex, archived: true });
            }
        },
    });

    // GET /api/processes/:id/turns/pinned — get pinned turns for a process
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/turns\/pinned$/,
        handler: async (_req, res, match) => {
            const processId = decodeURIComponent(match![1]);

            const proc = await store.getProcess(processId);
            if (!proc) return handleAPIError(res, notFound('Process'));

            const pinnedTurns = store.getPinnedTurns(processId);
            sendJSON(res, 200, { turns: pinnedTurns });
        },
    });
}

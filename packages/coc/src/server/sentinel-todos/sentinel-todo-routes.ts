/**
 * Sentinel to-do ledger REST API (guarded by `features.sentinelTodoLedger`).
 *
 *   GET   /api/workspaces/:workspaceId/sentinel-todos/:processId                — ledger
 *   POST  /api/workspaces/:workspaceId/sentinel-todos/:processId/items          — create
 *   PATCH /api/workspaces/:workspaceId/sentinel-todos/:processId/items/:itemId  — edit
 *
 * `workspaceId` is the parent Sentinel chat's workspace (a repo or repo group)
 * on this server; clients route remote-owned chats to their owning server.
 * Edits carry `expectedRevision`; a stale write gets 409 with the current item.
 */
import type * as http from 'http';
import type { Route } from '../shared/router';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { isValidWorkspaceId } from '../tasks/comments/base-comments-manager';
import { SentinelTodoError } from './sentinel-todo-store';
import type { SentinelTodoService } from './sentinel-todo-service';

const LEDGER = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)$/;
const ITEMS = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items$/;
const ITEM = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)$/;

export function registerSentinelTodoRoutes(opts: {
    routes: Route[];
    service: SentinelTodoService;
    getEnabled: () => boolean;
}): void {
    const { routes, service, getEnabled } = opts;

    const owner = (res: http.ServerResponse, match: RegExpMatchArray | null | undefined) => {
        if (!getEnabled()) return sendError(res, 404, 'Sentinel to-do ledger is disabled');
        const workspaceId = decodeURIComponent(match![1]);
        const processId = decodeURIComponent(match![2]);
        if (!isValidWorkspaceId(workspaceId) || !processId) return sendError(res, 400, 'Invalid workspace or chat');
        return { workspaceId, processId };
    };

    const fail = (res: http.ServerResponse, error: unknown) => {
        if (!(error instanceof SentinelTodoError)) return sendError(res, 500, 'Failed to save the to-do ledger');
        const status = { not_found: 404, conflict: 409, invalid: 400, limit: 400 }[error.code];
        return sendJSON(res, status, { error: error.message, code: error.code, ...(error.current ? { current: error.current } : {}) });
    };

    routes.push({
        method: 'GET',
        pattern: LEDGER,
        handler: async (_req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            try {
                sendJSON(res, 200, await service.list(target));
            } catch (error) {
                fail(res, error);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: ITEMS,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { idempotencyKey, ...input } = body ?? {};
            if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 200)) {
                return sendError(res, 400, 'Invalid idempotencyKey');
            }
            try {
                const result = await service.create(target, input, { actor: 'user', idempotencyKey });
                sendJSON(res, result.created ? 201 : 200, result);
            } catch (error) {
                fail(res, error);
            }
        },
    });

    routes.push({
        method: 'PATCH',
        pattern: ITEM,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { expectedRevision, ...patch } = body ?? {};
            if (!Number.isInteger(expectedRevision)) return sendError(res, 400, 'Missing expectedRevision');
            try {
                sendJSON(res, 200, await service.update(target, decodeURIComponent(match![3]), expectedRevision, patch, 'user'));
            } catch (error) {
                fail(res, error);
            }
        },
    });
}

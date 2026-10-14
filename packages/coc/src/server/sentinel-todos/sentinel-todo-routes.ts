/**
 * Sentinel to-do ledger REST API.
 *
 *   GET   /api/workspaces/:workspaceId/sentinel-todos/:processId                — ledger
 *   POST  /api/workspaces/:workspaceId/sentinel-todos/:processId/items          — create
 *   PATCH /api/workspaces/:workspaceId/sentinel-todos/:processId/items/:itemId  — edit
 *   POST  /api/workspaces/:workspaceId/sentinel-todos/:processId/items/:itemId/references
 *         — attach an existing local conversation as a reference-only link
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
import { sentinelTodoRecentList } from './sentinel-todo-list';

const LEDGER = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)$/;
const ITEMS = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items$/;
const ITEM = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)$/;
const REFERENCES = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/references$/;
const DEPENDENCIES = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/dependencies$/;
const EVIDENCE = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/(pr-output|artifact-acceptance|readiness)$/;
const TAGS = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/tags$/;
const TAG = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/tags\/([^/]+)$/;
const SUGGEST_TAGS = /^\/api\/workspaces\/([^/]+)\/sentinel-todos\/([^/]+)\/items\/([^/]+)\/suggest-tags$/;

export function registerSentinelTodoRoutes(opts: {
    routes: Route[];
    service: SentinelTodoService;
}): void {
    const { routes, service } = opts;

    const owner = (res: http.ServerResponse, match: RegExpMatchArray | null | undefined) => {
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

    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
        routes.push({
            method,
            pattern: method === 'PATCH' || method === 'DELETE' ? TAG : TAGS,
            handler: async (req, res, match) => {
                const target = owner(res, match);
                if (!target) return;
                if (!service.tagsEnabled()) return sendError(res, 404, 'Sentinel to-do tags are disabled');
                try {
                    if (method === 'GET') return sendJSON(res, 200, await service.getTags(target));
                    const body = await parseBodyOrReject(req, res);
                    if (body === null) return;
                    const result = method === 'POST' ? await service.createTag(target, body)
                        : method === 'PATCH' ? await service.updateTag(target, decodeURIComponent(match![3]), body)
                            : await service.deleteTag(target, decodeURIComponent(match![3]), body);
                    sendJSON(res, 200, result);
                } catch (error) { fail(res, error); }
            },
        });
    }
    routes.push({
        method: 'POST', pattern: SUGGEST_TAGS,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            if (!service.tagsEnabled()) return sendError(res, 404, 'Sentinel to-do tags are disabled');
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            try { sendJSON(res, 200, await service.suggestTags(target, decodeURIComponent(match![3]), body)); }
            catch (error) { fail(res, error); }
        },
    });

    routes.push({
        method: 'POST',
        pattern: EVIDENCE,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            if (!service.dependenciesEnabled()) return sendError(res, 404, 'Sentinel dependencies are disabled');
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            try {
                const itemId = decodeURIComponent(match![3]);
                if (match![4] === 'readiness') {
                    if (Object.keys(body ?? {}).length) return sendError(res, 400, 'Readiness accepts no authoring fields');
                    return sendJSON(res, 200, await service.evaluateDependencies(target, itemId));
                }
                sendJSON(res, 200, match![4] === 'pr-output'
                    ? await service.bindPrOutput(target, itemId, body, 'user')
                    : await service.acceptArtifact(target, itemId, body, 'user'));
            } catch (error) { fail(res, error); }
        },
    });

    routes.push({
        method: 'GET',
        pattern: LEDGER,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            try {
                const query = new URL(req.url!, 'http://localhost').searchParams;
                const full = query.get('full');
                if (full !== null && full !== 'true' && full !== 'false') {
                    throw new SentinelTodoError('invalid', 'Invalid full snapshot option');
                }
                const ledger = await service.list(target);
                sendJSON(res, 200, full === 'true' ? ledger : sentinelTodoRecentList(ledger, {
                    ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}),
                    ...(query.has('offset') ? { offset: Number(query.get('offset')) } : {}),
                    ...(query.has('itemId') ? { itemId: query.get('itemId') } : {}),
                }));
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

    routes.push({
        method: 'PUT',
        pattern: DEPENDENCIES,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            if (!service.dependenciesEnabled()) return sendError(res, 404, 'Sentinel dependencies are disabled');
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { expectedRevision, dependsOn, ...rest } = body ?? {};
            if (!Number.isInteger(expectedRevision)) return sendError(res, 400, 'Missing expectedRevision');
            if (Object.keys(rest).length) return sendError(res, 400, `Unknown fields: ${Object.keys(rest).join(', ')}`);
            try {
                sendJSON(res, 200, await service.setDependencies(target, decodeURIComponent(match![3]), expectedRevision, dependsOn, 'user'));
            } catch (error) {
                fail(res, error);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: REFERENCES,
        handler: async (req, res, match) => {
            const target = owner(res, match);
            if (!target) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { expectedRevision, processId, workspaceId, ...rest } = body ?? {};
            if (!Number.isInteger(expectedRevision)) return sendError(res, 400, 'Missing expectedRevision');
            if (Object.keys(rest).length) return sendError(res, 400, `Unknown fields: ${Object.keys(rest).join(', ')}`);
            try {
                sendJSON(res, 200, await service.attachReference(target, decodeURIComponent(match![3]), expectedRevision,
                    { processId, workspaceId }, 'user'));
            } catch (error) {
                fail(res, error);
            }
        },
    });
}

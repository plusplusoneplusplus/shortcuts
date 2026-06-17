/**
 * Work-Item-Chat Binding REST API Routes
 *
 * CRUD operations on origin + workItemId -> chat task bindings. Workspace URLs
 * are migration-compatible callers that resolve their workspace to an origin.
 */

import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { WorkItemChatBindingStore } from '../processes/work-item-chat-binding-store';
import { startFreshLensChat } from '../processes/fresh-lens-chat-binding';
import {
    legacyWorkspaceIdsForWorkItemOrigin,
    workspaceOriginId,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';

const MAX_WORK_ITEM_ID_LENGTH = 512;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const WORK_ITEM_CHAT_COLLECTION_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-item-chat-bindings$/;
const WORK_ITEM_CHAT_DETAIL_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-item-chat-bindings\/([^/]{1,512})$/;
const WORK_ITEM_CHAT_FRESH_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-item-chat-bindings\/([^/]{1,512})\/fresh$/;

interface ResolvedWorkItemChatBindingScope {
    scopeId: string;
    legacyScopeIds: string[];
    workspace?: WorkspaceInfo;
}

function isValidWorkItemId(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= MAX_WORK_ITEM_ID_LENGTH
        && !CONTROL_CHAR_RE.test(value);
}

function queryWorkspaceId(req: import('http').IncomingMessage): string | undefined {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const raw = parsed.searchParams.get('workspaceId')?.trim();
    return raw || undefined;
}

function bodyWorkspaceId(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const raw = (body as Record<string, unknown>).workspaceId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

async function resolveWorkItemChatBindingScope(
    ctx: ApiRouteContext,
    kind: WorkItemRouteScopeKind,
    routeScopeId: string,
    workspaceId: string | undefined,
    requireWorkspace: boolean,
): Promise<ResolvedWorkItemChatBindingScope> {
    const workspaces = await ctx.store.getWorkspaces();
    if (kind === 'workspaces') {
        const workspace = workspaces.find(entry => entry.id === routeScopeId);
        if (!workspace) {
            throw notFound('Workspace');
        }
        const originId = await workspaceOriginId(workspace, ctx.store);
        return {
            scopeId: originId,
            legacyScopeIds: await legacyWorkspaceIdsForWorkItemOrigin(ctx.store, originId),
            workspace,
        };
    }

    if (workspaceId) {
        const workspace = workspaces.find(entry => entry.id === workspaceId);
        if (!workspace) {
            throw badRequest(`workspaceId '${workspaceId}' is not registered`);
        }
        const resolvedOriginId = await workspaceOriginId(workspace, ctx.store);
        if (resolvedOriginId !== routeScopeId) {
            throw badRequest(`workspaceId '${workspaceId}' resolves to origin '${resolvedOriginId}', not '${routeScopeId}'`);
        }
        return {
            scopeId: routeScopeId,
            legacyScopeIds: await legacyWorkspaceIdsForWorkItemOrigin(ctx.store, routeScopeId),
            workspace,
        };
    }

    if (requireWorkspace) {
        throw badRequest('workspaceId is required for origin-scoped fresh work item chat bindings');
    }

    return {
        scopeId: routeScopeId,
        legacyScopeIds: await legacyWorkspaceIdsForWorkItemOrigin(ctx.store, routeScopeId),
    };
}

export function registerWorkItemChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new WorkItemChatBindingStore(db!);

    // POST /api/origins/:originId/work-item-chat-bindings/:workItemId/fresh — Archive current chat and clear binding
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_CHAT_FRESH_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            try {
                const scope = await resolveWorkItemChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), true);
                if (!scope.workspace) {
                    return handleAPIError(res, badRequest('workspaceId is required for origin-scoped fresh work item chat bindings'));
                }
                const archivedTaskId = await startFreshLensChat({
                    store,
                    workspaceId: scope.workspace.id,
                    binding: bindingStore.get(scope.scopeId, workItemId, scope.legacyScopeIds),
                    unbind: () => bindingStore.unbind(scope.scopeId, workItemId, scope.legacyScopeIds),
                });
                sendJSON(res, 200, { workItemId, archivedTaskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // GET /api/origins/:originId/work-item-chat-bindings — List all bindings
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_CHAT_COLLECTION_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            try {
                const scope = await resolveWorkItemChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                sendJSON(res, 200, { bindings: bindingStore.list(scope.scopeId, scope.legacyScopeIds) });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // GET /api/origins/:originId/work-item-chat-bindings/:workItemId — Get single binding
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_CHAT_DETAIL_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            try {
                const scope = await resolveWorkItemChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                const binding = bindingStore.get(scope.scopeId, workItemId, scope.legacyScopeIds);
                if (!binding) {
                    return handleAPIError(res, notFound('Binding'));
                }
                sendJSON(res, 200, { workItemId, taskId: binding.taskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/work-item-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_CHAT_COLLECTION_PATTERN,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const kind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const { workItemId, taskId } = body;
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            try {
                const scope = await resolveWorkItemChatBindingScope(ctx, kind, routeScopeId, bodyWorkspaceId(body) ?? queryWorkspaceId(req), false);
                bindingStore.bind(scope.scopeId, workItemId, taskId, scope.legacyScopeIds);
                sendJSON(res, 201, { workItemId, taskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // DELETE /api/origins/:originId/work-item-chat-bindings/:workItemId — Remove binding
    routes.push({
        method: 'DELETE',
        pattern: WORK_ITEM_CHAT_DETAIL_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            try {
                const scope = await resolveWorkItemChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                bindingStore.unbind(scope.scopeId, workItemId, scope.legacyScopeIds);
                res.writeHead(204);
                res.end();
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });
}

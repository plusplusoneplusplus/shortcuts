/**
 * Pull-Request-Chat Binding REST API Routes
 *
 * CRUD operations on pullRequest -> chat bindings. Persistent bindings are
 * scoped by canonical origin; workspace URLs are migration-compatible callers
 * that resolve their workspace to an origin first.
 */

import {
    detectRemoteUrl,
    resolveCanonicalOriginId,
    type ProcessStore,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { PullRequestChatBindingStore } from '../processes/pull-request-chat-binding-store';
import { startFreshLensChat } from '../processes/fresh-lens-chat-binding';

// PR IDs are typically numeric (GitHub, ADO) but can be longer opaque strings
// in the future. Allow URL-safe characters (alphanumerics, hyphen, underscore)
// with a reasonable length cap.
const PR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PR_CHAT_COLLECTION_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/pull-request-chat-bindings$/;
const PR_CHAT_DETAIL_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/pull-request-chat-bindings\/([A-Za-z0-9_-]{1,64})$/;
const PR_CHAT_FRESH_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/pull-request-chat-bindings\/([A-Za-z0-9_-]{1,64})\/fresh$/;

type PrChatRouteScopeKind = 'workspaces' | 'origins';

interface ResolvedPrChatBindingScope {
    scopeId: string;
    legacyScopeIds: string[];
    workspace?: WorkspaceInfo;
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

async function workspaceOriginId(
    workspace: WorkspaceInfo,
    processStore: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string> {
    let remoteUrl = workspace.remoteUrl;
    if (!remoteUrl && workspace.rootPath) {
        remoteUrl = await detectRemoteUrl(workspace.rootPath);
        if (remoteUrl) {
            await processStore.updateWorkspace(workspace.id, { remoteUrl });
        }
    }
    return resolveCanonicalOriginId({ remoteUrl, workspaceId: workspace.id });
}

async function legacyWorkspaceIdsForOrigin(
    processStore: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>,
    originId: string,
): Promise<string[]> {
    const legacyScopeIds: string[] = [];
    for (const workspace of await processStore.getWorkspaces()) {
        if (await workspaceOriginId(workspace, processStore) === originId) {
            legacyScopeIds.push(workspace.id);
        }
    }
    return legacyScopeIds;
}

async function resolvePrChatBindingScope(
    ctx: ApiRouteContext,
    kind: PrChatRouteScopeKind,
    routeScopeId: string,
    workspaceId: string | undefined,
    requireWorkspace: boolean,
): Promise<ResolvedPrChatBindingScope> {
    if (kind === 'workspaces') {
        const workspace = (await ctx.store.getWorkspaces()).find(entry => entry.id === routeScopeId);
        if (!workspace) {
            throw notFound('Workspace');
        }
        const originId = await workspaceOriginId(workspace, ctx.store);
        return {
            scopeId: originId,
            legacyScopeIds: await legacyWorkspaceIdsForOrigin(ctx.store, originId),
            workspace,
        };
    }

    if (workspaceId) {
        const workspace = (await ctx.store.getWorkspaces()).find(entry => entry.id === workspaceId);
        if (!workspace) {
            throw badRequest(`workspaceId '${workspaceId}' is not registered`);
        }
        const resolvedOriginId = await workspaceOriginId(workspace, ctx.store);
        if (resolvedOriginId !== routeScopeId) {
            throw badRequest(`workspaceId '${workspaceId}' resolves to origin '${resolvedOriginId}', not '${routeScopeId}'`);
        }
        return {
            scopeId: routeScopeId,
            legacyScopeIds: await legacyWorkspaceIdsForOrigin(ctx.store, routeScopeId),
            workspace,
        };
    }

    if (requireWorkspace) {
        throw badRequest('workspaceId is required for origin-scoped fresh pull request chat bindings');
    }

    return {
        scopeId: routeScopeId,
        legacyScopeIds: await legacyWorkspaceIdsForOrigin(ctx.store, routeScopeId),
    };
}

export function registerPrChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new PullRequestChatBindingStore(db!);

    // POST /api/origins/:originId/pull-request-chat-bindings/:prId/fresh — Archive current chat and clear binding
    routes.push({
        method: 'POST',
        pattern: PR_CHAT_FRESH_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as PrChatRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const prId = match![3];
            try {
                const scope = await resolvePrChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), true);
                if (!scope.workspace) {
                    return handleAPIError(res, badRequest('workspaceId is required for origin-scoped fresh pull request chat bindings'));
                }
                const archivedTaskId = await startFreshLensChat({
                    store,
                    workspaceId: scope.workspace.id,
                    binding: bindingStore.get(scope.scopeId, prId, scope.legacyScopeIds),
                    unbind: () => bindingStore.unbind(scope.scopeId, prId, scope.legacyScopeIds),
                });
                sendJSON(res, 200, { prId, archivedTaskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // GET /api/origins/:originId/pull-request-chat-bindings — List all bindings
    routes.push({
        method: 'GET',
        pattern: PR_CHAT_COLLECTION_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as PrChatRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            try {
                const scope = await resolvePrChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                sendJSON(res, 200, { bindings: bindingStore.list(scope.scopeId, scope.legacyScopeIds) });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // GET /api/origins/:originId/pull-request-chat-bindings/:prId — Get single binding
    routes.push({
        method: 'GET',
        pattern: PR_CHAT_DETAIL_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as PrChatRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const prId = match![3];
            try {
                const scope = await resolvePrChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                const binding = bindingStore.get(scope.scopeId, prId, scope.legacyScopeIds);
                if (!binding) {
                    return handleAPIError(res, notFound('Binding'));
                }
                sendJSON(res, 200, { prId, taskId: binding.taskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // POST /api/origins/:originId/pull-request-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: PR_CHAT_COLLECTION_PATTERN,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const kind = match![1] as PrChatRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const { prId, taskId } = body;
            if (typeof prId !== 'string' || !PR_ID_RE.test(prId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: prId'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            try {
                const scope = await resolvePrChatBindingScope(ctx, kind, routeScopeId, bodyWorkspaceId(body) ?? queryWorkspaceId(req), false);
                bindingStore.bind(scope.scopeId, prId, taskId, scope.legacyScopeIds);
                sendJSON(res, 201, { prId, taskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // DELETE /api/origins/:originId/pull-request-chat-bindings/:prId — Remove binding
    routes.push({
        method: 'DELETE',
        pattern: PR_CHAT_DETAIL_PATTERN,
        handler: async (req, res, match) => {
            const kind = match![1] as PrChatRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const prId = match![3];
            try {
                const scope = await resolvePrChatBindingScope(ctx, kind, routeScopeId, queryWorkspaceId(req), false);
                bindingStore.unbind(scope.scopeId, prId, scope.legacyScopeIds);
                res.writeHead(204);
                res.end();
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });
}

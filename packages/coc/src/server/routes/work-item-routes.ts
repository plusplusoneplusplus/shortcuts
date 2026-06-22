/**
 * Work Item REST API Routes
 *
 * CRUD operations for CoC work items. Create and update operations delegate
 * to the shared work-item command service (`work-item-commands.ts`) so the
 * REST routes and the `create_update_work_item` AI tool share hierarchy
 * validation, provider sync, cache invalidation, and broadcast behavior.
 *
 * Routes:
 *   GET    /api/origins/:originId/work-items              — List work items (with filters)
 *   POST   /api/origins/:originId/work-items              — Create work item
 *   GET    /api/origins/:originId/work-items/:workItemId   — Get work item detail
 *   PATCH  /api/origins/:originId/work-items/:workItemId   — Update work item
 *   DELETE /api/origins/:originId/work-items/:workItemId   — Delete work item
 *
 * Workspace URLs are still accepted during the origin API migration and resolve
 * to the workspace's canonical origin for shared storage/cache keys.
 */

import * as http from 'http';
import * as url from 'url';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScope,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';
import type {
    WorkItemStore,
    WorkItemFilter,
    WorkItemStatus,
    WorkItemSource,
    WorkItemPriority,
    WorkItemType,
    WorkItem,
    WorkItemTrackerKind,
    WorkItemIndexEntry,
} from '../work-items/types';
import { WORK_ITEM_TYPES, WORK_ITEM_TRACKER_KINDS, isKnownWorkItemStatus } from '../work-items/types';
import type { GitHubWorkItemIssueTransport } from '../work-items/work-item-sync-github-provider';
import type { AzureBoardsWorkItemTransport } from '../work-items/work-item-sync-azure-boards-provider';
import type { WorkItemSyncProviderAdapter } from '../work-items/work-item-sync-provider';
import type { EnqueueFunction } from '../work-items/work-item-executor';
import {
    createWorkItemCommand,
    updateWorkItemCommand,
    type UpdateWorkItemCommandInput,
    type WorkItemCommandContext,
} from '../work-items/work-item-commands';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import {
    clearWorkItemResponseCacheForWorkspace,
    getOrRefreshWorkItemResponseCacheEntry,
    makeWorkItemGroupedResponseCacheKey,
    makeWorkItemListResponseCacheKey,
} from '../work-items/work-item-response-cache';

const VALID_SOURCES: Set<string> = new Set(['manual', 'chat', 'schedule']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
const VALID_TRACKER_KINDS: Set<string> = new Set(WORK_ITEM_TRACKER_KINDS);
const WORK_ITEM_COLLECTION_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items$/;
const WORK_ITEM_GROUPED_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/grouped$/;
const WORK_ITEM_DETAIL_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)$/;
const WORK_ITEM_REQUEST_CHANGES_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/request-changes$/;
const WORK_ITEM_PIN_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/pin$/;
const WORK_ITEM_ARCHIVE_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/archive$/;

export interface WorkItemRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
    /** Returns true when the workItems.hierarchy feature flag is enabled. */
    getHierarchyEnabled?: () => boolean;
    /** Returns true when remote work-item provider integration is enabled. */
    getSyncEnabled?: () => boolean;
    /** Base CoC data directory, required to resolve workspace GitHub preferences for GitHub-backed child creation. */
    dataDir?: string;
    /** Override GitHub transport for testing. Defaults to GhCliGitHubWorkItemIssueTransport. */
    githubTransport?: GitHubWorkItemIssueTransport;
    /** Override Azure Boards transport for testing. Defaults to AzureBoardsRestWorkItemTransport. */
    azureBoardsTransport?: AzureBoardsWorkItemTransport;
    /** Override Azure Boards status adapter for testing. Defaults to the Azure CLI-backed adapter. */
    azureBoardsProvider?: WorkItemSyncProviderAdapter;
}

export interface WorkItemListRouteResponse {
    items: WorkItemIndexEntry[];
    total: number;
    hasMore: boolean;
}

export interface WorkItemGroupedRouteResponse {
    groups: Record<string, { items: WorkItemIndexEntry[]; total: number; hasMore: boolean }>;
}

export async function buildWorkItemListRouteResponse(
    workItemStore: WorkItemStore,
    filter: WorkItemFilter,
): Promise<WorkItemListRouteResponse> {
    const result = await workItemStore.listWorkItems(filter);
    const hasMore = (filter.offset ?? 0) + result.items.length < result.total;
    return { items: result.items, total: result.total, hasMore };
}

export async function buildWorkItemGroupedRouteResponse(
    workItemStore: WorkItemStore,
    filter: WorkItemFilter,
): Promise<WorkItemGroupedRouteResponse> {
    const result = await workItemStore.listWorkItemsGrouped(filter);
    const groups: WorkItemGroupedRouteResponse['groups'] = {};
    for (const [status, group] of Object.entries(result.groups)) {
        groups[status] = {
            items: group.items,
            total: group.total,
            hasMore: group.items.length < group.total,
        };
    }
    return { groups };
}

function invalidateAndBroadcastRemoval(
    scope: WorkItemRouteScope,
    getWsServer: WorkItemRouteContext['getWsServer'],
    workItemId: string,
): void {
    clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
    getWsServer?.()?.broadcastProcessEvent({
        type: 'work-item-removed',
        workspaceId: scope.storageRepoId,
        itemId: workItemId,
    });
}

export function registerWorkItemRoutes(ctx: WorkItemRouteContext): void {
    const { routes, workItemStore, getWsServer } = ctx;
    // All valid types when hierarchy is enabled
    const ALL_VALID_TYPES = new Set<string>(WORK_ITEM_TYPES);

    const commandCtx: WorkItemCommandContext = {
        workItemStore,
        processStore: ctx.processStore,
        dataDir: ctx.dataDir,
        enqueue: ctx.enqueue,
        getHierarchyEnabled: ctx.getHierarchyEnabled,
        getSyncEnabled: ctx.getSyncEnabled,
        githubTransport: ctx.githubTransport,
        azureBoardsTransport: ctx.azureBoardsTransport,
        azureBoardsProvider: ctx.azureBoardsProvider,
        broadcast: event => getWsServer?.()?.broadcastProcessEvent(event),
    };

    // GET /api/origins/:originId/work-items — List with optional filters
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_COLLECTION_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;
            const force = query.force === 'true';

            const filter: WorkItemFilter = { repoId: scope.storageRepoId };
            if (typeof query.status === 'string' && query.status) {
                const statuses = query.status.split(',').filter(isKnownWorkItemStatus);
                if (statuses.length === 1) {
                    filter.status = statuses[0] as WorkItemStatus;
                } else if (statuses.length > 1) {
                    filter.status = statuses as WorkItemStatus[];
                }
            }
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && ALL_VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.tracker === 'string' && VALID_TRACKER_KINDS.has(query.tracker)) {
                filter.tracker = query.tracker as WorkItemTrackerKind;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.offset === 'string') {
                const n = parseInt(query.offset, 10);
                if (!isNaN(n) && n >= 0) filter.offset = n;
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const response = await getOrRefreshWorkItemResponseCacheEntry(
                makeWorkItemListResponseCacheKey(filter),
                scope.storageRepoId,
                'list',
                force,
                () => buildWorkItemListRouteResponse(workItemStore, filter),
            );
            sendJSON(res, 200, response);
        },
    });

    // GET /api/origins/:originId/work-items/grouped — List grouped by status with per-group pagination
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_GROUPED_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;
            const force = query.force === 'true';

            const filter: WorkItemFilter = { repoId: scope.storageRepoId };
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && ALL_VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.tracker === 'string' && VALID_TRACKER_KINDS.has(query.tracker)) {
                filter.tracker = query.tracker as WorkItemTrackerKind;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const response = await getOrRefreshWorkItemResponseCacheEntry(
                makeWorkItemGroupedResponseCacheKey(filter),
                scope.storageRepoId,
                'grouped',
                force,
                () => buildWorkItemGroupedRouteResponse(workItemStore, filter),
            );
            sendJSON(res, 200, response);
        },
    });

    // POST /api/origins/:originId/work-items — Create work item
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_COLLECTION_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(
                    ctx,
                    routeKind,
                    routeScopeId,
                    typeof body.workspaceId === 'string' ? body.workspaceId : queryWorkspaceId(req),
                );
            } catch (err) {
                return handleAPIError(res, err);
            }

            try {
                const item = await createWorkItemCommand(commandCtx, scope.commandRepoId, {
                    id: body.id,
                    title: body.title,
                    syncLinks: body.syncLinks,
                    description: body.description,
                    type: body.type,
                    parentId: body.parentId,
                    tracker: body.tracker,
                    source: body.source,
                    sourceId: body.sourceId,
                    priority: body.priority,
                    tags: body.tags,
                    autoExecute: body.autoExecute,
                    successCriteria: body.successCriteria,
                    storageRepoId: scope.storageRepoId,
                    plan: body.plan,
                });
                sendJSON(res, 201, item);
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // GET /api/origins/:originId/work-items/:workItemId — Get detail
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_DETAIL_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            sendJSON(res, 200, item);
        },
    });

    // PATCH /api/origins/:originId/work-items/:workItemId — Update work item
    routes.push({
        method: 'PATCH',
        pattern: WORK_ITEM_DETAIL_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(
                    ctx,
                    routeKind,
                    routeScopeId,
                    typeof body.workspaceId === 'string' ? body.workspaceId : queryWorkspaceId(req),
                );
            } catch (err) {
                return handleAPIError(res, err);
            }

            const input: UpdateWorkItemCommandInput = {};
            if (body.title !== undefined) input.title = body.title;
            if (body.description !== undefined) input.description = body.description;
            if (body.status !== undefined) input.status = body.status;
            if (body.priority !== undefined) input.priority = body.priority;
            if (body.tags !== undefined) input.tags = body.tags;
            if (body.autoExecute !== undefined) input.autoExecute = body.autoExecute;
            if (body.completedAt !== undefined) input.completedAt = body.completedAt;
            if (body.reviewComments !== undefined) input.reviewComments = body.reviewComments;
            if (body.successCriteria !== undefined) input.successCriteria = body.successCriteria;
            if (body.grillSessionId !== undefined) input.grillSessionId = body.grillSessionId;
            if (body.syncLinks !== undefined) input.syncLinks = body.syncLinks;
            if (body.plan !== undefined) input.plan = body.plan;
            if (body.tracker !== undefined) input.tracker = body.tracker;
            if ('parentId' in body) input.parentId = body.parentId;
            if (body.syncConflictResolution !== undefined) input.syncConflictResolution = body.syncConflictResolution;
            input.storageRepoId = scope.storageRepoId;

            try {
                const updated = await updateWorkItemCommand(commandCtx, scope.commandRepoId, workItemId, input);
                sendJSON(res, 200, updated);
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // POST /api/origins/:originId/work-items/:workItemId/request-changes — Incorporate review comments into plan, transition to readyToExecute
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_REQUEST_CHANGES_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(
                    ctx,
                    routeKind,
                    routeScopeId,
                    typeof body.workspaceId === 'string' ? body.workspaceId : queryWorkspaceId(req),
                );
            } catch (err) {
                return handleAPIError(res, err);
            }

            const comments = body.comments;
            if (!Array.isArray(comments) || comments.length === 0) {
                return handleAPIError(res, badRequest('At least one comment is required'));
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (item.status !== 'aiDone') {
                return handleAPIError(res, badRequest(
                    `Cannot request changes in status '${item.status}'. Work item must be in 'aiDone' status.`
                ));
            }

            // Build new plan version incorporating the comments
            const now = new Date().toISOString();
            const currentPlan = item.plan?.content || '';
            const source: string | undefined = body.source; // 'diff-comments' | undefined
            const commentBlock = comments.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n');
            const heading = source === 'diff-comments'
                ? '## Diff Review Comments (to address)'
                : '## Review Comments (to address)';
            const newContent = currentPlan + '\n\n' + heading + '\n\n' + commentBlock;
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion = {
                version: newVersion,
                content: newContent,
                createdAt: now,
                resolvedBy: 'user' as const,
                source: 'user' as const,
                authorType: 'user' as const,
                reason: source === 'diff-comments'
                    ? `Incorporated ${comments.length} diff review comment(s)`
                    : `Incorporated ${comments.length} review comment(s)`,
                summary: source === 'diff-comments'
                    ? `Incorporated ${comments.length} diff review comment(s)`
                    : `Incorporated ${comments.length} review comment(s)`,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion, scope.storageRepoId);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                status: 'readyToExecute',
                currentContentVersion: newVersion,
                plan: {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: newContent,
                    updatedAt: now,
                    resolvedBy: 'user',
                    source: 'user',
                    reason: planVersion.reason,
                },
                reviewComments: [],
            }, scope.storageRepoId);

            if (updated) {
                clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updated });
            }

            sendJSON(res, 200, { plan: planVersion, newVersion });
        },
    });

    // DELETE /api/origins/:originId/work-items/:workItemId — Delete work item
    routes.push({
        method: 'DELETE',
        pattern: WORK_ITEM_DETAIL_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }

            const removed = await workItemStore.removeWorkItem(workItemId);
            if (!removed) {
                return handleAPIError(res, notFound('Work item'));
            }
            invalidateAndBroadcastRemoval(scope, getWsServer, workItemId);
            sendJSON(res, 204, null);
        },
    });

    // PATCH /api/origins/:originId/work-items/:workItemId/pin — Pin/unpin work item
    routes.push({
        method: 'PATCH',
        pattern: WORK_ITEM_PIN_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const pinned = body.pinned;
            if (typeof pinned !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "pinned" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (pinned) {
                updated = await workItemStore.pinWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unpinWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });

    // PATCH /api/origins/:originId/work-items/:workItemId/archive — Archive/unarchive work item
    routes.push({
        method: 'PATCH',
        pattern: WORK_ITEM_ARCHIVE_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const archived = body.archived;
            if (typeof archived !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "archived" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (archived) {
                updated = await workItemStore.archiveWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unarchiveWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });
}

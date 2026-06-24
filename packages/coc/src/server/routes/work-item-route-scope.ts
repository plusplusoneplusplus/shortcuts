import * as http from 'http';
import * as url from 'url';
import {
    type ProcessStore,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import {
    resolveWorkspaceOriginId,
    sameOriginWorkspaceIds,
} from '../repos/origin-scope';
import { badRequest } from '../errors';

export type WorkItemRouteScopeKind = 'workspaces' | 'origins';

/**
 * Build a route pattern for an origin-scoped persistent API. Both the
 * `/api/workspaces/<id>/...` and `/api/origins/<id>/...` families are matched so
 * new handlers do not hand-roll the `(workspaces|origins)` scope segment.
 *
 * Capture group 1 is the scope kind (`workspaces`/`origins`), group 2 is the
 * scope id; any capture groups inside `tail` follow. `tail` is appended raw and
 * the pattern is anchored at both ends.
 *
 * @example scopedRoutePattern('/work-items/([^/]+)') // → /api/(workspaces|origins)/<id>/work-items/<id>
 */
export function scopedRoutePattern(tail = ''): RegExp {
    return new RegExp(`^/api/(workspaces|origins)/([^/]+)${tail}$`);
}

export interface WorkItemRouteScope {
    kind: WorkItemRouteScopeKind;
    routeScopeId: string;
    storageRepoId: string;
    commandRepoId: string;
    workspaceId?: string;
}

export function queryWorkspaceId(req: http.IncomingMessage): string | undefined {
    const parsed = url.parse(req.url || '/', true);
    const raw = parsed.query.workspaceId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/**
 * Resolve a workspace record to its canonical origin id. Thin facade over the
 * shared origin-scope resolver so route handlers and the binding store keep one
 * import surface.
 */
export async function workspaceOriginId(
    workspace: WorkspaceInfo,
    processStore?: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string> {
    return resolveWorkspaceOriginId(workspace, processStore);
}

export async function resolveWorkspaceWorkItemOriginId(
    processStore: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>,
    workspaceId: string,
): Promise<string> {
    const workspaces = await processStore.getWorkspaces();
    const workspace = workspaces.find(entry => entry.id === workspaceId);
    return workspace ? resolveWorkspaceOriginId(workspace, processStore) : workspaceId;
}

export async function legacyWorkspaceIdsForWorkItemOrigin(
    processStore: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>,
    originId: string,
): Promise<string[]> {
    return sameOriginWorkspaceIds(processStore, originId);
}

export async function resolveWorkItemRouteScope(
    ctx: Pick<{ processStore: ProcessStore }, 'processStore'>,
    kind: WorkItemRouteScopeKind,
    routeScopeId: string,
    workspaceId?: string,
): Promise<WorkItemRouteScope> {
    if (kind === 'origins') {
        if (!workspaceId) {
            return {
                kind,
                routeScopeId,
                storageRepoId: routeScopeId,
                commandRepoId: routeScopeId,
            };
        }

        const workspaces = await ctx.processStore?.getWorkspaces?.() ?? [];
        const workspace = workspaces.find(entry => entry.id === workspaceId);
        if (!workspace) {
            throw badRequest(`workspaceId '${workspaceId}' is not registered`);
        }
        const resolvedOriginId = await workspaceOriginId(workspace, ctx.processStore);
        if (resolvedOriginId !== routeScopeId) {
            throw badRequest(`workspaceId '${workspaceId}' resolves to origin '${resolvedOriginId}', not '${routeScopeId}'`);
        }
        return {
            kind,
            routeScopeId,
            storageRepoId: routeScopeId,
            commandRepoId: workspaceId,
            workspaceId,
        };
    }

    const workspaces = await ctx.processStore?.getWorkspaces?.() ?? [];
    const workspace = workspaces.find(entry => entry.id === routeScopeId);
    const storageRepoId = workspace
        ? await workspaceOriginId(workspace, ctx.processStore)
        : routeScopeId;
    return {
        kind,
        routeScopeId,
        storageRepoId,
        commandRepoId: routeScopeId,
        workspaceId: routeScopeId,
    };
}

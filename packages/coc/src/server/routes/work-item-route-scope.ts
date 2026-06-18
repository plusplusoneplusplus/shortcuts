import * as http from 'http';
import * as url from 'url';
import {
    detectRemoteUrl,
    resolveCanonicalOriginId,
    type ProcessStore,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import { badRequest } from '../errors';

export type WorkItemRouteScopeKind = 'workspaces' | 'origins';

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

export async function workspaceOriginId(
    workspace: WorkspaceInfo,
    processStore?: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string> {
    let remoteUrl = workspace.remoteUrl;
    if (!remoteUrl && workspace.rootPath) {
        remoteUrl = await detectRemoteUrl(workspace.rootPath);
        if (remoteUrl) {
            await processStore?.updateWorkspace?.(workspace.id, { remoteUrl });
        }
    }
    return resolveCanonicalOriginId({ remoteUrl, workspaceId: workspace.id });
}

export async function resolveWorkspaceWorkItemOriginId(
    processStore: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>,
    workspaceId: string,
): Promise<string> {
    const workspaces = await processStore.getWorkspaces();
    const workspace = workspaces.find(entry => entry.id === workspaceId);
    return workspace ? workspaceOriginId(workspace, processStore) : workspaceId;
}

export async function legacyWorkspaceIdsForWorkItemOrigin(
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

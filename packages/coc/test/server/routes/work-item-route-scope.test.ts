import { describe, it, expect } from 'vitest';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    resolveWorkItemRouteScope,
    scopedRoutePattern,
} from '../../../src/server/routes/work-item-route-scope';

function makeCtx(workspaces: WorkspaceInfo[]): { processStore: ProcessStore } {
    const store = {
        getWorkspaces: async () => workspaces,
        updateWorkspace: async (id: string, patch: Partial<WorkspaceInfo>) => {
            const ws = workspaces.find(entry => entry.id === id);
            if (!ws) return undefined;
            Object.assign(ws, patch);
            return ws;
        },
    } as unknown as ProcessStore;
    return { processStore: store };
}

function workspace(overrides: Partial<WorkspaceInfo> & { id: string }): WorkspaceInfo {
    return { name: overrides.id, rootPath: `/repos/${overrides.id}`, ...overrides } as WorkspaceInfo;
}

describe('scopedRoutePattern', () => {
    it('matches both the workspaces and origins families and captures kind + id', () => {
        const pattern = scopedRoutePattern('/work-items');
        expect('/api/workspaces/ws-1/work-items'.match(pattern)?.slice(1)).toEqual(['workspaces', 'ws-1']);
        expect('/api/origins/gh_owner_repo/work-items'.match(pattern)?.slice(1)).toEqual(['origins', 'gh_owner_repo']);
    });

    it('anchors both ends and exposes tail capture groups', () => {
        const pattern = scopedRoutePattern('/work-items/([^/]+)');
        expect(pattern.test('/api/workspaces/ws-1/work-items')).toBe(false);
        expect(pattern.test('/api/workspaces/ws-1/work-items/wi-9/extra')).toBe(false);
        expect('/api/origins/gh_o_r/work-items/wi-9'.match(pattern)?.slice(1)).toEqual([
            'origins',
            'gh_o_r',
            'wi-9',
        ]);
    });

    it('rejects unknown scope families', () => {
        const pattern = scopedRoutePattern('/work-items');
        expect(pattern.test('/api/repos/ws-1/work-items')).toBe(false);
    });
});

describe('resolveWorkItemRouteScope', () => {
    it('resolves the workspaces family to a canonical storage id with the workspace as command repo', async () => {
        const ctx = makeCtx([workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' })]);
        const scope = await resolveWorkItemRouteScope(ctx, 'workspaces', 'clone-a');
        expect(scope).toEqual({
            kind: 'workspaces',
            routeScopeId: 'clone-a',
            storageRepoId: 'gh_owner_repo',
            commandRepoId: 'clone-a',
            workspaceId: 'clone-a',
        });
    });

    it('keeps an unregistered workspaces id as its own storage id', async () => {
        const ctx = makeCtx([]);
        const scope = await resolveWorkItemRouteScope(ctx, 'workspaces', 'gh_owner_repo');
        expect(scope.storageRepoId).toBe('gh_owner_repo');
        expect(scope.commandRepoId).toBe('gh_owner_repo');
    });

    it('uses the origin id directly when the origins family has no selected workspace', async () => {
        const ctx = makeCtx([workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' })]);
        const scope = await resolveWorkItemRouteScope(ctx, 'origins', 'gh_owner_repo');
        expect(scope).toEqual({
            kind: 'origins',
            routeScopeId: 'gh_owner_repo',
            storageRepoId: 'gh_owner_repo',
            commandRepoId: 'gh_owner_repo',
        });
    });

    it('binds the selected workspace as command repo when it resolves to the origin', async () => {
        const ctx = makeCtx([workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' })]);
        const scope = await resolveWorkItemRouteScope(ctx, 'origins', 'gh_owner_repo', 'clone-a');
        expect(scope).toEqual({
            kind: 'origins',
            routeScopeId: 'gh_owner_repo',
            storageRepoId: 'gh_owner_repo',
            commandRepoId: 'clone-a',
            workspaceId: 'clone-a',
        });
    });

    it('rejects an unregistered selected workspace', async () => {
        const ctx = makeCtx([]);
        await expect(resolveWorkItemRouteScope(ctx, 'origins', 'gh_owner_repo', 'missing'))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a selected workspace that resolves to a different origin', async () => {
        const ctx = makeCtx([workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/other.git' })]);
        await expect(resolveWorkItemRouteScope(ctx, 'origins', 'gh_owner_repo', 'clone-a'))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});

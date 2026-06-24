import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectRemoteUrl, type ProcessStore, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    isCanonicalOriginId,
    mapWorkspaceOriginIds,
    resolveOriginIdForId,
    resolveWorkspaceOriginId,
    resolveWorkspaceRemoteUrl,
    sameOriginWorkspaceIds,
} from '../../../src/server/repos/origin-scope';

// Keep the real canonical-id resolution; only stub remote detection so the
// detect-and-backfill path is deterministic without a real git checkout.
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, detectRemoteUrl: vi.fn() };
});

const mockedDetectRemoteUrl = vi.mocked(detectRemoteUrl);

function workspace(overrides: Partial<WorkspaceInfo> & { id: string }): WorkspaceInfo {
    return {
        name: overrides.id,
        rootPath: `/repos/${overrides.id}`,
        ...overrides,
    } as WorkspaceInfo;
}

function makeProcessStore(workspaces: WorkspaceInfo[]): {
    store: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>;
    updates: Array<{ id: string; updates: Partial<WorkspaceInfo> }>;
} {
    const updates: Array<{ id: string; updates: Partial<WorkspaceInfo> }> = [];
    const store: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'> = {
        getWorkspaces: async () => workspaces,
        updateWorkspace: async (id, patch) => {
            updates.push({ id, updates: patch as Partial<WorkspaceInfo> });
            const ws = workspaces.find(entry => entry.id === id);
            if (!ws) return undefined;
            Object.assign(ws, patch);
            return ws;
        },
    };
    return { store, updates };
}

beforeEach(() => {
    mockedDetectRemoteUrl.mockReset();
});

describe('isCanonicalOriginId', () => {
    it('recognizes canonical origin prefixes', () => {
        expect(isCanonicalOriginId('gh_owner_repo')).toBe(true);
        expect(isCanonicalOriginId('ado_org_project')).toBe(true);
        expect(isCanonicalOriginId('git_abc123')).toBe(true);
        expect(isCanonicalOriginId('local_ws-1')).toBe(true);
    });

    it('rejects clone-specific workspace ids', () => {
        expect(isCanonicalOriginId('ws-xjvuoc')).toBe(false);
        expect(isCanonicalOriginId('clone-a')).toBe(false);
        expect(isCanonicalOriginId('github_owner_repo')).toBe(false);
    });
});

describe('resolveWorkspaceRemoteUrl', () => {
    it('returns the stored remote without detecting when present', async () => {
        const ws = workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' });
        const remote = await resolveWorkspaceRemoteUrl(ws);
        expect(remote).toBe('https://github.com/owner/repo.git');
        expect(mockedDetectRemoteUrl).not.toHaveBeenCalled();
    });

    it('detects and backfills the remote when the record has none', async () => {
        mockedDetectRemoteUrl.mockResolvedValue('git@github.com:owner/repo.git');
        const ws = workspace({ id: 'clone-a', remoteUrl: undefined });
        const { store, updates } = makeProcessStore([ws]);

        const remote = await resolveWorkspaceRemoteUrl(ws, store);

        expect(remote).toBe('git@github.com:owner/repo.git');
        expect(mockedDetectRemoteUrl).toHaveBeenCalledWith('/repos/clone-a');
        expect(updates).toEqual([{ id: 'clone-a', updates: { remoteUrl: 'git@github.com:owner/repo.git' } }]);
    });

    it('returns undefined and does not backfill when detection finds no remote', async () => {
        mockedDetectRemoteUrl.mockResolvedValue(undefined);
        const ws = workspace({ id: 'clone-a', remoteUrl: undefined });
        const { store, updates } = makeProcessStore([ws]);

        const remote = await resolveWorkspaceRemoteUrl(ws, store);

        expect(remote).toBeUndefined();
        expect(updates).toEqual([]);
    });

    it('does not detect when there is no root path', async () => {
        const ws = workspace({ id: 'clone-a', remoteUrl: undefined, rootPath: undefined });
        const remote = await resolveWorkspaceRemoteUrl(ws);
        expect(remote).toBeUndefined();
        expect(mockedDetectRemoteUrl).not.toHaveBeenCalled();
    });
});

describe('resolveWorkspaceOriginId', () => {
    it('resolves a canonical origin id from the stored remote', async () => {
        const ws = workspace({ id: 'clone-a', remoteUrl: 'https://github.com/Owner/Repo.git' });
        expect(await resolveWorkspaceOriginId(ws)).toBe('gh_owner_repo');
    });

    it('detects + backfills, then resolves the canonical origin id', async () => {
        mockedDetectRemoteUrl.mockResolvedValue('git@github.com:owner/repo.git');
        const ws = workspace({ id: 'clone-a', remoteUrl: undefined });
        const { store, updates } = makeProcessStore([ws]);

        expect(await resolveWorkspaceOriginId(ws, store)).toBe('gh_owner_repo');
        expect(updates).toHaveLength(1);
    });

    it('falls back to a local origin id when no remote is available', async () => {
        mockedDetectRemoteUrl.mockResolvedValue(undefined);
        const ws = workspace({ id: 'ws-solo', remoteUrl: undefined });
        expect(await resolveWorkspaceOriginId(ws)).toBe('local_ws-solo');
    });
});

describe('mapWorkspaceOriginIds', () => {
    it('maps every workspace to its canonical origin in getWorkspaces order', async () => {
        const workspaces = [
            workspace({ id: 'clone-a', remoteUrl: 'https://github.com/Owner/Repo.git' }),
            workspace({ id: 'clone-b', remoteUrl: 'git@github.com:owner/repo.git' }),
            workspace({ id: 'other', remoteUrl: 'https://github.com/owner/other.git' }),
        ];
        const { store } = makeProcessStore(workspaces);

        const map = await mapWorkspaceOriginIds(store);

        expect([...map.entries()]).toEqual([
            ['clone-a', 'gh_owner_repo'],
            ['clone-b', 'gh_owner_repo'],
            ['other', 'gh_owner_other'],
        ]);
    });
});

describe('sameOriginWorkspaceIds', () => {
    it('lists all clones sharing one canonical origin in order', async () => {
        const workspaces = [
            workspace({ id: 'clone-a', remoteUrl: 'https://github.com/Owner/Repo.git' }),
            workspace({ id: 'other', remoteUrl: 'https://github.com/owner/other.git' }),
            workspace({ id: 'clone-b', remoteUrl: 'git@github.com:owner/repo.git' }),
        ];
        const { store } = makeProcessStore(workspaces);

        expect(await sameOriginWorkspaceIds(store, 'gh_owner_repo')).toEqual(['clone-a', 'clone-b']);
    });

    it('returns an empty list when no workspace resolves to the origin', async () => {
        const { store } = makeProcessStore([
            workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' }),
        ]);
        expect(await sameOriginWorkspaceIds(store, 'gh_owner_other')).toEqual([]);
    });
});

describe('resolveOriginIdForId', () => {
    it('resolves a registered workspace id to its origin', async () => {
        const { store } = makeProcessStore([
            workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' }),
        ]);
        expect(await resolveOriginIdForId(store, 'clone-a')).toBe('gh_owner_repo');
    });

    it('passes through an already-canonical origin id that is not registered', async () => {
        const { store } = makeProcessStore([]);
        expect(await resolveOriginIdForId(store, 'gh_owner_repo')).toBe('gh_owner_repo');
    });

    it('returns undefined for an unregistered, non-canonical id', async () => {
        const { store } = makeProcessStore([
            workspace({ id: 'clone-a', remoteUrl: 'https://github.com/owner/repo.git' }),
        ]);
        expect(await resolveOriginIdForId(store, 'ws-unknown')).toBeUndefined();
    });
});

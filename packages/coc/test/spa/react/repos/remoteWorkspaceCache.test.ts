import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheKey = 'coc-remote-workspace-cache';

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
});

describe('remote workspace identity cache', () => {
    it('persists destination identity and reloads it with its workspace list', async () => {
        const { saveRemoteWorkspaceCacheEntry } = await import('../../../../src/server/spa/client/react/repos/remoteWorkspaceCache');
        const workspaces = [{ id: 'shared', name: 'Repo', rootPath: '/repo' }];
        saveRemoteWorkspaceCacheEntry('alias', { baseUrl: 'http://old-port', serverIdentity: 'installation-a', workspaces });
        vi.resetModules();
        const { loadRemoteWorkspaceCache } = await import('../../../../src/server/spa/client/react/repos/remoteWorkspaceCache');
        expect(loadRemoteWorkspaceCache().alias).toMatchObject({ serverIdentity: 'installation-a', workspaces });
    });

    it('loads caches without identity without substituting the registry alias', async () => {
        localStorage.setItem(cacheKey, JSON.stringify({ alias: { baseUrl: 'http://old', workspaces: [], updatedAt: 1 } }));
        const { loadRemoteWorkspaceCache } = await import('../../../../src/server/spa/client/react/repos/remoteWorkspaceCache');
        expect(loadRemoteWorkspaceCache().alias.serverIdentity).toBeUndefined();
    });

    it.each([null, '', '  ', 42, {}])('rejects a malformed persisted identity (%j)', async serverIdentity => {
        localStorage.setItem(cacheKey, JSON.stringify({ alias: { baseUrl: 'http://old', serverIdentity, workspaces: [] } }));
        const { loadRemoteWorkspaceCache } = await import('../../../../src/server/spa/client/react/repos/remoteWorkspaceCache');
        expect(loadRemoteWorkspaceCache()).toEqual({});
    });
});

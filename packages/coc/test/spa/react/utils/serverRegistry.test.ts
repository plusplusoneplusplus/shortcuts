import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    addRemoteServer,
    getServerEndpoint,
    listRemoteServers,
    removeRemoteServer,
    testRemoteServer,
    updateRemoteServer,
    type RemoteServer,
} from '../../../../src/server/spa/client/react/utils/serverRegistry';

const LEGACY_REGISTRY_KEY = 'coc-remote-servers';
const MIGRATION_DONE_KEY = 'coc-remote-servers-api-migrated';

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

describe('serverRegistry API client', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        localStorage.clear();
        fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('lists remote servers from the backend after migration is marked complete', async () => {
        localStorage.setItem(MIGRATION_DONE_KEY, 'true');
        const servers: RemoteServer[] = [
            { id: 'a', kind: 'url', label: 'A', url: 'http://a.example.com', addedAt: 1, updatedAt: 1 },
        ];
        fetchMock.mockResolvedValueOnce(jsonResponse(servers));

        await expect(listRemoteServers()).resolves.toEqual(servers);
        expect(fetchMock).toHaveBeenCalledWith('/api/servers', expect.any(Object));
    });

    it('adds, updates, removes, and tests through backend routes', async () => {
        localStorage.setItem(MIGRATION_DONE_KEY, 'true');
        const created = { id: 'a', kind: 'url', label: 'A', url: 'http://a.example.com', addedAt: 1, updatedAt: 1 };
        fetchMock
            .mockResolvedValueOnce(jsonResponse(created, 201))
            .mockResolvedValueOnce(jsonResponse({ ...created, label: 'B' }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }))
            .mockResolvedValueOnce(jsonResponse({ serverId: 'test', kind: 'url', status: 'online', lastChecked: 1 }));

        await expect(addRemoteServer({ kind: 'url', label: 'A', url: 'http://a.example.com' })).resolves.toEqual(created);
        await expect(updateRemoteServer('a', { label: 'B' })).resolves.toMatchObject({ label: 'B' });
        await expect(removeRemoteServer('a')).resolves.toBeUndefined();
        await expect(testRemoteServer({ kind: 'url', label: 'A', url: 'http://a.example.com' })).resolves.toMatchObject({ status: 'online' });

        expect(fetchMock.mock.calls.map(call => [call[0], call[1]?.method ?? 'GET'])).toEqual([
            ['/api/servers', 'POST'],
            ['/api/servers/a', 'PATCH'],
            ['/api/servers/a', 'DELETE'],
            ['/api/servers/test', 'POST'],
        ]);
    });

    it('migrates legacy localStorage URL entries once without deleting them', async () => {
        localStorage.setItem(LEGACY_REGISTRY_KEY, JSON.stringify([
            { id: 'old', label: 'Old Box', url: 'http://old.example.com/', addedAt: 1 },
        ]));
        fetchMock
            .mockResolvedValueOnce(jsonResponse([]))
            .mockResolvedValueOnce(jsonResponse({ id: 'new', kind: 'url', label: 'Old Box', url: 'http://old.example.com', addedAt: 2, updatedAt: 2 }, 201))
            .mockResolvedValueOnce(jsonResponse([{ id: 'new', kind: 'url', label: 'Old Box', url: 'http://old.example.com', addedAt: 2, updatedAt: 2 }]));

        const servers = await listRemoteServers();

        expect(servers).toHaveLength(1);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/servers');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
            kind: 'url',
            label: 'Old Box',
            url: 'http://old.example.com',
        });
        expect(localStorage.getItem(LEGACY_REGISTRY_KEY)).not.toBeNull();
        expect(localStorage.getItem(MIGRATION_DONE_KEY)).toBe('true');
    });

    it('does not mark migration complete when import fails', async () => {
        localStorage.setItem(LEGACY_REGISTRY_KEY, JSON.stringify([
            { label: 'Old Box', url: 'http://old.example.com' },
        ]));
        fetchMock
            .mockResolvedValueOnce(jsonResponse([]))
            .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500));

        await expect(listRemoteServers()).rejects.toThrow('nope');
        expect(localStorage.getItem(MIGRATION_DONE_KEY)).toBeNull();
    });

    it('resolves direct URL and DevTunnel endpoints', () => {
        expect(getServerEndpoint({ id: 'u', kind: 'url', label: 'U', url: 'http://u.example.com', addedAt: 1, updatedAt: 1 })).toBe('http://u.example.com');
        expect(getServerEndpoint({ id: 'd', kind: 'devtunnel', label: 'D', tunnelId: 'tid', effectiveUrl: 'http://127.0.0.1:4000', addedAt: 1, updatedAt: 1 })).toBe('http://127.0.0.1:4000');
        expect(getServerEndpoint({ id: 'd', kind: 'devtunnel', label: 'D', tunnelId: 'tid', addedAt: 1, updatedAt: 1 })).toBeUndefined();
    });
});

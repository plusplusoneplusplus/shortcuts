/**
 * Tests for remote workspace aggregation (AC-01):
 *   • tag + merge logic (tagRemoteWorkspaces / aggregateRemoteWorkspaces)
 *   • offline-cache fallback (offline server → cached entries flagged offline)
 *
 * All remote I/O is mocked — no live remote server is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteServer, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Feature flag — flipped per-test.
let remoteShellEnabled = true;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isRemoteShellEnabled: () => remoteShellEnabled,
}));

// Registry client: getSpaCocClient().servers.list()
const serversList = vi.fn<[], Promise<RemoteServer[]>>();
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ servers: { list: serversList } }),
}));

// Per-server remote CocClient: replace only the constructor, keep real exports/types.
// Each base URL gets its own canned workspaces.list() + gitInfoBatch() response.
interface RemoteResponse {
    workspaces?: WorkspaceInfo[];
    gitInfo?: Record<string, unknown>;
    listError?: Error;
}
const remoteResponses = new Map<string, RemoteResponse>();
const constructedBaseUrls: string[] = [];

vi.mock('@plusplusoneplusplus/coc-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-client')>();
    class MockCocClient {
        private readonly baseUrl: string;
        readonly workspaces: {
            list: () => Promise<{ workspaces: WorkspaceInfo[] }>;
            gitInfoBatch: (ids: string[]) => Promise<{ results: Record<string, unknown> }>;
        };
        constructor(options: { baseUrl?: string }) {
            this.baseUrl = options.baseUrl ?? '';
            constructedBaseUrls.push(this.baseUrl);
            const resp = remoteResponses.get(this.baseUrl) ?? {};
            this.workspaces = {
                list: async () => {
                    if (resp.listError) throw resp.listError;
                    return { workspaces: resp.workspaces ?? [] };
                },
                gitInfoBatch: async () => ({ results: resp.gitInfo ?? {} }),
            };
        }
    }
    return { ...actual, CocClient: MockCocClient };
});

// Import after mocks are registered.
import {
    aggregateRemoteWorkspaces,
    isRemoteWorkspace,
    tagRemoteWorkspaces,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import {
    _resetRemoteWorkspaceCache,
    loadRemoteWorkspaceCache,
    saveRemoteWorkspaceCacheEntry,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceCache';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ws(id: string, name = id, extra: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
    return { id, name, rootPath: `/repos/${id}`, ...extra };
}

function onlineServer(id: string, label: string, effectiveUrl: string): RemoteServer {
    return {
        id,
        label,
        kind: 'ssh',
        host: id,
        localPort: 4000,
        addedAt: 0,
        updatedAt: 0,
        status: 'online',
        effectiveUrl,
    } as RemoteServer;
}

function offlineServer(id: string, label: string, effectiveUrl?: string): RemoteServer {
    return {
        id,
        label,
        kind: 'ssh',
        host: id,
        localPort: 4000,
        addedAt: 0,
        updatedAt: 0,
        status: 'offline',
        ...(effectiveUrl ? { effectiveUrl } : {}),
    } as RemoteServer;
}

beforeEach(() => {
    remoteShellEnabled = true;
    serversList.mockReset();
    remoteResponses.clear();
    constructedBaseUrls.length = 0;
    _resetRemoteWorkspaceCache();
});

afterEach(() => {
    _resetRemoteWorkspaceCache();
});

// ── tag logic ─────────────────────────────────────────────────────────────────

describe('tagRemoteWorkspaces', () => {
    it('tags each workspace with baseUrl + serverId + serverLabel and a remote marker', () => {
        const tagged = tagRemoteWorkspaces(
            { id: 'srv-1', label: 'Ubuntu ARM' },
            'http://127.0.0.1:4000',
            [ws('a'), ws('b')],
            false,
        );
        expect(tagged).toHaveLength(2);
        for (const t of tagged) {
            expect(t.baseUrl).toBe('http://127.0.0.1:4000');
            expect(t.remote).toEqual({
                baseUrl: 'http://127.0.0.1:4000',
                serverId: 'srv-1',
                serverLabel: 'Ubuntu ARM',
                offline: false,
            });
            expect(isRemoteWorkspace(t)).toBe(true);
        }
    });

    it('flags entries offline when offline=true and falls back to id when label missing', () => {
        const tagged = tagRemoteWorkspaces({ id: 'srv-2', label: '' }, 'http://127.0.0.1:5000', [ws('a')], true);
        expect(tagged[0].remote.offline).toBe(true);
        expect(tagged[0].remote.serverLabel).toBe('srv-2');
    });

    it('preserves original workspace fields', () => {
        const tagged = tagRemoteWorkspaces(
            { id: 's', label: 'L' },
            'http://127.0.0.1:4000',
            [ws('a', 'Repo A', { remoteUrl: 'git@github.com:org/repo.git', isGitRepo: true })],
            false,
        );
        expect(tagged[0].name).toBe('Repo A');
        expect(tagged[0].remoteUrl).toBe('git@github.com:org/repo.git');
        expect(tagged[0].isGitRepo).toBe(true);
    });
});

describe('isRemoteWorkspace', () => {
    it('returns false for local workspaces (no baseUrl/remote)', () => {
        expect(isRemoteWorkspace(ws('local'))).toBe(false);
        expect(isRemoteWorkspace(null)).toBe(false);
        expect(isRemoteWorkspace({ baseUrl: 'x' })).toBe(false); // missing remote marker
    });
});

// ── merge (online) ──────────────────────────────────────────────────────────

describe('aggregateRemoteWorkspaces — online merge', () => {
    it('fetches each online server at its effectiveUrl and merges tagged workspaces + git-info', async () => {
        serversList.mockResolvedValue([
            onlineServer('srv-1', 'Server One', 'http://127.0.0.1:4000'),
            onlineServer('srv-2', 'Server Two', 'http://127.0.0.1:4001'),
        ]);
        remoteResponses.set('http://127.0.0.1:4000', {
            workspaces: [ws('w1'), ws('w2')],
            gitInfo: { w1: { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: null } },
        });
        remoteResponses.set('http://127.0.0.1:4001', {
            workspaces: [ws('w3')],
            gitInfo: { w3: { branch: 'dev', dirty: true, isGitRepo: true, remoteUrl: null } },
        });

        const result = await aggregateRemoteWorkspaces();

        // Fetched directly at each effectiveUrl.
        expect(constructedBaseUrls).toContain('http://127.0.0.1:4000');
        expect(constructedBaseUrls).toContain('http://127.0.0.1:4001');

        expect(result.sources).toHaveLength(2);
        expect(result.workspaces.map(w => w.id).sort()).toEqual(['w1', 'w2', 'w3']);

        // Tagging carries through the merge.
        const w1 = result.workspaces.find(w => w.id === 'w1')!;
        expect(w1.remote.serverId).toBe('srv-1');
        expect(w1.remote.serverLabel).toBe('Server One');
        expect(w1.remote.offline).toBe(false);
        expect(w1.baseUrl).toBe('http://127.0.0.1:4000');

        // git-info merged across sources, keyed by workspace id.
        expect(result.gitInfo.w1).toMatchObject({ branch: 'main' });
        expect(result.gitInfo.w3).toMatchObject({ branch: 'dev', dirty: true });
        expect(result.warnings).toHaveLength(0);
    });

    it('excludes virtual workspaces from the remote source', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', {
            workspaces: [ws('real'), ws('global', 'Global', { virtual: true })],
        });

        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces.map(w => w.id)).toEqual(['real']);
    });

    it('caches the online list so a later offline load can reuse it', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('w1'), ws('w2')] });

        await aggregateRemoteWorkspaces();

        const cache = loadRemoteWorkspaceCache();
        expect(cache['srv-1'].baseUrl).toBe('http://127.0.0.1:4000');
        expect(cache['srv-1'].workspaces.map(w => w.id)).toEqual(['w1', 'w2']);
        // Cached list is untagged so it can be re-tagged offline.
        expect((cache['srv-1'].workspaces[0] as { remote?: unknown }).remote).toBeUndefined();
    });
});

// ── offline-cache fallback ──────────────────────────────────────────────────

describe('aggregateRemoteWorkspaces — offline cache fallback', () => {
    it('returns last-known cached entries flagged offline when the server is offline', async () => {
        // Seed cache as if a prior online fetch happened.
        saveRemoteWorkspaceCacheEntry('srv-1', {
            baseUrl: 'http://127.0.0.1:4000',
            workspaces: [ws('w1'), ws('w2')],
        });
        serversList.mockResolvedValue([offlineServer('srv-1', 'Server One')]);

        const result = await aggregateRemoteWorkspaces();

        // No live fetch attempted for an offline server.
        expect(constructedBaseUrls).toHaveLength(0);

        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].online).toBe(false);
        expect(result.workspaces.map(w => w.id)).toEqual(['w1', 'w2']);
        for (const w of result.workspaces) {
            expect(w.remote.offline).toBe(true);
            expect(w.remote.serverId).toBe('srv-1');
            // Falls back to cached baseUrl when the offline server has none.
            expect(w.baseUrl).toBe('http://127.0.0.1:4000');
        }
        // No git-info for cached (offline) sources.
        expect(result.gitInfo).toEqual({});
    });

    it('uses the cached baseUrl as fallback but prefers a current effectiveUrl when present', async () => {
        saveRemoteWorkspaceCacheEntry('srv-1', {
            baseUrl: 'http://127.0.0.1:4000',
            workspaces: [ws('w1')],
        });
        // devtunnel port reassignment: server reports a new effectiveUrl while offline.
        serversList.mockResolvedValue([offlineServer('srv-1', 'S1', 'http://127.0.0.1:9999')]);

        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces[0].baseUrl).toBe('http://127.0.0.1:9999');
    });

    it('omits an offline server with no cached entries (no phantom rows)', async () => {
        serversList.mockResolvedValue([offlineServer('srv-1', 'S1')]);
        const result = await aggregateRemoteWorkspaces();
        expect(result.sources).toHaveLength(0);
        expect(result.workspaces).toHaveLength(0);
    });

    it('falls back to cached offline entries when an online fetch throws', async () => {
        saveRemoteWorkspaceCacheEntry('srv-1', {
            baseUrl: 'http://127.0.0.1:4000',
            workspaces: [ws('w1')],
        });
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', { listError: new Error('ECONNREFUSED') });

        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces).toHaveLength(1);
        expect(result.workspaces[0].remote.offline).toBe(true);
        expect(result.warnings[0]).toContain('ECONNREFUSED');
    });

    it('mixes online and offline servers in one aggregate', async () => {
        saveRemoteWorkspaceCacheEntry('srv-off', {
            baseUrl: 'http://127.0.0.1:5000',
            workspaces: [ws('cached')],
        });
        serversList.mockResolvedValue([
            onlineServer('srv-on', 'Online', 'http://127.0.0.1:4000'),
            offlineServer('srv-off', 'Offline'),
        ]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('live')] });

        const result = await aggregateRemoteWorkspaces();
        const byId = new Map(result.workspaces.map(w => [w.id, w]));
        expect(byId.get('live')!.remote.offline).toBe(false);
        expect(byId.get('cached')!.remote.offline).toBe(true);
        expect(result.sources).toHaveLength(2);
    });
});

// ── feature-flag gating ─────────────────────────────────────────────────────

describe('aggregateRemoteWorkspaces — feature flag', () => {
    it('returns an empty aggregate and performs NO server fetch when remoteShell is OFF', async () => {
        remoteShellEnabled = false;
        const result = await aggregateRemoteWorkspaces();
        expect(serversList).not.toHaveBeenCalled();
        expect(constructedBaseUrls).toHaveLength(0);
        expect(result).toEqual({ sources: [], workspaces: [], gitInfo: {}, warnings: [] });
    });

    it('returns an empty aggregate when the registry list fails', async () => {
        serversList.mockRejectedValue(new Error('registry down'));
        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces).toHaveLength(0);
        expect(result.sources).toHaveLength(0);
    });
});

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
interface QueueRepoEntry {
    repoId: string;
    rootPath?: string;
    isPaused?: boolean;
    taskCount?: number;
    queuedCount?: number;
    runningCount?: number;
}
interface RemoteResponse {
    workspaces?: WorkspaceInfo[];
    gitInfo?: Record<string, unknown>;
    listError?: Error;
    /** Canned `/api/queue/repos` rows for this base URL (AC-05). */
    queueRepos?: QueueRepoEntry[];
    /** When set, queue.repos() rejects (queue fetch must stay resilient). */
    queueError?: Error;
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
        readonly queue: {
            repos: () => Promise<{ repos: QueueRepoEntry[] }>;
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
            this.queue = {
                repos: async () => {
                    if (resp.queueError) throw resp.queueError;
                    return { repos: resp.queueRepos ?? [] };
                },
            };
        }
    }
    return { ...actual, CocClient: MockCocClient };
});

// Import after mocks are registered.
import {
    aggregateRemoteWorkspaces,
    isRemoteWorkspace,
    remoteQueueStatusFromRepo,
    tagRemoteWorkspaces,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import type { RemoteServerRuntimeStatus } from '@plusplusoneplusplus/coc-client';
import {
    _resetRemoteWorkspaceCache,
    loadRemoteWorkspaceCache,
    saveRemoteWorkspaceCacheEntry,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceCache';
import {
    lookupCloneBaseUrl,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';

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

/** A non-online server (e.g. 'connecting' | 'failed' | 'idle') for the status dot. */
function serverWithStatus(id: string, label: string, status: RemoteServerRuntimeStatus, effectiveUrl?: string): RemoteServer {
    return {
        id,
        label,
        kind: 'ssh',
        host: id,
        localPort: 4000,
        addedAt: 0,
        updatedAt: 0,
        status,
        ...(effectiveUrl ? { effectiveUrl } : {}),
    } as RemoteServer;
}

beforeEach(() => {
    remoteShellEnabled = true;
    serversList.mockReset();
    remoteResponses.clear();
    constructedBaseUrls.length = 0;
    _resetRemoteWorkspaceCache();
    resetCloneRegistryForTests();
});

afterEach(() => {
    _resetRemoteWorkspaceCache();
    resetCloneRegistryForTests();
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
                cloneKey: `remote:${encodeURIComponent('srv-1')}:${encodeURIComponent(t.id)}`,
                offline: false,
                // AC-05: an online (offline=false) tag defaults to an online
                // connection + idle queue when no explicit status is supplied.
                connection: 'online',
                queue: 'idle',
            });
            expect(isRemoteWorkspace(t)).toBe(true);
        }
    });

    it('defaults connection to offline + idle queue when offline=true and no status given', () => {
        const tagged = tagRemoteWorkspaces({ id: 'srv-2', label: '' }, 'http://127.0.0.1:5000', [ws('a')], true);
        expect(tagged[0].remote.offline).toBe(true);
        expect(tagged[0].remote.serverLabel).toBe('srv-2');
        expect(tagged[0].remote.connection).toBe('offline');
        expect(tagged[0].remote.queue).toBe('idle');
    });

    it('applies an explicit connection + per-workspace queue status (AC-05)', () => {
        const tagged = tagRemoteWorkspaces(
            { id: 'srv-3', label: 'S3' },
            'http://127.0.0.1:6000',
            [ws('busy'), ws('calm')],
            false,
            { connection: 'online', queueByWorkspace: { busy: 'running' } },
        );
        const byId = new Map(tagged.map(t => [t.id, t]));
        expect(byId.get('busy')!.remote.queue).toBe('running');
        expect(byId.get('calm')!.remote.queue).toBe('idle'); // missing ⇒ idle
        expect(byId.get('busy')!.remote.connection).toBe('online');
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

// ── AC-05: connection status + remote queue sourcing ──────────────────────────

describe('remoteQueueStatusFromRepo', () => {
    it('maps paused > running > queued > idle', () => {
        expect(remoteQueueStatusFromRepo({ isPaused: true, runningCount: 3, queuedCount: 2 })).toBe('paused');
        expect(remoteQueueStatusFromRepo({ runningCount: 1, queuedCount: 5 })).toBe('running');
        expect(remoteQueueStatusFromRepo({ runningCount: 0, queuedCount: 2 })).toBe('queued');
        expect(remoteQueueStatusFromRepo({ runningCount: 0, queuedCount: 0 })).toBe('idle');
        expect(remoteQueueStatusFromRepo(undefined)).toBe('idle');
    });
});

describe('aggregateRemoteWorkspaces — connection + remote queue (AC-05)', () => {
    it('tags online workspaces with connection=online and their remote queue status', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', {
            workspaces: [ws('busy'), ws('calm')],
            queueRepos: [
                { repoId: 'busy', runningCount: 2, queuedCount: 0, isPaused: false },
                { repoId: 'calm', runningCount: 0, queuedCount: 0, isPaused: false },
            ],
        });

        const result = await aggregateRemoteWorkspaces();
        const byId = new Map(result.workspaces.map(w => [w.id, w]));
        expect(byId.get('busy')!.remote.connection).toBe('online');
        expect(byId.get('busy')!.remote.queue).toBe('running');
        expect(byId.get('calm')!.remote.queue).toBe('idle');
    });

    it('maps a paused remote repo to queue=paused', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', {
            workspaces: [ws('w1')],
            queueRepos: [{ repoId: 'w1', isPaused: true, runningCount: 0, queuedCount: 0 }],
        });
        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces[0].remote.queue).toBe('paused');
    });

    it('stays resilient when the remote queue fetch fails — workspaces survive with idle queue', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', {
            workspaces: [ws('w1')],
            queueError: new Error('queue 500'),
        });
        const result = await aggregateRemoteWorkspaces();
        // Server is NOT dropped; queue defaults to idle.
        expect(result.workspaces.map(w => w.id)).toEqual(['w1']);
        expect(result.workspaces[0].remote.connection).toBe('online');
        expect(result.workspaces[0].remote.queue).toBe('idle');
    });

    it('records connection=connecting for a connecting server (cached rows)', async () => {
        saveRemoteWorkspaceCacheEntry('srv-c', { baseUrl: 'http://127.0.0.1:4000', workspaces: [ws('w1')] });
        serversList.mockResolvedValue([serverWithStatus('srv-c', 'Connecting', 'connecting')]);

        const result = await aggregateRemoteWorkspaces();
        // No live fetch for a non-online server.
        expect(constructedBaseUrls).toHaveLength(0);
        expect(result.workspaces[0].remote.connection).toBe('connecting');
        expect(result.workspaces[0].remote.offline).toBe(true); // still cache-sourced
        expect(result.workspaces[0].remote.queue).toBe('idle');
    });

    it('records connection=offline for an offline server (cached rows)', async () => {
        saveRemoteWorkspaceCacheEntry('srv-o', { baseUrl: 'http://127.0.0.1:4000', workspaces: [ws('w1')] });
        serversList.mockResolvedValue([offlineServer('srv-o', 'Offline')]);

        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces[0].remote.connection).toBe('offline');
    });

    it('records connection=failed for a failed server (cached rows)', async () => {
        saveRemoteWorkspaceCacheEntry('srv-f', { baseUrl: 'http://127.0.0.1:4000', workspaces: [ws('w1')] });
        serversList.mockResolvedValue([serverWithStatus('srv-f', 'Failed', 'failed')]);

        const result = await aggregateRemoteWorkspaces();
        expect(result.workspaces[0].remote.connection).toBe('failed');
    });
});

// ── AC-07: populate the workspace→baseUrl LOOKUP registry ───────────────────
describe('aggregateRemoteWorkspaces — clone lookup registry (AC-07)', () => {
    it('registers every remote workspace id → its baseUrl for per-clone routing', async () => {
        serversList.mockResolvedValue([
            onlineServer('srv-1', 'Server One', 'http://127.0.0.1:4000'),
            onlineServer('srv-2', 'Server Two', 'http://127.0.0.1:4001'),
        ]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('w1'), ws('w2')] });
        remoteResponses.set('http://127.0.0.1:4001', { workspaces: [ws('w3')] });

        await aggregateRemoteWorkspaces();

        expect(lookupCloneBaseUrl('w1')).toBe('http://127.0.0.1:4000');
        expect(lookupCloneBaseUrl('w2')).toBe('http://127.0.0.1:4000');
        expect(lookupCloneBaseUrl('w3')).toBe('http://127.0.0.1:4001');
        // A local id is never registered → resolves to undefined (default client).
        expect(lookupCloneBaseUrl('local-only')).toBeUndefined();
    });

    it('registers OFFLINE (cached) clones too, so an offline-selected clone still resolves to its server (not local)', async () => {
        saveRemoteWorkspaceCacheEntry('srv-o', { baseUrl: 'http://127.0.0.1:4000', workspaces: [ws('w1')] });
        serversList.mockResolvedValue([offlineServer('srv-o', 'Offline')]);

        await aggregateRemoteWorkspaces();
        expect(lookupCloneBaseUrl('w1')).toBe('http://127.0.0.1:4000');
    });

    it('keeps duplicate legacy workspace ids as distinct server-scoped clone routes', async () => {
        serversList.mockResolvedValue([
            onlineServer('srv-1', 'Server One', 'http://127.0.0.1:4000'),
            onlineServer('srv-2', 'Server Two', 'http://127.0.0.1:4001'),
        ]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('ws-legacy', 'same path')] });
        remoteResponses.set('http://127.0.0.1:4001', { workspaces: [ws('ws-legacy', 'same path')] });

        const result = await aggregateRemoteWorkspaces();

        expect(result.workspaces).toHaveLength(2);
        expect(result.workspaces.map(w => w.remote.serverId).sort()).toEqual(['srv-1', 'srv-2']);
        expect(lookupCloneBaseUrl(buildRemoteCloneKey('srv-1', 'ws-legacy'))).toBe('http://127.0.0.1:4000');
        expect(lookupCloneBaseUrl(buildRemoteCloneKey('srv-2', 'ws-legacy'))).toBe('http://127.0.0.1:4001');
        expect(lookupCloneBaseUrl('ws-legacy')).toBeUndefined();
    });

    it('clears the registry when the remote-shell flag is OFF (per-clone routing reverts to local)', async () => {
        // First populate while ON.
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('w1')] });
        await aggregateRemoteWorkspaces();
        expect(lookupCloneBaseUrl('w1')).toBe('http://127.0.0.1:4000');

        // Flip OFF and re-aggregate → registry cleared.
        remoteShellEnabled = false;
        await aggregateRemoteWorkspaces();
        expect(lookupCloneBaseUrl('w1')).toBeUndefined();
    });

    it('clears the registry when the server registry is unavailable', async () => {
        serversList.mockResolvedValue([onlineServer('srv-1', 'S1', 'http://127.0.0.1:4000')]);
        remoteResponses.set('http://127.0.0.1:4000', { workspaces: [ws('w1')] });
        await aggregateRemoteWorkspaces();
        expect(lookupCloneBaseUrl('w1')).toBe('http://127.0.0.1:4000');

        serversList.mockRejectedValue(new Error('registry down'));
        await aggregateRemoteWorkspaces();
        expect(lookupCloneBaseUrl('w1')).toBeUndefined();
    });
});

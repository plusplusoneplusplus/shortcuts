/**
 * list_workspaces tool + workspace directory: local listing, remote listing via
 * each remote's /api/workspaces, offline/last-known handling, per-server
 * timeouts, query filter, result cap, and repo-group entries. Remote HTTP is
 * mocked through `fetchImpl`; nothing touches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BranchService } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createCache } from '../../../src/server/cache';
import { getRepoDataPath } from '../../../src/server/paths';
import { createListWorkspacesTool, LIST_WORKSPACES_MAX_RESULTS } from '../../../src/server/llm-tools/list-workspaces-tool';
import {
    createWorkspaceDirectory,
    type WorkspaceDirectoryEntry,
    type WorkspaceDirectoryOptions,
} from '../../../src/server/servers/workspace-directory';

type Ws = { id: string; name?: string; virtual?: boolean; rootPath?: string };

function makeStore(workspaces: Ws[]): ProcessStore {
    return { getWorkspaces: vi.fn().mockResolvedValue(workspaces) } as unknown as ProcessStore;
}

function remoteServer(id: string, label: string, opts: { kind?: string; effectiveUrl?: string } = {}) {
    return {
        id,
        label,
        kind: opts.kind ?? 'url',
        url: opts.effectiveUrl,
        effectiveUrl: opts.effectiveUrl,
        status: 'online',
        addedAt: 0,
        updatedAt: 0,
    } as any;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Route mocked fetch calls by URL; unknown URLs reject like a refused connection. */
function routedFetch(routes: Record<string, () => Response | Promise<Response>>) {
    return vi.fn(async (url: string | URL) => {
        const handler = routes[String(url)];
        if (!handler) throw new TypeError('fetch failed');
        return handler();
    }) as unknown as typeof fetch;
}

function makeDirectory(opts: Partial<WorkspaceDirectoryOptions> & { store: ProcessStore }) {
    return createWorkspaceDirectory({
        lastKnownCache: createCache<WorkspaceDirectoryEntry[]>({ namespace: 'test-last-known', immutable: true }),
        ...opts,
    });
}

async function runTool(directory: ReturnType<typeof makeDirectory>, args: { query?: string } = {}) {
    const { tool } = createListWorkspacesTool({ directory });
    return tool.handler(args, {} as any) as Promise<any>;
}

describe('list_workspaces', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-workspaces-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('lists local repos only when no remote servers are registered', async () => {
        const directory = makeDirectory({
            store: makeStore([
                { id: 'ws-a', name: 'alpha', rootPath: dataDir },
                { id: 'my_work', name: 'My Work', virtual: true },
            ]),
        });

        const result = await runTool(directory);

        expect(result.workspaces).toEqual([
            { id: 'ws-a', name: 'alpha', type: 'repo', server: 'local', serverKind: 'local', online: true, git: { state: 'non-git' } },
        ]);
        expect(result.servers).toEqual([{ server: 'local', serverKind: 'local', online: true }]);
        expect(result.total).toBe(1);
        expect(result.truncated).toBe(false);
        // Basic fields only: no paths leak.
        expect(JSON.stringify(result)).not.toContain('/secret');
    });

    it('lists local and online remote repos together with clone-key ids', async () => {
        const directory = makeDirectory({
            store: makeStore([{ id: 'ws-a', name: 'alpha' }]),
            remoteServers: { list: () => [remoteServer('srv-1', 'dev-vm', { kind: 'devtunnel', effectiveUrl: 'http://127.0.0.1:5001' })] },
            fetchImpl: routedFetch({
                'http://127.0.0.1:5001/api/workspaces': () => json({ workspaces: [{ id: 'ws-r', name: 'beta', rootPath: '/r/beta' }] }),
            }),
        });

        const result = await runTool(directory);

        expect(result.workspaces).toEqual([
            { id: 'ws-a', name: 'alpha', type: 'repo', server: 'local', serverKind: 'local', online: true, git: { state: 'unavailable' } },
            { id: 'remote:srv-1:ws-r', name: 'beta', type: 'repo', server: 'dev-vm', serverKind: 'devtunnel', online: true, git: { state: 'unavailable' } },
        ]);
        expect(result.servers).toContainEqual({ server: 'dev-vm', serverKind: 'devtunnel', online: true });
        expect(JSON.stringify(result)).not.toContain('127.0.0.1');
    });

    it('marks an offline server online:false with last-known repos, or zero repos when nothing is cached', async () => {
        let reachable = true;
        const store = makeStore([]);
        const directory = makeDirectory({
            store,
            remoteServers: {
                list: () => [
                    remoteServer('srv-1', 'box', { effectiveUrl: 'http://box:4000' }),
                    remoteServer('srv-2', 'never-seen', { kind: 'ssh' }),
                ],
            },
            fetchImpl: vi.fn(async (url: string) => {
                if (reachable && url === 'http://box:4000/api/workspaces') return json({ workspaces: [{ id: 'w1', name: 'repo1' }] });
                throw new TypeError('fetch failed');
            }) as unknown as typeof fetch,
        });

        const first = await runTool(directory);
        expect(first.workspaces).toContainEqual(expect.objectContaining({ id: 'remote:srv-1:w1', online: true }));

        reachable = false;
        const second = await runTool(directory);
        expect(second.workspaces).toEqual([
            { id: 'remote:srv-1:w1', name: 'repo1', type: 'repo', server: 'box', serverKind: 'url', online: false, git: { state: 'offline' } },
        ]);
        expect(second.servers).toEqual([
            { server: 'local', serverKind: 'local', online: true },
            { server: 'box', serverKind: 'url', online: false },
            { server: 'never-seen', serverKind: 'ssh', online: false },
        ]);
    });

    it('times out a slow remote quickly without failing the whole call', async () => {
        const directory = makeDirectory({
            store: makeStore([{ id: 'ws-a', name: 'alpha' }]),
            listTimeoutMs: 30,
            remoteServers: {
                list: () => [
                    remoteServer('slow', 'slow-box', { effectiveUrl: 'http://slow' }),
                    remoteServer('fast', 'fast-box', { effectiveUrl: 'http://fast' }),
                ],
            },
            fetchImpl: routedFetch({
                'http://slow/api/workspaces': () => new Promise<Response>(() => { /* never resolves */ }),
                'http://fast/api/workspaces': () => json({ workspaces: [{ id: 'f1', name: 'fast-repo' }] }),
            }),
        });

        const started = Date.now();
        const result = await runTool(directory);

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(result.workspaces.map((w: any) => w.id)).toEqual(['ws-a', 'remote:fast:f1']);
        expect(result.servers).toContainEqual({ server: 'slow-box', serverKind: 'url', online: false });
    });

    it('filters by case-insensitive substring over repo and server name', async () => {
        const directory = makeDirectory({
            store: makeStore([{ id: 'ws-a', name: 'Frontend' }, { id: 'ws-b', name: 'backend' }]),
            remoteServers: { list: () => [remoteServer('s', 'GPU-Box', { effectiveUrl: 'http://gpu' })] },
            fetchImpl: routedFetch({
                'http://gpu/api/workspaces': () => json({ workspaces: [{ id: 'g1', name: 'trainer' }] }),
            }),
        });

        expect((await runTool(directory, { query: 'END' })).workspaces.map((w: any) => w.name)).toEqual(['Frontend', 'backend']);
        expect((await runTool(directory, { query: 'gpu' })).workspaces.map((w: any) => w.name)).toEqual(['trainer']);
    });

    it(`caps results at ${LIST_WORKSPACES_MAX_RESULTS} and reports truncated + total`, async () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ id: `ws-${i}`, name: `repo-${i}` }));
        const result = await runTool(makeDirectory({ store: makeStore(many) }));

        expect(result.workspaces).toHaveLength(LIST_WORKSPACES_MAX_RESULTS);
        expect(result.total).toBe(60);
        expect(result.truncated).toBe(true);
    });

    it('lists repo groups as one entry with members (local and remote)', async () => {
        const groupFile = getRepoDataPath(dataDir, 'group-core', 'group.json');
        fs.mkdirSync(path.dirname(groupFile), { recursive: true });
        fs.writeFileSync(groupFile, JSON.stringify({ name: 'Core', members: ['ws-a', 'ws-b'] }));

        const directory = makeDirectory({
            dataDir,
            store: makeStore([
                { id: 'ws-a', name: 'alpha' },
                { id: 'ws-b', name: 'beta' },
                { id: 'group-core', name: 'Core', virtual: true },
            ]),
            remoteServers: { list: () => [remoteServer('s1', 'vm', { effectiveUrl: 'http://vm' })] },
            fetchImpl: routedFetch({
                'http://vm/api/workspaces': () => json({
                    workspaces: [{ id: 'r1', name: 'svc' }, { id: 'group-team', name: 'Team', virtual: true }],
                }),
                'http://vm/api/repo-groups/group-team': () => json({ id: 'group-team', name: 'Team', members: [{ workspaceId: 'r1', stale: false }] }),
            }),
        });

        const result = await runTool(directory);

        expect(result.workspaces).toContainEqual({
            id: 'group-core', name: 'Core', type: 'group', server: 'local', serverKind: 'local', online: true,
            members: [{ id: 'ws-a', name: 'alpha' }, { id: 'ws-b', name: 'beta' }],
        });
        expect(result.workspaces).toContainEqual({
            id: 'remote:s1:group-team', name: 'Team', type: 'group', server: 'vm', serverKind: 'url', online: true,
            members: [{ id: 'remote:s1:r1', name: 'svc' }],
        });
    });
});

describe('list_workspaces compact Git summary', () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-git-'));
        fs.mkdirSync(path.join(root, '.git'));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
        [false, false, 'main', 'origin/main', { state: 'clean', branch: 'main', ahead: 2, behind: 1 }],
        [true, false, 'topic', undefined, { state: 'dirty', branch: 'topic' }],
        [false, true, 'HEAD', 'origin/main', { state: 'clean', branch: null, detached: true }],
    ])('projects local status without files or upstream URLs (%s, %s)', async (dirty, detached, branch, upstream, expected) => {
        const read = vi.spyOn(BranchService.prototype, 'getRepositoryStatus').mockResolvedValue({
            branch, dirty, isDetached: detached, trackingBranch: upstream, ahead: 2, behind: 1, unborn: false,
        });
        const directory = makeDirectory({ store: makeStore([{ id: 'repo', rootPath: root }]) });
        const result = await runTool(directory);
        expect(result.workspaces[0].git).toEqual(expected);
        expect(read).toHaveBeenCalledWith(root);
        expect(JSON.stringify(result)).not.toContain('origin');
        expect(JSON.stringify(result)).not.toContain(root);
    });

    it('distinguishes failed status from non-Git and never probes a group root', async () => {
        const read = vi.spyOn(BranchService.prototype, 'getRepositoryStatus').mockResolvedValue(null);
        fs.mkdirSync(path.join(root, 'plain'));
        const directory = makeDirectory({ store: makeStore([
            { id: 'repo', rootPath: root }, { id: 'plain', rootPath: path.join(root, 'plain') },
            { id: 'group-g', rootPath: root, virtual: true },
        ]) });
        const result = await runTool(directory);
        expect(result.workspaces.map((row: any) => row.git)).toEqual([
            { state: 'unavailable' }, { state: 'non-git' }, undefined,
        ]);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('supports worktree .git files and local dashboard identity, but not missing roots', async () => {
        fs.rmSync(path.join(root, '.git'), { recursive: true });
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: /private/worktree');
        const read = vi.spyOn(BranchService.prototype, 'getRepositoryStatus').mockResolvedValue({
            branch: 'topic', dirty: true, isDetached: false, ahead: 0, behind: 0, unborn: false,
        });
        const directory = makeDirectory({ serverIdentity: 'local-id', store: makeStore([
            { id: 'repo', rootPath: root }, { id: 'missing', rootPath: path.join(root, 'missing') },
        ]) });
        expect(await directory.getGitSummary!({ serverIdentity: 'local-id', workspaceId: 'repo', online: true }, new AbortController().signal))
            .toEqual({ state: 'dirty', branch: 'topic' });
        expect(await directory.getGitSummary!({ id: 'missing', online: true }, new AbortController().signal))
            .toEqual({ state: 'unavailable' });
        expect(read).toHaveBeenCalledTimes(1);
    });

    function remoteDirectory(info: unknown, extra: { isGitRepo?: boolean; status?: number } = {}) {
        const server = { ...remoteServer('owner', 'Owner', { effectiveUrl: 'https://owner.invalid' }), serverIdentity: 'owner-id' };
        const fetchImpl = routedFetch({
            'https://owner.invalid/api/workspaces': () => json({ workspaces: [{ id: 'same', name: 'Remote', isGitRepo: extra.isGitRepo }] }),
            'https://owner.invalid/api/workspaces/same/git-info': () => json(info, extra.status),
        });
        const directory = makeDirectory({ store: makeStore([{ id: 'same', rootPath: root }]),
            serverIdentity: 'local-id', remoteServers: { list: () => [server] }, fetchImpl });
        return { directory, server, fetchImpl };
    }

    it('reads remote Git only through its owner and projects an allowlist', async () => {
        const local = vi.spyOn(BranchService.prototype, 'getRepositoryStatus');
        const { directory, fetchImpl } = remoteDirectory({
            isGitRepo: true, branch: 'main', dirty: true, ahead: 3, behind: 0, upstream: 'origin/main',
            remoteUrl: 'SECRET', files: ['SECRET'],
        });
        const result = await directory.getGitSummary!({ id: 'remote:owner:same', online: true }, new AbortController().signal);
        expect(result).toEqual({ state: 'dirty', branch: 'main', ahead: 3, behind: 0 });
        expect(local).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it.each([
        [{ isGitRepo: false }, {}, 'unavailable'],
        [{ isGitRepo: false }, { isGitRepo: false }, 'non-git'],
        [{}, { status: 404 }, 'unsupported'],
        [{}, { status: 503 }, 'unavailable'],
        [{ isGitRepo: true, dirty: false }, {}, 'unavailable'],
        [{ isGitRepo: true, branch: 'main', dirty: false, ahead: 0, behind: 0 }, {}, 'clean'],
    ])('handles remote non-Git, old capability and read failures (%j)', async (info, extra, state) => {
        const { directory } = remoteDirectory(info, extra);
        const result = await directory.getGitSummary!({ id: 'remote:owner:same', online: true }, new AbortController().signal);
        expect(result.state).toBe(state);
        expect(result).not.toHaveProperty('ahead');
    });

    it('binds dashboard reads to durable owner identity, never labels or equal local workspace IDs', async () => {
        const local = vi.spyOn(BranchService.prototype, 'getRepositoryStatus').mockResolvedValue(null);
        const { directory, fetchImpl } = remoteDirectory({ isGitRepo: true, branch: 'remote', dirty: false });
        const { tool } = createListWorkspacesTool({ directory, workspaceId: 'caller', getDashboardDiscovery: () => ({
            listWorkspaces: async () => [
                { workspaceId: 'same', serverIdentity: 'owner-id', workspaceLabel: 'Repo', serverLabel: 'local', serverKind: 'local', type: 'repo', online: true },
                { workspaceId: 'same', serverIdentity: 'unknown-owner', workspaceLabel: 'Repo', serverLabel: 'local', serverKind: 'local', type: 'repo', online: true },
                { workspaceId: 'same', workspaceLabel: 'Repo', serverLabel: 'local', serverKind: 'local', type: 'repo', online: false },
                { workspaceId: 'same', workspaceLabel: 'Repo', serverLabel: 'local', serverKind: 'local', type: 'repo', online: true },
            ],
        }) });
        const result = await tool.handler({ source: 'dashboard' }, {} as any) as any;
        expect(result.workspaces.map((row: any) => row.git)).toEqual([
            { state: 'clean', branch: 'remote' }, { state: 'unsupported' }, { state: 'offline' }, { state: 'unsupported' },
        ]);
        expect(local).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects late status after the remote owner changes', async () => {
        const { directory, server, fetchImpl } = remoteDirectory({});
        (fetchImpl as any).mockImplementationOnce(async () => {
            server.serverIdentity = 'replacement';
            return json({ workspaces: [{ id: 'same', isGitRepo: true }] });
        });
        expect(await directory.getGitSummary!({ id: 'remote:owner:same', online: true }, new AbortController().signal))
            .toEqual({ state: 'unavailable' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(await directory.getGitSummary!({ id: 'remote:owner:same', serverIdentity: 'owner-id', online: true }, new AbortController().signal))
            .toEqual({ state: 'unavailable' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('collects only capped matches with four reads and a single deadline; suppresses late results', async () => {
        vi.useFakeTimers();
        const directory = makeDirectory({ store: makeStore(Array.from({ length: 60 }, (_, i) => ({ id: `repo-${i}` }))) });
        let resolveRead!: (value: any) => void;
        const pending = new Promise<any>(resolve => { resolveRead = resolve; });
        const read = vi.spyOn(directory, 'getGitSummary').mockImplementation(() => pending);
        const resultPromise = runTool(directory);
        await vi.advanceTimersByTimeAsync(0);
        expect(read).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(4_000);
        const result = await resultPromise;
        expect(result.workspaces).toHaveLength(50);
        expect(result.total).toBe(60);
        expect(result.truncated).toBe(true);
        expect(result.workspaces.every((row: any) => row.git.state === 'unavailable')).toBe(true);
        expect(read.mock.calls[0][1].aborted).toBe(true);
        resolveRead({ state: 'clean', branch: 'late' });
        await Promise.resolve();
        expect(result.workspaces[0].git).toEqual({ state: 'unavailable' });
        read.mockResolvedValue({ state: 'non-git' });
        read.mockClear();
        await runTool(directory, { query: 'repo-59' });
        expect(read).toHaveBeenCalledTimes(1);
        expect(read.mock.calls[0][0].id).toBe('repo-59');
    });

    it('forwards cancellation to remote reads without failing the listing', async () => {
        const { directory, fetchImpl } = remoteDirectory({});
        let receivedSignal: AbortSignal | undefined;
        (fetchImpl as any).mockImplementation(async (_url: string, init: RequestInit) => {
            receivedSignal = init.signal as AbortSignal;
            return new Promise(() => {});
        });
        const controller = new AbortController();
        const { tool } = createListWorkspacesTool({ directory, workspaceId: 'caller', getDashboardDiscovery: () => ({
            listWorkspaces: async () => [{ serverIdentity: 'owner-id', workspaceId: 'same', workspaceLabel: 'Repo', serverLabel: 'Remote', serverKind: 'url', type: 'repo', online: true }],
        }) });
        const pending = tool.handler({ source: 'dashboard' }, { signal: controller.signal } as any);
        await vi.waitFor(() => expect(receivedSignal).toBeDefined());
        controller.abort();
        const result = await pending as any;
        expect(receivedSignal?.aborted).toBe(true);
        expect(result.workspaces[0].git).toEqual({ state: 'unavailable' });
    });
});

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
                { id: 'ws-a', name: 'alpha', rootPath: '/secret/alpha' },
                { id: 'my_work', name: 'My Work', virtual: true },
            ]),
        });

        const result = await runTool(directory);

        expect(result.workspaces).toEqual([
            { id: 'ws-a', name: 'alpha', type: 'repo', server: 'local', serverKind: 'local', online: true },
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
            { id: 'ws-a', name: 'alpha', type: 'repo', server: 'local', serverKind: 'local', online: true },
            { id: 'remote:srv-1:ws-r', name: 'beta', type: 'repo', server: 'dev-vm', serverKind: 'devtunnel', online: true },
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
            { id: 'remote:srv-1:w1', name: 'repo1', type: 'repo', server: 'box', serverKind: 'url', online: false },
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

import { describe, expect, it, vi } from 'vitest';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { readWorkspaceGitInfo, readWorkspaceQueue } from '../../../../src/server/spa/client/react/api/workspaceReads';

function makeClient(baseUrl = '') {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ queued: [], running: [] }), {
        headers: { 'content-type': 'application/json' },
    }));
    return { client: new CocClient({ baseUrl, fetch }), fetch };
}

describe.each([
    ['Git info', readWorkspaceGitInfo],
    ['queue', readWorkspaceQueue],
] as const)('shared workspace %s reads', (_name, read) => {
    it('shares concurrent requests but reads fresh after settlement', async () => {
        const { client, fetch } = makeClient();
        const first = read(client, 'ws-one');
        const second = read(client, 'ws-one');
        expect(second).toBe(first);
        expect(fetch).toHaveBeenCalledTimes(1);
        await expect(second).resolves.toEqual(await first);

        await read(client, 'ws-one');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    describe('refresh supersession', () => {
        it('an unresolved seed follows refreshes after earlier replacements have settled', async () => {
            const { client, fetch } = makeClient();
            let resolveSeed!: (response: Response) => void;
            fetch.mockImplementationOnce(() => new Promise(resolve => { resolveSeed = resolve; }));
            const seed = read(client, 'ws-one');
            const json = (isPaused: boolean) => new Response(JSON.stringify({
                queued: [], running: [], stats: { isPaused },
            }), { headers: { 'content-type': 'application/json' } });
            fetch.mockResolvedValueOnce(json(true));
            await read(client, 'ws-one', true);
            fetch.mockResolvedValueOnce(json(false));
            const newest = await read(client, 'ws-one', true);
            resolveSeed(json(true));
            expect(await seed).toEqual(newest);
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        it.each(['resolve', 'reject'] as const)('a post-mutation refresh supersedes a pending snapshot (%s)', async settle => {
            const { client, fetch } = makeClient();
            let resolveOld!: (response: Response) => void;
            let rejectOld!: (error: Error) => void;
            fetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
                resolveOld = resolve;
                rejectOld = reject;
            }));
            const seed = read(client, 'ws-one');
            const chat = read(client, 'ws-one');
            fetch.mockResolvedValueOnce(new Response(JSON.stringify({
                queued: [], running: [], stats: { isPaused: true },
            }), { headers: { 'content-type': 'application/json' } }));
            const refresh = read(client, 'ws-one', true);
            expect(refresh).not.toBe(seed);
            const fresh = await refresh;
            if (settle === 'resolve') resolveOld(new Response(JSON.stringify({
                queued: [], running: [], stats: { isPaused: false },
            }), { headers: { 'content-type': 'application/json' } }));
            else rejectOld(new Error('obsolete read failed'));
            expect(await seed).toEqual(fresh);
            expect(await chat).toEqual(fresh);
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    it('isolates workspaces and clients on different servers', async () => {
        const local = makeClient();
        const remote = makeClient('https://remote.example');
        await Promise.all([
            read(local.client, 'ws-one'),
            read(local.client, 'ws-two'),
            read(remote.client, 'ws-one'),
        ]);
        expect(local.fetch).toHaveBeenCalledTimes(2);
        expect(remote.fetch).toHaveBeenCalledTimes(1);
        expect(String(remote.fetch.mock.calls[0][0])).toContain('https://remote.example/');
    });

    it('shares failures without caching them or retaining a rejected request', async () => {
        const { client, fetch } = makeClient();
        const cause = new Error('offline');
        fetch.mockRejectedValueOnce(cause);
        const first = read(client, 'ws-one');
        const second = read(client, 'ws-one');
        expect(second).toBe(first);
        await expect(first).rejects.toMatchObject({ cause });
        await expect(second).rejects.toMatchObject({ cause });
        await read(client, 'ws-one');
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

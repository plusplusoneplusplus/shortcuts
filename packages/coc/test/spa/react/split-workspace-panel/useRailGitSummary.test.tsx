/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { useGroupRailGit, useRepoRailGit } from '../../../../src/server/spa/client/react/features/repo-detail/useRailGitSummary';

const info = { isGitRepo: true, branch: 'feature', dirty: true, ahead: 2, behind: 1, upstream: 'origin/feature', remoteUrl: null };
const members = [
    { workspaceId: 'ws-one', name: 'One', stale: false, readOnly: false },
    { workspaceId: 'ws-two', name: 'Two', stale: false, readOnly: false },
    { workspaceId: 'ws-removed', stale: true, readOnly: false },
];

function owner(baseUrl?: string) {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        const body = path.includes('/git-info/batch')
            ? { results: Object.fromEntries(JSON.parse(String(init?.body)).workspaceIds.map((id: string) => [id, info])) }
            : path.includes('/git-info') ? info : { changes: [], repoState: { operation: 'none', conflictFiles: [] } };
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    return { client: new CocClient({ baseUrl, fetch }), fetch };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe.each([undefined, 'https://owner.example'])('manual Git status on owner %s', baseUrl => {
    const routingRef = baseUrl ? 'remote:owner:ws-one' : 'ws-one';

    it('reads eligible status once without polling and stops all work on unmount', async () => {
        vi.useFakeTimers();
        const { client, fetch } = owner(baseUrl);
        const { result, unmount } = renderHook(() => useRepoRailGit({ client, routingRef, workspaceId: 'ws-one', enabled: true }));
        await act(async () => {});
        expect(result.current.input.info.data).toEqual(info);
        expect(fetch).toHaveBeenCalledTimes(2);
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
        expect(fetch).toHaveBeenCalledTimes(2);
        unmount();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, [], members.filter(member => member.stale)])('skips group reads without live members (%j)', async rows => {
        const { client, fetch } = owner(baseUrl);
        renderHook(() => useGroupRailGit({ client, routingRef, members: rows, enabled: true }));
        await act(async () => {});
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads fresh branch/sync and working tree even when passive reads are disabled', async () => {
        const { client, fetch } = owner(baseUrl);
        const { result } = renderHook(() => useRepoRailGit({ client, routingRef, workspaceId: 'ws-one', enabled: false }));
        expect(fetch).not.toHaveBeenCalled();
        await act(async () => { await result.current.refresh(true); });
        expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
            `${baseUrl ?? ''}/api/workspaces/ws-one/git-info?refresh=true`,
            `${baseUrl ?? ''}/api/workspaces/ws-one/git/changes?refresh=true`,
        ]);
        expect(result.current.input.info.data).toMatchObject(info);
        expect(result.current.input.tree.data?.paths).toBe(0);
        expect(result.current.input.info.failed).toBe(false);
    });

    it('refreshes live group members in one owner-routed fresh batch, never a group Git root', async () => {
        const { client, fetch } = owner(baseUrl);
        const groupRef = baseUrl ? 'remote:owner:group-scope' : 'group-scope';
        const { result } = renderHook(() => useGroupRailGit({ client, routingRef: groupRef, members, enabled: false }));
        await act(async () => { await result.current.refresh(true); });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0][0])).toBe(`${baseUrl ?? ''}/api/git-info/batch`);
        expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
            workspaceIds: ['ws-one', 'ws-two'], refresh: true, trigger: 'manual-refresh',
        });
        expect(result.current.input.members?.slice(0, 2).map(row => row.info)).toEqual([info, info]);
    });

    it.each(['git-info', '/git/changes'])('retains known status and settles the other read when %s fails', async failedPath => {
        const { client, fetch } = owner(baseUrl);
        const { result } = renderHook(() => useRepoRailGit({ client, routingRef, workspaceId: 'ws-one', enabled: false }));
        await act(async () => { await result.current.refresh(true); });
        const normal = fetch.getMockImplementation()!;
        fetch.mockImplementation(async (url, init) => String(url).includes(failedPath)
            ? new Response(JSON.stringify({ error: 'status unavailable' }), { status: 503 })
            : normal(url, init));
        await act(async () => { await expect(result.current.refresh(true)).rejects.toThrow('Git status'); });
        expect(result.current.input.info.data).toEqual(info);
        expect(result.current.input.tree.data?.paths).toBe(0);
        expect(result.current.input.info.failed).toBe(failedPath === 'git-info');
        expect(result.current.input.tree.failed).toBe(failedPath === '/git/changes');
        expect(result.current.input.info.loading || result.current.input.tree.loading).toBe(false);
    });

    it('publishes successful group status but rejects missing member results explicitly', async () => {
        const { client, fetch } = owner(baseUrl);
        fetch.mockResolvedValue(new Response(JSON.stringify({ results: { 'ws-one': info, 'ws-two': null } })));
        const { result } = renderHook(() => useGroupRailGit({ client, routingRef, members, enabled: false }));
        await act(async () => { await expect(result.current.refresh(true)).rejects.toThrow('1 group member'); });
        expect(result.current.input.members?.[0].info).toEqual(info);
        expect(result.current.input.members?.[1].info).toBeNull();
    });
});

it('rejects unresolved remote owners without local reads', async () => {
    const { client, fetch } = owner();
    const { result } = renderHook(() => useRepoRailGit({ client, routingRef: 'remote:missing:ws-one', workspaceId: 'ws-one', enabled: false }));
    await expect(result.current.refresh(true)).rejects.toThrow('owning server');
    expect(fetch).not.toHaveBeenCalled();
});

it('does not apply old Git status after the owner changes', async () => {
    const first = owner('https://first.example');
    const second = owner('https://second.example');
    let finish!: (response: Response) => void;
    first.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ client, routingRef }) =>
        useRepoRailGit({ client, routingRef, workspaceId: 'ws-one', enabled: false }), {
        initialProps: { client: first.client, routingRef: 'remote:first:ws-one' },
    });
    let old!: Promise<void>;
    act(() => { old = result.current.refresh(true); });
    rerender({ client: second.client, routingRef: 'remote:second:ws-one' });
    await act(async () => { await result.current.refresh(true); });
    await act(async () => {
        finish(new Response(JSON.stringify({ ...info, branch: 'stale' })));
        await old;
    });
    expect(result.current.input.info.data?.branch).toBe('feature');
});

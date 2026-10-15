import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { useWorkspaceQueueSeed } from '../../../src/server/spa/client/react/queue/hooks/useWorkspaceQueueSeed';
import { useRepoQueueJobs } from '../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats';
import { workspaceReadSource } from '../../../src/server/spa/client/react/api/workspaceReads';

function Wrapper({ children }: { children: ReactNode }) {
    return <QueueProvider>{children}</QueueProvider>;
}

const empty = { running: [], queued: [] };
const running = { running: [{ id: 'resumed-job', processId: 'queue_parent', type: 'chat' }], queued: [] };
const queued = { running: [], queued: running.running };
function response(value: unknown): Response {
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function owner(baseUrl = '') {
    const pending: Array<(value: Response) => void> = [];
    const fetch = vi.fn((_input: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => pending.push(resolve)));
    return { client: new CocClient({ baseUrl, fetch }), fetch, pending };
}

function mount(client: CocClient, workspaceId = 'same-id', routingRef?: string) {
    return renderHook((props: { client: CocClient; workspaceId: string; routingRef?: string }) => {
        useWorkspaceQueueSeed(props.workspaceId, props.client, props.routingRef);
        return { ...useQueue(), jobs: useRepoQueueJobs(props.workspaceId, props.client, props.routingRef) };
    }, { wrapper: Wrapper, initialProps: { client, workspaceId, routingRef } });
}

describe('workspace queue reconciliation', () => {
    it('rejects a delayed empty seed after a live queued-to-running snapshot, including same-batch settlement', async () => {
        const local = owner();
        const { result } = mount(local.client);
        await act(async () => {
            result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'same-id', queue: queued });
            result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'same-id', queue: running });
            local.pending[0](response(empty));
        });
        expect(result.current.jobs).toEqual(running);
        act(() => result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'same-id', queue: empty }));
        expect(result.current.jobs).toEqual(empty);
    });

    it('does not mistake stats-only hydration for a newer authoritative task snapshot', async () => {
        const local = owner();
        const { result } = mount(local.client);
        act(() => result.current.dispatch({ type: 'REPO_QUEUE_STATS_UPDATED', repoId: 'same-id', stats: { running: 1 } }));
        await act(async () => local.pending[0](response(running)));
        expect(result.current.jobs).toEqual(running);
    });

    it('does not reuse an abandoned pending read when the owner remounts after missed events', async () => {
        const local = owner();
        const first = mount(local.client);
        first.unmount();
        const second = mount(local.client);
        expect(local.fetch).toHaveBeenCalledTimes(2);
        await act(async () => local.pending[1](response(running)));
        await act(async () => local.pending[0](response(empty)));
        expect(second.result.current.jobs).toEqual(running);
    });

    it.each(['', 'https://owner.example'])('retains every reconnect refresh while reads are pending on %s', async baseUrl => {
        const current = owner(baseUrl);
        const { result } = mount(current.client);
        const reconnect = () => window.dispatchEvent(new CustomEvent(baseUrl ? 'coc-remote-ws-connect' : 'coc-local-ws-connect',
            { detail: baseUrl ? { baseUrl } : {} }));
        act(() => { reconnect(); reconnect(); });
        expect(current.fetch).toHaveBeenCalledTimes(3);
        await act(async () => current.pending[2](response(running)));
        expect(result.current.jobs).toEqual(running);
        await act(async () => {
            current.pending[1](response(queued));
            current.pending[0](response(empty));
        });
        expect(result.current.jobs).toEqual(running);
        expect(String(current.fetch.mock.calls[0][0])).toContain('repoId=same-id');
    });

    it('ignores foreign reconnects and late responses after an owner changes', async () => {
        const a = owner('https://a.example');
        const b = owner('https://b.example');
        const { result, rerender } = mount(a.client);
        await act(async () => {
            window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} }));
            window.dispatchEvent(new CustomEvent('coc-remote-ws-connect', { detail: { baseUrl: 'https://b.example' } }));
        });
        expect(a.fetch).toHaveBeenCalledTimes(1);
        rerender({ client: b.client, workspaceId: 'same-id' });
        await act(async () => b.pending[0](response(running)));
        await act(async () => a.pending[0](response(queued)));
        expect(result.current.jobs).toEqual(running);
        expect(String(b.fetch.mock.calls[0][0])).toContain('https://b.example/');
    });

    it('skips unresolved remote routes and disposes reconnect listeners and delayed results', async () => {
        const local = owner();
        const unresolved = mount(local.client, 'same-id', 'remote:unavailable:same-id');
        expect(local.fetch).not.toHaveBeenCalled();
        unresolved.unmount();
        const { result, unmount } = mount(local.client);
        unmount();
        await act(async () => {
            window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} }));
            local.pending[0](response(running));
        });
        expect(local.fetch).toHaveBeenCalledTimes(1);
        expect(result.current.jobs).toEqual(empty);
    });

    it('keeps the last successful jobs and surfaces a failed reconnect read', async () => {
        const local = owner();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { result } = mount(local.client);
            await act(async () => local.pending[0](response(running)));
            local.fetch.mockRejectedValueOnce(new Error('offline'));
            await act(async () => window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} })));
            await waitFor(() => expect(warning).toHaveBeenCalledWith('Could not refresh workspace queue', expect.any(Error)));
            expect(result.current.jobs).toEqual(running);
            local.fetch.mockResolvedValueOnce(response(queued));
            await act(async () => window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} })));
            expect(result.current.jobs).toEqual(queued);
        } finally {
            warning.mockRestore();
        }
    });
});

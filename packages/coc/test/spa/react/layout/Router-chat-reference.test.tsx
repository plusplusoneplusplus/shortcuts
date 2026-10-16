/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { resolveDashboardRoute, type RouteContext } from '../../../../src/server/spa/client/react/layout/dashboardRoutes';
import { publishDashboardTopology } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { repoHashBase } from '../../../../src/server/spa/client/react/layout/routePath';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), queue: vi.fn(), repos: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({ useApp: () => ({
    state: { activeTab: 'repos', selectedRepoId: 'same', repoRouteState: {}, repoTabState: {} }, dispatch: mocks.dispatch,
}) }));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({ useQueue: () => ({
    state: { repoQueueMap: {}, repoHistoryMap: {}, selectedTaskIdByRepo: {} }, dispatch: mocks.queue,
}) }));
vi.mock('../../../../src/server/spa/client/react/repos', () => ({ ReposView: () => {
    mocks.repos(); return <div data-testid="repos" />;
} }));
vi.mock('../../../../src/server/spa/client/react/wiki/WikiView', () => ({ WikiView: () => <div>Wiki</div> }));

const hash = '#chat-references/destination/same/chat';
const local = { id: 'same', name: 'Local collision' } as WorkspaceInfo;
const rows = (kind: 'ssh' | 'devtunnel' = 'ssh', port = 5000, offline = false, alias = 'alias', identity = 'destination') =>
    tagRemoteWorkspaces({ id: alias, label: 'Server', kind, serverIdentity: identity },
        `http://localhost:${port}`, [{ id: 'same', name: 'Repo' } as WorkspaceInfo], offline);
const publish = (remotes = rows()) => publishDashboardTopology('owner', [local, ...remotes], 'local-server');
const navigate = (value: string) => {
    window.history.replaceState(null, '', value);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
};
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function serve(handler: (url: URL, init?: RequestInit) => unknown | Promise<unknown> = url =>
    url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
        : { process: { id: 'chat', workspaceId: 'same', type: 'chat' } }) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        json(await handler(new URL(String(input), 'http://localhost:4000'), init)));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
const flush = async () => { await act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); }); };

beforeEach(() => {
    mocks.dispatch.mockClear(); mocks.queue.mockClear(); mocks.repos.mockClear();
    publishDashboardTopology(null, []);
    window.history.replaceState(null, '', hash);
});
afterEach(() => {
    cleanup(); publishDashboardTopology(null, []); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    window.history.replaceState(null, '', '#');
});

describe('durable reference route recognition', () => {
    const ctx = { queueState: {}, selectedRepoId: 'same', repoRouteState: {}, repoTabState: {},
        isSchedulesInSlide: () => false } as RouteContext;
    it('recognizes exact identity without dispatching any selection', () => {
        expect(resolveDashboardRoute(hash, ctx)).toEqual({ effects: [], chatReference: {
            serverIdentity: 'destination', workspaceId: 'same', processId: 'chat',
        } });
    });
    it.each(['#chat-references', '#chat-references/destination/same', '#chat-references/destination/%ZZ/chat',
        '#chat-references/destination/same/chat?server=other', '#chat-references/destination/same/chat/extra'])(
        'reserves malformed reference %s without normal workspace effects', value => {
            expect(resolveDashboardRoute(value, ctx)).toEqual({ effects: [], chatReference: null });
        });
});

describe('Router direct chat references', () => {
    it.each(['ssh', 'devtunnel'] as const)('opens an exact %s destination on reload, despite local and foreign collisions', async kind => {
        publish([...rows(kind), ...rows(kind, 8000, false, 'foreign', 'other-server')]);
        const fetcher = serve();
        const view = render(<Router />);
        expect(screen.getByRole('status').textContent).toContain('Checking');
        expect(mocks.repos).not.toHaveBeenCalled();
        expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
        await waitFor(() => expect(location.hash).toBe(`${repoHashBase(buildRemoteCloneKey('alias', 'same'))}/chats/chat`));
        expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: buildRemoteCloneKey('alias', 'same') });
        expect(mocks.queue).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: 'chat', repoId: buildRemoteCloneKey('alias', 'same') });
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '5000')).toBe(true);
        expect(fetcher.mock.calls.every(([, init]) => !init?.body && (!init?.method || init.method === 'GET'))).toBe(true);
        // A copied durable URL works in a fresh mount, independently of prior selection.
        view.unmount(); act(() => navigate(hash)); render(<Router />);
        await waitFor(() => expect(location.hash).toContain('/chats/chat'));
    });

    it('waits for initial topology and page-origin identity without mounting the selected local chat', async () => {
        const fetcher = serve(); render(<Router />);
        expect(fetcher).not.toHaveBeenCalled(); expect(mocks.repos).not.toHaveBeenCalled();
        act(() => publish());
        await waitFor(() => expect(location.hash).toContain('/chats/chat'));
    });

    it.each(['ssh', 'devtunnel'] as const)('retries an offline %s link at its new alias and port', async kind => {
        publish(rows(kind, 5000, true)); const fetcher = serve(); render(<Router />);
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(fetcher).not.toHaveBeenCalled(); expect(mocks.repos).not.toHaveBeenCalled();
        act(() => publish(rows(kind, 7000, false, 'new-alias')));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(location.hash).toBe(`${repoHashBase(buildRemoteCloneKey('new-alias', 'same'))}/chats/chat`));
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
    });

    it('waits for page-origin ownership observation and opens encoded exact IDs', async () => {
        const processId = 'chat/a?b#%2F';
        window.history.replaceState(null, '', '#chat-references/local-server/same/' + encodeURIComponent(processId));
        publishDashboardTopology('owner', [local]);
        const fetcher = serve(url => url.pathname.endsWith('/health') ? { serverIdentity: 'local-server' }
            : { process: { id: processId, workspaceId: 'same', type: 'chat' } });
        render(<Router />);
        expect(fetcher).not.toHaveBeenCalled(); expect(mocks.repos).not.toHaveBeenCalled();
        act(() => { publishDashboardTopology('owner', [local], 'local-server'); });
        await waitFor(() => expect(location.hash).toBe('#repos/same/chats/' + encodeURIComponent(processId)));
        expect(mocks.queue).toHaveBeenCalledWith({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: 'same' });
        expect(fetcher.mock.calls.every(([url]) => !String(url).includes(':5000'))).toBe(true);
    });

    it('keeps transport errors private and allows an explicit fresh retry', async () => {
        publish(); const fetcher = serve(() => { throw new Error('secret tunnel credentials'); });
        render(<Router />);
        await screen.findByRole('button', { name: 'Retry' });
        expect(document.body.textContent).not.toContain('secret');
        expect(location.hash).toBe(hash); expect(mocks.queue).not.toHaveBeenCalled();
        serve(); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(location.hash).toContain('/chats/chat'));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps an unavailable or replaced identity out of the local workspace until the bounded deadline', async () => {
        vi.useFakeTimers(); publish(rows('ssh', 5000, false, 'alias', 'replacement'));
        const fetcher = serve(); render(<Router />);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(location.hash).toBe(hash); expect(mocks.dispatch).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled(); expect(mocks.repos).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('renders malformed direct links unavailable without I/O or default chat rendering', () => {
        window.history.replaceState(null, '', '#chat-references/server/%ZZ/chat');
        const fetcher = serve(); render(<Router />);
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(fetcher).not.toHaveBeenCalled(); expect(mocks.repos).not.toHaveBeenCalled();
    });

    it('rejects a mismatched process instead of navigating to a same-id local chat', async () => {
        publish(); serve(url => url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
            : { process: { id: 'other', workspaceId: 'same', type: 'chat' } });
        render(<Router />);
        await screen.findByRole('button', { name: 'Retry' });
        expect(location.hash).toBe(hash); expect(mocks.dispatch).not.toHaveBeenCalled();
        expect(mocks.queue).not.toHaveBeenCalled();
    });

    it.each(['navigation', 'unmount', 'pagehide', 'timeout'] as const)('suppresses abort-ignoring responses after %s', async reason => {
        vi.useFakeTimers(); publish();
        let finish!: (value: unknown) => void;
        const fetcher = serve(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<Router />); await flush();
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (reason === 'navigation') act(() => navigate('#reports'));
        if (reason === 'unmount') view.unmount();
        if (reason === 'pagehide') act(() => { window.dispatchEvent(new Event('pagehide')); });
        if (reason === 'timeout') act(() => { vi.advanceTimersByTime(10_000); });
        expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
        finish({ serverIdentity: 'destination' }); await flush();
        expect(location.hash).toBe(reason === 'navigation' ? '#reports' : hash);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(mocks.queue).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });

    it('revokes the old endpoint during loading and verifies the current topology instead', async () => {
        publish(); let finish!: (value: unknown) => void;
        const fetcher = serve(url => url.port === '5000' ? new Promise(resolve => { finish = resolve; })
            : url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
                : { process: { id: 'chat', workspaceId: 'same', type: 'chat' } });
        render(<Router />); await flush();
        act(() => publish(rows('ssh', 7000, false, 'new-alias')));
        await waitFor(() => expect(location.hash).toContain(encodeURIComponent(buildRemoteCloneKey('new-alias', 'same'))));
        finish({ serverIdentity: 'destination' }); await flush();
        expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).port === '5000')).toHaveLength(1);
        expect(mocks.queue).toHaveBeenCalledTimes(1);
    });

    it('cancels an earlier durable link when a second one is opened', async () => {
        publish(); let finish!: (value: unknown) => void;
        let first = true;
        serve(url => {
            if (first) { first = false; return new Promise(resolve => { finish = resolve; }); }
            return url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
                : { process: { id: 'second', workspaceId: 'same', type: 'chat' } };
        });
        render(<Router />); await flush();
        act(() => navigate('#chat-references/destination/same/second'));
        await waitFor(() => expect(location.hash).toContain('/chats/second'));
        finish({ serverIdentity: 'destination' }); await flush();
        expect(location.hash).toContain('/chats/second');
        expect(mocks.queue).toHaveBeenCalledTimes(1);
    });
});

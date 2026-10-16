/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SentinelTodoConversationReference, SentinelTodoItem, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { SentinelTodoConversationReferences } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoConversationReferences';
import { publishDashboardTopology } from '../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';

const owner = { ownerWorkspaceId: 'owner', ownerRoutingRef: null, processId: 'sentinel' };
const ref: SentinelTodoConversationReference = { serverIdentity: 'destination', workspaceId: 'same', processId: 'chat',
    serverLabel: 'Laptop', workspaceLabel: 'Project', verification: 'unverified', title: 'Notes',
    openLink: '#chat-references/destination/same/chat', attachedAt: '2026-10-16T00:00:00Z', attachedBy: 'sentinel' };
const item = (references = [ref]) => ({ id: 'i1', title: 'Task', references } as SentinelTodoItem);
const follow = vi.fn();
function topology(kind: 'ssh' | 'devtunnel', offline = false, port = 7000, identity = 'destination') {
    publishDashboardTopology('owner', [{ id: 'same', name: 'Local collision' } as WorkspaceInfo,
        ...tagRemoteWorkspaces({ id: 'new-alias', label: 'Laptop', kind, serverIdentity: identity },
            `http://localhost:${port}`, [{ id: 'same', name: 'Project' } as WorkspaceInfo], offline)], 'local');
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function serve(handler?: (url: URL) => unknown | Promise<unknown>) {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost:4000');
        return json(await (handler ? handler(url) : url.pathname.endsWith('/health') ? { serverIdentity: 'destination' }
            : { process: { id: 'chat', workspaceId: 'same', type: 'chat' } }));
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
beforeEach(async () => {
    window.location.hash = '#repos/owner/chats/sentinel';
    await new Promise(resolve => setTimeout(resolve, 0));
    follow.mockReset();
});
afterEach(() => { cleanup(); publishDashboardTopology(null, []); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('To-do conversation reference navigation', () => {
    it.each(['ssh', 'devtunnel'] as const)('opens a cached %s reference only after reconnect verification at the new port', async kind => {
        topology(kind, true, 5000);
        const fetcher = serve();
        const value = item();
        render(<SentinelTodoConversationReferences item={value} owner={owner} onFollowLink={follow} />);
        expect(screen.getByText('Laptop · Project')).toBeTruthy();
        expect(screen.getByText('Unverified')).toBeTruthy();
        fireEvent.click(screen.getByRole('link', { name: 'Notes' }));
        await screen.findByRole('alert');
        expect(fetcher).not.toHaveBeenCalled();
        expect(follow).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('#repos/owner/chats/sentinel');
        topology(kind);
        fireEvent.click(screen.getByRole('link', { name: 'Notes' }));
        await waitFor(() => expect(follow).toHaveBeenCalledTimes(1));
        const href = '#repos/remote%3Anew-alias%3Asame/chats/chat';
        expect(follow.mock.calls[0][2]).toBe(href);
        expect(window.location.hash).toBe(href);
        expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).port === '7000')).toBe(true);
        expect(value.references).toEqual([ref]);
    });
    it('qualifies React and return-focus keys across server and workspace collisions', () => {
        render(<SentinelTodoConversationReferences item={item([ref, { ...ref, serverIdentity: 'other' }, { ...ref, workspaceId: 'other' }])} owner={owner} onFollowLink={follow} />);
        const links = screen.getAllByRole('link');
        expect(new Set(links.map(link => link.getAttribute('data-todo-link'))).size).toBe(3);
        expect(new Set(links.map(link => link.getAttribute('href'))).size).toBe(3);
    });
    it('keeps same-server references on their ledger owner remote server', () => {
        render(<SentinelTodoConversationReferences item={item([{ ...ref, serverIdentity: undefined }])}
            owner={{ ...owner, ownerRoutingRef: 'remote:laptop:owner' }} onFollowLink={follow} />);
        const link = screen.getByRole('link');
        expect(link.getAttribute('href')).toBe('#repos/remote%3Alaptop%3Asame/chats/chat');
        fireEvent.click(link);
        expect(follow).toHaveBeenCalledTimes(1);
    });
    it.each([
        [null, '#repos/same%2Fproject/chats/queue_ref%2Fchat'],
        ['remote:laptop:owner', '#repos/remote%3Alaptop%3Asame%252Fproject/chats/queue_ref%2Fchat'],
    ])('builds same-server links from exact stored IDs for owner %s', (ownerRoutingRef, href) => {
        render(<SentinelTodoConversationReferences item={item([{
            ...ref, serverIdentity: undefined, workspaceId: 'same/project', processId: 'queue_ref/chat',
            openLink: '#repos/wrong-owner/chats/wrong-chat',
        }])} owner={{ ...owner, ownerRoutingRef }} onFollowLink={follow} />);
        expect(screen.getByRole('link').getAttribute('href')).toBe(href);
    });
    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves durable browser links for modified clicks %j', init => {
        const fetcher = serve();
        render(<SentinelTodoConversationReferences item={item()} owner={owner} onFollowLink={follow} />);
        const link = screen.getByRole('link');
        fireEvent.click(link, init);
        expect(link.getAttribute('href')).toBe(ref.openLink);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('rejects a replaced installation without navigating or exposing transport details', async () => {
        topology('ssh');
        serve(() => ({ serverIdentity: 'replacement' }));
        render(<SentinelTodoConversationReferences item={item()} owner={owner} onFollowLink={follow} />);
        fireEvent.click(screen.getByRole('link'));
        expect((await screen.findByRole('alert')).textContent).toContain('Reconnect');
        expect(follow).not.toHaveBeenCalled();
    });
    it.each(['unmount', 'navigation', 'pagehide', 'owner-change', 'timeout', 'new-click'] as const)('suppresses late abort-ignoring reads after %s', async reason => {
        topology('devtunnel');
        let release!: (value: unknown) => void;
        const fetcher = serve(() => new Promise(resolve => { release = resolve; }));
        const view = render(<SentinelTodoConversationReferences item={item()} owner={owner} onFollowLink={follow} />);
        if (reason === 'timeout') vi.useFakeTimers();
        fireEvent.click(screen.getByRole('link'));
        const firstRelease = release;
        if (reason === 'unmount') view.unmount();
        if (reason === 'pagehide') fireEvent(window, new Event('pagehide'));
        if (reason === 'owner-change') view.rerender(<SentinelTodoConversationReferences item={item()} owner={{ ...owner, ownerRoutingRef: 'remote:other:owner' }} onFollowLink={follow} />);
        if (reason === 'navigation') { window.location.hash = '#repos/elsewhere'; fireEvent(window, new HashChangeEvent('hashchange')); }
        if (reason === 'timeout') act(() => vi.advanceTimersByTime(10_000));
        if (reason === 'new-click') fireEvent.click(screen.getByRole('link'));
        await act(async () => { firstRelease({ serverIdentity: 'destination' }); });
        expect(follow).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledTimes(reason === 'new-click' ? 2 : 1);
        if (reason === 'timeout') expect(screen.getByRole('alert').textContent).toContain('Reconnect');
    });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { TerminalView } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalPanel', () => ({
    TerminalPanel: ({ connectionMode, workspaceId, routingRef, focusRequest, isActive }: any) =>
        <div data-testid="session" data-mode={connectionMode} data-workspace={workspaceId}
            data-route={routingRef} data-focus={isActive ? focusRequest : 0} />,
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api', isContainerMode: () => false,
}));
function response(sessions: any[] = []) { return { ok: true, json: async () => ({ sessions }) }; }
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    resetCloneRegistryForTests();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetCloneRegistryForTests(); });

describe('explicit Terminal add-menu request', () => {
    it('creates through the canonical lifecycle and requests focus after hydration', async () => {
        render(<TerminalView workspaceId="member-a" openRequest={1} />);
        await waitFor(() => expect(screen.getByTestId('session').dataset.mode).toBe('create'));
        expect(screen.getByTestId('session').dataset.workspace).toBe('member-a');
        expect(screen.getByTestId('session').dataset.focus).toBe('1');
    });
    it('creates only once under StrictMode effect replay', async () => {
        render(<StrictMode><TerminalView workspaceId="member-a" openRequest={1} /></StrictMode>);
        await waitFor(() => expect(screen.getAllByTestId('session')).toHaveLength(1));
        expect(screen.getByTestId('session').dataset.focus).toBe('1');
    });
    it('starts a terminal in an already mounted empty tab', async () => {
        const view = render(<TerminalView workspaceId="member-a" />);
        await act(async () => {});
        expect(screen.queryByTestId('session')).toBeNull();
        view.rerender(<TerminalView workspaceId="member-a" openRequest={1} />);
        await screen.findByTestId('session');
    });
    it('waits for asynchronous hydration and preserves existing sessions', async () => {
        const pending = deferred<ReturnType<typeof response>>();
        fetchMock.mockReturnValue(pending.promise);
        render(<TerminalView workspaceId="member-a" openRequest={1} />);
        expect(screen.queryByTestId('session')).toBeNull();
        await act(async () => pending.resolve(response([{ id: 'existing', status: 'running' }])));
        expect(screen.getByTestId('session').dataset.mode).toBe('attach');
        expect(screen.getByTestId('session').dataset.focus).toBe('1');
    });
    it('coalesces rapid requests and retains an in-flight WebSocket create', async () => {
        const pending = deferred<ReturnType<typeof response>>();
        fetchMock.mockReturnValue(pending.promise);
        const view = render(<TerminalView workspaceId="member-a" openRequest={1} />);
        view.rerender(<TerminalView workspaceId="member-a" openRequest={2} />);
        await act(async () => pending.resolve(response()));
        expect(screen.getAllByTestId('session')).toHaveLength(1);
        fetchMock.mockResolvedValue(response());
        view.rerender(<TerminalView workspaceId="member-a" openRequest={3} />);
        await waitFor(() => expect(screen.getByTestId('session').dataset.focus).toBe('2'));
        expect(screen.getAllByTestId('session')).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('ignores stale hydration after switching workspace', async () => {
        const old = deferred<ReturnType<typeof response>>();
        fetchMock.mockReturnValueOnce(old.promise);
        const view = render(<TerminalView workspaceId="member-a" openRequest={1} />);
        view.rerender(<TerminalView workspaceId="member-b" openRequest={2} />);
        await screen.findByTestId('session');
        await act(async () => old.resolve(response([{ id: 'old-session', status: 'running' }])));
        expect(screen.getAllByTestId('session')).toHaveLength(1);
        expect(screen.getByTestId('session').dataset.workspace).toBe('member-b');
    });
    it('keeps terminal sessions independent across workspaces', async () => {
        render(<><TerminalView workspaceId="member-a" openRequest={1} />
            <TerminalView workspaceId="member-b" openRequest={1} /></>);
        await waitFor(() => expect(screen.getAllByTestId('session')).toHaveLength(2));
        expect(screen.getAllByTestId('session').map(node => node.dataset.workspace)).toEqual(['member-a', 'member-b']);
    });
    it('never creates on passive mounting or restoration', async () => {
        const view = render(<TerminalView workspaceId="member-a" />);
        await act(async () => {});
        view.unmount();
        render(<TerminalView workspaceId="member-a" />);
        await act(async () => {});
        expect(screen.queryByTestId('session')).toBeNull();
    });
    it('surfaces hydration errors without creating and retries on a new request', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        const view = render(<TerminalView workspaceId="member-a" openRequest={1} />);
        await screen.findByText('Failed to load terminal sessions.');
        expect(screen.queryByTestId('session')).toBeNull();
        view.rerender(<TerminalView workspaceId="member-a" openRequest={2} />);
        await screen.findByTestId('session');
        expect(screen.queryByText('Failed to load terminal sessions.')).toBeNull();
    });
    it('routes group-member hydration and PTY creation to its concrete remote owner', async () => {
        registerCloneBaseUrls([{ workspaceId: 'member-a', cloneKey: 'remote:owner:member-a', baseUrl: 'https://owner.example' }]);
        render(<TerminalView workspaceId="member-a" routingRef="remote:owner:member-a" openRequest={1} />);
        await screen.findByTestId('session');
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://owner.example/api/workspaces/member-a/terminals');
        expect(screen.getByTestId('session').dataset.route).toBe('remote:owner:member-a');
    });
});

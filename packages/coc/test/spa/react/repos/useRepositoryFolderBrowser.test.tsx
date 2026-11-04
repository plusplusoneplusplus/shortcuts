/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPathLeaf, joinBrowserPath, useRepositoryFolderBrowser } from '../../../../src/server/spa/client/react/repos/useRepositoryFolderBrowser';
import { useRepositoryDialogSession } from '../../../../src/server/spa/client/react/repos/useRepositoryDialogSession';
import type { ServerSelection } from '../../../../src/server/spa/client/react/repos/useServerSelection';

const mocks = vi.hoisted(() => ({ browse: vi.fn(), setAgent: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    browseWorkspaceFolders: mocks.browse,
    getRepositoryApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getCurrentAgentId: () => 'previous-agent',
    setCurrentAgentId: mocks.setAgent,
}));

const local = { id: 'local', label: 'Local' };
const remote = { id: 'box', label: 'Remote box', baseUrl: 'https://remote.test' };
function server(selected = local): ServerSelection {
    return {
        choices: [local, remote], selected, serverId: selected.id,
        resolveServer: id => [local, remote].find(s => s.id === id)!,
        selectServer: vi.fn(),
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.browse.mockResolvedValue({ path: '/root', entries: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('repository folder browser', () => {
    it('keeps the newest directory when reads resolve out of order', async () => {
        const old = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(old.promise);
        const onSelect = vi.fn();
        const { result } = renderHook(() => useRepositoryFolderBrowser({ open: true, server: server(), onSelect }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('/old'); });
        await act(async () => { await result.current.navigateTo('/root'); });
        await act(async () => { old.resolve({ path: '/old' }); await pending; });
        expect(result.current.browserPath).toBe('/root');
        expect(result.current.browserLoading).toBe(false);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it.each(['resolve', 'reject'] as const)('ignores a previous owner browse %s without masking the current owner', async outcome => {
        const old = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(old.promise);
        const onSelect = vi.fn();
        const { result, rerender } = renderHook(({ selected }) => useRepositoryFolderBrowser({ open: true, server: server(selected), onSelect }), {
            initialProps: { selected: local },
        });
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('~'); });
        rerender({ selected: remote });
        await act(async () => { await result.current.navigateTo('~'); });
        await act(async () => {
            if (outcome === 'resolve') old.resolve({ path: '/wrong-owner' });
            else old.reject(new Error('old owner unavailable'));
            await pending;
        });
        expect(mocks.browse).toHaveBeenLastCalledWith('~', remote.baseUrl);
        expect(result.current.browserPath).toBe('/root');
        expect(result.current.browserError).toBeNull();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('invalidates pending reads across close and reopen on the same server', async () => {
        const old = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(old.promise);
        const onSelect = vi.fn();
        const { result, rerender } = renderHook(({ open }) => useRepositoryFolderBrowser({ open, server: server(), onSelect }), {
            initialProps: { open: true },
        });
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('~'); });
        rerender({ open: false });
        rerender({ open: true });
        await act(async () => { old.resolve({ path: '/old' }); await pending; });
        expect(result.current.browserPath).toBe('');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'] as const)('does not revive an old read after an owner round trip (%s)', async outcome => {
        const old = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(old.promise);
        const onSelect = vi.fn();
        const { result, rerender } = renderHook(({ selected }) => useRepositoryFolderBrowser({ open: true, server: server(selected), onSelect }), {
            initialProps: { selected: local },
        });
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('~'); });
        rerender({ selected: remote });
        rerender({ selected: local });
        await act(async () => {
            if (outcome === 'resolve') old.resolve({ path: '/revived-owner' });
            else old.reject(new Error('stale failure'));
            await pending;
        });
        expect(mocks.browse).toHaveBeenCalledTimes(1);
        expect(result.current.browserPath).toBe('');
        expect(result.current.browserError).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('allows the explicitly targeted read started before the server selection commits', async () => {
        const next = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(next.promise);
        const { result, rerender } = renderHook(({ selected }) => useRepositoryFolderBrowser({ open: true, server: server(selected) }), {
            initialProps: { selected: local },
        });
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('~', remote.id); });
        rerender({ selected: remote });
        await act(async () => { next.resolve({ path: '/remote/current' }); await pending; });
        expect(result.current.browserPath).toBe('/remote/current');
    });

    it.each(['resolve', 'reject'] as const)('restarts the requested directory for a new container agent and ignores the old %s', async outcome => {
        const old = deferred<{ path: string }>();
        mocks.browse.mockReturnValueOnce(old.promise);
        const onSelect = vi.fn();
        const { result, rerender } = renderHook(({ agentId }) => useRepositoryFolderBrowser({
            open: true, server: server(), agent: { id: agentId }, onSelect,
        }), { initialProps: { agentId: 'agent-a' } });
        let pending!: Promise<void>;
        act(() => { pending = result.current.navigateTo('/requested'); });
        rerender({ agentId: 'agent-b' });
        await act(async () => {});
        expect(mocks.browse).toHaveBeenNthCalledWith(2, '/requested', undefined);
        expect(mocks.setAgent).toHaveBeenCalledWith('agent-b');
        expect(result.current.browserPath).toBe('/root');
        expect(result.current.browserLoading).toBe(false);
        await act(async () => {
            if (outcome === 'resolve') old.resolve({ path: '/old-agent' });
            else old.reject(new Error('old agent failed'));
            await pending;
        });
        expect(result.current.browserPath).toBe('/root');
        expect(result.current.browserError).toBeNull();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('retains the directory on error, clears stale entries and names the exact server', async () => {
        const { result } = renderHook(() => useRepositoryFolderBrowser({ open: true, server: server(remote) }));
        await act(async () => { await result.current.navigateTo('~'); });
        mocks.browse.mockRejectedValueOnce(new Error('Permission denied'));
        await act(async () => { await result.current.navigateTo('/denied'); });
        expect(result.current.browserPath).toBe('/root');
        expect(result.current.browserEntries).toEqual([]);
        expect(result.current.browserError).toBe('Permission denied on Remote box');
        expect(result.current.browserLoading).toBe(false);
    });

    it('restores a container agent and ignores auth messages after leaving its owner', async () => {
        mocks.browse.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }));
        const popup = { closed: false } as Window;
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const onSelect = vi.fn();
        const agent = { id: 'agent', address: 'https://agent.test' };
        const { result, rerender, unmount } = renderHook(({ selected }) => useRepositoryFolderBrowser({ open: true, server: server(selected), agent, onSelect }), {
            initialProps: { selected: local },
        });
        await act(async () => { await result.current.navigateTo('~'); });
        expect(mocks.setAgent.mock.calls).toEqual([['agent'], ['previous-agent']]);
        expect(result.current.browserError).toContain('Authenticating');
        rerender({ selected: remote });
        act(() => window.dispatchEvent(new MessageEvent('message', {
            origin: agent.address, source: popup, data: { type: 'browse-result', data: { path: '/agent-only' } },
        })));
        expect(onSelect).not.toHaveBeenCalled();
        unmount();
    });

    it.each([
        null,
        { type: 'browse-result', data: { path: 123 } },
        { type: 'browse-result', data: { path: '/root', entries: [{ name: 12 }] } },
        { type: 'browse-result', data: { path: '/root', browseRoots: [{ label: 'Home', path: false }] } },
        { type: 'browse-error', error: { message: 'not a string' } },
    ])('surfaces invalid auth popup data without applying it: %j', async payload => {
        mocks.browse.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }));
        const popup = { closed: false } as Window;
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const onSelect = vi.fn();
        const agent = { id: 'agent', address: 'https://agent.test' };
        const { result } = renderHook(() => useRepositoryFolderBrowser({ open: true, server: server(), agent, onSelect }));
        await act(async () => { await result.current.navigateTo('~'); });
        act(() => window.dispatchEvent(new MessageEvent('message', { origin: agent.address, source: popup, data: payload })));
        expect(result.current.browserError).toBe('Browse failed: Invalid browser response');
        expect(result.current.browserLoading).toBe(false);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('validates popup ownership and accepts a well-formed authenticated result once', async () => {
        mocks.browse.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { status: 401 }));
        const popup = { closed: false } as Window;
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const onSelect = vi.fn();
        const agent = { id: 'agent', address: 'https://agent.test' };
        const { result } = renderHook(() => useRepositoryFolderBrowser({ open: true, server: server(), agent, onSelect }));
        await act(async () => { await result.current.navigateTo('~'); });
        const data = { type: 'browse-result', data: { path: '/authenticated', parent: null, entries: [{ name: 'repo', isGitRepo: true }] } };
        act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://other.test', source: popup, data })));
        expect(onSelect).not.toHaveBeenCalled();
        act(() => window.dispatchEvent(new MessageEvent('message', { origin: agent.address, source: popup, data })));
        act(() => window.dispatchEvent(new MessageEvent('message', { origin: agent.address, source: popup, data })));
        expect(result.current.browserPath).toBe('/authenticated');
        expect(result.current.browserError).toBeNull();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

describe('repository dialog session', () => {
    it('invalidates operations on owner changes, explicit cancellation, and unmount', () => {
        const { result, rerender, unmount } = renderHook(({ selected }) => useRepositoryDialogSession(true, server(selected)), {
            initialProps: { selected: local },
        });
        const localOperation = result.current.capture();
        rerender({ selected: remote });
        expect(localOperation()).toBe(false);
        const remoteOperation = result.current.capture();
        result.current.invalidate();
        expect(remoteOperation()).toBe(false);
        const lastOperation = result.current.capture();
        unmount();
        expect(lastOperation()).toBe(false);
    });
});

describe('browser path conventions', () => {
    it.each([
        ['/projects', 'repo', '/projects/repo'],
        ['C:\\projects', 'repo', 'C:\\projects\\repo'],
        ['C:\\', 'repo', 'C:\\repo'],
        ['', 'repo', 'repo'],
    ])('joins %s and %s without changing separator semantics', (base, child, expected) => {
        expect(joinBrowserPath(base, child)).toBe(expected);
        expect(getPathLeaf(expected)).toBe(child);
    });
});

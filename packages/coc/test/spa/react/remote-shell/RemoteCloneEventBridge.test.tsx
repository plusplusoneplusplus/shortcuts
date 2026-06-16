/* @vitest-environment jsdom */
/**
 * Tests for useRemoteCloneEvents — the global-event socket fan-out to online
 * remote clones that keeps remote task rows transitioning RUNNING → COMPLETED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockUseRepos, connectSpy, sockets } = vi.hoisted(() => ({
    mockUseRepos: vi.fn(),
    connectSpy: vi.fn(),
    sockets: new Map<string, { close: ReturnType<typeof vi.fn>; opts: any }>(),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => mockUseRepos(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: vi.fn(() => ({})),
    getCocClientFor: (baseUrl: string) => ({
        events: {
            connect: (opts: any) => {
                connectSpy(baseUrl, opts);
                const close = vi.fn();
                sockets.set(baseUrl, { close, opts });
                return { close };
            },
        },
    }),
}));

import { useRemoteCloneEvents } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteCloneEventBridge';

function remoteRepo(id: string, baseUrl: string, connection: string) {
    return {
        workspace: {
            id,
            baseUrl,
            remote: {
                baseUrl,
                serverId: `srv-${baseUrl}`,
                serverLabel: 'Server',
                offline: connection !== 'online',
                connection,
                queue: 'idle',
            },
        },
    } as any;
}

function localRepo(id: string) {
    return { workspace: { id } } as any;
}

describe('useRemoteCloneEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sockets.clear();
        mockUseRepos.mockReturnValue({ repos: [] });
    });

    it('opens one socket per online remote clone (local repos ignored)', () => {
        mockUseRepos.mockReturnValue({
            repos: [
                remoteRepo('w1', 'http://127.0.0.1:4000', 'online'),
                remoteRepo('w2', 'http://127.0.0.1:5000', 'online'),
                localRepo('local'),
            ],
        });
        renderHook(() => useRemoteCloneEvents(vi.fn()));
        expect(connectSpy).toHaveBeenCalledTimes(2);
        expect(connectSpy.mock.calls.map(c => c[0]).sort()).toEqual([
            'http://127.0.0.1:4000',
            'http://127.0.0.1:5000',
        ]);
    });

    it('dedupes multiple workspaces on the same server to a single socket', () => {
        mockUseRepos.mockReturnValue({
            repos: [
                remoteRepo('w1', 'http://127.0.0.1:4000', 'online'),
                remoteRepo('w2', 'http://127.0.0.1:4000', 'online'),
            ],
        });
        renderHook(() => useRemoteCloneEvents(vi.fn()));
        expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('skips clones that are not online (offline / connecting)', () => {
        mockUseRepos.mockReturnValue({
            repos: [
                remoteRepo('w1', 'http://127.0.0.1:4000', 'offline'),
                remoteRepo('w2', 'http://127.0.0.1:5000', 'connecting'),
            ],
        });
        renderHook(() => useRemoteCloneEvents(vi.fn()));
        expect(connectSpy).not.toHaveBeenCalled();
    });

    it('routes socket messages into the shared onMessage handler', () => {
        const onMessage = vi.fn();
        mockUseRepos.mockReturnValue({ repos: [remoteRepo('w1', 'http://127.0.0.1:4000', 'online')] });
        renderHook(() => useRemoteCloneEvents(onMessage));

        const msg = { type: 'process-updated', process: { id: 'p1', status: 'completed' } };
        sockets.get('http://127.0.0.1:4000')!.opts.onMessage(msg);
        expect(onMessage).toHaveBeenCalledWith(msg);
    });

    it('closes the socket when a clone goes offline', () => {
        mockUseRepos.mockReturnValue({ repos: [remoteRepo('w1', 'http://127.0.0.1:4000', 'online')] });
        const { rerender } = renderHook(() => useRemoteCloneEvents(vi.fn()));
        const close = sockets.get('http://127.0.0.1:4000')!.close;
        expect(close).not.toHaveBeenCalled();

        mockUseRepos.mockReturnValue({ repos: [remoteRepo('w1', 'http://127.0.0.1:4000', 'offline')] });
        rerender();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('opens a socket for a newly-online clone without tearing down stable ones', () => {
        mockUseRepos.mockReturnValue({ repos: [remoteRepo('w1', 'http://127.0.0.1:4000', 'online')] });
        const { rerender } = renderHook(() => useRemoteCloneEvents(vi.fn()));
        expect(connectSpy).toHaveBeenCalledTimes(1);
        const stableClose = sockets.get('http://127.0.0.1:4000')!.close;

        mockUseRepos.mockReturnValue({
            repos: [
                remoteRepo('w1', 'http://127.0.0.1:4000', 'online'),
                remoteRepo('w2', 'http://127.0.0.1:5000', 'online'),
            ],
        });
        rerender();
        expect(connectSpy).toHaveBeenCalledTimes(2); // only the new server
        expect(stableClose).not.toHaveBeenCalled(); // existing socket preserved
    });

    it('closes every socket on unmount', () => {
        mockUseRepos.mockReturnValue({
            repos: [
                remoteRepo('w1', 'http://127.0.0.1:4000', 'online'),
                remoteRepo('w2', 'http://127.0.0.1:5000', 'online'),
            ],
        });
        const { unmount } = renderHook(() => useRemoteCloneEvents(vi.fn()));
        unmount();
        expect(sockets.get('http://127.0.0.1:4000')!.close).toHaveBeenCalledTimes(1);
        expect(sockets.get('http://127.0.0.1:5000')!.close).toHaveBeenCalledTimes(1);
    });

    it('no-ops when there are no remote clones', () => {
        mockUseRepos.mockReturnValue({ repos: [localRepo('a'), localRepo('b')] });
        renderHook(() => useRemoteCloneEvents(vi.fn()));
        expect(connectSpy).not.toHaveBeenCalled();
    });
});

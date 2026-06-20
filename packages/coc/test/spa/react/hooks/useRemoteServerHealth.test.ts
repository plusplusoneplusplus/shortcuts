import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
    useRemoteServerHealth,
    type ServerHealthState,
} from '../../../../src/server/spa/client/react/hooks/useRemoteServerHealth';
import type { RemoteServer } from '../../../../src/server/spa/client/react/utils/serverRegistry';

const SERVER_A: RemoteServer = {
    id: 'a',
    kind: 'url',
    label: 'Box A',
    url: 'https://a.example.com',
    addedAt: 100,
    updatedAt: 100,
};

const SERVER_B: RemoteServer = {
    id: 'b',
    kind: 'devtunnel',
    label: 'Box B',
    tunnelId: 'box-b',
    addedAt: 200,
    updatedAt: 200,
};

const EMPTY_SERVERS: RemoteServer[] = [];
const ONE_SERVER: RemoteServer[] = [SERVER_A];
const TWO_SERVERS: RemoteServer[] = [SERVER_A, SERVER_B];

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

describe('useRemoteServerHealth', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns an empty array when given no servers', () => {
        const { result, unmount } = renderHook(() => useRemoteServerHealth(EMPTY_SERVERS));
        try {
            expect(result.current.healthStates).toEqual([]);
        } finally {
            unmount();
        }
    });

    it('starts with status="checking" before any fetch resolves', () => {
        let resolveFetch: (value: Response) => void = () => {};
        fetchMock.mockReturnValue(new Promise<Response>(r => { resolveFetch = r; }));
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            expect(result.current.healthStates).toHaveLength(1);
            expect(result.current.healthStates[0].status).toBe('checking');
            expect(result.current.healthStates[0].server).toEqual(SERVER_A);
        } finally {
            unmount();
            resolveFetch(jsonResponse({}, 500));
        }
    });

    it('polls backend health and populates returned metadata', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            serverId: 'a',
            kind: 'url',
            status: 'online',
            effectiveUrl: 'https://a.example.com',
            uptime: 1234,
            processCount: 7,
            version: '1.2.3',
            commit: 'abc1234',
            serverName: 'box-a',
            lastChecked: 10,
        }));

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current.healthStates[0].status).toBe('online'));
            const state = result.current.healthStates[0];
            expect(fetchMock).toHaveBeenCalledWith('/api/servers/a/health', expect.any(Object));
            expect(state.uptime).toBe(1234);
            expect(state.processCount).toBe(7);
            expect(state.version).toBe('1.2.3');
            expect(state.commit).toBe('abc1234');
            expect(state.serverName).toBe('box-a');
            expect(state.effectiveUrl).toBe('https://a.example.com');
            expect(state.lastChecked).toBe(10);
        } finally {
            unmount();
        }
    });

    it('marks a server offline when fetch throws', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current.healthStates[0].status).toBe('offline'));
            expect(result.current.healthStates[0].error).toBe('CoC API request failed before receiving a response');
            expect(result.current.healthStates[0].lastChecked).toBeTypeOf('number');
        } finally {
            unmount();
        }
    });

    it('marks a server offline when backend health returns a non-200 status', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'bad' }, 503));
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current.healthStates[0].status).toBe('offline'));
            expect(result.current.healthStates[0].error).toBe('bad');
        } finally {
            unmount();
        }
    });

    it('polls every server independently and returns one entry per server', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url === '/api/servers/a/health') {
                return Promise.resolve(jsonResponse({
                    serverId: 'a',
                    kind: 'url',
                    status: 'online',
                    version: 'v-a',
                    uptime: 10,
                    lastChecked: 1,
                }));
            }
            return Promise.resolve(jsonResponse({
                serverId: 'b',
                kind: 'devtunnel',
                status: 'offline',
                tunnelId: 'box-b',
                localPort: 4000,
                error: 'B is down',
                lastChecked: 2,
            }));
        });

        const { result, unmount } = renderHook(() => useRemoteServerHealth(TWO_SERVERS));
        try {
            await waitFor(() => {
                expect(result.current.healthStates).toHaveLength(2);
                const a = result.current.healthStates.find(s => s.server.id === 'a');
                const b = result.current.healthStates.find(s => s.server.id === 'b');
                expect(a?.status).toBe('online');
                expect(b?.status).toBe('offline');
            });
            expect(result.current.healthStates.find(s => s.server.id === 'a')?.version).toBe('v-a');
            expect(result.current.healthStates.find(s => s.server.id === 'b')?.error).toBe('B is down');
            expect(result.current.healthStates.find(s => s.server.id === 'b')?.localPort).toBe(4000);
        } finally {
            unmount();
        }
    });

    it('clears the polling interval on unmount', () => {
        let resolveFetch: (value: Response) => void = () => {};
        fetchMock.mockReturnValue(new Promise<Response>(r => { resolveFetch = r; }));
        const clearSpy = vi.spyOn(global, 'clearInterval');
        const { unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        unmount();
        expect(clearSpy).toHaveBeenCalled();
        resolveFetch(jsonResponse({}, 500));
    });

    it('refetch() triggers an immediate re-poll without waiting for the interval', async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue(jsonResponse({
            serverId: 'a',
            kind: 'url',
            status: 'online',
            lastChecked: 1,
        }));

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(result.current.healthStates[0].status).toBe('online');
            const callsAfterFirstPoll = fetchMock.mock.calls.length;

            // No interval advance — refetch alone should fire another poll.
            await act(async () => {
                result.current.refetch();
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstPoll);
        } finally {
            unmount();
            vi.useRealTimers();
        }
    });

    it('refetch() is a no-op when there are no servers', () => {
        const { result, unmount } = renderHook(() => useRemoteServerHealth(EMPTY_SERVERS));
        try {
            expect(() => result.current.refetch()).not.toThrow();
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            unmount();
        }
    });

    it('re-polls after the 30s interval', async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue(jsonResponse({
            serverId: 'a',
            kind: 'url',
            status: 'online',
            lastChecked: 1,
        }));

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(result.current.healthStates[0].status).toBe('online');
            const callsAfterFirstPoll = fetchMock.mock.calls.length;

            await act(async () => {
                await vi.advanceTimersByTimeAsync(30_000);
            });
            expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstPoll);
        } finally {
            unmount();
            vi.useRealTimers();
        }
    });
});

const _typeCheck: ServerHealthState | undefined = undefined;
void _typeCheck;

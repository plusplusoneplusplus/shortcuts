import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
    useRemoteServerHealth,
    type ServerHealthState,
} from '../../../../src/server/spa/client/react/hooks/useRemoteServerHealth';
import type { RemoteServer } from '../../../../src/server/spa/client/react/utils/serverRegistry';

const SERVER_A: RemoteServer = {
    id: 'a',
    label: 'Box A',
    url: 'https://a.example.com',
    addedAt: 100,
};

const SERVER_B: RemoteServer = {
    id: 'b',
    label: 'Box B',
    url: 'https://b.example.com',
    addedAt: 200,
};

// Stable references — the hook's contract requires callers to memoize the
// array so the polling effect does not re-run on every render. New array
// literals would trigger an infinite re-render loop.
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
            expect(result.current).toEqual([]);
        } finally {
            unmount();
        }
    });

    it('starts with status="checking" before any fetch resolves', () => {
        let resolveFetch: (value: Response) => void = () => {};
        fetchMock.mockReturnValue(new Promise<Response>(r => { resolveFetch = r; }));
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            expect(result.current).toHaveLength(1);
            expect(result.current[0].status).toBe('checking');
            expect(result.current[0].server).toEqual(SERVER_A);
        } finally {
            unmount();
            resolveFetch(jsonResponse({}, 500));
        }
    });

    it('marks a server online and populates uptime/version after a successful poll', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.endsWith('/api/health')) {
                return Promise.resolve(jsonResponse({ status: 'ok', uptime: 1234, processCount: 7 }));
            }
            if (url.endsWith('/api/admin/version')) {
                return Promise.resolve(jsonResponse({ version: '1.2.3', commit: 'abc1234' }));
            }
            if (url.endsWith('/api/admin/config')) {
                return Promise.resolve(jsonResponse({ hostname: 'box-a' }));
            }
            return Promise.reject(new Error(`unexpected url: ${url}`));
        });

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current[0].status).toBe('online'));
            const state = result.current[0];
            expect(state.uptime).toBe(1234);
            expect(state.processCount).toBe(7);
            expect(state.version).toBe('1.2.3');
            expect(state.commit).toBe('abc1234');
            expect(state.serverName).toBe('box-a');
            expect(state.lastChecked).toBeTypeOf('number');
            expect(state.error).toBeUndefined();
        } finally {
            unmount();
        }
    });

    it('marks a server offline when fetch throws', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current[0].status).toBe('offline'));
            expect(result.current[0].error).toBe('network down');
            expect(result.current[0].lastChecked).toBeTypeOf('number');
        } finally {
            unmount();
        }
    });

    it('marks a server offline when /api/health returns a non-200 status', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.endsWith('/api/health')) {
                return Promise.resolve(jsonResponse({}, 503));
            }
            if (url.endsWith('/api/admin/version')) {
                return Promise.resolve(jsonResponse({ version: 'x', commit: 'y' }));
            }
            return Promise.resolve(jsonResponse({}, 404));
        });
        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current[0].status).toBe('offline'));
            expect(result.current[0].error).toBe('HTTP 503');
        } finally {
            unmount();
        }
    });

    it('leaves serverName undefined when /api/admin/config fails but health/version succeed', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.endsWith('/api/health')) {
                return Promise.resolve(jsonResponse({ uptime: 1, processCount: 0 }));
            }
            if (url.endsWith('/api/admin/version')) {
                return Promise.resolve(jsonResponse({ version: '1', commit: '2' }));
            }
            if (url.endsWith('/api/admin/config')) {
                return Promise.reject(new Error('forbidden'));
            }
            return Promise.reject(new Error(`unexpected ${url}`));
        });

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            await waitFor(() => expect(result.current[0].status).toBe('online'));
            expect(result.current[0].serverName).toBeUndefined();
        } finally {
            unmount();
        }
    });

    it('polls every server independently and returns one entry per server', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.startsWith(SERVER_A.url)) {
                if (url.endsWith('/api/health')) {
                    return Promise.resolve(jsonResponse({ uptime: 10, processCount: 1 }));
                }
                if (url.endsWith('/api/admin/version')) {
                    return Promise.resolve(jsonResponse({ version: 'v-a', commit: 'c-a' }));
                }
                return Promise.resolve(jsonResponse({}));
            }
            return Promise.reject(new Error('B is down'));
        });

        const { result, unmount } = renderHook(() => useRemoteServerHealth(TWO_SERVERS));
        try {
            await waitFor(() => {
                expect(result.current).toHaveLength(2);
                const a = result.current.find(s => s.server.id === 'a');
                const b = result.current.find(s => s.server.id === 'b');
                expect(a?.status).toBe('online');
                expect(b?.status).toBe('offline');
            });
            const a = result.current.find(s => s.server.id === 'a')!;
            expect(a.version).toBe('v-a');
            expect(a.uptime).toBe(10);
            const b = result.current.find(s => s.server.id === 'b')!;
            expect(b.error).toBe('B is down');
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

    it('re-polls after the 30s interval', async () => {
        // Use fake timers from the start so setInterval is registered against
        // them; otherwise switching to fake timers mid-test cannot fire the
        // already-registered real-timer interval.
        vi.useFakeTimers();
        let healthCalls = 0;
        fetchMock.mockImplementation((url: string) => {
            if (url.endsWith('/api/health')) {
                healthCalls++;
                return Promise.resolve(jsonResponse({ uptime: healthCalls, processCount: 0 }));
            }
            if (url.endsWith('/api/admin/version')) {
                return Promise.resolve(jsonResponse({ version: '1', commit: '2' }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        const { result, unmount } = renderHook(() => useRemoteServerHealth(ONE_SERVER));
        try {
            // Flush the initial poll's microtasks.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(result.current[0].status).toBe('online');
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

// Type-only sanity check: the public type is exported.
const _typeCheck: ServerHealthState | undefined = undefined;
void _typeCheck;

/**
 * Tests for useWebSocket — connection, exponential-backoff reconnect, message parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../../../../src/server/spa/client/react/hooks/useWebSocket';

// ── Minimal WebSocket mock ────────────────────────────────────────────

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    static OPEN = 1;
    url: string;
    onopen: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    readyState = 0; // CONNECTING
    close = vi.fn(() => {
        this.readyState = 3; // CLOSED
        this.onclose?.();
    });
    send = vi.fn();

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    _open() {
        this.readyState = 1;
        this.onopen?.();
    }

    _error() {
        this.onerror?.(new Event('error'));
    }

    _message(data: any) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }

    static reset() {
        MockWebSocket.instances = [];
    }

    static get last(): MockWebSocket {
        return MockWebSocket.instances[MockWebSocket.instances.length - 1];
    }
}

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
}));

// Stub window.location
Object.defineProperty(globalThis, 'location', {
    value: { protocol: 'http:', host: 'localhost' },
    writable: true,
    configurable: true,
});

describe('useWebSocket', () => {
    beforeEach(() => {
        MockWebSocket.reset();
        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts with status closed', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        expect(result.current.status).toBe('closed');
    });

    it('reports connecting then open on successful connect', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect(); });
        expect(result.current.status).toBe('connecting');

        act(() => { MockWebSocket.last._open(); });
        expect(result.current.status).toBe('open');
    });

    it('reports closed and schedules reconnect after onclose fires', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });
        expect(result.current.status).toBe('open');

        // Simulate a server close
        act(() => {
            MockWebSocket.last.readyState = 3;
            MockWebSocket.last.onclose?.();
        });
        expect(result.current.status).toBe('reconnecting');

        // After reconnect delay, a new WebSocket should be created
        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('reconnect delay doubles with exponential backoff', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });

        // First close — reconnect after 1000ms
        act(() => { MockWebSocket.last.onclose?.(); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(2);

        // Second close without open — reconnect after 2000ms (doubled)
        act(() => { MockWebSocket.last.onclose?.(); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(2); // not yet

        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('does not reconnect after manual disconnect()', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { result.current.disconnect(); });
        expect(result.current.status).toBe('closed');

        act(() => { vi.advanceTimersByTime(5000); });
        // No new connections created after manual disconnect
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('calls onMessage with parsed JSON when a message event fires', () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage }));
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });
        act(() => { MockWebSocket.last._message({ type: 'update', data: 42 }); });
        expect(onMessage).toHaveBeenCalledWith({ type: 'update', data: 42 });
    });

    it('calls onConnect callback on successful open', () => {
        const onConnect = vi.fn();
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn(), onConnect }),
        );
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });
        expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('ignores non-JSON messages gracefully', () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage }));
        act(() => { result.current.connect(); });
        act(() => { MockWebSocket.last._open(); });
        act(() => {
            MockWebSocket.last.onmessage?.({ data: 'not json' } as MessageEvent);
        });
        expect(onMessage).not.toHaveBeenCalled();
    });

    it('reconnect delay is capped at 30000ms', () => {
        const { result } = renderHook(() =>
            useWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect(); });

        // Simulate many reconnect cycles without opening to exhaust backoff
        for (let i = 0; i < 6; i++) {
            act(() => { MockWebSocket.last.onclose?.(); });
            act(() => { vi.advanceTimersByTime(35000); });
        }

        // At this point delay should be capped at 30000, not exceeding it
        const preCount = MockWebSocket.instances.length;
        act(() => { MockWebSocket.last.onclose?.(); });
        act(() => { vi.advanceTimersByTime(30001); });
        expect(MockWebSocket.instances.length).toBe(preCount + 1);
    });
});

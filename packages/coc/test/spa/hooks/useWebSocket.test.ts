/**
 * Tests for useWebSocket hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebSocket } from '../../../src/server/spa/client/react/hooks/useWebSocket';

// ── Mock WebSocket ────────────────────────────────────────────────────────────

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState: number = MockWebSocket.CONNECTING;
    url: string;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onerror: (() => void) | null = null;
    sentMessages: string[] = [];

    static instances: MockWebSocket[] = [];

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    send(data: string) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }

    /** Test helper: simulate a successful connection. */
    simulateOpen() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    /** Test helper: simulate an incoming message. */
    simulateMessage(data: any) {
        this.onmessage?.({ data: JSON.stringify(data) });
    }
}

function getLatestWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    // Stub location for ws URL construction
    Object.defineProperty(window, 'location', {
        writable: true,
        value: { protocol: 'http:', host: 'localhost:4000', hash: '' },
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useWebSocket', () => {
    it('returns status "closed" before connect is called', () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        expect(result.current.status).toBe('closed');
    });

    it('returns status "connecting" after connect() is called', () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        expect(result.current.status).toBe('connecting');
    });

    it('returns status "open" after socket open event', async () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        expect(result.current.status).toBe('open');
    });

    it('calls onMessage when a message event fires', async () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        act(() => { getLatestWs().simulateMessage({ type: 'process-added', id: 'p1' }); });
        expect(onMessage).toHaveBeenCalledWith({ type: 'process-added', id: 'p1' });
    });

    it('does NOT call onMessage for malformed JSON', () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        act(() => {
            getLatestWs().onmessage?.({ data: 'not-json' });
        });
        expect(onMessage).not.toHaveBeenCalled();
    });

    it('calls onConnect callback after socket opens', () => {
        const onConnect = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn(), onConnect }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('returns status "closed" after disconnect()', () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        act(() => { result.current.disconnect(); });
        expect(result.current.status).toBe('closed');
    });

    it('schedules reconnect after socket close event (auto-reconnect)', async () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        const firstWs = getLatestWs();
        // Simulate server-side close (not manual)
        act(() => {
            firstWs.readyState = MockWebSocket.CLOSED;
            firstWs.onclose?.();
        });
        expect(result.current.status).toBe('reconnecting');
        // Advance past the reconnect delay
        act(() => { vi.advanceTimersByTime(1100); });
        // A new WebSocket should have been created
        expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    });

    it('exponential backoff: reconnect delay doubles after repeated failures', async () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });

        // First close: delay starts at 1000ms
        act(() => {
            const ws = getLatestWs();
            ws.readyState = MockWebSocket.CLOSED;
            ws.onclose?.();
        });
        const countBefore = MockWebSocket.instances.length;
        // Advance only 500ms — should NOT have reconnected yet
        act(() => { vi.advanceTimersByTime(500); });
        expect(MockWebSocket.instances.length).toBe(countBefore);
        // Advance past 1000ms — should reconnect
        act(() => { vi.advanceTimersByTime(600); });
        expect(MockWebSocket.instances.length).toBe(countBefore + 1);

        // Second close: delay is now 2000ms
        act(() => {
            const ws = getLatestWs();
            ws.readyState = MockWebSocket.CLOSED;
            ws.onclose?.();
        });
        const countAfterFirst = MockWebSocket.instances.length;
        act(() => { vi.advanceTimersByTime(1500); });
        // Should NOT have reconnected in 1500ms (delay is 2000ms)
        expect(MockWebSocket.instances.length).toBe(countAfterFirst);
        act(() => { vi.advanceTimersByTime(600); });
        expect(MockWebSocket.instances.length).toBe(countAfterFirst + 1);
    });

    it('does NOT reconnect after manual disconnect()', async () => {
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        act(() => { result.current.disconnect(); });
        const count = MockWebSocket.instances.length;
        act(() => { vi.advanceTimersByTime(5000); });
        expect(MockWebSocket.instances.length).toBe(count);
    });

    it('cleans up on unmount — no reconnect timers fire after unmount', () => {
        const { result, unmount } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        act(() => { getLatestWs().simulateOpen(); });
        const beforeCount = MockWebSocket.instances.length;
        unmount();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(MockWebSocket.instances.length).toBe(beforeCount);
    });

    it('constructs wss:// URL when page protocol is https:', () => {
        Object.defineProperty(window, 'location', {
            writable: true,
            value: { protocol: 'https:', host: 'example.com', hash: '' },
        });
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        expect(getLatestWs().url).toMatch(/^wss:\/\//);
    });

    it('constructs ws:// URL when page protocol is http:', () => {
        Object.defineProperty(window, 'location', {
            writable: true,
            value: { protocol: 'http:', host: 'localhost:4000', hash: '' },
        });
        const { result } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
        act(() => { result.current.connect(); });
        expect(getLatestWs().url).toMatch(/^ws:\/\//);
    });
});

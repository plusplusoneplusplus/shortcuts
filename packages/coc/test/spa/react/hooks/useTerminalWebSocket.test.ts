/**
 * Tests for useTerminalWebSocket — connection, reconnect, sendInput, sendResize, cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket } from '../../../../src/server/spa/client/react/hooks/useTerminalWebSocket';

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
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
}));

// Stub window.location
Object.defineProperty(globalThis, 'location', {
    value: { protocol: 'http:', host: 'localhost' },
    writable: true,
    configurable: true,
});

describe('useTerminalWebSocket', () => {
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

    it('exports hook with correct API shape', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        expect(result.current).toHaveProperty('status');
        expect(result.current).toHaveProperty('connect');
        expect(result.current).toHaveProperty('disconnect');
        expect(result.current).toHaveProperty('sendInput');
        expect(result.current).toHaveProperty('sendResize');
        expect(typeof result.current.connect).toBe('function');
        expect(typeof result.current.disconnect).toBe('function');
        expect(typeof result.current.sendInput).toBe('function');
        expect(typeof result.current.sendResize).toBe('function');
    });

    it('connect() opens WebSocket to correct URL', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        expect(MockWebSocket.last.url).toBe(
            'ws://localhost/ws/terminal?workspaceId=ws-123&cols=80&rows=24'
        );
    });

    it('status transitions: closed → connecting → open', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        expect(result.current.status).toBe('closed');

        act(() => { result.current.connect('ws-123', 80, 24); });
        expect(result.current.status).toBe('connecting');

        act(() => { MockWebSocket.last._open(); });
        expect(result.current.status).toBe('open');
    });

    it('sendInput sends JSON message when connected', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-input', data: 'hello' })
        );
    });

    it('sendInput is no-op when disconnected', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('sendResize sends JSON message', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { result.current.sendResize(120, 40); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-resize', cols: 120, rows: 40 })
        );
    });

    it('disconnect() closes WebSocket and prevents reconnect', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { result.current.disconnect(); });
        expect(result.current.status).toBe('closed');

        act(() => { vi.advanceTimersByTime(5000); });
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('reconnects with exponential backoff on unexpected close', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        // First close — reconnect after 1000ms
        act(() => {
            MockWebSocket.last.readyState = 3;
            MockWebSocket.last.onclose?.();
        });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(2);

        // Second close without open — reconnect after 2000ms (doubled)
        act(() => { MockWebSocket.last.onclose?.(); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(2); // not yet

        act(() => { vi.advanceTimersByTime(1000); });
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('onMessage callback receives parsed server messages', () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { MockWebSocket.last._message({ type: 'terminal-output', data: 'hello' }); });
        expect(onMessage).toHaveBeenCalledWith({ type: 'terminal-output', data: 'hello' });
    });

    it('cleanup on unmount closes WebSocket', () => {
        const { result, unmount } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        unmount();
        expect(MockWebSocket.last.close).toHaveBeenCalled();
    });

    it('sends ping every 30s when connected', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        act(() => { vi.advanceTimersByTime(30000); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'ping' })
        );
    });
});

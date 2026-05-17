/**
 * Tests for useTerminalWebSocket — connection, reconnect, sendInput, sendResize, cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket } from '../../../../src/server/spa/client/react/features/terminal/hooks/useTerminalWebSocket';

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

    it('sends terminal-create message on open', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        // First send call should be terminal-create
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-create', workspaceId: 'ws-123', cols: 80, rows: 24 })
        );
    });

    it('sends terminal-attach message in attach mode and stores attached sessionId', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => {
            result.current.connect('ws-123', 80, 24, { mode: 'attach', sessionId: 'sess-existing' });
        });
        act(() => { MockWebSocket.last._open(); });

        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-attach', sessionId: 'sess-existing' })
        );

        act(() => {
            MockWebSocket.last._message({
                type: 'terminal-created',
                session: { id: 'sess-existing', workspaceId: 'ws-123', cols: 80, rows: 24, createdAt: 0, lastActivity: 0, pid: 1234, pinned: true },
            });
        });
        act(() => { result.current.sendInput('attached input'); });

        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-input', sessionId: 'sess-existing', data: 'attached input' })
        );
    });

    it('stores sessionId from terminal-created response', () => {
        const onMessage = vi.fn();
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });

        // Simulate server terminal-created response
        act(() => {
            MockWebSocket.last._message({
                type: 'terminal-created',
                session: { id: 'sess-abc', workspaceId: 'ws-123', cols: 80, rows: 24, createdAt: 0, lastActivity: 0, pid: 1234 },
            });
        });

        // onMessage should still receive the message
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal-created' }));

        // Now sendInput should include sessionId
        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-input', sessionId: 'sess-abc', data: 'hello' })
        );
    });

    it('sendInput sends JSON message with sessionId when connected', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });
        act(() => {
            MockWebSocket.last._message({
                type: 'terminal-created',
                session: { id: 'sess-abc', workspaceId: 'ws-123', cols: 80, rows: 24, createdAt: 0, lastActivity: 0, pid: 1234 },
            });
        });

        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-input', sessionId: 'sess-abc', data: 'hello' })
        );
    });

    it('sendInput is no-op when no session exists', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        // No connect, no session
        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('sendInput is no-op before terminal-created', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });
        MockWebSocket.last.send.mockClear();

        // sendInput before terminal-created should be no-op (no sessionId)
        act(() => { result.current.sendInput('hello'); });
        expect(MockWebSocket.last.send).not.toHaveBeenCalled();
    });

    it('sendResize sends JSON message with sessionId', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });
        act(() => {
            MockWebSocket.last._message({
                type: 'terminal-created',
                session: { id: 'sess-abc', workspaceId: 'ws-123', cols: 80, rows: 24, createdAt: 0, lastActivity: 0, pid: 1234 },
            });
        });

        act(() => { result.current.sendResize(120, 40); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-resize', sessionId: 'sess-abc', cols: 120, rows: 40 })
        );
    });

    it('disconnect() sends terminal-close then closes WebSocket', () => {
        const { result } = renderHook(() =>
            useTerminalWebSocket({ onMessage: vi.fn() }),
        );
        act(() => { result.current.connect('ws-123', 80, 24); });
        act(() => { MockWebSocket.last._open(); });
        act(() => {
            MockWebSocket.last._message({
                type: 'terminal-created',
                session: { id: 'sess-abc', workspaceId: 'ws-123', cols: 80, rows: 24, createdAt: 0, lastActivity: 0, pid: 1234 },
            });
        });

        act(() => { result.current.disconnect(); });
        expect(MockWebSocket.last.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'terminal-close', sessionId: 'sess-abc' })
        );
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

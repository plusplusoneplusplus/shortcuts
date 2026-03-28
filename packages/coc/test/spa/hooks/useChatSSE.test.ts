/**
 * Tests for useChatSSE hook — EventSource streaming, accumulation, done/error events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSSE } from '../../../src/server/spa/client/react/hooks/useChatSSE';

// ── Mock EventSource ──────────────────────────────────────────────────────────

class MockEventSource {
    url: string;
    listeners: Record<string, ((e: Event) => void)[]> = {};
    closed = false;
    onerror: (() => void) | null = null;

    static instances: MockEventSource[] = [];

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, handler: (e: Event) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    removeEventListener(type: string, handler: (e: Event) => void) {
        if (this.listeners[type]) {
            this.listeners[type] = this.listeners[type].filter(h => h !== handler);
        }
    }

    close() { this.closed = true; }

    /** Test helper: fire a named event with JSON data. */
    emit(type: string, data: any) {
        const event = { data: JSON.stringify(data) } as MessageEvent;
        (this.listeners[type] || []).forEach(h => h(event));
    }

    /** Test helper: trigger the onerror handler. */
    triggerError() { this.onerror?.(); }

    static latest(): MockEventSource {
        return MockEventSource.instances[MockEventSource.instances.length - 1];
    }
}

beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<Parameters<typeof useChatSSE>[0]> = {}): Parameters<typeof useChatSSE>[0] {
    return {
        taskId: 'task-1',
        task: { status: 'running' },
        processId: 'proc-1',
        setIsStreaming: vi.fn(),
        setTask: vi.fn(),
        setPendingQueue: vi.fn(),
        setSuggestions: vi.fn(),
        setSessionTokenLimit: vi.fn(),
        setSessionCurrentTokens: vi.fn(),
        setTurnsAndRef: vi.fn(),
        refreshConversation: vi.fn().mockResolvedValue(undefined),
        onSendComplete: vi.fn(),
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useChatSSE', () => {
    it('opens EventSource to /api/processes/:id/stream when task is running', () => {
        const opts = makeOptions();
        renderHook(() => useChatSSE(opts));
        const es = MockEventSource.latest();
        expect(es).toBeDefined();
        expect(es.url).toContain('/processes/proc-1/stream');
    });

    it('does NOT open EventSource when task status is not "running"', () => {
        const opts = makeOptions({ task: { status: 'completed' } });
        renderHook(() => useChatSSE(opts));
        expect(MockEventSource.instances.length).toBe(0);
    });

    it('does NOT open EventSource when processId is null', () => {
        const opts = makeOptions({ processId: null });
        renderHook(() => useChatSSE(opts));
        expect(MockEventSource.instances.length).toBe(0);
    });

    it('calls setIsStreaming(true) on mount when task is running', () => {
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        expect(setIsStreaming).toHaveBeenCalledWith(true);
    });

    it('calls setTurnsAndRef when a "chunk" event fires', () => {
        const setTurnsAndRef = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTurnsAndRef })));
        act(() => { MockEventSource.latest().emit('chunk', { content: 'Hello' }); });
        expect(setTurnsAndRef).toHaveBeenCalled();
    });

    it('accumulates multiple chunk events by calling setTurnsAndRef each time', () => {
        const setTurnsAndRef = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTurnsAndRef })));
        act(() => {
            MockEventSource.latest().emit('chunk', { content: 'Hello' });
            MockEventSource.latest().emit('chunk', { content: ' World' });
        });
        expect(setTurnsAndRef).toHaveBeenCalledTimes(2);
    });

    it('sets isStreaming false and calls refreshConversation on "done" event', async () => {
        const setIsStreaming = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming, refreshConversation })));
        act(() => { MockEventSource.latest().emit('done', {}); });
        expect(setIsStreaming).toHaveBeenCalledWith(false);
        expect(refreshConversation).toHaveBeenCalledWith('proc-1');
    });

    it('closes EventSource and calls refreshConversation on error', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ refreshConversation, setIsStreaming })));
        const es = MockEventSource.latest();
        act(() => { es.triggerError(); });
        expect(es.closed).toBe(true);
        expect(refreshConversation).toHaveBeenCalledWith('proc-1');
    });

    it('stopStreaming() closes the EventSource and sets isStreaming false', () => {
        const setIsStreaming = vi.fn();
        const { result } = renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        const es = MockEventSource.latest();
        act(() => { result.current.stopStreaming(); });
        expect(es.closed).toBe(true);
        expect(setIsStreaming).toHaveBeenCalledWith(false);
    });

    it('closes EventSource on unmount', () => {
        const { unmount } = renderHook(() => useChatSSE(makeOptions()));
        const es = MockEventSource.latest();
        unmount();
        expect(es.closed).toBe(true);
    });

    it('handles conversation-snapshot event and calls setTurnsAndRef', () => {
        const setTurnsAndRef = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTurnsAndRef })));
        act(() => {
            MockEventSource.latest().emit('conversation-snapshot', { turns: [{ role: 'user', content: 'hi' }] });
        });
        expect(setTurnsAndRef).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }]);
    });

    it('calls setTask to mark completed on "done" event', () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        act(() => { MockEventSource.latest().emit('done', {}); });
        expect(setTask).toHaveBeenCalled();
    });
});

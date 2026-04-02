/**
 * Tests for useChatSSE — SSE EventSource lifecycle and streaming state updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSSE } from '../../../../src/server/spa/client/react/hooks/useChatSSE';
import type { UseChatSSEOptions } from '../../../../src/server/spa/client/react/hooks/useChatSSE';

// ── Minimal EventSource mock ──────────────────────────────────────────

class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    listeners: Map<string, Set<(e: Event) => void>> = new Map();
    onerror: ((e: Event) => void) | null = null;
    close = vi.fn();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, handler: (e: Event) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(handler);
    }

    removeEventListener(type: string, handler: (e: Event) => void) {
        this.listeners.get(type)?.delete(handler);
    }

    _emit(type: string, data: any) {
        const event = { data: JSON.stringify(data) } as MessageEvent;
        for (const h of this.listeners.get(type) ?? []) h(event);
    }

    _emitError() {
        if (this.onerror) this.onerror(new Event('error'));
    }

    static reset() {
        MockEventSource.instances = [];
    }

    static get last(): MockEventSource {
        return MockEventSource.instances[MockEventSource.instances.length - 1];
    }
}

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

function makeOptions(overrides: Partial<UseChatSSEOptions> = {}): UseChatSSEOptions {
    return {
        taskId: 'task-1',
        task: { status: 'running' },
        processId: 'pid-1',
        setIsStreaming: vi.fn(),
        setTask: vi.fn(),
        setPendingQueue: vi.fn(),
        setSuggestions: vi.fn(),
        setSessionTokenLimit: vi.fn(),
        setSessionCurrentTokens: vi.fn(),
        setBackgroundTasks: vi.fn(),
        setTurnsAndRef: vi.fn(),
        refreshConversation: vi.fn().mockResolvedValue(undefined),
        onSendComplete: vi.fn(),
        ...overrides,
    };
}

describe('useChatSSE', () => {
    beforeEach(() => {
        MockEventSource.reset();
        vi.stubGlobal('EventSource', MockEventSource);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('opens EventSource at correct URL when processId is provided', () => {
        renderHook(() => useChatSSE(makeOptions({ processId: 'pid-1' })));
        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.last.url).toBe('/api/processes/pid-1/stream');
    });

    it('calls setIsStreaming(true) when opening EventSource', () => {
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        expect(setIsStreaming).toHaveBeenCalledWith(true);
    });

    it('does not open EventSource when processId is null', () => {
        renderHook(() => useChatSSE(makeOptions({ processId: null })));
        expect(MockEventSource.instances).toHaveLength(0);
    });

    it('does not open EventSource when task status is not running', () => {
        renderHook(() =>
            useChatSSE(makeOptions({ task: { status: 'completed' } })),
        );
        expect(MockEventSource.instances).toHaveLength(0);
    });

    it('calls setIsStreaming(false) on SSE onerror', () => {
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        act(() => { MockEventSource.last._emitError(); });
        expect(setIsStreaming).toHaveBeenCalledWith(false);
    });

    it('stopStreaming closes the EventSource and calls setIsStreaming(false)', () => {
        const setIsStreaming = vi.fn();
        const { result } = renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        act(() => { result.current.stopStreaming(); });
        expect(MockEventSource.last.close).toHaveBeenCalled();
        expect(setIsStreaming).toHaveBeenCalledWith(false);
    });

    it('cleans up EventSource on unmount', () => {
        const { unmount } = renderHook(() => useChatSSE(makeOptions()));
        const es = MockEventSource.last;
        unmount();
        expect(es.close).toHaveBeenCalled();
    });

    it('does not open second EventSource when processId is unchanged on rerender', () => {
        const opts = makeOptions();
        const { rerender } = renderHook(() => useChatSSE(opts));
        rerender();
        // Effect deps haven't changed — only 1 instance
        expect(MockEventSource.instances).toHaveLength(1);
    });

    it('closes previous EventSource and opens a new one when processId changes', () => {
        const setIsStreaming = vi.fn();
        const { rerender } = renderHook(
            ({ processId }: { processId: string }) =>
                useChatSSE(makeOptions({ processId, setIsStreaming })),
            { initialProps: { processId: 'pid-1' } },
        );
        expect(MockEventSource.instances).toHaveLength(1);
        const firstEs = MockEventSource.last;

        act(() => { rerender({ processId: 'pid-2' }); });

        // Old EventSource was closed
        expect(firstEs.close).toHaveBeenCalled();
        // New EventSource opened for pid-2
        expect(MockEventSource.instances).toHaveLength(2);
        expect(MockEventSource.last.url).toContain('pid-2');
    });

    it('calls setTurnsAndRef on conversation-snapshot event', () => {
        const setTurnsAndRef = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTurnsAndRef })));
        act(() => {
            MockEventSource.last._emit('conversation-snapshot', {
                turns: [{ role: 'user', content: 'hi' }],
            });
        });
        expect(setTurnsAndRef).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }]);
    });

    it('calls setIsStreaming(false) and refreshConversation on done event', async () => {
        const setIsStreaming = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming, refreshConversation })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(setIsStreaming).toHaveBeenCalledWith(false);
        expect(refreshConversation).toHaveBeenCalledWith('pid-1');
    });

    it('encodes processId in the URL', () => {
        renderHook(() =>
            useChatSSE(makeOptions({ processId: 'pid with spaces' })),
        );
        expect(MockEventSource.last.url).toBe('/api/processes/pid%20with%20spaces/stream');
    });

    it('updates backgroundTasks state on background-tasks event', () => {
        const setBackgroundTasks = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setBackgroundTasks })));
        act(() => {
            MockEventSource.last._emit('background-tasks', {
                backgroundAgents: [{ id: 'a1', description: 'research' }],
                backgroundShells: [{ id: 's1' }],
                backgroundTotalActive: 2,
                backgroundWaitingForDrain: true,
            });
        });
        expect(setBackgroundTasks).toHaveBeenCalledWith({
            backgroundAgents: [{ id: 'a1', description: 'research' }],
            backgroundShells: [{ id: 's1' }],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        });
    });

    it('clears backgroundTasks on done event', async () => {
        const setBackgroundTasks = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setBackgroundTasks })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(setBackgroundTasks).toHaveBeenCalledWith(null);
    });
});

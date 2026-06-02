/**
 * Tests for useChatSSE hook — EventSource streaming, accumulation, done/error events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSSE } from '../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';

// ── Mock EventSource ──────────────────────────────────────────────────────────

class MockEventSource {
    url: string;
    listeners: Record<string, ((e: Event) => void)[]> = {};
    closed = false;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;

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

    /** Test helper: trigger the onopen handler. */
    triggerOpen() { this.onopen?.(); }

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
        setSessionSystemTokens: vi.fn(),
        setSessionToolTokens: vi.fn(),
        setSessionConversationTokens: vi.fn(),
        setBackgroundTasks: vi.fn(),
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

    it('does not close EventSource on a single error (allows native auto-reconnect)', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ refreshConversation, setIsStreaming })));
        const es = MockEventSource.latest();
        act(() => { es.triggerError(); });
        // Single error should NOT close — EventSource auto-reconnects
        expect(es.closed).toBe(false);
        expect(refreshConversation).not.toHaveBeenCalled();
    });

    it('closes EventSource after MAX_SSE_ERRORS consecutive errors', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ refreshConversation, setIsStreaming })));
        const es = MockEventSource.latest();
        for (let i = 0; i < 5; i++) {
            act(() => { es.triggerError(); });
        }
        expect(es.closed).toBe(true);
        expect(refreshConversation).toHaveBeenCalledWith('proc-1');
    });

    it('resets error counter on successful reconnection (onopen)', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ refreshConversation })));
        const es = MockEventSource.latest();
        // Fire 4 errors (just under the limit)
        for (let i = 0; i < 4; i++) {
            act(() => { es.triggerError(); });
        }
        expect(es.closed).toBe(false);
        // Reconnect succeeds — reset counter
        act(() => { es.triggerOpen(); });
        // Fire 4 more errors — should still not close (counter was reset)
        for (let i = 0; i < 4; i++) {
            act(() => { es.triggerError(); });
        }
        expect(es.closed).toBe(false);
        expect(refreshConversation).not.toHaveBeenCalled();
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

    it('hydrates context breakdown fields from conversation-snapshot', () => {
        const setSessionSystemTokens = vi.fn();
        const setSessionToolTokens = vi.fn();
        const setSessionConversationTokens = vi.fn();
        renderHook(() => useChatSSE(makeOptions({
            setSessionSystemTokens,
            setSessionToolTokens,
            setSessionConversationTokens,
        })));
        act(() => {
            MockEventSource.latest().emit('conversation-snapshot', {
                turns: [{ role: 'user', content: 'hi' }],
                sessionSystemTokens: 12_000,
                sessionToolTokens: 24_000,
                sessionConversationTokens: 14_000,
            });
        });
        expect(setSessionSystemTokens).toHaveBeenCalledWith(12_000);
        expect(setSessionToolTokens).toHaveBeenCalledWith(24_000);
        expect(setSessionConversationTokens).toHaveBeenCalledWith(14_000);
    });

    it('rehydrates a pending ask-user batch from SSE replay', () => {
        const onAskUserBatch = vi.fn();
        const question = {
            batchId: 'batch-1',
            questionId: 'ask-1',
            question: 'Choose an option',
            type: 'select',
            options: [{ value: 'a', label: 'Option A' }],
            defaultValue: 'a',
            turnIndex: 1,
            index: 0,
            batchSize: 1,
        };

        renderHook(() => useChatSSE(makeOptions({ onAskUserBatch })));
        act(() => {
            MockEventSource.latest().emit('ask-user', question);
        });

        expect(onAskUserBatch).toHaveBeenCalledWith({ batchId: 'batch-1', questions: [question] });
    });

    it('accumulates ask-user questions until the full batch arrives', () => {
        const onAskUserBatch = vi.fn();
        const q2 = {
            batchId: 'batch-2',
            questionId: 'ask-2',
            question: 'Second',
            type: 'text',
            turnIndex: 1,
            index: 1,
            batchSize: 2,
        };
        const q1 = {
            batchId: 'batch-2',
            questionId: 'ask-1',
            question: 'First',
            type: 'confirm',
            turnIndex: 1,
            index: 0,
            batchSize: 2,
        };

        renderHook(() => useChatSSE(makeOptions({ onAskUserBatch })));
        act(() => {
            MockEventSource.latest().emit('ask-user', q2);
        });
        expect(onAskUserBatch).not.toHaveBeenCalled();

        act(() => {
            MockEventSource.latest().emit('ask-user', q1);
        });
        expect(onAskUserBatch).toHaveBeenCalledWith({ batchId: 'batch-2', questions: [q1, q2] });
    });

    it('calls setTask to mark completed on "done" event', () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        act(() => { MockEventSource.latest().emit('done', {}); });
        expect(setTask).toHaveBeenCalled();
    });
});

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

    it('sets task status to completed on done event', async () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        // setTask receives an updater — call it with a running task
        const updater = setTask.mock.calls.find(([arg]) => typeof arg === 'function')?.[0];
        expect(updater).toBeDefined();
        expect(updater({ status: 'running' })).toEqual({ status: 'completed' });
    });

    it('dispatches REPO_TASK_COMPLETED_OPTIMISTIC with completed on done event', async () => {
        const queueDispatch = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ queueDispatch, workspaceId: 'ws-1' })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(queueDispatch).toHaveBeenCalledWith({
            type: 'REPO_TASK_COMPLETED_OPTIMISTIC',
            repoId: 'ws-1',
            taskId: 'task-1',
            status: 'completed',
        });
    });

    it('dispatches REPO_TASK_COMPLETED_OPTIMISTIC with failed on status failed event', async () => {
        const queueDispatch = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ queueDispatch, workspaceId: 'ws-1' })));
        await act(async () => { MockEventSource.last._emit('status', { status: 'failed' }); });
        expect(queueDispatch).toHaveBeenCalledWith({
            type: 'REPO_TASK_COMPLETED_OPTIMISTIC',
            repoId: 'ws-1',
            taskId: 'task-1',
            status: 'failed',
        });
    });

    it('dispatches REPO_TASK_COMPLETED_OPTIMISTIC with cancelled on status cancelled event', async () => {
        const queueDispatch = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ queueDispatch, workspaceId: 'ws-1' })));
        await act(async () => { MockEventSource.last._emit('status', { status: 'cancelled' }); });
        expect(queueDispatch).toHaveBeenCalledWith({
            type: 'REPO_TASK_COMPLETED_OPTIMISTIC',
            repoId: 'ws-1',
            taskId: 'task-1',
            status: 'cancelled',
        });
    });

    it('does not dispatch REPO_TASK_COMPLETED_OPTIMISTIC when queueDispatch is not provided', async () => {
        // Should not throw even without queueDispatch
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(setTask).toHaveBeenCalled(); // still updates task
    });

    it('sets task status to failed on status failed event', async () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => { MockEventSource.last._emit('status', { status: 'failed' }); });
        const updater = setTask.mock.calls.find(([arg]) => typeof arg === 'function')?.[0];
        expect(updater).toBeDefined();
        expect(updater({ status: 'running' })).toEqual({ status: 'failed' });
    });

    it('finish() dedup: onerror after done does not call refreshConversation twice', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const onSendComplete = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ refreshConversation, onSendComplete })));
        const es = MockEventSource.last;
        // Fire 'done' first (triggers finish())
        await act(async () => { es._emit('done', {}); });
        expect(refreshConversation).toHaveBeenCalledTimes(1);
        expect(onSendComplete).toHaveBeenCalledTimes(1);
        // Then fire onerror (should be suppressed by finished guard)
        act(() => { es._emitError(); });
        expect(refreshConversation).toHaveBeenCalledTimes(1); // still 1, not 2
        expect(onSendComplete).toHaveBeenCalledTimes(1);
    });

    it('finish() dedup: done after status event does not double-fire', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ refreshConversation })));
        const es = MockEventSource.last;
        // Fire 'status failed' first
        await act(async () => { es._emit('status', { status: 'failed' }); });
        expect(refreshConversation).toHaveBeenCalledTimes(1);
        // Then fire 'done' (should be suppressed)
        await act(async () => { es._emit('done', {}); });
        expect(refreshConversation).toHaveBeenCalledTimes(1);
    });

    it('onerror before done: defers via setTimeout so buffered done event fires first', async () => {
        const setTask = vi.fn();
        const onSendComplete = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ setTask, onSendComplete, refreshConversation })));
        const es = MockEventSource.last;

        // Simulate the race: onerror fires, then 'done' fires before setTimeout(0) runs
        act(() => { es._emitError(); });
        // At this point onerror has called setTimeout(..., 0) but the callback hasn't run yet.
        // The 'done' event fires synchronously before the deferred handler:
        await act(async () => { es._emit('done', {}); });
        // finish() from 'done' should have set task to completed
        const doneUpdater = setTask.mock.calls.find(([arg]: any) => typeof arg === 'function')?.[0];
        expect(doneUpdater).toBeDefined();
        expect(doneUpdater({ status: 'running' })).toEqual({ status: 'completed' });

        // Now let the deferred onerror handler run — it should be suppressed by the finished guard
        await act(async () => { vi.advanceTimersByTime(0); });
        // onSendComplete was called once by finish() (via refreshConversation.finally), not by onerror
        expect(onSendComplete).toHaveBeenCalledTimes(1);
    });

    it('onerror sets task.status to completed synchronously when no done event arrives', async () => {
        const setTask = vi.fn();
        const onSendComplete = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        // Mock fetch for the retry fetch
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ task: { id: 'task-1', status: 'completed' } }),
        });
        vi.stubGlobal('fetch', mockFetch);

        renderHook(() => useChatSSE(makeOptions({ setTask, onSendComplete, refreshConversation })));
        const es = MockEventSource.last;

        // Fire onerror with no prior done event
        act(() => { es._emitError(); });
        // Advance past the setTimeout(0) deferral
        await act(async () => { vi.advanceTimersByTime(0); });

        // task.status should be optimistically set to 'completed'
        const updater = setTask.mock.calls.find(([arg]: any) => typeof arg === 'function')?.[0];
        expect(updater).toBeDefined();
        expect(updater({ status: 'running' })).toEqual({ status: 'completed' });
        // onSendComplete should have been called
        expect(onSendComplete).toHaveBeenCalledTimes(1);
    });

    it('onerror dispatches REPO_TASK_COMPLETED_OPTIMISTIC', async () => {
        const queueDispatch = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ task: { id: 'task-1', status: 'completed' } }),
        });
        vi.stubGlobal('fetch', mockFetch);

        renderHook(() => useChatSSE(makeOptions({ queueDispatch, workspaceId: 'ws-1', refreshConversation })));
        const es = MockEventSource.last;
        act(() => { es._emitError(); });
        await act(async () => { vi.advanceTimersByTime(0); });

        expect(queueDispatch).toHaveBeenCalledWith({
            type: 'REPO_TASK_COMPLETED_OPTIMISTIC',
            repoId: 'ws-1',
            taskId: 'task-1',
            status: 'completed',
        });
    });

    it('onerror retries fetch when server returns stale running status', async () => {
        const setTask = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        // First fetch returns stale 'running', second returns 'completed'
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ task: { id: 'task-1', status: 'running' } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ task: { id: 'task-1', status: 'completed' } }),
            });
        vi.stubGlobal('fetch', mockFetch);

        renderHook(() => useChatSSE(makeOptions({ setTask, refreshConversation })));
        const es = MockEventSource.last;
        act(() => { es._emitError(); });

        // Run the deferred onerror handler
        await act(async () => { vi.advanceTimersByTime(0); });
        // Let the first fetch resolve
        await act(async () => { await Promise.resolve(); });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // First response was 'running' — should retry after 500ms
        await act(async () => { vi.advanceTimersByTime(500); });
        await act(async () => { await Promise.resolve(); });
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Second response was 'completed' — setTask should be called with server data
        const serverUpdater = setTask.mock.calls.filter(([arg]: any) => typeof arg === 'function')
            .map(([fn]: any) => fn)
            .find((fn: any) => {
                const result = fn({ id: 'task-1', status: 'running' });
                return result?.status === 'completed' && result?.id === 'task-1';
            });
        expect(serverUpdater).toBeDefined();
    });

    it('onerror retries fetch on network error', async () => {
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        const mockFetch = vi.fn()
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ task: { id: 'task-1', status: 'completed' } }),
            });
        vi.stubGlobal('fetch', mockFetch);

        renderHook(() => useChatSSE(makeOptions({ refreshConversation })));
        const es = MockEventSource.last;
        act(() => { es._emitError(); });

        // Run the deferred onerror handler
        await act(async () => { vi.advanceTimersByTime(0); });
        // Let the first fetch reject
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Should retry after 500ms
        await act(async () => { vi.advanceTimersByTime(500); });
        await act(async () => { await Promise.resolve(); });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('finish() defers setTask until after refreshConversation resolves', async () => {
        const callOrder: string[] = [];
        const refreshConversation = vi.fn().mockImplementation(() => {
            callOrder.push('refreshConversation');
            return Promise.resolve();
        });
        const setTask = vi.fn().mockImplementation(() => {
            callOrder.push('setTask');
        });
        const onSendComplete = vi.fn().mockImplementation(() => {
            callOrder.push('onSendComplete');
        });

        renderHook(() => useChatSSE(makeOptions({ setTask, refreshConversation, onSendComplete })));
        await act(async () => { MockEventSource.last._emit('done', {}); });

        // refreshConversation should run before setTask and onSendComplete
        expect(callOrder).toEqual(['refreshConversation', 'setTask', 'onSendComplete']);
    });
});

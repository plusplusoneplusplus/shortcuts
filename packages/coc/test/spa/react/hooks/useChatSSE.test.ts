/**
 * Tests for useChatSSE — SSE EventSource lifecycle and streaming state updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatSSE } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import type { UseChatSSEOptions } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import type { ClientConversationTurn } from '../../../../src/server/spa/client/react/types/dashboard';
import { RALPH_GRILL_MAX_ROUNDS } from '../../../../src/server/ralph/grill-planning';

// ── Minimal EventSource mock ──────────────────────────────────────────

class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    listeners: Map<string, Set<(e: Event) => void>> = new Map();
    onerror: ((e: Event) => void) | null = null;
    onopen: ((e: Event) => void) | null = null;
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

    _emitOpen() {
        if (this.onopen) this.onopen(new Event('open'));
    }

    static reset() {
        MockEventSource.instances = [];
    }

    static get last(): MockEventSource {
        return MockEventSource.instances[MockEventSource.instances.length - 1];
    }
}

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
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

    it('does not close SSE on a single onerror (allows native auto-reconnect)', () => {
        const setIsStreaming = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming })));
        act(() => { MockEventSource.last._emitError(); });
        // Single error should NOT close the connection — EventSource auto-reconnects
        expect(MockEventSource.last.close).not.toHaveBeenCalled();
        expect(setIsStreaming).not.toHaveBeenCalledWith(false);
    });

    it('closes SSE after MAX_SSE_ERRORS consecutive errors', () => {
        const setIsStreaming = vi.fn();
        const refreshConversation = vi.fn().mockResolvedValue(undefined);
        renderHook(() => useChatSSE(makeOptions({ setIsStreaming, refreshConversation })));
        const es = MockEventSource.last;
        // Fire 5 consecutive errors (MAX_SSE_ERRORS)
        for (let i = 0; i < 5; i++) {
            act(() => { es._emitError(); });
        }
        expect(es.close).toHaveBeenCalled();
        expect(setIsStreaming).toHaveBeenCalledWith(false);
        expect(refreshConversation).toHaveBeenCalledWith('pid-1');
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

    it('rehydrates preserved interrupted turns with tool history and later follow-ups from snapshots only', () => {
        const setTurnsAndRef = vi.fn();
        const snapshotTurns: ClientConversationTurn[] = [
            { role: 'user', content: 'Start the task', turnIndex: 0, timeline: [] },
            {
                role: 'assistant',
                content: 'Partial answer before timeout.',
                turnIndex: 1,
                interrupted: true,
                interruptionReason: 'Request timed out after 90000ms',
                timeline: [
                    {
                        type: 'content',
                        timestamp: '2026-01-15T14:19:01Z',
                        content: 'Partial answer before timeout.',
                    },
                    {
                        type: 'tool-start',
                        timestamp: '2026-01-15T14:19:02Z',
                        toolCall: {
                            id: 'tool-1',
                            toolName: 'bash',
                            args: { command: 'echo persisted' },
                            status: 'running',
                            startTime: '2026-01-15T14:19:02Z',
                        },
                    },
                    {
                        type: 'tool-complete',
                        timestamp: '2026-01-15T14:19:03Z',
                        toolCall: {
                            id: 'tool-1',
                            toolName: 'bash',
                            args: { command: 'echo persisted' },
                            result: 'persisted',
                            status: 'completed',
                            startTime: '2026-01-15T14:19:02Z',
                            endTime: '2026-01-15T14:19:03Z',
                        },
                    },
                ],
            },
            { role: 'user', content: 'Please continue', turnIndex: 2, timeline: [] },
            { role: 'assistant', content: 'Fresh answer after retry.', turnIndex: 3, timeline: [] },
        ];

        renderHook(() => useChatSSE(makeOptions({ setTurnsAndRef })));
        act(() => {
            MockEventSource.last._emit('conversation-snapshot', { turns: snapshotTurns });
        });

        expect(setTurnsAndRef).toHaveBeenCalledTimes(1);
        expect(setTurnsAndRef).toHaveBeenCalledWith(snapshotTurns);
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
            MockEventSource.last._emit('conversation-snapshot', {
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

    it('tracks Ralph grill planning progress and clears it when ask_user arrives', () => {
        const setRalphGrillPlanningProgress = vi.fn();
        const onAskUserBatch = vi.fn();
        const progress = {
            status: 'running',
            depth: 'deep',
            round: 2,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            agentCount: 2,
            agents: [
                {
                    role: 'product',
                    roleLabel: 'Product Agent',
                    provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                    status: 'running',
                    candidateCount: 0,
                },
            ],
            message: 'Running 2 Ralph grill agents to plan consolidated questions.',
            warnings: [],
        };
        const question = {
            batchId: 'batch-ralph',
            questionId: 'ask-1',
            question: 'Which users should this optimize for?',
            type: 'text',
            turnIndex: 1,
            index: 0,
            batchSize: 1,
        };

        renderHook(() => useChatSSE(makeOptions({ setRalphGrillPlanningProgress, onAskUserBatch })));
        act(() => {
            MockEventSource.last._emit('ralph-grill-planning', progress);
        });
        expect(setRalphGrillPlanningProgress).toHaveBeenCalledWith(progress);

        act(() => {
            MockEventSource.last._emit('ask-user', question);
        });
        expect(setRalphGrillPlanningProgress).toHaveBeenLastCalledWith(null);
        expect(onAskUserBatch).toHaveBeenCalledWith({ batchId: 'batch-ralph', questions: [question] });
    });

    it('clears backgroundTasks on done event', async () => {
        const setBackgroundTasks = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setBackgroundTasks })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(setBackgroundTasks).toHaveBeenCalledWith(null);
    });

    it('clears Ralph grill planning progress on done event', async () => {
        const setRalphGrillPlanningProgress = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setRalphGrillPlanningProgress })));
        await act(async () => { MockEventSource.last._emit('done', {}); });
        expect(setRalphGrillPlanningProgress).toHaveBeenCalledWith(null);
    });

    it('sets task status to failed when status SSE event reports failed', async () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => {
            MockEventSource.last._emit('status', { status: 'failed' });
        });
        // setTask receives an updater function; invoke it to verify the status
        const updater = setTask.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ status: 'running' });
        expect(result.status).toBe('failed');
    });

    it('sets task status to cancelled when status SSE event reports cancelled', async () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => {
            MockEventSource.last._emit('status', { status: 'cancelled' });
        });
        const updater = setTask.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ status: 'running' });
        expect(result.status).toBe('cancelled');
    });

    it('sets task status to completed on done event', async () => {
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        const updater = setTask.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ status: 'running' });
        expect(result.status).toBe('completed');
    });

    // ── Regression: missing follow-up bubble after task completes ──
    //
    // Without the synchronous setProcessDetails update in finish(), the
    // window between SSE 'done' and the async refreshConversation() leaves
    // `effectiveStatus = processDetails?.status ?? task?.status` evaluating
    // to 'running' in ChatDetail. A follow-up sent during that window is
    // misrouted through the active-generation enqueue path, the optimistic
    // user bubble is skipped, and SSE never reopens — so the new message
    // stays invisible until the user re-selects the chat.

    it('regression: done event mirrors terminal status onto processDetails synchronously', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        expect(setProcessDetails).toHaveBeenCalled();
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ id: 'pid-1', status: 'running' });
        expect(result.status).toBe('completed');
    });

    it('regression: status=failed event mirrors terminal status onto processDetails', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('status', { status: 'failed' });
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ id: 'pid-1', status: 'running' });
        expect(result.status).toBe('failed');
    });

    it('regression: status=cancelled event mirrors terminal status onto processDetails', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('status', { status: 'cancelled' });
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ id: 'pid-1', status: 'running' });
        expect(result.status).toBe('cancelled');
    });

    it('regression: terminal status update preserves existing endTime', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        const existing = { id: 'pid-1', status: 'running', endTime: '2024-01-01T00:00:00Z' };
        const result = updater!(existing);
        expect(result.endTime).toBe('2024-01-01T00:00:00Z');
    });

    it('regression: terminal status update fills missing endTime with a fresh timestamp', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        const result = updater!({ id: 'pid-1', status: 'running' });
        expect(typeof result.endTime).toBe('string');
        expect(result.endTime.length).toBeGreaterThan(0);
    });

    it('regression: terminal status update is a no-op when processDetails is null', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater!(null)).toBeNull();
    });

    it('regression: terminal status update is a no-op when processDetails is already terminal', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        const existing = { id: 'pid-1', status: 'completed', endTime: '2024-01-01T00:00:00Z' };
        // Status was already terminal (e.g. cancelled by user); do not stomp it.
        expect(updater!(existing)).toBe(existing);
    });

    it('regression: terminal status update is harmlessly absent when setProcessDetails is not provided', async () => {
        // ChatDetail wires setProcessDetails through, but stand-alone callers
        // may omit it. The hook must not crash and must still update task.
        const setTask = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setTask })));
        await act(async () => {
            MockEventSource.last._emit('done', {});
        });
        expect(setTask).toHaveBeenCalled();
    });

    it('regression: token-usage event mirrors live token and cost totals onto processDetails', async () => {
        const setProcessDetails = vi.fn();
        renderHook(() => useChatSSE(makeOptions({ setProcessDetails })));

        act(() => {
            MockEventSource.last._emit('token-usage', {
                turnIndex: 1,
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    cacheReadTokens: 10,
                    cacheWriteTokens: 5,
                    totalTokens: 165,
                    turnCount: 1,
                },
                cumulativeTokenUsage: {
                    inputTokens: 300,
                    outputTokens: 150,
                    cacheReadTokens: 30,
                    cacheWriteTokens: 15,
                    totalTokens: 495,
                    turnCount: 3,
                },
                conversationCostEstimate: {
                    estimatedUsdCost: 0.024,
                    costBreakdown: { inputUsd: 0.004, cachedInputUsd: 0.001, cacheWriteUsd: 0.002, outputUsd: 0.017 },
                    pricingSource: 'Copilot pricing table',
                    unpricedTurnCount: 0,
                    pricingUnavailable: false,
                },
            });
        });

        const updater = setProcessDetails.mock.calls.find(
            (call: any[]) => typeof call[0] === 'function',
        )?.[0];
        expect(updater).toBeDefined();
        const result = updater!({ id: 'pid-1', status: 'running' });
        expect(result.cumulativeTokenUsage).toMatchObject({ totalTokens: 495, turnCount: 3 });
        expect(result.conversationCostEstimate).toMatchObject({ estimatedUsdCost: 0.024, pricingUnavailable: false });
    });

    // ── Group 4: SSE event handling ──

    describe('SSE queue events', () => {
        it('SSE1: message-queued is acknowledged (no-op on pending queue)', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            act(() => {
                MockEventSource.last._emit('message-queued', { turnIndex: 2, deliveryMode: 'enqueue' });
            });
            // message-queued no longer touches pendingQueue
            expect(setPendingQueue).not.toHaveBeenCalled();
        });

        it('SSE2: message-steering is acknowledged (no-op on pending queue)', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            act(() => {
                MockEventSource.last._emit('message-steering', { turnIndex: 2 });
            });
            // message-steering no longer touches pendingQueue
            expect(setPendingQueue).not.toHaveBeenCalled();
        });

        it('SSE3: pending-message-added adds a server-confirmed queued item', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            act(() => {
                MockEventSource.last._emit('pending-message-added', {
                    pendingMessage: { id: 'pm-1', content: 'queued msg', createdAt: '2024-01-01' },
                });
            });
            expect(setPendingQueue).toHaveBeenCalled();
            const updater = setPendingQueue.mock.calls[0][0];
            const result = updater([]);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ id: 'pm-1', content: 'queued msg', status: 'queued' });
        });

        it('SSE3b: pending-message-added carries images into the queue entry', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            const images = ['data:image/png;base64,AAA'];
            act(() => {
                MockEventSource.last._emit('pending-message-added', {
                    pendingMessage: { id: 'pm-img', content: 'with image', createdAt: '2024-01-01', images },
                });
            });
            const updater = setPendingQueue.mock.calls[0][0];
            const result = updater([]);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ id: 'pm-img', content: 'with image', status: 'queued', images });
        });

        it('SSE3c: pending-message-added omits images when none are present', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            act(() => {
                MockEventSource.last._emit('pending-message-added', {
                    pendingMessage: { id: 'pm-noimg', content: 'no image', createdAt: '2024-01-01' },
                });
            });
            const updater = setPendingQueue.mock.calls[0][0];
            const result = updater([]);
            expect(result[0]).not.toHaveProperty('images');
        });

        it('SSE4: pending-message-added deduplicates by id', () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            act(() => {
                MockEventSource.last._emit('pending-message-added', {
                    pendingMessage: { id: 'pm-1', content: 'queued msg', createdAt: '2024-01-01' },
                });
            });
            const updater = setPendingQueue.mock.calls[0][0];
            const existing = [{ id: 'pm-1', content: 'queued msg', status: 'queued' as const }];
            const result = updater(existing);
            expect(result).toHaveLength(1); // no duplicate added
        });

        it('SSE5: done event clears all pending queue items', async () => {
            const setPendingQueue = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ setPendingQueue })));
            await act(async () => {
                MockEventSource.last._emit('done', {});
            });
            expect(setPendingQueue).toHaveBeenCalledWith([]);
        });

        it('SSE6: onSendComplete is called on done event', async () => {
            const onSendComplete = vi.fn();
            renderHook(() => useChatSSE(makeOptions({ onSendComplete })));
            await act(async () => {
                MockEventSource.last._emit('done', {});
            });
            expect(onSendComplete).toHaveBeenCalled();
        });
    });
});

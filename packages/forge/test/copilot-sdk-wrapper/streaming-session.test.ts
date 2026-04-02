/**
 * Tests for StreamingSession
 *
 * Verifies state transitions, event handling, timer behaviour, and the
 * full cancellation / settlement paths using a mock event emitter that
 * drives SDK events synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLogger, nullLogger } from '../../src/logger';
import {
    StreamingSession,
    StreamingState,
    IStreamableSession,
    ISessionEvent,
    StreamingSessionRunOptions,
} from '../../src/copilot-sdk-wrapper/streaming-session';

// Suppress logger output during tests
setLogger(nullLogger);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a mock streamable session whose events can be driven from tests. */
function makeMockSession(sessionId = 'test-session') {
    let handler: ((event: ISessionEvent) => void) | undefined;

    const session: IStreamableSession = {
        sessionId,
        on: vi.fn((h: (event: ISessionEvent) => void) => {
            handler = h;
            return () => { handler = undefined; };
        }),
        send: vi.fn(() => Promise.resolve()),
        destroy: vi.fn(() => Promise.resolve()),
    };

    const emit = (event: ISessionEvent) => {
        if (handler) { handler(event); }
    };

    return { session, emit };
}

/** Minimal streaming run options for most tests. */
function baseOptions(overrides: Partial<StreamingSessionRunOptions> = {}): StreamingSessionRunOptions {
    return {
        prompt: 'Hello',
        timeoutMs: 5000,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// State-transition tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — state transitions', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('starts in Idle state and moves to Streaming on run()', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();

        // Start running (don't await — it never settles until we emit)
        const promise = ss.run(session, baseOptions());

        // settle it immediately so the test doesn't hang
        emit({ type: 'session.idle' });
        await promise;

        // After settling, state is Settled
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('Idle → Streaming → Settled on session.idle', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.message', data: { content: 'hello' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('hello');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('Idle → Streaming → Settled via delta chunks + session.idle', async () => {
        const { session, emit } = makeMockSession();
        const chunks: string[] = [];
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            onStreamingChunk: c => chunks.push(c),
        }));

        emit({ type: 'assistant.message_delta', data: { deltaContent: 'foo' } });
        emit({ type: 'assistant.message_delta', data: { deltaContent: 'bar' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('foobar');
        expect(chunks).toEqual(['foo', 'bar']);
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('Idle → Streaming → Cancelled on session.error', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'session.error', data: { message: 'boom' } });

        await expect(promise).rejects.toThrow('Copilot session error: boom');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
    });

    it('run() throws if called a second time', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());
        emit({ type: 'session.idle' });
        await promise;

        expect(() => ss.run(session, baseOptions())).toThrow('can only be called once');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation path
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — cancellation', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('wall-clock timeout: Streaming → Cancelled', async () => {
        const { session } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 1000 }));

        vi.advanceTimersByTime(1001);

        await expect(promise).rejects.toThrow('timed out after 1000ms');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
        expect(session.destroy).toHaveBeenCalled();
    });

    it('idle timeout: Streaming → Cancelled when no activity arrives', async () => {
        const { session } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            idleTimeoutMs: 500,
        }));

        vi.advanceTimersByTime(501);

        await expect(promise).rejects.toThrow('idle-timed out after 500ms');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
        expect(session.destroy).toHaveBeenCalled();
    });

    it('idle timer resets on message_delta activity', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            idleTimeoutMs: 500,
        }));

        // Activity before idle fires
        vi.advanceTimersByTime(400);
        emit({ type: 'assistant.message_delta', data: { deltaContent: 'ping' } });
        vi.advanceTimersByTime(400);
        // Still within the reset window — should not have timed out yet
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Now settle cleanly
        emit({ type: 'session.idle' });
        const result = await promise;
        expect(result.response).toBe('ping');
    });

    it('abort event: Streaming → Cancelled promptly', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'abort', data: { reason: 'user cancelled' } });

        await expect(promise).rejects.toThrow('Session aborted');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Turn-end grace period
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — turn_end grace period', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('settles after grace period when no turn_start follows', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'result' } });
        emit({ type: 'assistant.turn_end' });

        // Should not be settled yet
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Advance past grace period (2 s)
        vi.advanceTimersByTime(2001);

        const result = await promise;
        expect(result.response).toBe('result');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('cancels grace timer when turn_start fires (multi-turn)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'turn 1' } });
        emit({ type: 'assistant.turn_end' });

        // Immediately fire turn_start — grace timer should be cancelled
        emit({ type: 'assistant.turn_start' });
        expect((ss as any).turnEndGraceTimer).toBeNull();

        // Now the second turn completes
        emit({ type: 'assistant.message', data: { content: 'turn 2' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toContain('turn 1');
        expect(result.response).toContain('turn 2');
    });

    it('session.idle beats grace timer (race)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'answer' } });
        emit({ type: 'assistant.turn_end' });
        // session.idle fires before the 2s grace period expires
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('answer');

        // Advance past grace period — should be a no-op (already Settled)
        vi.advanceTimersByTime(3000);
        expect((ss as any).state).toBe(StreamingState.Settled);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token usage
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — token usage', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('accumulates usage events across multiple turns', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.usage', data: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 2 } });
        emit({ type: 'assistant.usage', data: { inputTokens: 8, outputTokens: 15 } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.tokenUsage).toBeDefined();
        expect(result.tokenUsage!.inputTokens).toBe(18);
        expect(result.tokenUsage!.outputTokens).toBe(35);
        expect(result.tokenUsage!.cacheReadTokens).toBe(5);
        expect(result.tokenUsage!.cacheWriteTokens).toBe(2);
        expect(result.tokenUsage!.totalTokens).toBe(53);
        expect(result.tokenUsage!.turnCount).toBe(2);
    });

    it('returns undefined tokenUsage when no usage events received', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'session.idle' });
        const result = await promise;
        expect(result.tokenUsage).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool call capture
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — tool call capture', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('captures tool-start and tool-complete events', async () => {
        const { session, emit } = makeMockSession();
        const toolEvents: string[] = [];
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            onToolEvent: e => toolEvents.push(e.type),
        }));

        emit({ type: 'tool.execution_start', data: { toolCallId: 'tc1', toolName: 'view', arguments: { path: '/tmp/f' } } });
        emit({ type: 'tool.execution_complete', data: { toolCallId: 'tc1', toolName: 'view', success: true, result: { content: 'file content' } } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(toolEvents).toEqual(['tool-start', 'tool-complete']);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls![0].status).toBe('completed');
        expect(result.toolCalls![0].name).toBe('view');
    });

    it('marks tool as failed on tool.execution_complete with success=false', async () => {
        const { session, emit } = makeMockSession();
        const toolEvents: string[] = [];
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            onToolEvent: e => toolEvents.push(e.type),
        }));

        emit({ type: 'tool.execution_start', data: { toolCallId: 'tc2', toolName: 'bash', arguments: {} } });
        emit({ type: 'tool.execution_complete', data: { toolCallId: 'tc2', toolName: 'bash', success: false, error: { message: 'permission denied' } } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(toolEvents).toEqual(['tool-start', 'tool-failed']);
        expect(result.toolCalls![0].status).toBe('failed');
        expect(result.toolCalls![0].error).toBe('permission denied');
    });

    it('uses a shared toolCallsMap when provided by caller', async () => {
        const { session, emit } = makeMockSession();
        const shared = new Map();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ toolCallsMap: shared }));

        emit({ type: 'tool.execution_start', data: { toolCallId: 'tc3', toolName: 'read_file', arguments: {} } });
        emit({ type: 'session.idle' });
        await promise;

        // The caller's map should have the tool call (id may differ for unknown toolCallIds)
        expect(shared.size).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple-timer race condition
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — race condition guard', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('wall-clock timeout and session.idle do not double-resolve', async () => {
        const { session, emit } = makeMockSession();
        const resolveCount = { count: 0 };
        const rejectCount  = { count: 0 };

        const ss = new StreamingSession();
        ss.run(session, baseOptions({ timeoutMs: 100 }))
            .then(() => { resolveCount.count++; })
            .catch(() => { rejectCount.count++; });

        // Both happen "simultaneously"
        emit({ type: 'session.idle' });
        vi.advanceTimersByTime(200);

        // Let microtasks flush
        await Promise.resolve();
        await Promise.resolve();

        // Exactly one of them should have fired
        expect(resolveCount.count + rejectCount.count).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Background task gating
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — background task gating', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('session.idle with no backgroundTasks settles immediately (backward compat)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.message', data: { content: 'done' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('done');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('session.idle with undefined data settles immediately (backward compat)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'session.idle' });

        const result = await promise;
        expect((ss as any).state).toBe(StreamingState.Settled);
        expect(result.response).toBe('');
    });

    it('session.idle with empty backgroundTasks settles immediately', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.message', data: { content: 'hello' } });
        emit({ type: 'session.idle', data: { backgroundTasks: { agents: [], shells: [] } } });

        const result = await promise;
        expect(result.response).toBe('hello');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('session.idle with active agents does NOT settle', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'working' } });
        emit({
            type: 'session.idle',
            data: {
                backgroundTasks: {
                    agents: [{ id: 'agent-1', type: 'sub-agent', description: 'research' }],
                    shells: [],
                },
            },
        });

        // Should still be streaming — not settled
        expect((ss as any).state).toBe(StreamingState.Streaming);
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        // Clean up by settling
        emit({ type: 'session.idle', data: { backgroundTasks: { agents: [], shells: [] } } });
        await promise;
    });

    it('session.idle with active shells does NOT settle', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'running' } });
        emit({
            type: 'session.idle',
            data: {
                backgroundTasks: {
                    agents: [],
                    shells: [{ id: 'shell-1' }],
                },
            },
        });

        expect((ss as any).state).toBe(StreamingState.Streaming);
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        // Clean up
        emit({ type: 'session.idle' });
        await promise;
    });

    it('session.idle with bg tasks → background_tasks_changed empty → settles', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'result from agent' } });

        // First idle: background tasks active
        emit({
            type: 'session.idle',
            data: {
                backgroundTasks: {
                    agents: [{ id: 'a1' }],
                    shells: [],
                },
            },
        });
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Background tasks drain
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });

        const result = await promise;
        expect(result.response).toBe('result from agent');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('multiple session.idle events: first with tasks, second without → settles on second', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'multi-idle' } });

        // First idle with active background tasks
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Second idle with no background tasks
        emit({ type: 'session.idle', data: { backgroundTasks: { agents: [], shells: [] } } });

        const result = await promise;
        expect(result.response).toBe('multi-idle');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('background_tasks_changed without prior idle is a no-op', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'hello' } });

        // background_tasks_changed fires but we never received idle with bg tasks
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });

        // Should still be streaming — not waiting, so no settle
        expect((ss as any).state).toBe(StreamingState.Streaming);
        expect((ss as any).waitingForBackgroundTasks).toBe(false);

        // Settle normally
        emit({ type: 'session.idle' });
        const result = await promise;
        expect(result.response).toBe('hello');
    });

    it('background_tasks_changed with non-zero tasks while waiting does not settle', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'waiting' } });

        // Enter waiting state
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }, { id: 'a2' }], shells: [] } },
        });
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        // One agent finishes but one remains
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [{ id: 'a2' }], shells: [] } },
        });
        expect((ss as any).state).toBe(StreamingState.Streaming);
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        // Last agent finishes
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });

        const result = await promise;
        expect(result.response).toBe('waiting');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('wall-clock timeout wins over background task waiting', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 1000 }));

        emit({ type: 'assistant.message', data: { content: 'in progress' } });

        // Enter waiting state
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Wall-clock timeout fires
        vi.advanceTimersByTime(1001);

        await expect(promise).rejects.toThrow('timed out after 1000ms');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
    });

    it('turn count is preserved across background task waiting', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'turn 1' } });
        emit({ type: 'assistant.turn_end' });

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'turn 2' } });
        emit({ type: 'assistant.turn_end' });

        // Idle with background tasks
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });

        // Tasks drain
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });

        const result = await promise;
        expect(result.turnCount).toBe(2);
        expect(result.response).toContain('turn 1');
        expect(result.response).toContain('turn 2');
    });

    it('turn_end grace timer does NOT settle while waiting for background tasks', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'partial result' } });
        emit({ type: 'assistant.turn_end' });
        // turn_end starts the 2s grace timer

        // session.idle arrives with active background tasks — defers settlement
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });
        expect((ss as any).waitingForBackgroundTasks).toBe(true);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Grace timer fires — should NOT settle because bg tasks are active
        vi.advanceTimersByTime(3000);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Background tasks drain — now it settles
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });

        const result = await promise;
        expect(result.response).toBe('partial result');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('handleSessionIdle cancels pending turn_end grace timer when bg tasks active', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'hello' } });
        emit({ type: 'assistant.turn_end' });
        // Grace timer now ticking

        expect((ss as any).timers.hasTurnEndGraceTimer).toBe(true);

        // session.idle with bg tasks should cancel the grace timer
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });

        expect((ss as any).timers.hasTurnEndGraceTimer).toBe(false);

        // Clean up
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });
        await promise;
    });

    it('turn_end grace timer works normally when no background tasks are active', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'quick answer' } });
        emit({ type: 'assistant.turn_end' });

        // No session.idle with bg tasks — grace timer should work as before
        vi.advanceTimersByTime(3000);

        const result = await promise;
        expect(result.response).toBe('quick answer');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// onBackgroundTasksChanged callback
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — onBackgroundTasksChanged callback', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('calls onBackgroundTasksChanged when idle with active background tasks', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1', description: 'research' }], shells: [] } },
        });

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            backgroundAgents: [{ id: 'a1', description: 'research' }],
            backgroundShells: [],
            backgroundTotalActive: 1,
            backgroundWaitingForDrain: true,
        });

        // Settle
        emit({ type: 'background_tasks_changed', data: { backgroundTasks: { agents: [], shells: [] } } });
        await promise;
    });

    it('calls onBackgroundTasksChanged on each background_tasks_changed event', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }, { id: 'a2' }], shells: [] } },
        });
        expect(callback).toHaveBeenCalledTimes(1);

        // One agent finishes
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [{ id: 'a2' }], shells: [] } },
        });
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith({
            backgroundAgents: [{ id: 'a2' }],
            backgroundShells: [],
            backgroundTotalActive: 1,
            backgroundWaitingForDrain: true,
        });

        // All tasks drain — two calls: one with the change event, one with the drain-complete
        emit({
            type: 'background_tasks_changed',
            data: { backgroundTasks: { agents: [], shells: [] } },
        });
        expect(callback).toHaveBeenCalledTimes(4);
        // Last call should be the drain-complete with 0 active
        expect(callback).toHaveBeenLastCalledWith({
            backgroundAgents: [],
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        });

        await promise;
    });

    it('does not call onBackgroundTasksChanged when idle with no background tasks', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hello' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('hello');
        expect(callback).not.toHaveBeenCalled();
    });

    it('handles callback errors gracefully (non-fatal)', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn(() => { throw new Error('callback crash'); });
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({
            type: 'session.idle',
            data: { backgroundTasks: { agents: [{ id: 'a1' }], shells: [] } },
        });

        expect(callback).toHaveBeenCalled();
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Settle cleanly
        emit({ type: 'background_tasks_changed', data: { backgroundTasks: { agents: [], shells: [] } } });
        await promise;
    });

    it('includes shells in the callback', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({
            type: 'session.idle',
            data: {
                backgroundTasks: {
                    agents: [{ id: 'a1' }],
                    shells: [{ id: 's1', description: 'npm run build' }],
                },
            },
        });

        expect(callback).toHaveBeenCalledWith({
            backgroundAgents: [{ id: 'a1' }],
            backgroundShells: [{ id: 's1', description: 'npm run build' }],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        });

        // Settle
        emit({ type: 'session.idle', data: { backgroundTasks: { agents: [], shells: [] } } });
        await promise;
    });
});

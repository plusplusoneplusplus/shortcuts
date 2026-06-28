/**
 * Tests for StreamingSession
 *
 * Verifies state transitions, event handling, timer behaviour, and the
 * full cancellation / settlement paths using a mock event emitter that
 * drives SDK events synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    StreamingSession,
    StreamingState,
    IStreamableSession,
    ISessionEvent,
    StreamingSessionRunOptions,
} from '../../src/streaming-session';

// Suppress logger output during tests


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
        disconnect: vi.fn(() => Promise.resolve()),
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
        expect(session.disconnect).toHaveBeenCalled();
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
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('idle timeout is suppressed while a tool call is in flight (regression: ask_user widget)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            idleTimeoutMs: 500,
        }));

        // Tool starts (e.g. ask_user opens a user-input widget)
        emit({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc1', toolName: 'ask_user', arguments: {} },
        });

        // Far longer than idleTimeoutMs elapses with no activity at all —
        // the agent is blocked on a human reply, not idle.
        vi.advanceTimersByTime(5000);
        expect((ss as any).state).toBe(StreamingState.Streaming);
        expect(session.disconnect).not.toHaveBeenCalled();

        // Tool completes; session then settles normally.
        emit({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc1', success: true, result: { content: 'ok' } },
        });
        emit({ type: 'assistant.message', data: { content: 'done' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('done');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('wall-clock timeout still fires while a tool call is in flight', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 1000,
            idleTimeoutMs: 200,
        }));

        emit({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc1', toolName: 'ask_user', arguments: {} },
        });

        vi.advanceTimersByTime(1001);

        await expect(promise).rejects.toThrow('timed out after 1000ms');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('idle timeout fires after the tool completes if then no activity arrives', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            idleTimeoutMs: 500,
        }));

        emit({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc1', toolName: 'ask_user', arguments: {} },
        });

        vi.advanceTimersByTime(2000); // would be idle, but suppressed
        expect((ss as any).state).toBe(StreamingState.Streaming);

        emit({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc1', success: true, result: { content: 'ok' } },
        });

        // Now no tools are active — idle window should resume from this point.
        vi.advanceTimersByTime(501);
        await expect(promise).rejects.toThrow('idle-timed out after 500ms');
        expect((ss as any).state).toBe(StreamingState.Cancelled);
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

    it('abort event: Streaming → Settled with partial result (soft abort)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        // Emit some content, then abort
        emit({ type: 'assistant.message', data: { content: 'partial response' } });
        emit({ type: 'abort', data: { reason: 'user cancelled' } });

        const result = await promise;
        expect(result.response).toBe('partial response');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('abort event with no content: Streaming → Settled with empty result', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'abort', data: { reason: 'user cancelled' } });

        const result = await promise;
        expect(result.response).toBe('');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('abort followed by session.idle does not double-resolve', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'data' } });
        emit({ type: 'abort', data: { reason: 'user cancelled' } });
        // session.idle fires right after abort — should be no-op
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('data');
        expect((ss as any).state).toBe(StreamingState.Settled);
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

    it('captures session.usage_info breakdown (system, tool, conversation tokens)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.usage', data: { inputTokens: 1, outputTokens: 1 } });
        emit({
            type: 'session.usage_info',
            data: {
                tokenLimit: 200000,
                currentTokens: 70000,
                systemTokens: 12400,
                toolDefinitionsTokens: 8100,
                conversationTokens: 47200,
            },
        });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.tokenUsage).toBeDefined();
        expect(result.tokenUsage!.tokenLimit).toBe(200000);
        expect(result.tokenUsage!.currentTokens).toBe(70000);
        expect(result.tokenUsage!.systemTokens).toBe(12400);
        expect(result.tokenUsage!.toolDefinitionsTokens).toBe(8100);
        expect(result.tokenUsage!.conversationTokens).toBe(47200);
    });

    it('handles session.usage_info without breakdown fields', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.usage', data: { inputTokens: 1, outputTokens: 1 } });
        emit({ type: 'session.usage_info', data: { tokenLimit: 100000, currentTokens: 5000 } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.tokenUsage!.tokenLimit).toBe(100000);
        expect(result.tokenUsage!.currentTokens).toBe(5000);
        expect(result.tokenUsage!.systemTokens).toBeUndefined();
        expect(result.tokenUsage!.toolDefinitionsTokens).toBeUndefined();
        expect(result.tokenUsage!.conversationTokens).toBeUndefined();
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
// user.message event-id capture (rewind anchor — AC-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — user.message event id capture', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('captures the user.message event id and returns it on the result', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'user.message', id: 'evt-user-1', data: { content: 'Hello' } });
        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.userMessageEventId).toBe('evt-user-1');
    });

    it('keeps the FIRST user.message id when several arrive in one run (steering/queued)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        // Earliest event begins the turn; truncating there drops the whole turn.
        emit({ type: 'user.message', id: 'evt-first', data: { content: 'first' } });
        emit({ type: 'user.message', id: 'evt-second', data: { content: 'queued' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.userMessageEventId).toBe('evt-first');
    });

    it('leaves userMessageEventId undefined when no user.message event is observed', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.userMessageEventId).toBeUndefined();
    });

    it('ignores a user.message event that carries no id (non-rewindable)', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'user.message', data: { content: 'Hello' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.userMessageEventId).toBeUndefined();
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
// Background task gating (session.background_tasks_changed + session.idle)
// ─────────────────────────────────────────────────────────────────────────────

describe('StreamingSession — background task gating', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('session.idle settles immediately when no background tasks active', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'assistant.message', data: { content: 'done' } });
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('done');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('session.idle with undefined data settles immediately', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions());

        emit({ type: 'session.idle' });

        const result = await promise;
        expect((ss as any).state).toBe(StreamingState.Settled);
        expect(result.response).toBe('');
    });

    it('session.background_tasks_changed sets waiting flag and defers to session.idle', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'working on it' } });
        emit({ type: 'assistant.turn_end' });

        emit({ type: 'session.background_tasks_changed', data: {} });

        expect((ss as any).waitingForBackgroundTasks).toBe(true);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // Grace timer should NOT settle (it was cancelled)
        vi.advanceTimersByTime(3000);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        // session.idle fires when all background tasks are done
        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('working on it');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('session.background_tasks_changed cancels pending turn_end grace timer', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'hello' } });
        emit({ type: 'assistant.turn_end' });

        expect((ss as any).timers.hasTurnEndGraceTimer).toBe(true);

        emit({ type: 'session.background_tasks_changed', data: {} });

        expect((ss as any).timers.hasTurnEndGraceTimer).toBe(false);
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        emit({ type: 'session.idle' });
        await promise;
    });

    it('multiple session.background_tasks_changed events are idempotent', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'multi' } });

        emit({ type: 'session.background_tasks_changed', data: {} });
        emit({ type: 'session.background_tasks_changed', data: {} });
        emit({ type: 'session.background_tasks_changed', data: {} });

        expect(callback).toHaveBeenCalledTimes(1);
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        emit({ type: 'session.idle' });
        await promise;
    });

    it('session.idle clears waiting flag and settles after background tasks', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.message', data: { content: 'result from agent' } });

        emit({ type: 'session.background_tasks_changed', data: {} });
        expect((ss as any).waitingForBackgroundTasks).toBe(true);

        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('result from agent');
        expect((ss as any).state).toBe(StreamingState.Settled);
        expect((ss as any).waitingForBackgroundTasks).toBe(false);
    });

    it('wall-clock timeout wins over background task waiting', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 1000 }));

        emit({ type: 'assistant.message', data: { content: 'slow task' } });
        emit({ type: 'session.background_tasks_changed', data: {} });

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

        emit({ type: 'session.background_tasks_changed', data: {} });
        emit({ type: 'session.idle' });

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

        emit({ type: 'session.background_tasks_changed', data: {} });
        expect((ss as any).waitingForBackgroundTasks).toBe(true);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        vi.advanceTimersByTime(3000);
        expect((ss as any).state).toBe(StreamingState.Streaming);

        emit({ type: 'session.idle' });

        const result = await promise;
        expect(result.response).toBe('partial result');
        expect((ss as any).state).toBe(StreamingState.Settled);
    });

    it('turn_end grace timer works normally when no background tasks', async () => {
        const { session, emit } = makeMockSession();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({ timeoutMs: 60000 }));

        emit({ type: 'assistant.turn_start' });
        emit({ type: 'assistant.message', data: { content: 'quick answer' } });
        emit({ type: 'assistant.turn_end' });

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

    it('fires callback with waitingForDrain=true on session.background_tasks_changed', async () => {
        const { session, emit } = makeMockSession();
        const callback = vi.fn();
        const ss = new StreamingSession();
        const promise = ss.run(session, baseOptions({
            timeoutMs: 60000,
            onBackgroundTasksChanged: callback,
        }));

        emit({ type: 'assistant.message', data: { content: 'hi' } });
        emit({ type: 'session.background_tasks_changed', data: {} });

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            backgroundAgents: [],
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: true,
        });

        emit({ type: 'session.idle' });
        await promise;
    });

    it('does not fire callback when session.idle settles without background tasks', async () => {
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
        emit({ type: 'session.background_tasks_changed', data: {} });

        expect(callback).toHaveBeenCalled();
        expect((ss as any).state).toBe(StreamingState.Streaming);

        emit({ type: 'session.idle' });
        await promise;
    });
});

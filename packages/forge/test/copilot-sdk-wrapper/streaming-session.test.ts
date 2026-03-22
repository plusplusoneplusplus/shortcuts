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

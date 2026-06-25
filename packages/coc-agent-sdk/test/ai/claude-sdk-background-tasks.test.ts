/**
 * ClaudeSDKService — long-running background-task support.
 *
 * Covers the streaming-input transport, the in-flight background-task counter,
 * deferred settle, the wall-clock drain cap, and the original drop-the-task
 * regression. See the goal "Support long-running background tasks in the Claude
 * provider" (AC-01 … AC-06).
 *
 * The provider drives a turn in streaming-input mode: `query()` receives an
 * AsyncIterable prompt that stays open until all background tasks drain, then
 * EOFs. The {@link makeDeferredStreamingFake} helper models the real SDK's
 * behavior: it consumes the input to detect EOF and only delivers the
 * re-invocation batch(es) while the input is still open — if the loop closes the
 * input early (single-shot regression), the background result is dropped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import {
    ClaudeSDKService,
    applyClaudeTaskInflight,
    type ClaudeTaskSystemMessage,
} from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import { resetSDKLogger } from '../../src/logger';

const mockDynamicImport = vi.mocked(dynamicImportModule);

/** Flush pending microtasks (real timers). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface DeferredFakeOptions {
    /** Messages emitted before the loop's first settle decision (includes result #1). */
    pre: object[];
    /**
     * Re-invocation batches. Each batch is released by one `releaseBatch()` call
     * and is delivered ONLY if the input is still open at that point (mirrors the
     * SDK dropping the task when the session ends).
     */
    batches?: object[][];
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

/**
 * A fake `query()` whose output is coupled to the input channel staying open.
 */
function makeDeferredStreamingFake(opts: DeferredFakeOptions) {
    const batches = opts.batches ?? [];
    const gates = batches.map(() => deferred());
    const reached = batches.map(() => deferred());
    let nextBatch = 0;
    const releaseBatch = () => {
        if (nextBatch < gates.length) gates[nextBatch++].resolve();
    };

    const recordedInput: unknown[] = [];
    let inputEnded = false;
    const inputClosed = deferred();

    const queryFn = vi.fn((callOptions: { prompt: AsyncIterable<unknown>; abortController?: AbortController }) => {
        // Background-consume the input to detect EOF (the SDK reads stdin).
        void (async () => {
            try {
                for await (const msg of callOptions.prompt) recordedInput.push(msg);
            } finally {
                inputEnded = true;
                inputClosed.resolve();
            }
        })();

        return {
            [Symbol.asyncIterator]() {
                return (async function* () {
                    for (const m of opts.pre) yield m;
                    for (let i = 0; i < batches.length; i++) {
                        // Signal that the loop has consumed everything up to this
                        // batch boundary (so result #i's settle decision is made).
                        reached[i].resolve();
                        // Deliver this batch only while the input is still open.
                        const dropped = await Promise.race([
                            inputClosed.promise.then(() => true),
                            gates[i].promise.then(() => false),
                        ]);
                        // Re-check synchronously: if the input was closed by the
                        // time the gate fired, the SDK would have dropped the task.
                        if (dropped || inputEnded) return;
                        for (const m of batches[i]) yield m;
                    }
                })();
            },
            return: async (v?: unknown) => ({ done: true as const, value: v }),
        };
    });

    return {
        queryFn,
        releaseBatch,
        recordedInput,
        isInputEnded: () => inputEnded,
        whenInputClosed: () => inputClosed.promise,
        whenReachedBatch: (i: number) => reached[i].promise,
    };
}

/**
 * Wait until the loop has made its settle decision for the result preceding
 * batch `i`, with input state settled. Returns whether stdin is still open —
 * `true` means the loop correctly deferred settle (held stdin open). Under a
 * single-shot regression this returns `false`, so callers can assert on it.
 */
async function reachedBatchWithOpenInput(
    fake: ReturnType<typeof makeDeferredStreamingFake>,
    i: number,
): Promise<boolean> {
    await fake.whenReachedBatch(i);
    await flush();
    return !fake.isInputEnded();
}

const assistantText = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const taskStarted = (taskId: string) => ({ type: 'system', subtype: 'task_started', task_id: taskId, task_type: 'local_bash' });
const taskUpdated = (taskId: string) => ({ type: 'system', subtype: 'task_updated', task_id: taskId, patch: { status: 'completed' } });
const taskNotification = (taskId: string, status = 'completed') => ({
    type: 'system', subtype: 'task_notification', task_id: taskId, status, output_file: `/tmp/${taskId}.out`, summary: `task ${taskId} ${status}`,
});
const resultMsg = (extra: Record<string, unknown> = {}) => ({ type: 'result', subtype: 'success', ...extra });

describe('ClaudeSDKService background tasks', () => {
    let svc: ClaudeSDKService;

    beforeEach(() => {
        svc = new ClaudeSDKService();
        mockDynamicImport.mockReset();
    });

    afterEach(() => {
        resetSDKLogger();
        svc.dispose();
        vi.useRealTimers();
    });

    // ── AC-03: the in-flight counter rule (unit) ───────────────────────────────

    describe('applyClaudeTaskInflight (AC-03 counter rule)', () => {
        it('increments on task_started and decrements on terminal task_notification', () => {
            const set = new Set<string>();
            applyClaudeTaskInflight(set, taskStarted('t1') as ClaudeTaskSystemMessage);
            expect(set.has('t1')).toBe(true);
            expect(set.size).toBe(1);

            applyClaudeTaskInflight(set, taskNotification('t1', 'completed') as ClaudeTaskSystemMessage);
            expect(set.has('t1')).toBe(false);
            expect(set.size).toBe(0);
        });

        it('treats failed and stopped notifications as terminal (decrement)', () => {
            for (const status of ['failed', 'stopped'] as const) {
                const set = new Set<string>(['t1']);
                applyClaudeTaskInflight(set, taskNotification('t1', status) as ClaudeTaskSystemMessage);
                expect(set.size).toBe(0);
            }
        });

        it('ignores informational task_updated / task_progress (no double-count)', () => {
            const set = new Set<string>();
            applyClaudeTaskInflight(set, taskStarted('t1') as ClaudeTaskSystemMessage);
            applyClaudeTaskInflight(set, taskUpdated('t1') as ClaudeTaskSystemMessage);
            applyClaudeTaskInflight(set, { type: 'system', subtype: 'task_progress', task_id: 't1' } as ClaudeTaskSystemMessage);
            // Still exactly one in flight: only the terminal notification clears it.
            expect(set.size).toBe(1);
            expect(set.has('t1')).toBe(true);
        });

        it('tracks multiple concurrent tasks independently and ignores missing task_id', () => {
            const set = new Set<string>();
            applyClaudeTaskInflight(set, taskStarted('a') as ClaudeTaskSystemMessage);
            applyClaudeTaskInflight(set, taskStarted('b') as ClaudeTaskSystemMessage);
            applyClaudeTaskInflight(set, { type: 'system', subtype: 'task_started' } as ClaudeTaskSystemMessage);
            expect(set.size).toBe(2);
            applyClaudeTaskInflight(set, taskNotification('a') as ClaudeTaskSystemMessage);
            expect([...set]).toEqual(['b']);
        });
    });

    // ── AC-01: streaming-input transport + immediate close on no-background ─────

    it('AC-01: invokes query() with an async-iterable prompt carrying the user text', async () => {
        const fake = makeDeferredStreamingFake({ pre: [assistantText('hi'), resultMsg({ result: 'hi' })] });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        await svc.sendMessage({ prompt: 'hello there' });

        const call = fake.queryFn.mock.calls[0][0];
        expect(typeof call.prompt).not.toBe('string');
        await fake.whenInputClosed();
        expect(fake.recordedInput).toEqual([
            { type: 'user', message: { role: 'user', content: 'hello there' }, parent_tool_use_id: null },
        ]);
    });

    it('AC-01: a no-background turn closes stdin at result #1 with unchanged response/usage', async () => {
        const fake = makeDeferredStreamingFake({
            pre: [assistantText('done'), resultMsg({ result: 'done', usage: { input_tokens: 11, output_tokens: 4 }, num_turns: 1 })],
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const result = await svc.sendMessage({ prompt: 'do it' });
        await fake.whenInputClosed();

        expect(result.success).toBe(true);
        expect(result.response).toBe('done');
        expect(result.tokenUsage).toMatchObject({ inputTokens: 11, outputTokens: 4, totalTokens: 15, turnCount: 1 });
        // No background task in flight → input EOF'd immediately at result #1.
        expect(fake.isInputEnded()).toBe(true);
    });

    // ── AC-02 / AC-05: deferred settle + re-invocation capture ──────────────────

    it('AC-02/AC-05: holds stdin open for a backgrounded task, captures the re-invocation, sums usage', async () => {
        const fake = makeDeferredStreamingFake({
            pre: [
                assistantText('started'),
                taskStarted('bg1'),
                resultMsg({ result: 'started', usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 1, session_id: 'sess-1' }),
            ],
            batches: [[
                taskUpdated('bg1'),
                taskNotification('bg1', 'completed'),
                assistantText('background finished: exit 0'),
                resultMsg({ result: 'background finished', usage: { input_tokens: 20, output_tokens: 7 }, num_turns: 1 }),
            ]],
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'run a long background task' });
        // The loop must hold stdin OPEN past result #1 while the task is in
        // flight. Under a single-shot regression this is false → the fake drops
        // the re-invocation batch and the response/usage assertions below fail.
        expect(await reachedBatchWithOpenInput(fake, 0)).toBe(true);
        fake.releaseBatch();
        const result = await sendP;

        expect(result.success).toBe(true);
        // Combined turn-1 + re-invocation text.
        expect(result.response).toBe('startedbackground finished: exit 0');
        // Usage summed across both results.
        expect(result.tokenUsage).toMatchObject({ inputTokens: 30, outputTokens: 12, totalTokens: 42, turnCount: 2 });
        await fake.whenInputClosed();
        expect(fake.isInputEnded()).toBe(true);
    });

    it('AC-02: a chained background task started by the re-invocation also defers settle', async () => {
        const fake = makeDeferredStreamingFake({
            pre: [assistantText('A'), taskStarted('bgA'), resultMsg({ result: 'A' })],
            batches: [
                [taskNotification('bgA'), assistantText('B'), taskStarted('bgB'), resultMsg({ result: 'B' })],
                [taskNotification('bgB'), assistantText('C'), resultMsg({ result: 'C' })],
            ],
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'chain background tasks' });
        // Defer #1: stdin held open past result A while bgA runs.
        expect(await reachedBatchWithOpenInput(fake, 0)).toBe(true);
        fake.releaseBatch();
        // Defer #2: the re-invocation (turn B) started bgB, so stdin must STILL be
        // held open past result B — a chained background task also defers settle.
        expect(await reachedBatchWithOpenInput(fake, 1)).toBe(true);
        fake.releaseBatch();
        const result = await sendP;

        expect(result.success).toBe(true);
        // All three turns captured — settle deferred through BOTH background tasks.
        expect(result.response).toBe('ABC');
    });

    // ── AC-04: timeout / abort guards ───────────────────────────────────────────

    it('AC-04: a never-settling background task is bounded by the drain cap (returns, no hang)', async () => {
        vi.useFakeTimers();
        const fake = makeDeferredStreamingFake({
            pre: [assistantText('started'), taskStarted('wedged'), resultMsg({ result: 'started' })],
            // A batch that is NEVER released → the SDK would wait forever.
            batches: [[taskNotification('wedged'), assistantText('never'), resultMsg({})]],
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        // timeoutMs caps the drain wait (honored up to the 20-minute ceiling).
        const sendP = svc.sendMessage({ prompt: 'wedged background', timeoutMs: 5_000 });
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await sendP;

        // The cap closed the input and aborted; sendMessage resolves with turn-1.
        expect(result).toBeDefined();
        expect(result.response).toBe('started');
        expect(fake.isInputEnded()).toBe(true);
    });

    it('AC-04: in-flight tasks prevent settle until the cap fires', async () => {
        vi.useFakeTimers();
        const fake = makeDeferredStreamingFake({
            pre: [assistantText('started'), taskStarted('t'), resultMsg({ result: 'started' })],
            batches: [[taskNotification('t'), resultMsg({})]],
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'pending task', timeoutMs: 30_000 });

        // Advance short of the cap: the task is still in flight, so the turn must
        // NOT have settled (input still open).
        await vi.advanceTimersByTimeAsync(29_000);
        expect(fake.isInputEnded()).toBe(false);

        // Cross the cap → settles.
        await vi.advanceTimersByTimeAsync(2_000);
        await sendP;
        expect(fake.isInputEnded()).toBe(true);
    });

    it('AC-04: an external abort mid-wait closes input and resolves', async () => {
        const controller = new AbortController();
        const fake = makeDeferredStreamingFake({
            pre: [assistantText('started'), taskStarted('t'), resultMsg({ result: 'started' })],
            batches: [[taskNotification('t'), resultMsg({})]], // never released
        });
        mockDynamicImport.mockResolvedValue({ query: fake.queryFn });

        const sendP = svc.sendMessage({ prompt: 'abort me', signal: controller.signal });
        // Let the loop consume result #1 and reach the open-stdin wait.
        await flush();
        await flush();
        expect(fake.isInputEnded()).toBe(false);

        controller.abort();
        const result = await sendP;

        expect(result).toBeDefined();
        await fake.whenInputClosed();
        expect(fake.isInputEnded()).toBe(true);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { MID_TURN_TOKEN_USAGE_INTERVAL_MS } from '../../src/mid-turn-usage';

function makeCodexMock(events: Array<Record<string, unknown>>) {
    const thread = {
        id: 'thread-1',
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                for (const event of events) {
                    yield event;
                }
            })(),
        })),
    };
    const client = {
        startThread: vi.fn(() => thread),
        resumeThread: vi.fn(() => thread),
    };
    return { client, thread };
}

async function sendWithEvents(events: Array<Record<string, unknown>>, model?: string) {
    const svc = new CodexSDKService();
    const { client } = makeCodexMock(events);
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        return await svc.sendMessage({ prompt: 'test', ...(model ? { model } : {}) });
    } finally {
        svc.dispose();
    }
}

// ── Rollout-enrichment fixtures ──────────────────────────────────────────────

function rolloutTokenCountLine(totalTokens: number | null, contextWindow: number | null): string {
    return JSON.stringify({
        type: 'event_msg',
        payload: {
            type: 'token_count',
            info: {
                total_token_usage: { total_tokens: (totalTokens ?? 0) + 100 },
                last_token_usage: totalTokens === null ? null : { total_tokens: totalTokens },
                model_context_window: contextWindow,
            },
        },
    });
}

async function writeThreadRollout(
    root: string,
    threadId: string,
    lines: string[],
): Promise<void> {
    const dir = path.join(root, '2026', '07', '25');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, `rollout-2026-07-25T00-00-00-${threadId}.jsonl`),
        lines.join('\n') + '\n',
        'utf8',
    );
}

describe('CodexSDKService token usage', () => {
    it('maps Codex turn.completed usage into the shared TokenUsage shape', async () => {
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
            {
                type: 'turn.completed',
                usage: {
                    input_tokens: 125,
                    cached_input_tokens: 25,
                    output_tokens: 45,
                    reasoning_output_tokens: 12,
                },
            },
        ]);

        expect(result.success).toBe(true);
        expect(result.response).toBe('ok');
        expect(result.tokenUsage).toEqual({
            inputTokens: 125,
            outputTokens: 45,
            cacheReadTokens: 25,
            cacheWriteTokens: 0,
            totalTokens: 170,
            turnCount: 1,
        });
    });

    it('accumulates multiple Codex usage events and defaults missing fields to zero', async () => {
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                },
            },
            {
                type: 'turn.completed',
                usage: {
                    input_tokens: 20,
                    cached_input_tokens: 7,
                    output_tokens: 15,
                },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'done' } },
        ]);

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toEqual({
            inputTokens: 30,
            outputTokens: 20,
            cacheReadTokens: 7,
            cacheWriteTokens: 0,
            totalTokens: 50,
            turnCount: 2,
        });
    });

    it('leaves tokenUsage undefined when Codex does not report usage', async () => {
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
        ]);

        expect(result.success).toBe(true);
        expect(result.tokenUsage).toBeUndefined();
    });

    it('leaves the context meter unset when no model id is provided', async () => {
        // Without a model id there is no registry entry to source a context
        // window from, so tokenLimit/currentTokens (and the never-populated
        // breakdown fields) stay undefined even when per-turn usage is reported.
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: {
                    input_tokens: 80,
                    cached_input_tokens: 10,
                    output_tokens: 30,
                    reasoning_output_tokens: 8,
                },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
        ]);

        expect(result.success).toBe(true);
        // Per-turn fields are populated.
        expect(result.tokenUsage?.inputTokens).toBe(80);
        expect(result.tokenUsage?.outputTokens).toBe(30);
        expect(result.tokenUsage?.cacheReadTokens).toBe(10);
        expect(result.tokenUsage?.totalTokens).toBe(110);
        expect(result.tokenUsage?.turnCount).toBe(1);
        // Context-window fields stay unset with no model id.
        expect(result.tokenUsage?.tokenLimit).toBeUndefined();
        expect(result.tokenUsage?.currentTokens).toBeUndefined();
        expect(result.tokenUsage?.systemTokens).toBeUndefined();
        expect(result.tokenUsage?.toolDefinitionsTokens).toBeUndefined();
        expect(result.tokenUsage?.conversationTokens).toBeUndefined();
    });

    it('AC-01: derives tokenLimit from the registry and currentTokens from the latest turn', async () => {
        // gpt-5.4 has a registry contextWindow (272k). currentTokens is the
        // latest-turn occupancy snapshot: input_tokens + output_tokens. The
        // subset field cached_input_tokens is NOT added again, and reasoning
        // tokens are excluded.
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: {
                    input_tokens: 1000,
                    cached_input_tokens: 400,
                    output_tokens: 250,
                    reasoning_output_tokens: 90,
                },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
        ], 'gpt-5.4');

        expect(result.success).toBe(true);
        expect(result.tokenUsage?.tokenLimit).toBe(272_000);
        // input + output only (cached is a subset of input; reasoning excluded).
        expect(result.tokenUsage?.currentTokens).toBe(1250);
        // No fabricated breakdown for Codex.
        expect(result.tokenUsage?.systemTokens).toBeUndefined();
        expect(result.tokenUsage?.toolDefinitionsTokens).toBeUndefined();
        expect(result.tokenUsage?.conversationTokens).toBeUndefined();
    });

    it('AC-01: latest-turn snapshot wins for currentTokens while per-turn totals accumulate', async () => {
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: { input_tokens: 5000, output_tokens: 500 },
            },
            {
                type: 'turn.completed',
                usage: { input_tokens: 8000, cached_input_tokens: 6000, output_tokens: 300 },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'done' } },
        ], 'gpt-5.4');

        expect(result.success).toBe(true);
        // Per-turn totals still accumulate across turns.
        expect(result.tokenUsage?.inputTokens).toBe(13_000);
        expect(result.tokenUsage?.outputTokens).toBe(800);
        expect(result.tokenUsage?.cacheReadTokens).toBe(6000);
        expect(result.tokenUsage?.totalTokens).toBe(13_800);
        expect(result.tokenUsage?.turnCount).toBe(2);
        // currentTokens is a snapshot of the LATEST turn only, not cumulative.
        expect(result.tokenUsage?.tokenLimit).toBe(272_000);
        expect(result.tokenUsage?.currentTokens).toBe(8300);
    });

    it('AC-01: cached tokens do not inflate the currentTokens snapshot', async () => {
        // Even when nearly all input is cached, currentTokens counts input once.
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: { input_tokens: 2000, cached_input_tokens: 1900, output_tokens: 100 },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
        ], 'gpt-5.3-codex');

        expect(result.success).toBe(true);
        expect(result.tokenUsage?.tokenLimit).toBe(272_000);
        // 2000 + 100, NOT 2000 + 1900 + 100.
        expect(result.tokenUsage?.currentTokens).toBe(2100);
    });

    it('AC-02: unregistered model leaves tokenLimit unset so the indicator stays hidden', async () => {
        const result = await sendWithEvents([
            { type: 'thread.started', thread_id: 'thread-1' },
            {
                type: 'turn.completed',
                usage: { input_tokens: 500, output_tokens: 120 },
            },
            { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
        ], 'gpt-nonexistent-9.9');

        expect(result.success).toBe(true);
        // Per-turn totals are still reported.
        expect(result.tokenUsage?.inputTokens).toBe(500);
        expect(result.tokenUsage?.outputTokens).toBe(120);
        // The indicator-driving tokenLimit is absent for an unknown model.
        expect(result.tokenUsage?.tokenLimit).toBeUndefined();
        expect(result.tokenUsage?.currentTokens).toBeUndefined();
    });
});

describe('CodexSDKService rollout context enrichment', () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-svc-rollout-'));
        process.env.COC_CODEX_SESSIONS_DIR = root;
    });

    afterEach(async () => {
        delete process.env.COC_CODEX_SESSIONS_DIR;
        await fs.rm(root, { recursive: true, force: true });
    });

    const turnEvents = (usage: Record<string, number>) => [
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.completed', usage },
        { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } },
    ];

    it('enrichment wins: rollout occupancy/limit override the registry values', async () => {
        await writeThreadRollout(root, 'thread-1', [rolloutTokenCountLine(76_223, 258_400)]);

        const result = await sendWithEvents(turnEvents({ input_tokens: 1000, output_tokens: 250 }), 'gpt-5.4');

        expect(result.success).toBe(true);
        // Context meter comes from the rollout, not the registry (272_000 / 1250).
        expect(result.tokenUsage?.tokenLimit).toBe(258_400);
        expect(result.tokenUsage?.currentTokens).toBe(76_223);
        // Per-turn totals are untouched.
        expect(result.tokenUsage?.inputTokens).toBe(1000);
        expect(result.tokenUsage?.outputTokens).toBe(250);
        expect(result.tokenUsage?.totalTokens).toBe(1250);
    });

    it('null window in rollout keeps the registry-derived tokenLimit', async () => {
        await writeThreadRollout(root, 'thread-1', [rolloutTokenCountLine(50_000, null)]);

        const result = await sendWithEvents(turnEvents({ input_tokens: 1000, output_tokens: 250 }), 'gpt-5.4');

        expect(result.success).toBe(true);
        // Occupancy from rollout, limit preserved from the registry.
        expect(result.tokenUsage?.currentTokens).toBe(50_000);
        expect(result.tokenUsage?.tokenLimit).toBe(272_000);
    });

    it('fallback preserved: no rollout file → registry-derived values exactly as before', async () => {
        const result = await sendWithEvents(turnEvents({ input_tokens: 1000, output_tokens: 250 }), 'gpt-5.4');

        expect(result.success).toBe(true);
        expect(result.tokenUsage?.tokenLimit).toBe(272_000);
        expect(result.tokenUsage?.currentTokens).toBe(1250);
    });

    it('neither source: unknown model + no rollout → meter fields absent', async () => {
        const result = await sendWithEvents(turnEvents({ input_tokens: 500, output_tokens: 120 }), 'gpt-nonexistent-9.9');

        expect(result.success).toBe(true);
        expect(result.tokenUsage?.tokenLimit).toBeUndefined();
        expect(result.tokenUsage?.currentTokens).toBeUndefined();
    });

    it('rollout occupancy with a null window and unknown model clears currentTokens (invariant)', async () => {
        await writeThreadRollout(root, 'thread-1', [rolloutTokenCountLine(50_000, null)]);

        const result = await sendWithEvents(turnEvents({ input_tokens: 500, output_tokens: 120 }), 'gpt-nonexistent-9.9');

        expect(result.success).toBe(true);
        // No limit from either source → the two fields stay hidden together.
        expect(result.tokenUsage?.tokenLimit).toBeUndefined();
        expect(result.tokenUsage?.currentTokens).toBeUndefined();
    });

    it('read failure is non-fatal: turn still succeeds with the registry fallback', async () => {
        const svc = new CodexSDKService();
        const { client } = makeCodexMock(turnEvents({ input_tokens: 1000, output_tokens: 250 }));
        (svc as unknown as { sdk: unknown }).sdk = client;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };
        const readSpy = vi.fn(async () => {
            throw new Error('boom');
        });
        (svc as unknown as { readRolloutContextUsage: unknown }).readRolloutContextUsage = readSpy;

        try {
            const result = await svc.sendMessage({ prompt: 'test', model: 'gpt-5.4' });
            expect(result.success).toBe(true);
            expect(readSpy).toHaveBeenCalledTimes(1);
            // Registry fallback survives the read failure.
            expect(result.tokenUsage?.tokenLimit).toBe(272_000);
            expect(result.tokenUsage?.currentTokens).toBe(1250);
        } finally {
            svc.dispose();
        }
    });

    it('path cache: the second turn on a session passes the cached rollout path', async () => {
        await writeThreadRollout(root, 'thread-1', [rolloutTokenCountLine(70_000, 258_400)]);
        const rolloutPath = path.join(root, '2026', '07', '25', 'rollout-2026-07-25T00-00-00-thread-1.jsonl');

        const svc = new CodexSDKService();
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };
        const readSpy = vi.fn(readCodexRolloutContextUsageSpyImpl(rolloutPath));
        (svc as unknown as { readRolloutContextUsage: unknown }).readRolloutContextUsage = readSpy;

        try {
            (svc as unknown as { sdk: unknown }).sdk =
                makeCodexMock(turnEvents({ input_tokens: 1000, output_tokens: 250 })).client;
            await svc.sendMessage({ prompt: 'turn 1', model: 'gpt-5.4' });

            (svc as unknown as { sdk: unknown }).sdk =
                makeCodexMock(turnEvents({ input_tokens: 1000, output_tokens: 250 })).client;
            await svc.sendMessage({ prompt: 'turn 2', sessionId: 'thread-1', model: 'gpt-5.4' });

            expect(readSpy).toHaveBeenCalledTimes(2);
            // First turn: no cached path yet.
            expect(readSpy.mock.calls[0][1].cachedPath).toBeUndefined();
            // Second turn: the resolved path is threaded back in.
            expect(readSpy.mock.calls[1][1].cachedPath).toBe(rolloutPath);
        } finally {
            svc.dispose();
        }
    });
});

describe('CodexSDKService mid-turn context usage', () => {
    // A stream that yields a message, then blocks until `held` resolves before
    // finishing the turn — so poll ticks can fire while the turn is in flight.
    function makeHeldCodexMock(held: Promise<void>) {
        const thread = {
            id: 'thread-1',
            runStreamed: vi.fn(async () => ({
                events: (async function* () {
                    yield { type: 'thread.started', thread_id: 'thread-1' };
                    yield { type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: 'ok' } };
                    await held;
                    yield { type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 250 } };
                })(),
            })),
        };
        return { startThread: vi.fn(() => thread), resumeThread: vi.fn(() => thread) };
    }

    function makeService(client: unknown, readSpy: unknown): CodexSDKService {
        const svc = new CodexSDKService();
        (svc as unknown as { sdk: unknown }).sdk = client;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };
        (svc as unknown as { readRolloutContextUsage: unknown }).readRolloutContextUsage = readSpy;
        return svc;
    }

    it('polls the rollout on the shared interval and reports each snapshot', async () => {
        vi.useFakeTimers();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let currentTokens = 10_000;
        const readSpy = vi.fn(async () => ({
            currentTokens: (currentTokens += 10_000),
            tokenLimit: 258_400,
            rolloutPath: '/tmp/rollout-thread-1.jsonl',
        }));
        const svc = makeService(makeHeldCodexMock(held), readSpy);
        const onTokenUsage = vi.fn();
        const chunks: string[] = [];

        try {
            const pending = svc.sendMessage({
                prompt: 'test',
                model: 'gpt-5.4',
                onTokenUsage,
                onStreamingChunk: (c: string) => { chunks.push(c); },
            });

            // Streaming is not gated on the poll: the chunk lands before any tick.
            await vi.advanceTimersByTimeAsync(0);
            expect(chunks).toContain('ok');
            expect(readSpy).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS);
            expect(readSpy).toHaveBeenCalledTimes(1);
            expect(onTokenUsage).toHaveBeenCalledTimes(1);
            expect(onTokenUsage).toHaveBeenLastCalledWith({ currentTokens: 20_000, tokenLimit: 258_400 });

            // A second read is suppressed until the interval has fully elapsed.
            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS - 1);
            expect(readSpy).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(readSpy).toHaveBeenCalledTimes(2);
            expect(onTokenUsage).toHaveBeenLastCalledWith({ currentTokens: 30_000, tokenLimit: 258_400 });

            // The mid-turn read caches the rollout path for later reads.
            expect(readSpy.mock.calls[1][1].cachedPath).toBe('/tmp/rollout-thread-1.jsonl');

            release();
            const result = await pending;

            // Turn end is unchanged: the post-loop read is still authoritative.
            expect(result.success).toBe(true);
            expect(result.tokenUsage).toMatchObject({
                inputTokens: 1000,
                outputTokens: 250,
                currentTokens: 40_000,
                tokenLimit: 258_400,
            });

            // Nothing polls after the turn settles.
            const callsAtTurnEnd = readSpy.mock.calls.length;
            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS * 5);
            expect(readSpy).toHaveBeenCalledTimes(callsAtTurnEnd);
            expect(onTokenUsage).toHaveBeenCalledTimes(2);
        } finally {
            svc.dispose();
            vi.useRealTimers();
        }
    });

    it('swallows a mid-turn read failure and keeps polling', async () => {
        vi.useFakeTimers();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let attempt = 0;
        const readSpy = vi.fn(async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('rollout gone');
            return { currentTokens: 55_000, tokenLimit: 258_400, rolloutPath: '/tmp/r.jsonl' };
        });
        const svc = makeService(makeHeldCodexMock(held), readSpy);
        const onTokenUsage = vi.fn();

        try {
            const pending = svc.sendMessage({ prompt: 'test', model: 'gpt-5.4', onTokenUsage });

            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS);
            expect(readSpy).toHaveBeenCalledTimes(1);
            expect(onTokenUsage).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS);
            expect(onTokenUsage).toHaveBeenCalledTimes(1);

            release();
            const result = await pending;
            expect(result.success).toBe(true);
        } finally {
            svc.dispose();
            vi.useRealTimers();
        }
    });

    it('treats a missing rollout file mid-turn as a silent no-op', async () => {
        vi.useFakeTimers();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const readSpy = vi.fn(async () => undefined);
        const svc = makeService(makeHeldCodexMock(held), readSpy);
        const onTokenUsage = vi.fn();

        try {
            const pending = svc.sendMessage({ prompt: 'test', model: 'gpt-5.4', onTokenUsage });

            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS * 3);
            expect(readSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(onTokenUsage).not.toHaveBeenCalled();

            release();
            const result = await pending;
            expect(result.success).toBe(true);
            // Registry fallback, exactly as before this feature.
            expect(result.tokenUsage?.tokenLimit).toBe(272_000);
            expect(result.tokenUsage?.currentTokens).toBe(1250);
        } finally {
            svc.dispose();
            vi.useRealTimers();
        }
    });

    it('never polls when the caller supplied no onTokenUsage callback', async () => {
        vi.useFakeTimers();
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const readSpy = vi.fn(async () => ({ currentTokens: 1, tokenLimit: 2, rolloutPath: '/tmp/r.jsonl' }));
        const svc = makeService(makeHeldCodexMock(held), readSpy);

        try {
            const pending = svc.sendMessage({ prompt: 'test', model: 'gpt-5.4' });

            await vi.advanceTimersByTimeAsync(MID_TURN_TOKEN_USAGE_INTERVAL_MS * 4);
            expect(readSpy).not.toHaveBeenCalled();

            release();
            const result = await pending;
            expect(result.success).toBe(true);
            // Only the pre-existing turn-end read.
            expect(readSpy).toHaveBeenCalledTimes(1);
        } finally {
            svc.dispose();
            vi.useRealTimers();
        }
    });
});

// Returns a stub matching the readCodexRolloutContextUsage signature that always
// resolves to a fixed usage carrying `rolloutPath`, so the service caches it.
function readCodexRolloutContextUsageSpyImpl(rolloutPath: string) {
    return async (
        _threadId: string,
        _opts: { sessionsRoot: string; cachedPath?: string },
    ) => ({ currentTokens: 70_000, tokenLimit: 258_400, rolloutPath });
}

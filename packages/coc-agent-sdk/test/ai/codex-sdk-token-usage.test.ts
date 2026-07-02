import { describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';

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
        // gpt-5.4 has a registry contextWindow (128k). currentTokens is the
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
        expect(result.tokenUsage?.tokenLimit).toBe(128_000);
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
        expect(result.tokenUsage?.tokenLimit).toBe(128_000);
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
        expect(result.tokenUsage?.tokenLimit).toBe(128_000);
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

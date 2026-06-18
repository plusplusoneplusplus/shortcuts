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

async function sendWithEvents(events: Array<Record<string, unknown>>) {
    const svc = new CodexSDKService();
    const { client } = makeCodexMock(events);
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        return await svc.sendMessage({ prompt: 'test' });
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

    it('populates per-turn fields but leaves context-window fields undefined (no native Codex signal)', async () => {
        // Codex exposes no native context-window signal, so the per-turn mapping
        // must never fabricate the context meter. Guards the documented Codex
        // limitation: tokenLimit/currentTokens (and the rest of the breakdown)
        // stay undefined even when per-turn usage is reported.
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
        // Context-window fields are never populated for Codex.
        expect(result.tokenUsage?.tokenLimit).toBeUndefined();
        expect(result.tokenUsage?.currentTokens).toBeUndefined();
        expect(result.tokenUsage?.systemTokens).toBeUndefined();
        expect(result.tokenUsage?.toolDefinitionsTokens).toBeUndefined();
        expect(result.tokenUsage?.conversationTokens).toBeUndefined();
    });
});

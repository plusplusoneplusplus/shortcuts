/**
 * Token Usage Serialization Tests
 *
 * Tests that tokenUsage on ConversationTurn and token tracking fields on
 * AIProcess are correctly preserved through serializeProcess / deserializeProcess.
 */

import { describe, it, expect } from 'vitest';
import { serializeProcess, deserializeProcess } from '../../src/ai/process-types';
import type { AIProcess, ConversationTurn } from '../../src/ai/process-types';
import type { TokenUsage } from '../../src/copilot-sdk-wrapper/types';

function makeProcess(overrides?: Partial<AIProcess>): AIProcess {
    return {
        id: 'test-token',
        type: 'chat',
        promptPreview: 'hello',
        fullPrompt: 'hello world',
        status: 'completed',
        startTime: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    };
}

const sampleTokenUsage: TokenUsage = {
    inputTokens: 1234,
    outputTokens: 5678,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
    totalTokens: 6912,
    turnCount: 1,
    tokenLimit: 200_000,
    currentTokens: 42_000,
};

describe('ConversationTurn.tokenUsage serialization', () => {
    it('round-trips tokenUsage on an assistant turn', () => {
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Here is the answer',
            timestamp: new Date('2026-01-01T00:00:01Z'),
            turnIndex: 1,
            timeline: [],
            tokenUsage: sampleTokenUsage,
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].tokenUsage).toMatchObject({
            inputTokens: 1234,
            outputTokens: 5678,
            cacheReadTokens: 100,
            cacheWriteTokens: 50,
            totalTokens: 6912,
            turnCount: 1,
            tokenLimit: 200_000,
            currentTokens: 42_000,
        });

        const deserialized = deserializeProcess(serialized);
        const dTurn = deserialized.conversationTurns![0];
        expect(dTurn.tokenUsage).toBeDefined();
        expect(dTurn.tokenUsage!.inputTokens).toBe(1234);
        expect(dTurn.tokenUsage!.outputTokens).toBe(5678);
        expect(dTurn.tokenUsage!.totalTokens).toBe(6912);
        expect(dTurn.tokenUsage!.tokenLimit).toBe(200_000);
        expect(dTurn.tokenUsage!.currentTokens).toBe(42_000);
    });

    it('tokenUsage is undefined when not set (backward compat)', () => {
        const turn: ConversationTurn = {
            role: 'user',
            content: 'Hello',
            timestamp: new Date('2026-01-01T00:00:00Z'),
            turnIndex: 0,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        expect(deserialized.conversationTurns![0].tokenUsage).toBeUndefined();
    });

    it('preserves partial tokenUsage (no cache tokens)', () => {
        const partialUsage: TokenUsage = {
            inputTokens: 500,
            outputTokens: 300,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 800,
            turnCount: 1,
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Answer',
            timestamp: new Date('2026-01-01T00:00:01Z'),
            turnIndex: 0,
            timeline: [],
            tokenUsage: partialUsage,
        };
        const deserialized = deserializeProcess(serializeProcess(makeProcess({ conversationTurns: [turn] })));
        const du = deserialized.conversationTurns![0].tokenUsage!;
        expect(du.inputTokens).toBe(500);
        expect(du.outputTokens).toBe(300);
        expect(du.totalTokens).toBe(800);
        expect(du.tokenLimit).toBeUndefined();
        expect(du.currentTokens).toBeUndefined();
    });
});

describe('AIProcess context window tracking fields serialization', () => {
    it('round-trips tokenLimit and currentTokens', () => {
        const process = makeProcess({
            tokenLimit: 200_000,
            currentTokens: 50_000,
        });

        const serialized = serializeProcess(process);
        expect(serialized.tokenLimit).toBe(200_000);
        expect(serialized.currentTokens).toBe(50_000);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.tokenLimit).toBe(200_000);
        expect(deserialized.currentTokens).toBe(50_000);
    });

    it('round-trips cumulativeTokenUsage', () => {
        const cumulative: TokenUsage = {
            inputTokens: 3000,
            outputTokens: 1500,
            cacheReadTokens: 200,
            cacheWriteTokens: 100,
            totalTokens: 4500,
            turnCount: 3,
        };
        const process = makeProcess({ cumulativeTokenUsage: cumulative });

        const serialized = serializeProcess(process);
        expect(serialized.cumulativeTokenUsage).toMatchObject({
            inputTokens: 3000,
            outputTokens: 1500,
            turnCount: 3,
        });

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.cumulativeTokenUsage!.inputTokens).toBe(3000);
        expect(deserialized.cumulativeTokenUsage!.outputTokens).toBe(1500);
        expect(deserialized.cumulativeTokenUsage!.turnCount).toBe(3);
    });

    it('tokenLimit/currentTokens/cumulativeTokenUsage are undefined when not set (backward compat)', () => {
        const process = makeProcess();
        const deserialized = deserializeProcess(serializeProcess(process));
        expect(deserialized.tokenLimit).toBeUndefined();
        expect(deserialized.currentTokens).toBeUndefined();
        expect(deserialized.cumulativeTokenUsage).toBeUndefined();
    });
});

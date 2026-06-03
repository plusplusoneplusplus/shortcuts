import { describe, expect, it } from 'vitest';
import {
    estimateCopilotTokenCost,
    getCopilotModelPricing,
    normalizeCopilotModelId,
} from '../../src/ai/copilot-token-cost';

describe('Copilot token cost pricing', () => {
    it('looks up pricing by normalized model ID', () => {
        expect(normalizeCopilotModelId('GPT-5.3-Codex')).toBe('gpt-5.3-codex');
        expect(getCopilotModelPricing('GPT-5.5')?.modelId).toBe('gpt-5.5');
        expect(getCopilotModelPricing('Claude Sonnet 4.6')?.modelId).toBe('claude-sonnet-4.6');
        expect(getCopilotModelPricing('CLAUDE-OPUS-4.8')?.modelId).toBe('claude-opus-4.8');
    });

    it('calculates cost with cached input', () => {
        const cost = estimateCopilotTokenCost('gpt-5.5', {
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            cacheReadTokens: 250_000,
            cacheWriteTokens: 0,
        });

        expect(cost).toBeDefined();
        expect(cost!.inputUsd).toBeCloseTo(3.75);
        expect(cost!.cachedInputUsd).toBeCloseTo(0.125);
        expect(cost!.outputUsd).toBeCloseTo(15);
        expect(cost!.totalUsd).toBeCloseTo(18.875);
    });

    it('uses Anthropic cache-write pricing', () => {
        const cost = estimateCopilotTokenCost('claude-sonnet-4.6', {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 200_000,
        });

        expect(cost).toBeDefined();
        expect(cost!.inputUsd).toBeCloseTo(2.4);
        expect(cost!.cacheWriteUsd).toBeCloseTo(0.75);
        expect(cost!.totalUsd).toBeCloseTo(3.15);
    });

    it('prices Claude Opus 4.8 cached input instead of treating it as unknown', () => {
        const cost = estimateCopilotTokenCost('CLAUDE-OPUS-4.8', {
            inputTokens: 21_487_300,
            outputTokens: 97_100,
            cacheReadTokens: 21_000_000,
            cacheWriteTokens: 0,
        });

        expect(cost).toBeDefined();
        expect(cost!.inputUsd).toBeCloseTo(2.4365);
        expect(cost!.cachedInputUsd).toBeCloseTo(10.5);
        expect(cost!.outputUsd).toBeCloseTo(2.4275);
        expect(cost!.totalUsd).toBeCloseTo(15.364);
    });

    it('treats cache writes as normal input when no cache-write rate exists', () => {
        const cost = estimateCopilotTokenCost('gpt-5-mini', {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 200_000,
        });

        expect(cost).toBeDefined();
        expect(cost!.inputUsd).toBeCloseTo(0.2);
        expect(cost!.cacheWriteUsd).toBeCloseTo(0.05);
        expect(cost!.totalUsd).toBeCloseTo(0.25);
    });

    it('returns undefined for unknown models', () => {
        expect(estimateCopilotTokenCost('unknown-model', {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        })).toBeUndefined();
    });
});

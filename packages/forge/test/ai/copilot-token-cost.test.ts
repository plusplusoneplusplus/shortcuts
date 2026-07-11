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

    it('maps dated and suffixed Codex IDs onto existing pricing entries', () => {
        expect(normalizeCopilotModelId('gpt-5-3-codex-2026-01-15')).toBe('gpt-5.3-codex');
        expect(getCopilotModelPricing('gpt-5.3-codex-high')?.modelId).toBe('gpt-5.3-codex');
        expect(getCopilotModelPricing('GPT 5.2 Codex 20260115')?.modelId).toBe('gpt-5.2-codex');
    });

    it('maps Claude CLI, dated, and reasoning-suffixed IDs onto existing pricing entries', () => {
        expect(normalizeCopilotModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
        expect(getCopilotModelPricing('claude-sonnet-4-5-20250929')?.modelId).toBe('claude-sonnet-4.5');
        expect(getCopilotModelPricing('claude-opus-4-8-xhigh')?.modelId).toBe('claude-opus-4.8');
        expect(getCopilotModelPricing('Claude Haiku 4 5 latest')?.modelId).toBe('claude-haiku-4.5');
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

    it.each([
        ['GPT 5.6 Luna', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'Lightweight', 1, 0.1, 6],
        ['GPT 5.6 Sol', 'gpt-5.6-sol', 'GPT-5.6 Sol', 'Powerful', 5, 0.5, 30],
        ['GPT 5.6 Terra', 'gpt-5.6-terra', 'GPT-5.6 Terra', 'Versatile', 2.5, 0.25, 15],
    ] as const)('prices %s with its supported default-tier rates', (
        modelName,
        modelId,
        displayName,
        category,
        inputRate,
        cachedInputRate,
        outputRate
    ) => {
        expect(normalizeCopilotModelId(modelName)).toBe(modelId);
        expect(getCopilotModelPricing(modelId)).toMatchObject({
            modelId,
            displayName,
            provider: 'openai',
            releaseStatus: 'GA',
            category,
            usdPerMillionInputTokens: inputRate,
            usdPerMillionCachedInputTokens: cachedInputRate,
            usdPerMillionOutputTokens: outputRate,
        });

        const cost = estimateCopilotTokenCost(modelId, {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        });

        expect(cost).toBeDefined();
        expect(cost!.totalUsd).toBeCloseTo(inputRate + outputRate);
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
        expect(getCopilotModelPricing('claude-opus-4-1-20250805')).toBeUndefined();
    });
});

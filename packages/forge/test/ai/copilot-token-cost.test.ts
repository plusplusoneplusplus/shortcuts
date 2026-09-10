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
        expect(getCopilotModelPricing('Claude Opus 5')?.modelId).toBe('claude-opus-5');
    });

    it('prices Claude Opus 5 and its reasoning-suffixed IDs', () => {
        expect(getCopilotModelPricing('claude-opus-5-xhigh')?.modelId).toBe('claude-opus-5');
        expect(getCopilotModelPricing('claude-opus-5')).toMatchObject({
            modelId: 'claude-opus-5',
            displayName: 'Claude Opus 5',
            provider: 'anthropic',
            category: 'Powerful',
            usdPerMillionInputTokens: 5,
            usdPerMillionCachedInputTokens: 0.5,
            usdPerMillionCacheWriteTokens: 6.25,
            usdPerMillionOutputTokens: 25,
        });

        const cost = estimateCopilotTokenCost('claude-opus-5', {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        });
        expect(cost).toBeDefined();
        expect(cost!.totalUsd).toBeCloseTo(30);
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
        ['GPT 5.6 Luna', 'gpt-5.6-luna', 'GPT-5.6 Luna', 'Lightweight', 0.2, 0.02, 0.25, 1.2],
        ['GPT 5.6 Sol', 'gpt-5.6-sol', 'GPT-5.6 Sol', 'Powerful', 4, 0.4, 5, 20],
        ['GPT 5.6 Terra', 'gpt-5.6-terra', 'GPT-5.6 Terra', 'Versatile', 2, 0.2, 2.5, 12],
        ['GPT 6 Astra', 'gpt-6-astra', 'GPT-6 Astra', 'Powerful', 10, 1, 12.5, 50],
    ] as const)('prices %s with its supported default-tier rates', (
        modelName,
        modelId,
        displayName,
        category,
        inputRate,
        cachedInputRate,
        cacheWriteRate,
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
            usdPerMillionCacheWriteTokens: cacheWriteRate,
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

    // Regression: these rows drifted from the published Copilot pricing table
    // (GPT-5.6 Luna/Sol/Terra were stored at superseded rates, and the newer
    // Anthropic, Google, Microsoft, xAI, and Moonshot models were missing
    // entirely, so their turns showed no cost at all).
    it.each([
        ['claude-sonnet-5', 'Claude Sonnet 5', 'anthropic', 2, 0.2, 10],
        ['claude-fable-5', 'Claude Fable 5', 'anthropic', 10, 1, 50],
        ['claude-fable-5.1', 'Claude Fable 5.1', 'anthropic', 10, 0.25, 50],
        ['gemini-3.5-flash', 'Gemini 3.5 Flash', 'google', 1.5, 0.15, 9],
        ['gemini-3.6-flash', 'Gemini 3.6 Flash', 'google', 0.75, 0.075, 3.75],
        ['gemini-3.7-flash', 'Gemini 3.7 Flash', 'google', 0.75, 0.075, 3.75],
        ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'google', 0.75, 0.075, 3.75],
        ['mai-code-1-flash', 'MAI-Code-1-Flash', 'microsoft', 0.75, 0.075, 4.5],
        ['mai-code-1.1-flash', 'MAI-Code-1.1-Flash', 'microsoft', 0.2, 0.02, 1.2],
        ['grok-4.5', 'Grok 4.5', 'xai', 2, 0.5, 6],
        ['grok-4.6', 'Grok 4.6', 'xai', 2, 0.5, 6],
        ['kimi-k2.7-code', 'Kimi K2.7 Code', 'moonshot', 0.95, 0.19, 4],
        ['kimi-k3', 'Kimi K3', 'moonshot', 3, 0.3, 15],
    ] as const)('prices %s at its published rates', (
        modelId,
        displayName,
        provider,
        inputRate,
        cachedInputRate,
        outputRate
    ) => {
        expect(getCopilotModelPricing(modelId)).toMatchObject({
            modelId,
            displayName,
            provider,
            releaseStatus: 'GA',
            usdPerMillionInputTokens: inputRate,
            usdPerMillionCachedInputTokens: cachedInputRate,
            usdPerMillionOutputTokens: outputRate,
        });

        const cost = estimateCopilotTokenCost(modelId, {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 500_000,
            cacheWriteTokens: 0,
        });

        expect(cost).toBeDefined();
        expect(cost!.totalUsd).toBeCloseTo(inputRate / 2 + cachedInputRate / 2 + outputRate);
    });

    // Regression: the Claude CLI reports Fable with a hyphenated version
    // ('claude-fable-5-1'), which the dotted-version fallback used to skip
    // because it only knew the opus/sonnet/haiku families.
    it('maps hyphenated Claude Fable CLI IDs onto their pricing entries', () => {
        expect(normalizeCopilotModelId('claude-fable-5-1')).toBe('claude-fable-5.1');
        expect(getCopilotModelPricing('claude-fable-5-1-xhigh')?.modelId).toBe('claude-fable-5.1');
        expect(getCopilotModelPricing('Claude Fable 5')?.modelId).toBe('claude-fable-5');
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

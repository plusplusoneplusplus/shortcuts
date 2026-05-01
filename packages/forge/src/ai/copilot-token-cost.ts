import { COPILOT_MODEL_PRICING, COPILOT_PRICING_SOURCE } from './copilot-pricing-data';
import type { CopilotModelPricing } from './copilot-pricing-data';

export interface CopilotTokenCostBreakdown {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
    totalUsd: number;
    pricingSource: string;
}

export function normalizeCopilotModelId(modelId: string): string {
    return modelId
        .trim()
        .toLowerCase()
        .replace(/\[[^\]]*\]/g, '')
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function getCopilotModelPricing(modelId: string): CopilotModelPricing | undefined {
    const normalizedModelId = normalizeCopilotModelId(modelId);
    return COPILOT_MODEL_PRICING.find(pricing => pricing.modelId === normalizedModelId);
}

export function estimateCopilotTokenCost(
    modelId: string,
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
    }
): CopilotTokenCostBreakdown | undefined {
    const pricing = getCopilotModelPricing(modelId);
    if (!pricing) {
        return undefined;
    }

    const nonCachedInputTokens = Math.max(
        0,
        usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
    );
    const cacheWriteRate = pricing.usdPerMillionCacheWriteTokens ?? pricing.usdPerMillionInputTokens;
    const inputUsd = nonCachedInputTokens / 1_000_000 * pricing.usdPerMillionInputTokens;
    const cachedInputUsd = usage.cacheReadTokens / 1_000_000 * pricing.usdPerMillionCachedInputTokens;
    const cacheWriteUsd = usage.cacheWriteTokens / 1_000_000 * cacheWriteRate;
    const outputUsd = usage.outputTokens / 1_000_000 * pricing.usdPerMillionOutputTokens;

    return {
        inputUsd,
        cachedInputUsd,
        cacheWriteUsd,
        outputUsd,
        totalUsd: inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd,
        pricingSource: COPILOT_PRICING_SOURCE,
    };
}

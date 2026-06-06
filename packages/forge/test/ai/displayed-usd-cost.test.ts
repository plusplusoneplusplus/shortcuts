import { describe, expect, it } from 'vitest';
import { resolveDisplayedUsdCost, withDisplayedUsdCost } from '../../src/ai/displayed-usd-cost';
import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
    return {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        turnCount: 1,
        ...overrides,
    };
}

describe('resolveDisplayedUsdCost', () => {
    it('prefers provider-native USD over estimated USD', () => {
        expect(resolveDisplayedUsdCost({
            actualUsdCost: 0.0123,
            estimatedUsdCost: 9.99,
        })).toEqual({ usd: 0.0123, source: 'native' });
    });

    it('uses estimated USD when provider-native USD is absent', () => {
        expect(resolveDisplayedUsdCost({
            estimatedUsdCost: 0.0456,
        })).toEqual({ usd: 0.0456, source: 'estimated' });
    });

    it('never treats Copilot premium-unit cost as displayed USD', () => {
        const premiumUnitsOnly = { cost: 42 };
        const premiumUnitsWithEstimate = { cost: 42, estimatedUsdCost: 0.25 };

        expect(resolveDisplayedUsdCost(premiumUnitsOnly)).toBeUndefined();
        expect(resolveDisplayedUsdCost(premiumUnitsWithEstimate)).toEqual({ usd: 0.25, source: 'estimated' });
    });
});

describe('withDisplayedUsdCost', () => {
    it('adds native-first display fields to token usage', () => {
        expect(withDisplayedUsdCost(usage({
            actualUsdCost: 0.5,
            estimatedUsdCost: 2,
            cost: 10,
        }))).toMatchObject({
            actualUsdCost: 0.5,
            estimatedUsdCost: 2,
            cost: 10,
            displayedUsdCost: 0.5,
            displayedUsdCostSource: 'native',
        });
    });
});

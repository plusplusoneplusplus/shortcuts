import { describe, expect, it } from 'vitest';
import { estimateCopilotTokenCost } from '../../src/ai/copilot-token-cost';
import { computeConversationCostEstimate } from '../../src/ai/conversation-cost-estimate';
import type { ConversationTurn } from '../../src/ai/process-types';
import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';

const baseTime = new Date('2026-06-06T00:00:00Z');

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
    return {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 50_000,
        totalTokens: 1_500_000,
        turnCount: 1,
        ...overrides,
    };
}

function turn(role: 'user' | 'assistant', turnIndex: number, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
        role,
        content: role === 'user' ? 'question' : 'answer',
        timestamp: baseTime,
        turnIndex,
        timeline: [],
        ...overrides,
    };
}

describe('computeConversationCostEstimate', () => {
    it('sums a single-model conversation from per-turn estimates', () => {
        const firstUsage = usage({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
        const secondUsage = usage({ inputTokens: 2_000_000, outputTokens: 200_000, cacheReadTokens: 250_000, cacheWriteTokens: 0 });

        const estimate = computeConversationCostEstimate([
            turn('user', 0),
            turn('assistant', 1, { tokenUsage: firstUsage }),
            turn('user', 2),
            turn('assistant', 3, { tokenUsage: secondUsage }),
        ], 'gpt-5.5');

        const firstCost = estimateCopilotTokenCost('gpt-5.5', firstUsage)!;
        const secondCost = estimateCopilotTokenCost('gpt-5.5', secondUsage)!;

        expect(estimate).toBeDefined();
        expect(estimate!.estimatedUsdCost).toBeCloseTo(firstCost.totalUsd + secondCost.totalUsd);
        expect(estimate!.costBreakdown.inputUsd).toBeCloseTo(firstCost.inputUsd + secondCost.inputUsd);
        expect(estimate!.costBreakdown.cachedInputUsd).toBeCloseTo(firstCost.cachedInputUsd + secondCost.cachedInputUsd);
        expect(estimate!.costBreakdown.outputUsd).toBeCloseTo(firstCost.outputUsd + secondCost.outputUsd);
        expect(estimate!.unpricedTurnCount).toBe(0);
        expect(estimate!.pricingUnavailable).toBe(false);
        expect(estimate!.pricingSource).toBe(firstCost.pricingSource);
    });

    it('prices each assistant turn at the active model after user-turn model overrides', () => {
        const firstUsage = usage({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        const secondUsage = usage({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

        const estimate = computeConversationCostEstimate([
            turn('user', 0),
            turn('assistant', 1, { tokenUsage: firstUsage }),
            turn('user', 2, { model: 'gpt-5-mini' }),
            turn('assistant', 3, { tokenUsage: secondUsage }),
        ], 'gpt-5.5');

        const defaultModelCost = estimateCopilotTokenCost('gpt-5.5', firstUsage)!;
        const overrideModelCost = estimateCopilotTokenCost('gpt-5-mini', secondUsage)!;

        expect(estimate).toBeDefined();
        expect(estimate!.estimatedUsdCost).toBeCloseTo(defaultModelCost.totalUsd + overrideModelCost.totalUsd);
        expect(estimate!.costBreakdown.inputUsd).toBeCloseTo(defaultModelCost.inputUsd + overrideModelCost.inputUsd);
        expect(estimate!.unpricedTurnCount).toBe(0);
    });

    it('returns undefined when no turn has token usage', () => {
        expect(computeConversationCostEstimate([
            turn('user', 0),
            turn('assistant', 1),
        ], 'gpt-5.5')).toBeUndefined();
    });

    it('reports pricing unavailable when all usage-bearing turns use unpriced models', () => {
        const estimate = computeConversationCostEstimate([
            turn('user', 0),
            turn('assistant', 1, { tokenUsage: usage() }),
        ], 'unknown-model');

        expect(estimate).toEqual({
            estimatedUsdCost: 0,
            costBreakdown: {
                inputUsd: 0,
                cachedInputUsd: 0,
                cacheWriteUsd: 0,
                outputUsd: 0,
            },
            pricingSource: undefined,
            unpricedTurnCount: 1,
            pricingUnavailable: true,
        });
    });

    it('sums priced turns and counts unpriced turns for mixed pricing availability', () => {
        const pricedUsage = usage({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        const pricedCost = estimateCopilotTokenCost('gpt-5.5', pricedUsage)!;

        const estimate = computeConversationCostEstimate([
            turn('user', 0, { model: 'gpt-5.5' }),
            turn('assistant', 1, { tokenUsage: pricedUsage }),
            turn('user', 2, { model: 'unknown-model' }),
            turn('assistant', 3, { tokenUsage: usage() }),
        ]);

        expect(estimate).toBeDefined();
        expect(estimate!.estimatedUsdCost).toBeCloseTo(pricedCost.totalUsd);
        expect(estimate!.costBreakdown.inputUsd).toBeCloseTo(pricedCost.inputUsd);
        expect(estimate!.unpricedTurnCount).toBe(1);
        expect(estimate!.pricingUnavailable).toBe(false);
    });

    it('uses native USD for display while preserving token estimates', () => {
        const turnUsage = usage({
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            actualUsdCost: 0.0123,
            cost: 99,
        });
        const estimated = estimateCopilotTokenCost('claude-sonnet-4.6', turnUsage)!;

        const estimate = computeConversationCostEstimate([
            turn('user', 0),
            turn('assistant', 1, { tokenUsage: turnUsage }),
        ], 'claude-sonnet-4.6');

        expect(estimate).toBeDefined();
        expect(estimate!.actualUsdCost).toBeCloseTo(0.0123);
        expect(estimate!.estimatedUsdCost).toBeCloseTo(estimated.totalUsd);
        expect(estimate!.displayedUsdCost).toBeCloseTo(0.0123);
        expect(estimate!.displayedUsdCostSource).toBe('native');
    });
});

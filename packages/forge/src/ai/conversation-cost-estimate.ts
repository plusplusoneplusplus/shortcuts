import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ConversationTurn } from './process-interfaces';
import { estimateCopilotTokenCost } from './copilot-token-cost';

export interface ConversationCostBreakdown {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
}

export interface ConversationCostEstimate {
    estimatedUsdCost: number;
    costBreakdown: ConversationCostBreakdown;
    pricingSource?: string;
    unpricedTurnCount: number;
    pricingUnavailable: boolean;
}

function emptyBreakdown(): ConversationCostBreakdown {
    return {
        inputUsd: 0,
        cachedInputUsd: 0,
        cacheWriteUsd: 0,
        outputUsd: 0,
    };
}

function hasUsage(usage: TokenUsage | undefined): usage is TokenUsage {
    return !!usage && (
        usage.inputTokens > 0 ||
        usage.outputTokens > 0 ||
        usage.cacheReadTokens > 0 ||
        usage.cacheWriteTokens > 0 ||
        usage.totalTokens > 0
    );
}

/**
 * Estimate a conversation cost by walking turns in order and pricing each
 * assistant turn's usage at the model active for that turn.
 */
export function computeConversationCostEstimate(
    turns: readonly ConversationTurn[] | undefined,
    defaultModel?: string
): ConversationCostEstimate | undefined {
    let currentModel = defaultModel?.trim() || undefined;
    const costBreakdown = emptyBreakdown();
    let estimatedUsdCost = 0;
    let pricedTurnCount = 0;
    let unpricedTurnCount = 0;
    let pricingSource: string | undefined;

    for (const turn of turns ?? []) {
        if (turn.role === 'user' && typeof turn.model === 'string' && turn.model.trim()) {
            currentModel = turn.model.trim();
            continue;
        }

        if (turn.role !== 'assistant' || !hasUsage(turn.tokenUsage)) {
            continue;
        }

        if (!currentModel) {
            unpricedTurnCount += 1;
            continue;
        }

        const estimate = estimateCopilotTokenCost(currentModel, turn.tokenUsage);
        if (!estimate) {
            unpricedTurnCount += 1;
            continue;
        }

        pricedTurnCount += 1;
        pricingSource = pricingSource ?? estimate.pricingSource;
        estimatedUsdCost += estimate.totalUsd;
        costBreakdown.inputUsd += estimate.inputUsd;
        costBreakdown.cachedInputUsd += estimate.cachedInputUsd;
        costBreakdown.cacheWriteUsd += estimate.cacheWriteUsd;
        costBreakdown.outputUsd += estimate.outputUsd;
    }

    if (pricedTurnCount === 0 && unpricedTurnCount === 0) {
        return undefined;
    }

    return {
        estimatedUsdCost,
        costBreakdown,
        pricingSource,
        unpricedTurnCount,
        pricingUnavailable: pricedTurnCount === 0,
    };
}

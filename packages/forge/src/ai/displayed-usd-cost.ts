import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';

export type DisplayedUsdCostSource = 'native' | 'estimated';

export interface DisplayedUsdCostInput {
    cost?: number;
    actualUsdCost?: number;
    estimatedUsdCost?: number;
}

export interface DisplayedUsdCost {
    usd: number;
    source: DisplayedUsdCostSource;
}

function finiteUsd(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function resolveDisplayedUsdCost(input: DisplayedUsdCostInput): DisplayedUsdCost | undefined {
    const actualUsdCost = finiteUsd(input.actualUsdCost);
    if (actualUsdCost !== undefined) {
        return { usd: actualUsdCost, source: 'native' };
    }

    const estimatedUsdCost = finiteUsd(input.estimatedUsdCost);
    if (estimatedUsdCost !== undefined) {
        return { usd: estimatedUsdCost, source: 'estimated' };
    }

    return undefined;
}

export function withDisplayedUsdCost(usage: TokenUsage): TokenUsage {
    const result: TokenUsage = { ...usage };
    const displayed = resolveDisplayedUsdCost(result);
    if (!displayed) {
        delete result.displayedUsdCost;
        delete result.displayedUsdCostSource;
        return result;
    }

    result.displayedUsdCost = displayed.usd;
    result.displayedUsdCostSource = displayed.source;
    return result;
}

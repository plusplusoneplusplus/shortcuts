import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';
import type { SerializedAIProcess } from './process-types';
import { estimateCopilotTokenCost } from './copilot-token-cost';
import { withDisplayedUsdCost } from './displayed-usd-cost';

export interface TokenUsageStatsEntry {
    date: string;                        // YYYY-MM-DD (UTC)
    byModel: Record<string, TokenUsage>; // model name → aggregated TokenUsage for that day
    dayTotal: TokenUsage;                // sum across all models for that day
}

export interface TokenUsageStatsResponse {
    entries: TokenUsageStatsEntry[];     // sorted by date DESC
    models: string[];                    // sorted (asc) deduplicated list of all models seen
    generatedAt: string;                 // new Date().toISOString() at call time
    totalDays: number;                   // entries.length
}

function emptyUsage(): TokenUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        turnCount: 0,
        // cost and duration intentionally omitted (undefined)
    };
}

interface Accumulator {
    usage: TokenUsage;
    hasCost: boolean;
    hasDuration: boolean;
    hasActualUsdCost: boolean;
    hasEstimatedUsdCost: boolean;
    hasDisplayedUsdCost: boolean;
    hasCostBreakdown: boolean;
    pricingSources: Set<string>;
    displayedUsdCostSources: Set<NonNullable<TokenUsage['displayedUsdCostSource']>>;
    pricingUnavailable: boolean;
}

function newAccumulator(): Accumulator {
    return {
        usage: emptyUsage(),
        hasCost: false,
        hasDuration: false,
        hasActualUsdCost: false,
        hasEstimatedUsdCost: false,
        hasDisplayedUsdCost: false,
        hasCostBreakdown: false,
        pricingSources: new Set(),
        displayedUsdCostSources: new Set(),
        pricingUnavailable: false,
    };
}

function addToAccumulator(acc: Accumulator, src: TokenUsage): void {
    acc.usage.inputTokens += src.inputTokens;
    acc.usage.outputTokens += src.outputTokens;
    acc.usage.cacheReadTokens += src.cacheReadTokens;
    acc.usage.cacheWriteTokens += src.cacheWriteTokens;
    acc.usage.totalTokens += src.totalTokens;
    acc.usage.turnCount += src.turnCount;

    if (src.cost !== undefined) {
        acc.hasCost = true;
        acc.usage.cost = (acc.usage.cost ?? 0) + src.cost;
    }
    if (src.duration !== undefined) {
        acc.hasDuration = true;
        acc.usage.duration = (acc.usage.duration ?? 0) + src.duration;
    }
    if (src.actualUsdCost !== undefined) {
        acc.hasActualUsdCost = true;
        acc.usage.actualUsdCost = (acc.usage.actualUsdCost ?? 0) + src.actualUsdCost;
    }
    if (src.estimatedUsdCost !== undefined) {
        acc.hasEstimatedUsdCost = true;
        acc.usage.estimatedUsdCost = (acc.usage.estimatedUsdCost ?? 0) + src.estimatedUsdCost;
    }
    if (src.displayedUsdCost !== undefined) {
        acc.hasDisplayedUsdCost = true;
        acc.usage.displayedUsdCost = (acc.usage.displayedUsdCost ?? 0) + src.displayedUsdCost;
    }
    if (src.costBreakdown !== undefined) {
        acc.hasCostBreakdown = true;
        const existing = acc.usage.costBreakdown ?? {
            inputUsd: 0,
            cachedInputUsd: 0,
            cacheWriteUsd: 0,
            outputUsd: 0,
        };
        acc.usage.costBreakdown = {
            inputUsd: existing.inputUsd + src.costBreakdown.inputUsd,
            cachedInputUsd: existing.cachedInputUsd + src.costBreakdown.cachedInputUsd,
            cacheWriteUsd: existing.cacheWriteUsd + src.costBreakdown.cacheWriteUsd,
            outputUsd: existing.outputUsd + src.costBreakdown.outputUsd,
        };
    }
    if (src.pricingSource !== undefined) {
        acc.pricingSources.add(src.pricingSource);
    }
    if (src.displayedUsdCostSource !== undefined) {
        acc.displayedUsdCostSources.add(src.displayedUsdCostSource);
    }
    if (src.pricingUnavailable) {
        acc.pricingUnavailable = true;
    }
}

function finalizeAccumulator(acc: Accumulator): TokenUsage {
    const result: TokenUsage = { ...acc.usage };
    if (!acc.hasCost) {
        delete result.cost;
    }
    if (!acc.hasDuration) {
        delete result.duration;
    }
    if (!acc.hasActualUsdCost) {
        delete result.actualUsdCost;
    }
    if (!acc.hasEstimatedUsdCost) {
        delete result.estimatedUsdCost;
    }
    if (acc.hasDisplayedUsdCost) {
        result.displayedUsdCostSource = acc.displayedUsdCostSources.size === 1
            ? Array.from(acc.displayedUsdCostSources)[0]
            : 'mixed';
    } else {
        delete result.displayedUsdCost;
        delete result.displayedUsdCostSource;
    }
    if (!acc.hasCostBreakdown) {
        delete result.costBreakdown;
    }
    if (acc.pricingSources.size > 0) {
        result.pricingSource = Array.from(acc.pricingSources).sort().join(', ');
    } else {
        delete result.pricingSource;
    }
    if (acc.pricingUnavailable) {
        result.pricingUnavailable = true;
    } else {
        delete result.pricingUnavailable;
    }
    return result;
}

function addEstimatedTokenCost(model: string, usage: TokenUsage): TokenUsage {
    const result: TokenUsage = { ...usage };
    const estimated = estimateCopilotTokenCost(model, result);
    if (!estimated) {
        result.pricingUnavailable = true;
        return withDisplayedUsdCost(result);
    }

    result.estimatedUsdCost = estimated.totalUsd;
    result.costBreakdown = {
        inputUsd: estimated.inputUsd,
        cachedInputUsd: estimated.cachedInputUsd,
        cacheWriteUsd: estimated.cacheWriteUsd,
        outputUsd: estimated.outputUsd,
    };
    result.pricingSource = estimated.pricingSource;
    return withDisplayedUsdCost(result);
}

export function aggregateTokenUsageStats(
    processes: SerializedAIProcess[],
    options?: { days?: number }
): TokenUsageStatsResponse {
    const now = Date.now();
    const cutoff = options?.days !== undefined ? now - options.days * 24 * 60 * 60 * 1000 : undefined;

    // Map<date, Map<model, Accumulator>>
    const byDate = new Map<string, Map<string, Accumulator>>();
    const allModels = new Set<string>();

    for (const process of processes) {
        if (!process.cumulativeTokenUsage) {
            continue;
        }

        const startMs = new Date(process.startTime).getTime();
        if (cutoff !== undefined && startMs < cutoff) {
            continue;
        }

        const date = new Date(process.startTime).toISOString().slice(0, 10);
        const model = (process.metadata?.model as string | undefined) ?? 'unknown';

        allModels.add(model);

        if (!byDate.has(date)) {
            byDate.set(date, new Map());
        }
        const dateMap = byDate.get(date)!;

        if (!dateMap.has(model)) {
            dateMap.set(model, newAccumulator());
        }
        addToAccumulator(dateMap.get(model)!, process.cumulativeTokenUsage);
    }

    const entries: TokenUsageStatsEntry[] = [];

    for (const [date, modelMap] of byDate) {
        const byModel: Record<string, TokenUsage> = {};
        const dayAcc = newAccumulator();

        for (const [model, acc] of modelMap) {
            const finalized = addEstimatedTokenCost(model, finalizeAccumulator(acc));
            byModel[model] = finalized;
            addToAccumulator(dayAcc, finalized);
        }

        entries.push({
            date,
            byModel,
            dayTotal: finalizeAccumulator(dayAcc),
        });
    }

    entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
        entries,
        models: Array.from(allModels).sort(),
        generatedAt: new Date().toISOString(),
        totalDays: entries.length,
    };
}

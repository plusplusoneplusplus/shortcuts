import type { TokenUsage } from '../copilot-sdk-wrapper/types';
import type { SerializedAIProcess } from './process-types';

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
}

function newAccumulator(): Accumulator {
    return { usage: emptyUsage(), hasCost: false, hasDuration: false };
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
}

function finalizeAccumulator(acc: Accumulator): TokenUsage {
    const result: TokenUsage = { ...acc.usage };
    if (!acc.hasCost) {
        delete result.cost;
    }
    if (!acc.hasDuration) {
        delete result.duration;
    }
    return result;
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
            const finalized = finalizeAccumulator(acc);
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

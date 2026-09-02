/**
 * Pure aggregation over raw {@link TurnPerformanceEvent} rows: groups events
 * by one or more dimensions and computes TTFT / TPS distributions
 * (p50/p90/p99/mean/min/max) per group. Percentiles are computed here rather
 * than in SQL (SQLite has no percentile builtin) so the function stays
 * unit-testable against fixtures — same shape as `aggregateTokenUsageStats`.
 *
 * Exclusion rules (missing data is NULL, never zero):
 * - Non-completed (errored/cancelled) events are excluded from all groups.
 * - Events without a first output are excluded from the TTFT distribution.
 * - Events without token usage are excluded from the TPS distributions.
 * Every exclusion is accounted for in `excludedEvents` — the response states
 * what it dropped, never silently truncates.
 */

import type { TurnPerformanceEvent } from './turn-performance-types';

// ============================================================================
// Types
// ============================================================================

export const TURN_PERFORMANCE_GROUP_BY_VALUES = [
    'provider',
    'model',
    'workspace',
    'kind',
    'turnIndex',
    'day',
] as const;

export type TurnPerformanceGroupBy = (typeof TURN_PERFORMANCE_GROUP_BY_VALUES)[number];

export function isTurnPerformanceGroupBy(value: string): value is TurnPerformanceGroupBy {
    return (TURN_PERFORMANCE_GROUP_BY_VALUES as readonly string[]).includes(value);
}

/** Distribution stats over one metric; all values null when `n` is 0. */
export interface TurnPerformanceDistribution {
    p50: number | null;
    p90: number | null;
    p99: number | null;
    mean: number | null;
    min: number | null;
    max: number | null;
    /** Number of events that contributed a value to this distribution. */
    n: number;
}

export interface TurnPerformanceGroup {
    /** Composite group key, one entry per requested dimension. */
    key: Record<string, string | number>;
    /** Completed events in the group (includes events missing TTFT or tokens). */
    turnCount: number;
    ttftMs: TurnPerformanceDistribution;
    tpsGeneration: TurnPerformanceDistribution;
    tpsWall: TurnPerformanceDistribution;
    /** Sum of known output tokens across the group. */
    outputTokens: number;
}

export interface TurnPerformanceStatsResponse {
    groups: TurnPerformanceGroup[];
    groupBy: TurnPerformanceGroupBy[];
    /** Day window echoed from the query; null when unbounded. */
    days: number | null;
    /** Completed events aggregated across all groups. */
    totalEvents: number;
    excludedEvents: {
        /** Errored/cancelled events, excluded from all groups. */
        nonCompleted: number;
        /** Completed events with no first output (TTFT unknown). */
        noFirstToken: number;
        /** Completed events with no reported token usage (TPS unknown). */
        noTokenUsage: number;
    };
    generatedAt: string;
}

export interface AggregateTurnPerformanceOptions {
    /** Dimensions forming the composite group key. Defaults to `['provider']`. */
    groupBy?: TurnPerformanceGroupBy[];
    /** Day window echoed back in the response (filtering happens store-side). */
    days?: number;
}

// ============================================================================
// Aggregation
// ============================================================================

/** Nearest-rank percentile over an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function distribution(values: number[]): TurnPerformanceDistribution {
    if (values.length === 0) {
        return { p50: null, p90: null, p99: null, mean: null, min: null, max: null, n: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p99: percentile(sorted, 99),
        mean: round3(sum / sorted.length),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        n: sorted.length,
    };
}

function dimensionValue(event: TurnPerformanceEvent, dim: TurnPerformanceGroupBy): string | number {
    switch (dim) {
        case 'provider':
            return event.provider ?? 'unknown';
        case 'model':
            return event.model ?? 'unknown';
        case 'workspace':
            return event.workspaceId ?? 'unknown';
        case 'kind':
            return event.kind ?? 'unknown';
        case 'turnIndex':
            return event.turnIndex;
        case 'day':
            return event.startedAt.slice(0, 10);
    }
}

export function aggregateTurnPerformance(
    events: TurnPerformanceEvent[],
    options?: AggregateTurnPerformanceOptions,
): TurnPerformanceStatsResponse {
    const groupBy: TurnPerformanceGroupBy[] =
        options?.groupBy && options.groupBy.length > 0 ? options.groupBy : ['provider'];

    let nonCompleted = 0;
    let noFirstToken = 0;
    let noTokenUsage = 0;

    interface Bucket {
        key: Record<string, string | number>;
        turnCount: number;
        ttft: number[];
        tpsGen: number[];
        tpsWall: number[];
        outputTokens: number;
    }
    const buckets = new Map<string, Bucket>();

    for (const event of events) {
        if (event.status !== 'completed') {
            nonCompleted++;
            continue;
        }

        const key: Record<string, string | number> = {};
        for (const dim of groupBy) {
            key[dim] = dimensionValue(event, dim);
        }
        // NUL is the delimiter on purpose: it cannot occur in any provider,
        // model, workspace or kind value, so composite keys can never collide
        // the way they could with a printable separator. Keep the escape
        // sequence rather than a literal 0x00 byte, or the file becomes
        // binary to git and invisible to grep.
        const mapKey = groupBy.map((dim) => String(key[dim])).join('\u0000');

        let bucket = buckets.get(mapKey);
        if (!bucket) {
            bucket = { key, turnCount: 0, ttft: [], tpsGen: [], tpsWall: [], outputTokens: 0 };
            buckets.set(mapKey, bucket);
        }

        bucket.turnCount++;
        if (event.ttftMs !== null) {
            bucket.ttft.push(event.ttftMs);
        } else {
            noFirstToken++;
        }
        if (event.outputTokens !== null) {
            bucket.outputTokens += event.outputTokens;
        } else {
            noTokenUsage++;
        }
        if (event.tpsGeneration !== null) {
            bucket.tpsGen.push(event.tpsGeneration);
        }
        if (event.tpsWall !== null) {
            bucket.tpsWall.push(event.tpsWall);
        }
    }

    const groups: TurnPerformanceGroup[] = Array.from(buckets.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, bucket]) => ({
            key: bucket.key,
            turnCount: bucket.turnCount,
            ttftMs: distribution(bucket.ttft),
            tpsGeneration: distribution(bucket.tpsGen),
            tpsWall: distribution(bucket.tpsWall),
            outputTokens: bucket.outputTokens,
        }));

    return {
        groups,
        groupBy,
        days: options?.days ?? null,
        totalEvents: events.length - nonCompleted,
        excludedEvents: { nonCompleted, noFirstToken, noTokenUsage },
        generatedAt: new Date().toISOString(),
    };
}

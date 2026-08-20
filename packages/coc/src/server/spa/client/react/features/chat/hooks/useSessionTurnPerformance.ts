import { useState, useEffect } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { TurnPerformanceStatsResponse } from '@plusplusoneplusplus/coc-client';

export interface SessionTurnPerformance {
    /** TTFT of the session's first assistant turn (turnIndex 0), or null when that row is absent. */
    firstTurnTtftMs: number | null;
    /** Median generation TPS across the session's completed turns, or null when no turn has usage. */
    medianTpsGeneration: number | null;
    turnCount: number;
}

/**
 * Collapse a `groupBy=turnIndex&processId=<id>` aggregation response into the
 * two per-session headline numbers. Each group holds exactly one turn, so its
 * p50 is that turn's exact value.
 */
export function deriveSessionTurnPerformance(
    response: TurnPerformanceStatsResponse | null | undefined
): SessionTurnPerformance | null {
    const groups = response?.groups;
    if (!Array.isArray(groups) || groups.length === 0) return null;

    let firstTurnTtftMs: number | null = null;
    const tpsValues: number[] = [];
    let turnCount = 0;
    for (const group of groups) {
        turnCount += group.turnCount;
        if (String(group.key?.turnIndex) === '0' && group.ttftMs?.p50 != null) {
            firstTurnTtftMs = group.ttftMs.p50;
        }
        if (group.tpsGeneration?.p50 != null) {
            tpsValues.push(group.tpsGeneration.p50);
        }
    }

    let medianTpsGeneration: number | null = null;
    if (tpsValues.length > 0) {
        tpsValues.sort((a, b) => a - b);
        const mid = Math.floor(tpsValues.length / 2);
        medianTpsGeneration = tpsValues.length % 2 === 1
            ? tpsValues[mid]
            : (tpsValues[mid - 1] + tpsValues[mid]) / 2;
    }

    if (firstTurnTtftMs == null && medianTpsGeneration == null) return null;
    return { firstTurnTtftMs, medianTpsGeneration, turnCount };
}

/**
 * Per-session latency/throughput for the chat surface. Fetches once per
 * processId (unbounded window — a session's rows must not age out of view)
 * and resolves to null when the session has no recorded metrics, so callers
 * can hide the display cleanly.
 */
export function useSessionTurnPerformance(processId: string | null | undefined): {
    data: SessionTurnPerformance | null;
    loading: boolean;
} {
    const [data, setData] = useState<SessionTurnPerformance | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!processId) {
            setData(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setData(null);
        (async () => {
            try {
                const response = await getSpaCocClient().stats.turnPerformance({
                    processId,
                    groupBy: 'turnIndex',
                });
                if (!cancelled) setData(deriveSessionTurnPerformance(response));
            } catch {
                // Metrics are best-effort decoration; a failed fetch hides the row.
                if (!cancelled) setData(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [processId]);

    return { data, loading };
}

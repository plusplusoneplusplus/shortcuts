/**
 * ExploreCachePanel — shows explore-cache stats and triggers on-demand
 * tool-call aggregation from the #memory/config page.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';
import type { ToolCallCacheStats } from '@plusplusoneplusplus/pipeline-core';

export function ExploreCachePanel() {
    const [stats, setStats] = useState<ToolCallCacheStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [statsError, setStatsError] = useState<string | null>(null);

    const [aggregating, setAggregating] = useState(false);
    const [aggregateResult, setAggregateResult] = useState<string | null>(null);
    const [aggregateError, setAggregateError] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        setStatsError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/aggregate-tool-calls/stats`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ToolCallCacheStats = await res.json();
            setStats(data);
        } catch (err) {
            setStatsError(err instanceof Error ? err.message : String(err));
        } finally {
            setStatsLoading(false);
        }
    }, []);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    const handleAggregate = async () => {
        setAggregating(true);
        setAggregateResult(null);
        setAggregateError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/aggregate-tool-calls`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            setAggregateResult(`Aggregated ${body.rawCount} entries → ${body.consolidatedCount} consolidated`);
            setTimeout(() => setAggregateResult(null), 4000);
            await fetchStats();
        } catch (err) {
            setAggregateError(err instanceof Error ? err.message : String(err));
        } finally {
            setAggregating(false);
        }
    };

    return (
        <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Explore Cache</h3>

            {statsLoading && (
                <div className="flex justify-center py-2"><Spinner /></div>
            )}

            {statsError && (
                <p className="text-sm text-red-500">{statsError}</p>
            )}

            {!statsLoading && !statsError && stats && (
                <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-[#616161] dark:text-[#9d9d9d]">Raw entries</dt>
                        <dd className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{stats.rawCount}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-[#616161] dark:text-[#9d9d9d]">Consolidated entries</dt>
                        <dd className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{stats.consolidatedCount}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-[#616161] dark:text-[#9d9d9d]">Last aggregation</dt>
                        <dd className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                            {stats.lastAggregation
                                ? new Date(stats.lastAggregation).toLocaleString()
                                : 'Never'}
                        </dd>
                    </div>
                </dl>
            )}

            <div className="flex items-center gap-3">
                <Button
                    onClick={handleAggregate}
                    disabled={aggregating || statsLoading}
                    loading={aggregating}
                >
                    {aggregating ? 'Aggregating…' : 'Aggregate now'}
                </Button>
                <Button
                    variant="secondary"
                    onClick={fetchStats}
                    disabled={statsLoading}
                >
                    Refresh
                </Button>
            </div>

            {aggregateResult && (
                <p className="text-sm text-green-600 dark:text-green-400">{aggregateResult}</p>
            )}
            {aggregateError && (
                <p className="text-sm text-red-500">{aggregateError}</p>
            )}
        </Card>
    );
}

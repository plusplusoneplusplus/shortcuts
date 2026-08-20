import React, { useState } from 'react';
import { useTurnPerformanceStats } from './hooks/useTurnPerformanceStats';
import type { TurnPerformanceGroup, TurnPerformanceGroupBy } from '@plusplusoneplusplus/coc-client';

const DAY_OPTIONS = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'All time', value: undefined },
] as const;

const DIMENSION_OPTIONS: Array<{ label: string; value: TurnPerformanceGroupBy }> = [
    { label: 'By provider', value: 'provider' },
    { label: 'By model', value: 'model' },
    { label: 'By workspace', value: 'workspace' },
    { label: 'By kind', value: 'kind' },
];

function fmtMs(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    if (v >= 10_000) return (v / 1000).toFixed(1) + 's';
    return Math.round(v) + 'ms';
}

function fmtTps(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return v.toFixed(1);
}

function groupLabel(group: TurnPerformanceGroup): string {
    const values = Object.values(group.key ?? {});
    return values.length > 0 ? values.map(String).join(' · ') : 'all';
}

function excludedSummary(excluded: { nonCompleted: number; noFirstToken: number; noTokenUsage: number } | undefined): string | null {
    if (!excluded) return null;
    const parts = [
        excluded.nonCompleted > 0 ? `${excluded.nonCompleted} not completed` : null,
        excluded.noFirstToken > 0 ? `${excluded.noFirstToken} without first token` : null,
        excluded.noTokenUsage > 0 ? `${excluded.noTokenUsage} without token usage` : null,
    ].filter((p): p is string => p !== null);
    if (parts.length === 0) return null;
    return `Excluded: ${parts.join(', ')}`;
}

const thClass =
    'px-3 py-2 text-left font-semibold text-xs text-[var(--vscode-descriptionForeground)] ' +
    'uppercase border-b border-[var(--vscode-panel-border)] whitespace-nowrap';

const tdClass = 'px-3 py-1.5 align-top whitespace-nowrap';

export function TurnPerformanceView() {
    const [days, setDays] = useState<number | undefined>(30);
    const [groupBy, setGroupBy] = useState<TurnPerformanceGroupBy>('provider');
    const [firstTurnOnly, setFirstTurnOnly] = useState(false);
    const { data, loading, error, reload } = useTurnPerformanceStats(days, groupBy, firstTurnOnly);

    // Tolerate a malformed/empty payload (`{}`) the same way UsageStatsView does.
    const groups = data?.groups ?? null;

    return (
        <div className="border-t border-[var(--vscode-panel-border)]">
            {/* Controls bar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--vscode-panel-border)] flex-wrap">
                <span className="text-xs font-semibold uppercase text-[var(--vscode-descriptionForeground)]">
                    Performance
                </span>

                <select
                    aria-label="Performance dimension"
                    value={groupBy}
                    onChange={e => setGroupBy(e.target.value as TurnPerformanceGroupBy)}
                    className="text-xs bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded px-2 py-1 cursor-pointer"
                >
                    {DIMENSION_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>

                <select
                    aria-label="Performance day range"
                    value={days ?? ''}
                    onChange={e => setDays(e.target.value === '' ? undefined : Number(e.target.value))}
                    className="text-xs bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded px-2 py-1 cursor-pointer"
                >
                    {DAY_OPTIONS.map(o => (
                        <option key={o.label} value={o.value ?? ''}>
                            {o.label}
                        </option>
                    ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-[var(--vscode-foreground)] cursor-pointer">
                    <input
                        type="checkbox"
                        checked={firstTurnOnly}
                        onChange={e => setFirstTurnOnly(e.target.checked)}
                    />
                    First turn only
                </label>

                <button
                    onClick={reload}
                    disabled={loading}
                    className="text-xs px-2 py-1 rounded border border-[var(--vscode-button-border)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50"
                >
                    ↻ Refresh performance
                </button>

                {data && (
                    <span className="text-xs text-[var(--vscode-descriptionForeground)] ml-auto">
                        {data.totalEvents} turns
                        {excludedSummary(data.excludedEvents) ? ` · ${excludedSummary(data.excludedEvents)}` : ''}
                    </span>
                )}
            </div>

            {loading && (
                <div className="flex items-center justify-center py-8 text-[var(--vscode-descriptionForeground)] text-sm">
                    Loading performance…
                </div>
            )}

            {!loading && error && (
                <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <p className="text-[var(--vscode-errorForeground)] text-sm">{error}</p>
                    <button onClick={reload} className="text-xs underline text-[var(--vscode-textLink-foreground)]">
                        Retry
                    </button>
                </div>
            )}

            {!loading && !error && groups && groups.length === 0 && (
                <p className="p-6 text-sm text-[var(--vscode-descriptionForeground)]">
                    No turn metrics recorded yet — metrics start accruing after the next turn.
                </p>
            )}

            {!loading && !error && groups && groups.length > 0 && (
                <table className="w-full text-xs border-collapse">
                    <thead>
                        <tr>
                            <th className={thClass}>Group</th>
                            <th className={thClass}>Turns</th>
                            <th className={thClass}>TTFT p50</th>
                            <th className={thClass}>TTFT p90</th>
                            <th className={thClass}>TTFT p99</th>
                            <th className={thClass}>TPS p50</th>
                            <th className={thClass}>TPS p90</th>
                            <th className={thClass}>TPS p99</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map((group, i) => (
                            <tr
                                key={JSON.stringify(group.key)}
                                className={`border-b border-[var(--vscode-panel-border)] ${i % 2 === 0 ? '' : 'bg-[var(--vscode-list-hoverBackground)]'}`}
                            >
                                <td className={`${tdClass} text-[var(--vscode-foreground)] truncate max-w-[240px]`} title={groupLabel(group)}>
                                    {groupLabel(group)}
                                </td>
                                <td className={tdClass}>{group.turnCount}</td>
                                <td className={tdClass}>{fmtMs(group.ttftMs?.p50)}</td>
                                <td className={tdClass}>{fmtMs(group.ttftMs?.p90)}</td>
                                <td className={tdClass}>{fmtMs(group.ttftMs?.p99)}</td>
                                <td className={tdClass}>{fmtTps(group.tpsGeneration?.p50)}</td>
                                <td className={tdClass}>{fmtTps(group.tpsGeneration?.p90)}</td>
                                <td className={tdClass}>{fmtTps(group.tpsGeneration?.p99)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

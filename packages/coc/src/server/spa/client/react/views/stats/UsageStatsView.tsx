import React, { useState } from 'react';
import { useTokenUsageStats } from '../../hooks/useTokenUsageStats';
import type { ClientTokenUsageStatsEntry, ClientTokenUsage } from '../../types/dashboard';

const DAY_OPTIONS = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'All time', value: undefined },
] as const;

function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function fmtCost(c: number | undefined): string | null {
    if (c === undefined || c === null) return null;
    return '$' + c.toFixed(4);
}

function sumUsage(entries: ClientTokenUsageStatsEntry[]): ClientTokenUsage {
    return entries.reduce(
        (acc, e) => ({
            inputTokens: acc.inputTokens + e.dayTotal.inputTokens,
            outputTokens: acc.outputTokens + e.dayTotal.outputTokens,
            cacheReadTokens: acc.cacheReadTokens + e.dayTotal.cacheReadTokens,
            cacheWriteTokens: acc.cacheWriteTokens + e.dayTotal.cacheWriteTokens,
            totalTokens: acc.totalTokens + e.dayTotal.totalTokens,
            turnCount: acc.turnCount + e.dayTotal.turnCount,
            cost:
                acc.cost !== undefined && e.dayTotal.cost !== undefined
                    ? acc.cost + e.dayTotal.cost
                    : acc.cost ?? e.dayTotal.cost,
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, turnCount: 0 }
    );
}

function sumByModel(entries: ClientTokenUsageStatsEntry[], model: string): ClientTokenUsage | undefined {
    const rows = entries.filter(e => e.byModel[model]);
    if (rows.length === 0) return undefined;
    return rows.reduce(
        (acc, e) => ({
            inputTokens: acc.inputTokens + e.byModel[model].inputTokens,
            outputTokens: acc.outputTokens + e.byModel[model].outputTokens,
            cacheReadTokens: acc.cacheReadTokens + e.byModel[model].cacheReadTokens,
            cacheWriteTokens: acc.cacheWriteTokens + e.byModel[model].cacheWriteTokens,
            totalTokens: acc.totalTokens + e.byModel[model].totalTokens,
            turnCount: acc.turnCount + e.byModel[model].turnCount,
            cost:
                acc.cost !== undefined && e.byModel[model].cost !== undefined
                    ? acc.cost + e.byModel[model].cost
                    : acc.cost ?? e.byModel[model].cost,
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, turnCount: 0 }
    );
}

function UsageCell({ usage }: { usage: ClientTokenUsage }) {
    const costStr = fmtCost(usage.cost);

    const tooltip = [
        `Input:       ${usage.inputTokens.toLocaleString()}`,
        `Output:      ${usage.outputTokens.toLocaleString()}`,
        `Cache read:  ${usage.cacheReadTokens.toLocaleString()}`,
        `Cache write: ${usage.cacheWriteTokens.toLocaleString()}`,
        `Total:       ${usage.totalTokens.toLocaleString()}`,
        `Turns:       ${usage.turnCount}`,
        ...(costStr ? [`Cost:        ${costStr}`] : []),
    ].join('\n');

    return (
        <span title={tooltip} className="cursor-default">
            <span className="text-[var(--vscode-foreground)]">↓{fmt(usage.inputTokens)}</span>
            {' '}
            <span className="text-[var(--vscode-foreground)]">↑{fmt(usage.outputTokens)}</span>
            {costStr && (
                <span className="ml-1 text-[var(--vscode-descriptionForeground)]">{costStr}</span>
            )}
        </span>
    );
}

const thClass =
    'px-3 py-2 text-left font-semibold text-xs text-[var(--vscode-descriptionForeground)] ' +
    'uppercase border-b border-[var(--vscode-panel-border)] whitespace-nowrap';

const tdClass = 'px-3 py-1.5 align-top whitespace-nowrap';
const tdDateClass = 'px-3 py-1.5 align-top font-mono text-[var(--vscode-foreground)] whitespace-nowrap';

export function UsageStatsView() {
    const [days, setDays] = useState<number | undefined>(30);
    const { data, loading, error, reload } = useTokenUsageStats(days);

    const grandTotal = data ? sumUsage(data.entries) : null;

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
            {/* Controls bar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
                <select
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

                <button
                    onClick={reload}
                    disabled={loading}
                    className="text-xs px-2 py-1 rounded border border-[var(--vscode-button-border)] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50"
                >
                    ↻ Refresh
                </button>

                {data && (
                    <span className="text-xs text-[var(--vscode-descriptionForeground)] ml-auto">
                        Generated at: {new Date(data.generatedAt).toLocaleString()}
                    </span>
                )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-auto">
                {loading && (
                    <div className="flex items-center justify-center h-full text-[var(--vscode-descriptionForeground)] text-sm">
                        Loading…
                    </div>
                )}

                {!loading && error && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <p className="text-[var(--vscode-errorForeground)] text-sm">{error}</p>
                        <button onClick={reload} className="text-xs underline text-[var(--vscode-textLink-foreground)]">
                            Retry
                        </button>
                    </div>
                )}

                {!loading && !error && data && data.entries.length === 0 && (
                    <p className="p-6 text-sm text-[var(--vscode-descriptionForeground)]">
                        No token usage data found. Run some AI tasks to see stats here.
                    </p>
                )}

                {!loading && !error && data && data.entries.length > 0 && grandTotal && (
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 bg-[var(--vscode-editor-background)] z-10">
                            <tr>
                                <th className={thClass}>Date</th>
                                {data.models.map(m => (
                                    <th key={m} className={thClass} title={m}>
                                        {m.length > 20 ? m.slice(0, 18) + '…' : m}
                                    </th>
                                ))}
                                <th className={thClass}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.entries.map((entry, i) => (
                                <tr
                                    key={entry.date}
                                    className={
                                        'border-b border-[var(--vscode-panel-border)] ' +
                                        (i % 2 === 1 ? 'bg-[var(--vscode-list-hoverBackground)]' : '')
                                    }
                                >
                                    <td className={tdDateClass}>{entry.date}</td>

                                    {data.models.map(model => {
                                        const usage = entry.byModel[model];
                                        return (
                                            <td key={model} className={tdClass}>
                                                {usage ? (
                                                    <UsageCell usage={usage} />
                                                ) : (
                                                    <span className="text-[var(--vscode-descriptionForeground)]">—</span>
                                                )}
                                            </td>
                                        );
                                    })}

                                    <td className={tdClass}>
                                        <UsageCell usage={entry.dayTotal} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-[var(--vscode-panel-border)] font-semibold bg-[var(--vscode-editor-background)]">
                                <td className={tdDateClass}>Total</td>
                                {data.models.map(model => {
                                    const total = sumByModel(data.entries, model);
                                    return (
                                        <td key={model} className={tdClass}>
                                            {total ? (
                                                <UsageCell usage={total} />
                                            ) : (
                                                <span className="text-[var(--vscode-descriptionForeground)]">—</span>
                                            )}
                                        </td>
                                    );
                                })}
                                <td className={tdClass}>
                                    <UsageCell usage={grandTotal} />
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
    );
}

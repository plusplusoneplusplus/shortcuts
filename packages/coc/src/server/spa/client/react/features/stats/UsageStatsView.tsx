import React, { useState } from 'react';
import { useTokenUsageStats } from '../chat/hooks/useTokenUsageStats';
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

function fmtPremiumUnits(units: number | undefined): string | null {
    if (units === undefined || units === null) return null;
    return units.toFixed(2);
}

function fmtUsdCost(usd: number): string {
    if (usd >= 0.01) return '$' + usd.toFixed(2);
    return '$' + usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function addUsage(acc: ClientTokenUsage, usage: ClientTokenUsage): ClientTokenUsage {
    const costBreakdown = usage.costBreakdown
        ? {
            inputUsd: (acc.costBreakdown?.inputUsd ?? 0) + usage.costBreakdown.inputUsd,
            cachedInputUsd: (acc.costBreakdown?.cachedInputUsd ?? 0) + usage.costBreakdown.cachedInputUsd,
            cacheWriteUsd: (acc.costBreakdown?.cacheWriteUsd ?? 0) + usage.costBreakdown.cacheWriteUsd,
            outputUsd: (acc.costBreakdown?.outputUsd ?? 0) + usage.costBreakdown.outputUsd,
        }
        : acc.costBreakdown;

    return {
        inputTokens: acc.inputTokens + usage.inputTokens,
        outputTokens: acc.outputTokens + usage.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        turnCount: acc.turnCount + usage.turnCount,
        cost:
            acc.cost !== undefined && usage.cost !== undefined
                ? acc.cost + usage.cost
                : acc.cost ?? usage.cost,
        estimatedUsdCost:
            acc.estimatedUsdCost !== undefined && usage.estimatedUsdCost !== undefined
                ? acc.estimatedUsdCost + usage.estimatedUsdCost
                : acc.estimatedUsdCost ?? usage.estimatedUsdCost,
        costBreakdown,
        pricingSource: acc.pricingSource ?? usage.pricingSource,
        pricingUnavailable: acc.pricingUnavailable || usage.pricingUnavailable,
    };
}

function sumUsage(entries: ClientTokenUsageStatsEntry[]): ClientTokenUsage {
    return entries.reduce(
        (acc, e) => addUsage(acc, e.dayTotal),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, turnCount: 0 }
    );
}

function sumByModel(entries: ClientTokenUsageStatsEntry[], model: string): ClientTokenUsage | undefined {
    const rows = entries.filter(e => e.byModel[model]);
    if (rows.length === 0) return undefined;
    return rows.reduce(
        (acc, e) => addUsage(acc, e.byModel[model]),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, turnCount: 0 }
    );
}

function buildTooltip(usage: ClientTokenUsage, showCostDetails: boolean): string {
    const cachedInputTokens = usage.cacheReadTokens;
    const newInputTokens = Math.max(usage.inputTokens - cachedInputTokens - usage.cacheWriteTokens, 0);
    const premiumUnits = showCostDetails ? fmtPremiumUnits(usage.cost) : null;

    return [
        `Input total:   ${usage.inputTokens.toLocaleString()}`,
        `Input cached/read: ${cachedInputTokens.toLocaleString()}`,
        `Input non-cached:  ${newInputTokens.toLocaleString()}`,
        `Cache write:   ${usage.cacheWriteTokens.toLocaleString()}`,
        `Output:        ${usage.outputTokens.toLocaleString()}`,
        `Turns:         ${usage.turnCount}`,
        ...(showCostDetails && usage.costBreakdown ? [
            `Estimated token cost: ${fmtUsdCost(usage.estimatedUsdCost ?? 0)}`,
            `  Input:        ${fmtUsdCost(usage.costBreakdown.inputUsd)}`,
            `  Cached input: ${fmtUsdCost(usage.costBreakdown.cachedInputUsd)}`,
            `  Cache write:  ${fmtUsdCost(usage.costBreakdown.cacheWriteUsd)}`,
            `  Output:       ${fmtUsdCost(usage.costBreakdown.outputUsd)}`,
        ] : []),
        ...(showCostDetails && usage.pricingUnavailable ? ['No pricing table entry for this model'] : []),
        ...(showCostDetails && premiumUnits ? [`Premium units: ${premiumUnits}`] : []),
        ...(showCostDetails && usage.pricingSource ? [`Pricing source: ${usage.pricingSource}`] : []),
    ].join('\n');
}

function UsageCell({
    usage,
    showCostDetails = false,
}: {
    usage: ClientTokenUsage;
    showCostDetails?: boolean;
}) {
    const premiumUnits = showCostDetails ? fmtPremiumUnits(usage.cost) : null;
    const estimatedCost = showCostDetails && usage.estimatedUsdCost !== undefined
        ? fmtUsdCost(usage.estimatedUsdCost)
        : null;
    const cachedInputTokens = usage.cacheReadTokens;
    const newInputTokens = Math.max(usage.inputTokens - cachedInputTokens - usage.cacheWriteTokens, 0);
    const tooltip = buildTooltip(usage, showCostDetails);

    return (
        <span title={tooltip} className="cursor-default inline-flex flex-col gap-0.5 leading-snug">
            <span>
                <span className="text-[var(--vscode-foreground)]">↓{fmt(usage.inputTokens)} total</span>
                <span className="text-[var(--vscode-descriptionForeground)]"> · {fmt(cachedInputTokens)} cached</span>
                <span className="text-[var(--vscode-descriptionForeground)]"> · {fmt(newInputTokens)} new</span>
            </span>
            <span>
                <span className="text-[var(--vscode-foreground)]">↑{fmt(usage.outputTokens)} out</span>
                <span className="text-[var(--vscode-descriptionForeground)]"> · {fmt(usage.cacheWriteTokens)} cache write</span>
                {estimatedCost && (
                    <span className="text-[var(--vscode-descriptionForeground)]"> · est {estimatedCost}</span>
                )}
            </span>
            {premiumUnits && (
                <span className="text-[var(--vscode-descriptionForeground)]">Premium units: {premiumUnits}</span>
            )}
        </span>
    );
}

const thClass =
    'px-3 py-2 text-left font-semibold text-xs text-[var(--vscode-descriptionForeground)] ' +
    'uppercase border-b border-[var(--vscode-panel-border)] whitespace-nowrap';

const tdClass = 'px-3 py-1.5 align-top';

function DateGroupRow({
    entry,
    models,
    isEven,
}: {
    entry: ClientTokenUsageStatsEntry;
    models: string[];
    isEven: boolean;
}) {
    const modelsWithUsage = models.filter(m => entry.byModel[m]);
    const bgClass = isEven ? '' : 'bg-[var(--vscode-list-hoverBackground)]';

    return (
        <>
            {/* Day total summary row */}
            <tr className={`border-b border-[var(--vscode-panel-border)] ${bgClass}`}>
                <td className="px-3 py-1.5 align-top font-mono text-[var(--vscode-foreground)] whitespace-nowrap" rowSpan={modelsWithUsage.length + 1}>
                    {entry.date}
                </td>
                <td className={`${tdClass} font-semibold text-[var(--vscode-foreground)]`}>
                    All models
                </td>
                <td className={tdClass}>
                    <UsageCell usage={entry.dayTotal} showCostDetails />
                </td>
            </tr>
            {/* Per-model rows */}
            {modelsWithUsage.map(model => (
                <tr key={model} className={`border-b border-[var(--vscode-panel-border)] ${bgClass}`}>
                    <td className={`${tdClass} text-[var(--vscode-descriptionForeground)] truncate max-w-[200px]`} title={model}>
                        {model}
                    </td>
                    <td className={tdClass}>
                        <UsageCell usage={entry.byModel[model]} />
                    </td>
                </tr>
            ))}
        </>
    );
}

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
                                <th className={thClass} style={{ width: '110px' }}>Date</th>
                                <th className={thClass} style={{ width: '200px' }}>Model</th>
                                <th className={thClass}>Tokens</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.entries.map((entry, i) => (
                                <DateGroupRow
                                    key={entry.date}
                                    entry={entry}
                                    models={data.models}
                                    isEven={i % 2 === 0}
                                />
                            ))}
                        </tbody>
                        <tfoot>
                            {/* Grand total row */}
                            <tr className="border-t-2 border-[var(--vscode-panel-border)] font-semibold bg-[var(--vscode-editor-background)]">
                                <td className="px-3 py-1.5 align-top font-mono text-[var(--vscode-foreground)] whitespace-nowrap" rowSpan={data.models.length + 1}>
                                    Total
                                </td>
                                <td className={`${tdClass} font-semibold text-[var(--vscode-foreground)]`}>
                                    All models
                                </td>
                                <td className={tdClass}>
                                    <UsageCell usage={grandTotal} showCostDetails />
                                </td>
                            </tr>
                            {data.models.map(model => {
                                const total = sumByModel(data.entries, model);
                                return (
                                    <tr key={model} className="border-b border-[var(--vscode-panel-border)] font-semibold bg-[var(--vscode-editor-background)]">
                                        <td className={`${tdClass} text-[var(--vscode-descriptionForeground)] truncate max-w-[200px]`} title={model}>
                                            {model}
                                        </td>
                                        <td className={tdClass}>
                                            {total ? (
                                                <UsageCell usage={total} />
                                            ) : (
                                                <span className="text-[var(--vscode-descriptionForeground)]">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
    );
}

/**
 * KustoChart — interactive in-browser charts for a Kusto canvas.
 *
 * The chart is drawn with Recharts, which is NOT part of the SPA bundle: it is
 * fetched at runtime from the vendored `/canvas-vendor/recharts.js` bundle (see
 * `rechartsLoader.ts`). While that load is in flight we show a small
 * placeholder, and if it fails we fall back to the hand-drawn SVG renderer in
 * `KustoChartStaticSvg.tsx` — the chart always draws, only interactivity is
 * lost.
 *
 * The pure data helpers (`isNumericColumn`, `buildChartSeries`, …) live in
 * `chartSeries.ts` and are re-exported here so existing importers and tests are
 * unaffected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    KustoCellValue,
    KustoChartConfig,
    KustoChartType,
    KustoColumn,
} from '@plusplusoneplusplus/coc-client';
import {
    buildChartSeries,
    seriesColor,
    type ChartData,
} from './chartSeries';
import { ChartLegend } from './ChartLegend';
import { KustoChartStaticSvg } from './KustoChartStaticSvg';
import { loadRecharts, type RechartsNamespace } from './rechartsLoader';

export {
    CHART_PALETTE,
    buildChartSeries,
    cellToNumber,
    isNumericColumn,
    numericColumnNames,
    seriesColor,
} from './chartSeries';
export type { ChartData, ChartSeries } from './chartSeries';

/** Chart height in the panel, and in a compact inline embed. */
const CHART_HEIGHT = 320;
const COMPACT_CHART_HEIGHT = 220;

const AXIS_COLOR = '#888';
const GRID_COLOR = '#8884';

/** X tick labels stay short, same as the static renderer. */
function truncateLabel(label: string): string {
    return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

/**
 * Tooltip values are printed unrounded — reading the exact number off a hover is
 * the whole point of the interactive chart, so no compact/abbreviated formatting
 * here (the y-axis ticks may still be terse).
 */
function exactValue(value: number): string {
    return String(value);
}

interface TooltipEntry {
    name: string;
    color: string;
    value: number;
}

/** The tooltip card itself, styled off the same tokens as the legend. */
function TooltipCard({ label, entries }: { label: string; entries: TooltipEntry[] }) {
    return (
        <div
            className="rounded-sm border border-[#8884] bg-white dark:bg-[#252526] px-2 py-1 text-[10px] text-[#616161] dark:text-[#cccccc] shadow-sm"
            data-testid="kusto-chart-tooltip"
        >
            <div className="mb-0.5 font-medium">{label}</div>
            {entries.map(entry => (
                <div key={entry.name} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span
                        className="inline-block w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.name}</span>
                    <span className="ml-auto tabular-nums">{exactValue(entry.value)}</span>
                </div>
            ))}
        </div>
    );
}

/** Recharts hands custom tooltip content an untyped payload bag. */
interface TooltipContentProps {
    active?: boolean;
    label?: unknown;
    payload?: { name?: string; value?: unknown; payload?: Record<string, unknown> }[];
}

/**
 * A shared tooltip: it lists *every* visible series at the hovered x, not just
 * the nearest mark. We read the values straight out of `ChartData` rather than
 * off the recharts payload so the list is complete and in series order even for
 * chart kinds whose payload only carries the hovered item.
 */
function makeSharedTooltip(data: ChartData, visible: number[]) {
    return function SharedTooltip({ active, label, payload }: TooltipContentProps) {
        if (!active) return null;
        const raw = label ?? payload?.[0]?.payload?.__x;
        if (raw === undefined || raw === null) return null;
        const text = String(raw);
        const li = data.labels.indexOf(text);
        if (li < 0) return null;
        const entries: TooltipEntry[] = [];
        for (const si of visible) {
            const value = data.series[si]?.values[li];
            // Nulls are gaps in the series — omit them rather than showing 0.
            if (typeof value === 'number') {
                entries.push({ name: data.series[si].name, color: seriesColor(si), value });
            }
        }
        if (entries.length === 0) return null;
        return <TooltipCard label={text} entries={entries} />;
    };
}

/** Pie slices get a plain per-slice tooltip; a shared one is meaningless there. */
function makePieTooltip(data: ChartData) {
    const valueName = data.series[0]?.name ?? 'value';
    return function PieTooltip({ active, payload }: TooltipContentProps) {
        const item = payload?.[0];
        if (!active || !item || typeof item.value !== 'number') return null;
        const name = String(item.name ?? item.payload?.name ?? '');
        const index = Number(item.payload?.__i ?? 0);
        return (
            <TooltipCard
                label={name}
                entries={[{ name: valueName, color: seriesColor(index), value: item.value }]}
            />
        );
    };
}

/** Per-label rows in the shape Recharts wants: `{ __x, s0, s1, … }`. */
function toRechartsRows(data: ChartData): Record<string, string | number | null>[] {
    return data.labels.map((label, li) => {
        const row: Record<string, string | number | null> = { __x: label };
        data.series.forEach((s, si) => {
            row[`s${si}`] = s.values[li] ?? null;
        });
        return row;
    });
}

interface RechartsChartProps {
    rc: RechartsNamespace;
    data: ChartData;
    type: KustoChartType;
    compact: boolean;
    /** Series (or, for pie, slice) indices toggled off in the legend. */
    hidden: ReadonlySet<number>;
}

/** The Recharts render path — one component per chart kind, shared axes. */
function RechartsChart({ rc, data, type, compact, hidden }: RechartsChartProps) {
    const {
        ResponsiveContainer,
        LineChart, BarChart, ScatterChart, AreaChart, PieChart,
        Line, Bar, Scatter, Area, Pie, Cell,
        XAxis, YAxis, CartesianGrid, Tooltip,
    } = rc;
    const height = compact ? COMPACT_CHART_HEIGHT : CHART_HEIGHT;
    const rows = useMemo(() => toRechartsRows(data), [data]);
    // Hidden series are simply not rendered, so recharts rescales the y-axis to
    // what is left and the shared tooltip lists only visible series.
    const visible = useMemo(
        () => data.series.map((_s, si) => si).filter(si => !hidden.has(si)),
        [data, hidden],
    );
    const SharedTooltip = useMemo(() => makeSharedTooltip(data, visible), [data, visible]);
    const SlicedTooltip = useMemo(() => makePieTooltip(data), [data]);

    if (type === 'pie') {
        // Pie uses the first series; each label is a slice. `__i` keeps the
        // slice's palette index around for the tooltip swatch.
        const first = data.series[0];
        const slices = first
            ? data.labels
                .map((label, i) => ({ name: label, value: Math.max(first.values[i] ?? 0, 0), __i: i }))
                .filter(s => s.value > 0 && !hidden.has(s.__i))
            : [];
        return (
            <ResponsiveContainer width="100%" height={height}>
                <PieChart>
                    <Tooltip content={<SlicedTooltip />} isAnimationActive={false} />
                    <Pie data={slices} dataKey="value" nameKey="name" isAnimationActive={false}>
                        {slices.map((slice: { __i: number }, i: number) => (
                            <Cell key={i} fill={seriesColor(slice.__i)} />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
        );
    }

    const axes = (
        <>
            <CartesianGrid stroke={GRID_COLOR} />
            <Tooltip
                content={<SharedTooltip />}
                shared
                isAnimationActive={false}
                cursor={{ stroke: AXIS_COLOR, strokeDasharray: '3 3' }}
            />
            <XAxis
                dataKey="__x"
                tick={{ fontSize: 10, fill: AXIS_COLOR }}
                stroke={AXIS_COLOR}
                tickFormatter={truncateLabel}
                interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={AXIS_COLOR} width={56} />
        </>
    );

    const body = (() => {
        switch (type) {
            case 'bar':
                return (
                    <BarChart data={rows}>
                        {axes}
                        {visible.map(si => (
                            <Bar key={si} dataKey={`s${si}`} name={data.series[si].name} fill={seriesColor(si)} isAnimationActive={false} />
                        ))}
                    </BarChart>
                );
            case 'scatter':
                return (
                    <ScatterChart data={rows}>
                        {axes}
                        {visible.map(si => (
                            <Scatter key={si} dataKey={`s${si}`} name={data.series[si].name} fill={seriesColor(si)} isAnimationActive={false} />
                        ))}
                    </ScatterChart>
                );
            case 'stackedArea':
                return (
                    <AreaChart data={rows}>
                        {axes}
                        {visible.map(si => (
                            <Area
                                key={si}
                                type="linear"
                                dataKey={`s${si}`}
                                name={data.series[si].name}
                                stackId="kusto"
                                stroke={seriesColor(si)}
                                fill={seriesColor(si)}
                                fillOpacity={0.6}
                                isAnimationActive={false}
                            />
                        ))}
                    </AreaChart>
                );
            case 'line':
            default:
                return (
                    <LineChart data={rows}>
                        {axes}
                        {visible.map(si => (
                            <Line
                                key={si}
                                type="linear"
                                dataKey={`s${si}`}
                                name={data.series[si].name}
                                stroke={seriesColor(si)}
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                );
        }
    })();

    return (
        <ResponsiveContainer width="100%" height={height}>
            {body}
        </ResponsiveContainer>
    );
}

type LoaderState =
    | { status: 'loading' }
    | { status: 'ready'; rc: RechartsNamespace }
    | { status: 'failed' };

export interface KustoChartProps {
    columns: KustoColumn[];
    rows: KustoCellValue[][];
    config: KustoChartConfig;
    /** Inline chat embeds render a shorter chart. */
    compact?: boolean;
}

/** Full chart surface: the plot plus a legend, driven by the config. */
export function KustoChart({ columns, rows, config, compact = false }: KustoChartProps) {
    const data = useMemo(() => buildChartSeries(columns, rows, config), [columns, rows, config]);
    const [loader, setLoader] = useState<LoaderState>({ status: 'loading' });
    // Legend toggles are ephemeral view state: nothing is written back to the
    // canvas, so the revision never bumps and reopening resets everything.
    const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
    const toggleSeries = useCallback((index: number) => {
        setHidden(prev => {
            const next = new Set(prev);
            if (!next.delete(index)) next.add(index);
            return next;
        });
    }, []);

    // A different chart type or query result renumbers the series, so drop the
    // stale toggles rather than hiding an unrelated series.
    useEffect(() => { setHidden(new Set()); }, [config.type, data]);

    useEffect(() => {
        let alive = true;
        loadRecharts().then(
            rc => { if (alive) setLoader({ status: 'ready', rc }); },
            () => { if (alive) setLoader({ status: 'failed' }); },
        );
        return () => { alive = false; };
    }, []);

    if (!config.y || config.y.length === 0) {
        return (
            <div className="text-[11px] italic text-[#848484] text-center py-6" data-testid="kusto-chart-unconfigured">
                Pick a Y column to draw a chart.
            </div>
        );
    }
    if (data.labels.length === 0) {
        return (
            <div className="text-[11px] italic text-[#848484] text-center py-6" data-testid="kusto-chart-empty">
                No data to chart.
            </div>
        );
    }

    const legendNames = config.type === 'pie' ? data.labels : data.series.map(s => s.name);

    if (loader.status === 'loading') {
        return (
            <div data-testid="kusto-chart">
                <div
                    className="flex items-center justify-center text-[11px] italic text-[#848484]"
                    style={{ height: compact ? COMPACT_CHART_HEIGHT : CHART_HEIGHT }}
                    data-testid="kusto-chart-loading"
                >
                    Loading chart…
                </div>
            </div>
        );
    }

    if (loader.status === 'failed') {
        return (
            <div data-testid="kusto-chart">
                <KustoChartStaticSvg data={data} kind={config.type} />
            </div>
        );
    }

    return (
        <div data-testid="kusto-chart">
            <RechartsChart rc={loader.rc} data={data} type={config.type} compact={compact} hidden={hidden} />
            <ChartLegend names={legendNames} hidden={hidden} onToggle={toggleSeries} />
        </div>
    );
}

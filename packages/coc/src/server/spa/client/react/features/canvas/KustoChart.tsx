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

import { useEffect, useMemo, useState } from 'react';
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
}

/** The Recharts render path — one component per chart kind, shared axes. */
function RechartsChart({ rc, data, type, compact }: RechartsChartProps) {
    const {
        ResponsiveContainer,
        LineChart, BarChart, ScatterChart, AreaChart, PieChart,
        Line, Bar, Scatter, Area, Pie, Cell,
        XAxis, YAxis, CartesianGrid,
    } = rc;
    const height = compact ? COMPACT_CHART_HEIGHT : CHART_HEIGHT;
    const rows = useMemo(() => toRechartsRows(data), [data]);

    if (type === 'pie') {
        // Pie uses the first series; each label is a slice.
        const first = data.series[0];
        const slices = first
            ? data.labels
                .map((label, i) => ({ name: label, value: Math.max(first.values[i] ?? 0, 0) }))
                .filter(s => s.value > 0)
            : [];
        return (
            <ResponsiveContainer width="100%" height={height}>
                <PieChart>
                    <Pie data={slices} dataKey="value" nameKey="name" isAnimationActive={false}>
                        {slices.map((_slice: unknown, i: number) => (
                            <Cell key={i} fill={seriesColor(i)} />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
        );
    }

    const axes = (
        <>
            <CartesianGrid stroke={GRID_COLOR} />
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
                        {data.series.map((s, si) => (
                            <Bar key={si} dataKey={`s${si}`} name={s.name} fill={seriesColor(si)} isAnimationActive={false} />
                        ))}
                    </BarChart>
                );
            case 'scatter':
                return (
                    <ScatterChart data={rows}>
                        {axes}
                        {data.series.map((s, si) => (
                            <Scatter key={si} dataKey={`s${si}`} name={s.name} fill={seriesColor(si)} isAnimationActive={false} />
                        ))}
                    </ScatterChart>
                );
            case 'stackedArea':
                return (
                    <AreaChart data={rows}>
                        {axes}
                        {data.series.map((s, si) => (
                            <Area
                                key={si}
                                type="linear"
                                dataKey={`s${si}`}
                                name={s.name}
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
                        {data.series.map((s, si) => (
                            <Line
                                key={si}
                                type="linear"
                                dataKey={`s${si}`}
                                name={s.name}
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
            <RechartsChart rc={loader.rc} data={data} type={config.type} compact={compact} />
            <ChartLegend names={legendNames} />
        </div>
    );
}

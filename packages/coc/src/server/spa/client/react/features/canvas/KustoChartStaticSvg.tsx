/**
 * Hand-drawn SVG Kusto chart — the fallback renderer (AC-06).
 *
 * This is the original chart implementation, kept intact: it has no dependency
 * on any chart library, so it always draws even when the vendored recharts
 * bundle cannot be fetched. `KustoChart.tsx` falls back to it when the runtime
 * loader rejects. It is static: no hover tooltip, no legend toggling, no zoom.
 */

import { useMemo } from 'react';
import { CHART_PALETTE, type ChartData } from './chartSeries';
import { ChartLegend } from './ChartLegend';

const W = 640;
const H = 360;
const M = { top: 16, right: 16, bottom: 52, left: 56 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

function niceExtent(data: ChartData, includeZero: boolean): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const s of data.series) {
        for (const v of s.values) {
            if (v === null) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (includeZero) {
        min = Math.min(0, min);
        max = Math.max(0, max);
    }
    if (min === max) {
        // Flat series — pad so it renders.
        const pad = Math.abs(min) || 1;
        return [min - pad, max + pad];
    }
    return [min, max];
}

export type AxisChartKind = 'line' | 'bar' | 'scatter' | 'stackedArea';

interface AxisChartProps {
    data: ChartData;
    kind: AxisChartKind;
}

function AxisChart({ data, kind }: AxisChartProps) {
    const includeZero = kind === 'bar' || kind === 'stackedArea';
    const stacked = kind === 'stackedArea';
    const [yMin, yMax] = useMemo(() => {
        if (!stacked) return niceExtent(data, includeZero);
        // For stacked areas the axis must span the cumulative totals.
        let max = 0;
        data.labels.forEach((_, li) => {
            let sum = 0;
            for (const s of data.series) sum += s.values[li] ?? 0;
            if (sum > max) max = sum;
        });
        return [0, max || 1] as [number, number];
    }, [data, includeZero, stacked]);

    const n = Math.max(data.labels.length, 1);
    const band = PLOT_W / n;
    const xCenter = (i: number) => M.left + band * i + band / 2;
    const yScale = (v: number) => M.top + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;

    // Show at most ~12 x labels to avoid overlap.
    const labelStep = Math.ceil(data.labels.length / 12) || 1;

    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${kind} chart`}
            data-testid="kusto-chart-svg"
        >
            {/* Y grid + labels */}
            {yTicks.map((t, i) => (
                <g key={`y${i}`}>
                    <line
                        x1={M.left}
                        x2={W - M.right}
                        y1={yScale(t)}
                        y2={yScale(t)}
                        stroke="#8884"
                        strokeWidth={1}
                    />
                    <text x={M.left - 6} y={yScale(t) + 3} textAnchor="end" fontSize={10} fill="#888">
                        {Number.isInteger(t) ? t : t.toFixed(2)}
                    </text>
                </g>
            ))}
            {/* X labels */}
            {data.labels.map((label, i) =>
                i % labelStep === 0 ? (
                    <text
                        key={`x${i}`}
                        x={xCenter(i)}
                        y={H - M.bottom + 16}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#888"
                    >
                        {label.length > 12 ? `${label.slice(0, 11)}…` : label}
                    </text>
                ) : null,
            )}

            {kind === 'bar' && <BarMarks data={data} band={band} yScale={yScale} yZero={yScale(Math.max(0, yMin))} />}
            {kind === 'line' && <LineMarks data={data} xCenter={xCenter} yScale={yScale} />}
            {kind === 'scatter' && <ScatterMarks data={data} xCenter={xCenter} yScale={yScale} />}
            {kind === 'stackedArea' && <StackedAreaMarks data={data} xCenter={xCenter} yScale={yScale} yBase={yScale(0)} />}
        </svg>
    );
}

function BarMarks({ data, band, yScale, yZero }: { data: ChartData; band: number; yScale: (v: number) => number; yZero: number }) {
    const groups = data.series.length || 1;
    const barW = (band * 0.7) / groups;
    return (
        <g>
            {data.labels.map((_, li) => (
                <g key={li}>
                    {data.series.map((s, si) => {
                        const v = s.values[li];
                        if (v === null) return null;
                        const x = M.left + band * li + band * 0.15 + barW * si;
                        const y = yScale(v);
                        const h = Math.abs(y - yZero);
                        return (
                            <rect
                                key={si}
                                x={x}
                                y={Math.min(y, yZero)}
                                width={Math.max(barW - 1, 1)}
                                height={Math.max(h, 0)}
                                fill={CHART_PALETTE[si % CHART_PALETTE.length]}
                            />
                        );
                    })}
                </g>
            ))}
        </g>
    );
}

function seriesPath(values: (number | null)[], xCenter: (i: number) => number, yScale: (v: number) => number): string {
    let d = '';
    let penDown = false;
    values.forEach((v, i) => {
        if (v === null) {
            penDown = false;
            return;
        }
        const cmd = penDown ? 'L' : 'M';
        d += `${cmd}${xCenter(i).toFixed(1)},${yScale(v).toFixed(1)} `;
        penDown = true;
    });
    return d.trim();
}

function LineMarks({ data, xCenter, yScale }: { data: ChartData; xCenter: (i: number) => number; yScale: (v: number) => number }) {
    return (
        <g fill="none">
            {data.series.map((s, si) => (
                <path
                    key={si}
                    d={seriesPath(s.values, xCenter, yScale)}
                    stroke={CHART_PALETTE[si % CHART_PALETTE.length]}
                    strokeWidth={2}
                />
            ))}
        </g>
    );
}

function ScatterMarks({ data, xCenter, yScale }: { data: ChartData; xCenter: (i: number) => number; yScale: (v: number) => number }) {
    return (
        <g>
            {data.series.map((s, si) =>
                s.values.map((v, i) =>
                    v === null ? null : (
                        <circle
                            key={`${si}-${i}`}
                            cx={xCenter(i)}
                            cy={yScale(v)}
                            r={3}
                            fill={CHART_PALETTE[si % CHART_PALETTE.length]}
                            fillOpacity={0.8}
                        />
                    ),
                ),
            )}
        </g>
    );
}

function StackedAreaMarks({ data, xCenter, yScale, yBase }: { data: ChartData; xCenter: (i: number) => number; yScale: (v: number) => number; yBase: number }) {
    const cumulative = data.labels.map(() => 0);
    return (
        <g>
            {data.series.map((s, si) => {
                const lower = cumulative.slice();
                const upper = data.labels.map((_, li) => {
                    cumulative[li] += s.values[li] ?? 0;
                    return cumulative[li];
                });
                const top = upper.map((v, i) => `${xCenter(i).toFixed(1)},${yScale(v).toFixed(1)}`);
                const bottom = lower
                    .map((v, i) => `${xCenter(i).toFixed(1)},${yScale(v).toFixed(1)}`)
                    .reverse();
                const points = [...top, ...bottom].join(' ');
                return (
                    <polygon
                        key={si}
                        points={points || `${M.left},${yBase}`}
                        fill={CHART_PALETTE[si % CHART_PALETTE.length]}
                        fillOpacity={0.6}
                        stroke={CHART_PALETTE[si % CHART_PALETTE.length]}
                        strokeWidth={1}
                    />
                );
            })}
        </g>
    );
}

function PieChart({ data }: { data: ChartData }) {
    // Pie uses the first series; each label is a slice.
    const series = data.series[0];
    const slices = series
        ? data.labels.map((label, i) => ({ label, value: Math.max(series.values[i] ?? 0, 0) }))
        : [];
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(PLOT_W, PLOT_H) / 2 - 8;
    let angle = -Math.PI / 2;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="pie chart" data-testid="kusto-chart-svg">
            {total <= 0 ? (
                <text x={cx} y={cy} textAnchor="middle" fontSize={12} fill="#888">No positive values to chart</text>
            ) : (
                slices.map((slice, i) => {
                    const frac = slice.value / total;
                    const end = angle + frac * 2 * Math.PI;
                    const large = frac > 0.5 ? 1 : 0;
                    const x1 = cx + r * Math.cos(angle);
                    const y1 = cy + r * Math.sin(angle);
                    const x2 = cx + r * Math.cos(end);
                    const y2 = cy + r * Math.sin(end);
                    const d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
                    angle = end;
                    return <path key={i} d={d} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />;
                })
            )}
        </svg>
    );
}

export interface KustoChartStaticSvgProps {
    data: ChartData;
    kind: 'line' | 'bar' | 'scatter' | 'stackedArea' | 'pie';
}

/** The full static chart surface: SVG plot plus the shared legend. */
export function KustoChartStaticSvg({ data, kind }: KustoChartStaticSvgProps) {
    if (kind === 'pie') {
        return (
            <>
                <PieChart data={data} />
                <ChartLegend names={data.labels} />
            </>
        );
    }
    return (
        <>
            <AxisChart data={data} kind={kind} />
            <ChartLegend names={data.series.map(s => s.name)} />
        </>
    );
}

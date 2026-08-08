/**
 * Legend shared by both Kusto chart renderers (recharts and the static SVG
 * fallback), so the two look identical: a palette swatch plus a 10px label,
 * centered and wrapping.
 */

import { seriesColor } from './chartSeries';

export interface ChartLegendProps {
    names: string[];
}

export function ChartLegend({ names }: ChartLegendProps) {
    if (names.length <= 1) return null;
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1" data-testid="kusto-chart-legend">
            {names.map((name, i) => (
                <span key={name} className="inline-flex items-center gap-1 text-[10px] text-[#616161] dark:text-[#cccccc]">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: seriesColor(i) }} />
                    {name}
                </span>
            ))}
        </div>
    );
}

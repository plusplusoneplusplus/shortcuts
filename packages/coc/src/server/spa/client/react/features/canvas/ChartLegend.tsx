/**
 * Legend shared by both Kusto chart renderers (recharts and the static SVG
 * fallback), so the two look identical: a palette swatch plus a 10px label,
 * centered and wrapping.
 */

import { seriesColor } from './chartSeries';

export interface ChartLegendProps {
    names: string[];
    /** Indices the user has clicked off. Ephemeral view state — never persisted. */
    hidden?: ReadonlySet<number>;
    /** When given, entries become buttons that toggle their series. */
    onToggle?: (index: number) => void;
}

export function ChartLegend({ names, hidden, onToggle }: ChartLegendProps) {
    if (names.length <= 1) return null;
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1" data-testid="kusto-chart-legend">
            {names.map((name, i) => {
                const off = hidden?.has(i) ?? false;
                const inner = (
                    <>
                        <span
                            className="inline-block w-2.5 h-2.5 rounded-sm"
                            style={{ backgroundColor: seriesColor(i), opacity: off ? 0.25 : 1 }}
                        />
                        {name}
                    </>
                );
                const className = `inline-flex items-center gap-1 text-[10px] text-[#616161] dark:text-[#cccccc]${off ? ' opacity-50 line-through' : ''}`;
                if (!onToggle) {
                    return <span key={name} className={className}>{inner}</span>;
                }
                return (
                    <button
                        key={name}
                        type="button"
                        className={`${className} cursor-pointer hover:opacity-80`}
                        aria-pressed={!off}
                        title={off ? `Show ${name}` : `Hide ${name}`}
                        onClick={() => onToggle(i)}
                    >
                        {inner}
                    </button>
                );
            })}
        </div>
    );
}

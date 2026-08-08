/**
 * Pure data helpers behind the Kusto chart surface.
 *
 * These are deliberately library-independent: they turn Kusto columns+rows plus
 * a chart config into labelled series, and answer "is this column numeric?" for
 * the Y-column picker. `KustoChart.tsx` re-exports every name here, so callers
 * (and tests) can keep importing from either module.
 */

import type {
    KustoCellValue,
    KustoChartConfig,
    KustoColumn,
} from '@plusplusoneplusplus/coc-client';

/** Kusto scalar types that count as numeric (case-insensitive). */
const NUMERIC_KUSTO_TYPES = new Set([
    'long', 'int', 'integer', 'real', 'double', 'decimal', 'float', 'number',
]);

/** Coerce a cell to a finite number, or null when it is not numeric. */
export function cellToNumber(value: KustoCellValue): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * Whether a column holds numeric data. Trusts the Kusto column `type` first,
 * then falls back to sampling up to 20 non-null cells (so string-typed columns
 * that actually carry numbers still qualify, and text columns are rejected).
 */
export function isNumericColumn(
    column: KustoColumn,
    rows: KustoCellValue[][],
    columnIndex: number,
): boolean {
    if (NUMERIC_KUSTO_TYPES.has((column.type ?? '').toLowerCase())) return true;
    let seen = 0;
    for (const row of rows) {
        const value = row[columnIndex];
        if (value === null || value === undefined) continue;
        seen += 1;
        if (cellToNumber(value) === null) return false;
        if (seen >= 20) break;
    }
    return seen > 0;
}

/** Names of the numeric columns, in column order. */
export function numericColumnNames(
    columns: KustoColumn[],
    rows: KustoCellValue[][],
): string[] {
    return columns.filter((c, i) => isNumericColumn(c, rows, i)).map(c => c.name);
}

export interface ChartSeries {
    name: string;
    /** Values aligned to `labels`; null where a category has no datum. */
    values: (number | null)[];
}

export interface ChartData {
    /** X-axis / category labels, one per plotted position. */
    labels: string[];
    series: ChartSeries[];
}

function cellLabel(value: KustoCellValue): string {
    if (value === null || value === undefined) return '';
    return String(value);
}

/**
 * Reduce columns+rows into labelled series per the chart config. Two modes:
 *  - `series` column set → one series per distinct series value, valued by the
 *    first y column.
 *  - otherwise → one series per selected y column.
 * Labels come from the x column (or the row index when x is unset).
 */
export function buildChartSeries(
    columns: KustoColumn[],
    rows: KustoCellValue[][],
    config: KustoChartConfig,
): ChartData {
    const indexOf = (name: string | undefined): number =>
        name ? columns.findIndex(c => c.name === name) : -1;
    const xIndex = indexOf(config.x);
    const yNames = (config.y ?? []).filter(Boolean);
    const yIndexes = yNames.map(indexOf).filter(i => i >= 0);
    if (yIndexes.length === 0) return { labels: [], series: [] };

    const labels: string[] = [];
    const labelPos = new Map<string, number>();
    const labelFor = (rowIndex: number, row: KustoCellValue[]): string =>
        xIndex >= 0 ? cellLabel(row[xIndex]) : String(rowIndex + 1);
    const ensureLabel = (label: string): number => {
        let pos = labelPos.get(label);
        if (pos === undefined) {
            pos = labels.length;
            labelPos.set(label, pos);
            labels.push(label);
        }
        return pos;
    };

    const seriesIndex = indexOf(config.series);
    if (seriesIndex >= 0) {
        // Grouped by the series column; value = first y column.
        const yIdx = yIndexes[0];
        const seriesNames: string[] = [];
        const seriesPos = new Map<string, number>();
        const grid: (number | null)[][] = [];
        rows.forEach((row, rowIndex) => {
            const label = labelFor(rowIndex, row);
            const lp = ensureLabel(label);
            const sName = cellLabel(row[seriesIndex]);
            let sp = seriesPos.get(sName);
            if (sp === undefined) {
                sp = seriesNames.length;
                seriesPos.set(sName, sp);
                seriesNames.push(sName);
                grid.push([]);
            }
            grid[sp][lp] = cellToNumber(row[yIdx]);
        });
        const series = seriesNames.map((name, sp) => ({
            name,
            values: labels.map((_, lp) => grid[sp][lp] ?? null),
        }));
        return { labels, series };
    }

    // One series per y column.
    const grid: (number | null)[][] = yIndexes.map(() => []);
    rows.forEach((row, rowIndex) => {
        const lp = ensureLabel(labelFor(rowIndex, row));
        yIndexes.forEach((yIdx, s) => {
            grid[s][lp] = cellToNumber(row[yIdx]);
        });
    });
    const series = yIndexes.map((_, s) => ({
        name: yNames[s],
        values: labels.map((_, lp) => grid[s][lp] ?? null),
    }));
    return { labels, series };
}

/** Colorblind-safe categorical palette (Tableau 10). */
export const CHART_PALETTE = [
    '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1',
    '#76b7b2', '#ff9da7', '#9c755f', '#edc948', '#bab0ac',
];

/** Palette color for the n-th series, wrapping around. */
export function seriesColor(index: number): string {
    return CHART_PALETTE[index % CHART_PALETTE.length];
}

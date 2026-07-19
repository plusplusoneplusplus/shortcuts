/**
 * @vitest-environment jsdom
 *
 * ExplorationChart (AC-05) — pure data helpers (numeric-column gating,
 * config → series mapping) and the config → render mapping for each chart type.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExplorationCellValue, ExplorationColumn } from '@plusplusoneplusplus/coc-client';
import {
    ExplorationChart,
    buildChartSeries,
    cellToNumber,
    isNumericColumn,
    numericColumnNames,
} from '../../../../../src/server/spa/client/react/features/canvas/ExplorationChart';

const columns: ExplorationColumn[] = [
    { name: 'State', type: 'string' },
    { name: 'Count', type: 'long' },
    { name: 'Damage', type: 'real' },
    { name: 'CodeAsText', type: 'string' },
];
const rows: ExplorationCellValue[][] = [
    ['Texas', 100, 3.5, '7'],
    ['Kansas', 55, 1.2, '9'],
    ['Iowa', 20, 0.5, 'n/a'],
];

describe('cellToNumber', () => {
    it('coerces numbers and numeric strings, rejects text and non-finite', () => {
        expect(cellToNumber(42)).toBe(42);
        expect(cellToNumber('3.14')).toBeCloseTo(3.14);
        expect(cellToNumber('hello')).toBeNull();
        expect(cellToNumber('')).toBeNull();
        expect(cellToNumber(null)).toBeNull();
        expect(cellToNumber(Infinity)).toBeNull();
    });
});

describe('isNumericColumn / numericColumnNames', () => {
    it('trusts numeric Kusto types', () => {
        expect(isNumericColumn(columns[1], rows, 1)).toBe(true); // long
        expect(isNumericColumn(columns[2], rows, 2)).toBe(true); // real
    });

    it('rejects plainly textual columns', () => {
        expect(isNumericColumn(columns[0], rows, 0)).toBe(false); // State
    });

    it('rejects a string column that mixes text into its cells', () => {
        // CodeAsText holds '7','9','n/a' — the 'n/a' disqualifies it.
        expect(isNumericColumn(columns[3], rows, 3)).toBe(false);
    });

    it('accepts a string column whose cells are all numeric', () => {
        const strNumCols: ExplorationColumn[] = [{ name: 'Port', type: 'string' }];
        const strNumRows: ExplorationCellValue[][] = [['80'], ['443'], ['8080']];
        expect(isNumericColumn(strNumCols[0], strNumRows, 0)).toBe(true);
    });

    it('lists only numeric columns for the Y picker', () => {
        expect(numericColumnNames(columns, rows)).toEqual(['Count', 'Damage']);
    });
});

describe('buildChartSeries', () => {
    it('maps one series per Y column, labelled by X', () => {
        const data = buildChartSeries(columns, rows, { type: 'bar', x: 'State', y: ['Count', 'Damage'] });
        expect(data.labels).toEqual(['Texas', 'Kansas', 'Iowa']);
        expect(data.series.map(s => s.name)).toEqual(['Count', 'Damage']);
        expect(data.series[0].values).toEqual([100, 55, 20]);
        expect(data.series[1].values).toEqual([3.5, 1.2, 0.5]);
    });

    it('groups by the series column when set', () => {
        const cols: ExplorationColumn[] = [
            { name: 'Month', type: 'string' },
            { name: 'Region', type: 'string' },
            { name: 'Sales', type: 'long' },
        ];
        const rws: ExplorationCellValue[][] = [
            ['Jan', 'East', 10],
            ['Jan', 'West', 20],
            ['Feb', 'East', 15],
            ['Feb', 'West', 25],
        ];
        const data = buildChartSeries(cols, rws, { type: 'line', x: 'Month', y: ['Sales'], series: 'Region' });
        expect(data.labels).toEqual(['Jan', 'Feb']);
        expect(data.series.map(s => s.name)).toEqual(['East', 'West']);
        expect(data.series[0].values).toEqual([10, 15]);
        expect(data.series[1].values).toEqual([20, 25]);
    });

    it('uses the row number as label when X is unset', () => {
        const data = buildChartSeries(columns, rows, { type: 'scatter', y: ['Count'] });
        expect(data.labels).toEqual(['1', '2', '3']);
    });

    it('returns empty series when no Y column resolves', () => {
        const data = buildChartSeries(columns, rows, { type: 'bar', x: 'State', y: ['Nope'] });
        expect(data.series).toHaveLength(0);
    });
});

describe('ExplorationChart render mapping', () => {
    const base = { columns, rows };

    it.each(['line', 'bar', 'scatter', 'stackedArea'] as const)('renders an SVG for %s charts', type => {
        render(<ExplorationChart {...base} config={{ type, x: 'State', y: ['Count'] }} />);
        const svg = screen.getByTestId('exploration-chart-svg');
        expect(svg).toBeInTheDocument();
        expect(svg.getAttribute('aria-label')).toContain(type);
    });

    it('renders a pie chart with slices', () => {
        render(<ExplorationChart {...base} config={{ type: 'pie', x: 'State', y: ['Count'] }} />);
        const svg = screen.getByTestId('exploration-chart-svg');
        expect(svg.getAttribute('aria-label')).toContain('pie');
    });

    it('prompts to configure when no Y column is chosen', () => {
        render(<ExplorationChart {...base} config={{ type: 'bar', x: 'State', y: [] }} />);
        expect(screen.getByTestId('exploration-chart-unconfigured')).toBeInTheDocument();
    });

    it('shows an empty state when there is no data', () => {
        render(<ExplorationChart columns={columns} rows={[]} config={{ type: 'bar', x: 'State', y: ['Count'] }} />);
        expect(screen.getByTestId('exploration-chart-empty')).toBeInTheDocument();
    });
});

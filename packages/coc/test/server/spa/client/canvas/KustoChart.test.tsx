/**
 * @vitest-environment jsdom
 *
 * KustoChart (AC-05) — pure data helpers (numeric-column gating,
 * config → series mapping) and the config → render mapping for each chart type.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { KustoCellValue, KustoColumn } from '@plusplusoneplusplus/coc-client';
import * as Recharts from 'recharts';
import {
    KustoChart,
    buildChartSeries,
    cellToNumber,
    isNumericColumn,
    numericColumnNames,
} from '../../../../../src/server/spa/client/react/features/canvas/KustoChart';

// The vendored recharts bundle is fetched at runtime in the browser; in tests we
// hand the component the npm copy directly. `loadResult` lets a single test flip
// the loader into its failure mode to exercise the static-SVG fallback (AC-06).
let loadResult: () => Promise<any> = () => Promise.resolve(Recharts);
vi.mock('../../../../../src/server/spa/client/react/features/canvas/rechartsLoader', () => ({
    loadRecharts: () => loadResult(),
    RECHARTS_VENDOR_URL: '/canvas-vendor/recharts.js',
    resetRechartsLoaderForTests: () => {},
}));

/**
 * jsdom has no layout engine, so recharts' ResponsiveContainer would measure
 * 0×0 and render nothing. Give every element a size (offsetWidth/offsetHeight,
 * which is what recharts reads) and a ResizeObserver that reports it once.
 */
beforeAll(() => {
    const define = (prop: 'offsetWidth' | 'offsetHeight', value: number) =>
        Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    define('offsetWidth', 640);
    define('offsetHeight', 360);
    class SizedResizeObserver {
        constructor(private cb: ResizeObserverCallback) {}
        observe(target: Element) {
            const entry = {
                target,
                contentRect: { width: 640, height: 360, top: 0, left: 0, bottom: 360, right: 640, x: 0, y: 0 },
            } as unknown as ResizeObserverEntry;
            this.cb([entry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
    }
    globalThis.ResizeObserver = SizedResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
    cleanup();
    loadResult = () => Promise.resolve(Recharts);
});

const columns: KustoColumn[] = [
    { name: 'State', type: 'string' },
    { name: 'Count', type: 'long' },
    { name: 'Damage', type: 'real' },
    { name: 'CodeAsText', type: 'string' },
];
const rows: KustoCellValue[][] = [
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
        const strNumCols: KustoColumn[] = [{ name: 'Port', type: 'string' }];
        const strNumRows: KustoCellValue[][] = [['80'], ['443'], ['8080']];
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
        const cols: KustoColumn[] = [
            { name: 'Month', type: 'string' },
            { name: 'Region', type: 'string' },
            { name: 'Sales', type: 'long' },
        ];
        const rws: KustoCellValue[][] = [
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

describe('KustoChart render mapping', () => {
    const base = { columns, rows };

    it.each(['line', 'bar', 'scatter', 'stackedArea', 'pie'] as const)(
        'renders a recharts plot for %s charts',
        async type => {
            const { container } = render(<KustoChart {...base} config={{ type, x: 'State', y: ['Count'] }} />);
            await waitFor(() => {
                expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
            });
            expect(container.querySelector('.recharts-surface')?.innerHTML).toBeTruthy();
        },
    );

    it('shows a placeholder while the recharts bundle is loading', () => {
        loadResult = () => new Promise(() => {});
        render(<KustoChart {...base} config={{ type: 'line', x: 'State', y: ['Count'] }} />);
        expect(screen.getByTestId('kusto-chart-loading')).toBeInTheDocument();
    });

    it('falls back to the static SVG when the loader rejects', async () => {
        loadResult = () => Promise.reject(new Error('no vendor bundle'));
        render(<KustoChart {...base} config={{ type: 'line', x: 'State', y: ['Count'] }} />);
        const svg = await screen.findByTestId('kusto-chart-svg');
        expect(svg.getAttribute('aria-label')).toContain('line');
    });

    it('prompts to configure when no Y column is chosen', () => {
        render(<KustoChart {...base} config={{ type: 'bar', x: 'State', y: [] }} />);
        expect(screen.getByTestId('kusto-chart-unconfigured')).toBeInTheDocument();
    });

    it('shows an empty state when there is no data', () => {
        render(<KustoChart columns={columns} rows={[]} config={{ type: 'bar', x: 'State', y: ['Count'] }} />);
        expect(screen.getByTestId('kusto-chart-empty')).toBeInTheDocument();
    });
});

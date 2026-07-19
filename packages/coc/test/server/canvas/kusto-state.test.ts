import { describe, it, expect } from 'vitest';
import { MAX_KUSTO_ROWS } from '@plusplusoneplusplus/coc-client';
import {
    createEmptyKustoState,
    parseKustoState,
    serializeKustoState,
    truncateRows,
    type KustoCanvasState,
} from '../../../src/server/canvas/kusto-state';

describe('kusto-state (AC-01 data model)', () => {
    describe('createEmptyKustoState', () => {
        it('returns a blank state with empty query/cluster/database and no rows', () => {
            expect(createEmptyKustoState()).toEqual({
                query: '',
                clusterUrl: '',
                database: '',
                columns: [],
                rows: [],
                truncated: false,
            });
        });

        it('pre-fills cluster/database seeds (AC-07 manual create path)', () => {
            const seeded = createEmptyKustoState({
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
            });
            expect(seeded.clusterUrl).toBe('https://help.kusto.windows.net');
            expect(seeded.database).toBe('Samples');
            expect(seeded.rows).toEqual([]);
        });
    });

    describe('serialize/parse round-trip', () => {
        it('round-trips a fully populated Kusto state', () => {
            const state: KustoCanvasState = {
                query: 'StormEvents | take 3',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [
                    { name: 'State', type: 'string' },
                    { name: 'Count', type: 'long' },
                ],
                rows: [
                    ['TEXAS', 100],
                    ['KANSAS', 55],
                    ['FLORIDA', null],
                ],
                truncated: false,
                chartConfig: { type: 'bar', x: 'State', y: ['Count'], series: undefined },
                lastRun: { timestamp: '2026-07-18T00:00:00.000Z', status: 'success', rowCount: 3 },
            };

            const restored = parseKustoState(serializeKustoState(state));
            expect(restored.query).toBe(state.query);
            expect(restored.clusterUrl).toBe(state.clusterUrl);
            expect(restored.database).toBe(state.database);
            expect(restored.columns).toEqual(state.columns);
            expect(restored.rows).toEqual(state.rows);
            expect(restored.chartConfig).toEqual({ type: 'bar', x: 'State', y: ['Count'] });
            expect(restored.lastRun).toEqual(state.lastRun);
        });

        it('falls back to an empty state on non-JSON / corrupt content', () => {
            expect(parseKustoState('not json {')).toEqual(createEmptyKustoState());
            expect(parseKustoState('')).toEqual(createEmptyKustoState());
            expect(parseKustoState(null)).toEqual(createEmptyKustoState());
            expect(parseKustoState('42')).toEqual(createEmptyKustoState());
        });

        it('drops an invalid chart type and preserves the rest', () => {
            const restored = parseKustoState(
                JSON.stringify({ query: 'q', clusterUrl: 'c', database: 'd', chartConfig: { type: 'pie3d' } }),
            );
            expect(restored.query).toBe('q');
            expect(restored.chartConfig).toBeUndefined();
        });

        it('coerces malformed columns/rows to safe shapes', () => {
            const restored = parseKustoState(
                JSON.stringify({
                    columns: [{ name: 'A' }, { nope: true }, 'garbage'],
                    rows: [[1, 2], 'not-a-row', [3]],
                }),
            );
            expect(restored.columns).toEqual([{ name: 'A', type: 'string' }]);
            expect(restored.rows).toEqual([[1, 2], [3]]);
        });
    });

    describe('truncateRows (10k row cap)', () => {
        it('leaves a result under the cap untouched and unflagged', () => {
            const rows = Array.from({ length: 100 }, (_, i) => [i]);
            expect(truncateRows(rows)).toEqual({ rows, truncated: false });
        });

        it('caps a result over 10k rows and flags truncation', () => {
            const rows = Array.from({ length: MAX_KUSTO_ROWS + 250 }, (_, i) => [i]);
            const result = truncateRows(rows);
            expect(result.truncated).toBe(true);
            expect(result.rows).toHaveLength(MAX_KUSTO_ROWS);
            expect(result.rows[MAX_KUSTO_ROWS - 1]).toEqual([MAX_KUSTO_ROWS - 1]);
        });

        it('treats exactly 10k rows as not truncated', () => {
            const rows = Array.from({ length: MAX_KUSTO_ROWS }, (_, i) => [i]);
            expect(truncateRows(rows).truncated).toBe(false);
        });
    });

    describe('parse re-enforces the row cap on read', () => {
        it('truncates an over-cap persisted rows array and sets truncated', () => {
            const oversized = {
                query: 'q',
                clusterUrl: 'c',
                database: 'd',
                columns: [{ name: 'n', type: 'long' }],
                rows: Array.from({ length: MAX_KUSTO_ROWS + 5 }, (_, i) => [i]),
                truncated: false,
            };
            const restored = parseKustoState(JSON.stringify(oversized));
            expect(restored.rows).toHaveLength(MAX_KUSTO_ROWS);
            expect(restored.truncated).toBe(true);
        });
    });
});

import { describe, it, expect } from 'vitest';
import { MAX_EXPLORATION_ROWS } from '@plusplusoneplusplus/coc-client';
import {
    createEmptyExplorationState,
    parseExplorationState,
    serializeExplorationState,
    truncateRows,
    type ExplorationState,
} from '../../../src/server/canvas/exploration-state';

describe('exploration-state (AC-01 data model)', () => {
    describe('createEmptyExplorationState', () => {
        it('returns a blank state with empty query/cluster/database and no rows', () => {
            expect(createEmptyExplorationState()).toEqual({
                query: '',
                clusterUrl: '',
                database: '',
                columns: [],
                rows: [],
                truncated: false,
            });
        });

        it('pre-fills cluster/database seeds (AC-07 manual create path)', () => {
            const seeded = createEmptyExplorationState({
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
            });
            expect(seeded.clusterUrl).toBe('https://help.kusto.windows.net');
            expect(seeded.database).toBe('Samples');
            expect(seeded.rows).toEqual([]);
        });
    });

    describe('serialize/parse round-trip', () => {
        it('round-trips a fully populated exploration state', () => {
            const state: ExplorationState = {
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

            const restored = parseExplorationState(serializeExplorationState(state));
            expect(restored.query).toBe(state.query);
            expect(restored.clusterUrl).toBe(state.clusterUrl);
            expect(restored.database).toBe(state.database);
            expect(restored.columns).toEqual(state.columns);
            expect(restored.rows).toEqual(state.rows);
            expect(restored.chartConfig).toEqual({ type: 'bar', x: 'State', y: ['Count'] });
            expect(restored.lastRun).toEqual(state.lastRun);
        });

        it('falls back to an empty state on non-JSON / corrupt content', () => {
            expect(parseExplorationState('not json {')).toEqual(createEmptyExplorationState());
            expect(parseExplorationState('')).toEqual(createEmptyExplorationState());
            expect(parseExplorationState(null)).toEqual(createEmptyExplorationState());
            expect(parseExplorationState('42')).toEqual(createEmptyExplorationState());
        });

        it('drops an invalid chart type and preserves the rest', () => {
            const restored = parseExplorationState(
                JSON.stringify({ query: 'q', clusterUrl: 'c', database: 'd', chartConfig: { type: 'pie3d' } }),
            );
            expect(restored.query).toBe('q');
            expect(restored.chartConfig).toBeUndefined();
        });

        it('coerces malformed columns/rows to safe shapes', () => {
            const restored = parseExplorationState(
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
            const rows = Array.from({ length: MAX_EXPLORATION_ROWS + 250 }, (_, i) => [i]);
            const result = truncateRows(rows);
            expect(result.truncated).toBe(true);
            expect(result.rows).toHaveLength(MAX_EXPLORATION_ROWS);
            expect(result.rows[MAX_EXPLORATION_ROWS - 1]).toEqual([MAX_EXPLORATION_ROWS - 1]);
        });

        it('treats exactly 10k rows as not truncated', () => {
            const rows = Array.from({ length: MAX_EXPLORATION_ROWS }, (_, i) => [i]);
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
                rows: Array.from({ length: MAX_EXPLORATION_ROWS + 5 }, (_, i) => [i]),
                truncated: false,
            };
            const restored = parseExplorationState(JSON.stringify(oversized));
            expect(restored.rows).toHaveLength(MAX_EXPLORATION_ROWS);
            expect(restored.truncated).toBe(true);
        });
    });
});

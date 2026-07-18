import { describe, it, expect } from 'vitest';
import {
    coerceCellValue,
    executeKustoQuery,
    type KustoClientFactory,
    type KustoClientLike,
} from '../../../src/server/kusto/kusto-exec';

/** Build a mock KustoResultTable-shaped response from columns + raw rows. */
function mockResponse(
    columns: Array<{ name: string | null; type: string | null }>,
    rows: unknown[][],
) {
    return {
        primaryResults: [
            {
                columns,
                rows: () => rows.map(r => ({ getValueAt: (i: number) => r[i] })),
            },
        ],
    };
}

/** A client factory that resolves to a client whose execute() returns `response`. */
function factoryReturning(response: unknown): KustoClientFactory {
    return () => ({ execute: async () => response as never }) as unknown as KustoClientLike;
}

describe('coerceCellValue', () => {
    it('passes primitives through and nulls undefined', () => {
        expect(coerceCellValue('hi')).toBe('hi');
        expect(coerceCellValue(42)).toBe(42);
        expect(coerceCellValue(true)).toBe(true);
        expect(coerceCellValue(null)).toBeNull();
        expect(coerceCellValue(undefined)).toBeNull();
    });

    it('stringifies dates as ISO', () => {
        expect(coerceCellValue(new Date('2020-01-02T03:04:05.000Z'))).toBe('2020-01-02T03:04:05.000Z');
    });

    it('stringifies non-finite numbers', () => {
        expect(coerceCellValue(Infinity)).toBe('Infinity');
        expect(coerceCellValue(NaN)).toBe('NaN');
    });

    it('JSON-stringifies dynamic/object columns', () => {
        expect(coerceCellValue({ a: 1 })).toBe('{"a":1}');
        expect(coerceCellValue([1, 2])).toBe('[1,2]');
    });

    it('keeps safe bigints as numbers and unsafe ones as strings', () => {
        expect(coerceCellValue(10n)).toBe(10);
        expect(coerceCellValue(9007199254740993n)).toBe('9007199254740993');
    });
});

describe('executeKustoQuery', () => {
    const params = { clusterUrl: 'https://c.kusto.windows.net', database: 'DB', query: 'T | take 1' };

    it('returns typed columns and coerced rows on success', async () => {
        const response = mockResponse(
            [{ name: 'Name', type: 'string' }, { name: 'Count', type: 'long' }],
            [['a', 1], ['b', 2]],
        );
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning(response) });
        expect(result.columns).toEqual([
            { name: 'Name', type: 'string' },
            { name: 'Count', type: 'long' },
        ]);
        expect(result.rows).toEqual([['a', 1], ['b', 2]]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
    });

    it('backfills missing column names/types', async () => {
        const response = mockResponse([{ name: null, type: null }], [['x']]);
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning(response) });
        expect(result.columns).toEqual([{ name: 'Column1', type: 'string' }]);
    });

    it('truncates rows beyond the cap and reports the full count', async () => {
        const rows = Array.from({ length: 5 }, (_, i) => [i]);
        const response = mockResponse([{ name: 'n', type: 'long' }], rows);
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning(response), cap: 3 });
        expect(result.rows).toHaveLength(3);
        expect(result.rowCount).toBe(5);
        expect(result.truncated).toBe(true);
    });

    it('propagates a query error from execute()', async () => {
        const factory: KustoClientFactory = () => ({
            execute: async () => {
                throw new Error('Semantic error: query is malformed');
            },
        });
        await expect(executeKustoQuery(params, { clientFactory: factory })).rejects.toThrow(
            'Semantic error: query is malformed',
        );
    });

    it('propagates an auth error from the client factory', async () => {
        const factory: KustoClientFactory = () => {
            throw new Error('AzureCliCredential: az login required');
        };
        await expect(executeKustoQuery(params, { clientFactory: factory })).rejects.toThrow(
            'az login required',
        );
    });

    it('returns an empty result when there are no primary results', async () => {
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning({ primaryResults: [] }) });
        expect(result).toEqual({ columns: [], rows: [], rowCount: 0, truncated: false });
    });
});

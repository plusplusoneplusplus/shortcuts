import { describe, it, expect, vi } from 'vitest';
import {
    coerceCellValue,
    MAX_KUSTO_RESULT_BYTES,
    executeKustoQuery,
    type KustoClientFactory,
    type KustoClientLike,
} from '../../../src/server/kusto/kusto-exec';
import { MAX_KUSTO_ROWS } from '../../../src/server/canvas/kusto-state';

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

/** A client factory that resolves to a client whose executeQuery() returns `response`. */
function factoryReturning(response: unknown): KustoClientFactory {
    return () => ({ executeQuery: async () => response as never }) as unknown as KustoClientLike;
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

    it('keeps unusual values JSON-safe', () => {
        expect(coerceCellValue(Symbol('x'))).toBe('Symbol(x)');
        expect(coerceCellValue(() => 1)).toEqual(expect.any(String));
        expect(coerceCellValue(new Date(NaN))).toBe('Invalid Date');
        expect(coerceCellValue({ toJSON: () => undefined })).toEqual(expect.any(String));
    });

    it('keeps safe bigints as numbers and unsafe ones as strings', () => {
        expect(coerceCellValue(10n)).toBe(10);
        expect(coerceCellValue(9007199254740993n)).toBe('9007199254740993');
    });
});

describe('executeKustoQuery', () => {
    const params = { clusterUrl: 'https://c.kusto.windows.net', database: 'DB', query: 'T | take 1' };

    it.each([
        '.show tables',
        ' \n\t.set-or-append T <| print x=1',
        '\ufeff.drop table T',
        '.show tables | count',
    ])('rejects management text before client construction: %s', async query => {
        const factory = vi.fn();
        await expect(executeKustoQuery({ ...params, query }, { clientFactory: factory }))
            .rejects.toThrow('management commands require explicit approval');
        expect(factory).not.toHaveBeenCalled();
    });

    it('uses only executeQuery even when an injected SDK also exposes execute and executeMgmt', async () => {
        const execute = vi.fn();
        const executeMgmt = vi.fn();
        const executeQuery = vi.fn(async () => mockResponse([], []));
        await executeKustoQuery(params, { clientFactory: () => ({ execute, executeMgmt, executeQuery }) });
        expect(executeQuery).toHaveBeenCalledExactlyOnceWith(params.database, params.query);
        expect(execute).not.toHaveBeenCalled();
        expect(executeMgmt).not.toHaveBeenCalled();
    });

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

    it('bounds UTF-8 JSON bytes and retains a prefix with the full count', async () => {
        const text = '你好'.repeat(10) + JSON.stringify('line\n');
        const response = mockResponse([{ name: 'text', type: 'string' }], [
            [text], ['large'.repeat(100)], ['small'],
        ]);
        const result = await executeKustoQuery(params, {
            clientFactory: factoryReturning(response), maxBytes: 256,
        });
        expect(result.rows).toEqual([[text]]);
        expect(result.rowCount).toBe(3);
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(256);
    });

    it('applies the default byte ceiling to a single oversized row', async () => {
        const response = mockResponse([{ name: 'text', type: 'string' }], [
            ['x'.repeat(MAX_KUSTO_RESULT_BYTES)],
        ]);
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning(response) });
        expect(result).toMatchObject({ rows: [], rowCount: 1, truncated: true });
        expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(MAX_KUSTO_RESULT_BYTES);
    });

    it('does not convert rows discarded by row or byte limits', async () => {
        const read = vi.fn(() => { throw new Error('discarded cells must not be read'); });
        const response = { primaryResults: [{
            columns: [{ name: 'x', type: 'string' }],
            rows: () => [{ getValueAt: () => 'x'.repeat(300) }, { getValueAt: read }],
        }] };
        for (const limits of [{ cap: 0 }, { cap: 1 }, { maxBytes: 128 }]) {
            const result = await executeKustoQuery(params, {
                clientFactory: factoryReturning(response), ...limits,
            });
            expect(result.rowCount).toBe(2);
            expect(result.truncated).toBe(true);
        }
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects oversized column metadata without returning partial JSON', async () => {
        const response = mockResponse([{ name: 'x'.repeat(300), type: 'string' }], []);
        await expect(executeKustoQuery(params, {
            clientFactory: factoryReturning(response), maxBytes: 128,
        })).rejects.toThrow('column metadata exceeds the byte limit');
    });

    it.each([
        { cap: -1 }, { cap: 1.5 }, { cap: NaN }, { cap: Infinity }, { cap: MAX_KUSTO_ROWS + 1 },
        { maxBytes: 0 }, { maxBytes: 1.5 }, { maxBytes: NaN }, { maxBytes: Infinity },
        { maxBytes: MAX_KUSTO_RESULT_BYTES + 1 },
    ])('rejects invalid bounds before creating a client: %j', async limits => {
        const factory = vi.fn();
        await expect(executeKustoQuery(params, { clientFactory: factory, ...limits })).rejects.toThrow('cap must be');
        expect(factory).not.toHaveBeenCalled();
    });

    it('propagates a query error from executeQuery()', async () => {
        const factory: KustoClientFactory = () => ({
            executeQuery: async () => {
                throw new Error('Semantic error: query is malformed');
            },
        });
        await expect(executeKustoQuery(params, { clientFactory: factory })).rejects.toThrow(
            'Semantic error: query is malformed',
        );
    });

    it('propagates an auth error from the client factory', async () => {
        const factory: KustoClientFactory = () => {
            throw new Error('Kusto Rust auth: az login required');
        };
        await expect(executeKustoQuery(params, { clientFactory: factory })).rejects.toThrow(
            'az login required',
        );
    });

    it('refuses unwired real execution rather than creating a fallback credential', async () => {
        await expect(executeKustoQuery(params)).rejects.toThrow('host-owned Rust client factory');
    });

    it('returns an empty result when there are no primary results', async () => {
        const result = await executeKustoQuery(params, { clientFactory: factoryReturning({ primaryResults: [] }) });
        expect(result).toEqual({ columns: [], rows: [], rowCount: 0, truncated: false });
    });
});

describe('executeKustoQuery — magic mock: queries', () => {
    const params = { clusterUrl: 'mock', database: 'mock', query: '' };

    /** A factory that fails if invoked — proves a mock: query skips the SDK path. */
    const neverFactory: KustoClientFactory = () => {
        throw new Error('client factory must not be called for a mock: query');
    };

    it('serves a mock: JSON query from inline data, skipping the client factory', async () => {
        const query = `mock:
        {
          "columns": [
            { "name": "Name",   "type": "string"   },
            { "name": "Count",  "type": "long"     },
            { "name": "Ratio",  "type": "real"     },
            { "name": "Active", "type": "bool"     },
            { "name": "When",   "type": "datetime" }
          ],
          "rows": [
            ["alpha", 10, 0.5,  true,  "2024-01-01T00:00:00Z"],
            ["beta",  20, 1.25, false, null]
          ]
        }`;
        const result = await executeKustoQuery({ ...params, query }, { clientFactory: neverFactory });
        expect(result.columns).toEqual([
            { name: 'Name', type: 'string' },
            { name: 'Count', type: 'long' },
            { name: 'Ratio', type: 'real' },
            { name: 'Active', type: 'bool' },
            { name: 'When', type: 'datetime' },
        ]);
        expect(result.rows).toEqual([
            ['alpha', 10, 0.5, true, '2024-01-01T00:00:00Z'],
            ['beta', 20, 1.25, false, null],
        ]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
    });

    it('matches the mock: prefix case-insensitively', async () => {
        const result = await executeKustoQuery(
            { ...params, query: 'MOCK:{ "columns": [{ "name": "x", "type": "long" }], "rows": [[1]] }' },
            { clientFactory: neverFactory },
        );
        expect(result.columns).toEqual([{ name: 'x', type: 'long' }]);
        expect(result.rows).toEqual([[1]]);
    });

    it('mock:error throws the default message', async () => {
        await expect(
            executeKustoQuery({ ...params, query: 'mock:error' }, { clientFactory: neverFactory }),
        ).rejects.toThrow('Mock Kusto error');
    });

    it('mock:error: <message> throws with that message', async () => {
        await expect(
            executeKustoQuery({ ...params, query: 'mock:error: boom' }, { clientFactory: neverFactory }),
        ).rejects.toThrow('boom');
    });

    it('mock:big returns more rows than the cap and reports truncation', async () => {
        const result = await executeKustoQuery({ ...params, query: 'mock:big' }, { clientFactory: neverFactory });
        expect(result.columns.map(c => c.name)).toEqual(['Index', 'Value', 'Label']);
        expect(result.rowCount).toBe(MAX_KUSTO_ROWS + 50);
        expect(result.rows).toHaveLength(MAX_KUSTO_ROWS);
        expect(result.truncated).toBe(true);
    });

    it('mock:big: <N> generates exactly N rows (still capped)', async () => {
        const result = await executeKustoQuery(
            { ...params, query: 'mock:big: 5' },
            { clientFactory: neverFactory, cap: 3 },
        );
        expect(result.rowCount).toBe(5);
        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
    });

    it('throws on malformed mock JSON (surfaced as the canvas error state)', async () => {
        await expect(
            executeKustoQuery({ ...params, query: 'mock:{ bad json' }, { clientFactory: neverFactory }),
        ).rejects.toThrow();
    });

    it('does not intercept a normal query that merely contains the word "mock"', async () => {
        const response = mockResponse([{ name: 'n', type: 'long' }], [[1]]);
        let called = 0;
        const factory: KustoClientFactory = () => {
            called++;
            return { executeQuery: async () => response as never } as unknown as KustoClientLike;
        };
        const result = await executeKustoQuery(
            { ...params, query: 'T | where Name == "mock" | take 1' },
            { clientFactory: factory },
        );
        expect(called).toBe(1);
        expect(result.rows).toEqual([[1]]);
    });
});

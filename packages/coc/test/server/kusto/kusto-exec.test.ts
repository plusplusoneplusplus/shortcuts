import { describe, it, expect } from 'vitest';
import {
    coerceCellValue,
    createCachedClientFactory,
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
            return { execute: async () => response as never } as unknown as KustoClientLike;
        };
        const result = await executeKustoQuery(
            { ...params, query: 'T | where Name == "mock" | take 1' },
            { clientFactory: factory },
        );
        expect(called).toBe(1);
        expect(result.rows).toEqual([[1]]);
    });
});

describe('createCachedClientFactory', () => {
    it('builds the client once per clusterUrl and reuses it on subsequent runs', async () => {
        let builds = 0;
        const factory = createCachedClientFactory(async () => {
            builds++;
            return { execute: async () => ({ primaryResults: [] }) } as unknown as KustoClientLike;
        });
        const a1 = await factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' });
        const a2 = await factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q2' });
        expect(builds).toBe(1);
        expect(a1).toBe(a2);
    });

    it('builds a separate client per distinct clusterUrl', async () => {
        let builds = 0;
        const factory = createCachedClientFactory(async () => {
            builds++;
            return { execute: async () => ({ primaryResults: [] }) } as unknown as KustoClientLike;
        });
        await factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' });
        await factory({ clusterUrl: 'https://b.kusto.windows.net', database: 'D', query: 'q' });
        expect(builds).toBe(2);
    });

    it('shares one in-flight build across concurrent first runs', async () => {
        let builds = 0;
        const factory = createCachedClientFactory(async () => {
            builds++;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { execute: async () => ({ primaryResults: [] }) } as unknown as KustoClientLike;
        });
        const [c1, c2] = await Promise.all([
            factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' }),
            factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' }),
        ]);
        expect(builds).toBe(1);
        expect(c1).toBe(c2);
    });

    it('evicts a rejected build so the next run retries', async () => {
        let builds = 0;
        const factory = createCachedClientFactory(async () => {
            builds++;
            if (builds === 1) throw new Error('AzureCliCredential: az login required');
            return { execute: async () => ({ primaryResults: [] }) } as unknown as KustoClientLike;
        });
        await expect(
            factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' }),
        ).rejects.toThrow('az login required');
        // The failure was evicted, so a retry rebuilds and succeeds.
        await factory({ clusterUrl: 'https://a.kusto.windows.net', database: 'D', query: 'q' });
        expect(builds).toBe(2);
    });
});

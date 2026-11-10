import { describe, expect, it } from 'vitest';
import { readKustoQueryToolResult } from '../../../src/server/kusto/kusto-query-tool-result';
import { MAX_KUSTO_RESULT_BYTES } from '../../../src/server/kusto/kusto-exec';

const result = { success: true, columns: [{ name: 'n', type: 'long' }], rows: [[1]], rowCount: 1, truncated: false };

describe('Kusto query tool result boundary', () => {
    it('preserves schema, JSON-safe cells, total count and byte/row truncation', () => {
        const value = { ...result, rows: [[null], ['text'], [false], [1.5]], rowCount: 15, truncated: true };
        const { success, ...expected } = value;
        expect(readKustoQueryToolResult(value)).toEqual(expected);
        expect(readKustoQueryToolResult({ ...result, rows: [], rowCount: 1, truncated: true }).rows).toEqual([]);
    });

    it('surfaces tool failures instead of treating an error envelope as empty success', () => {
        expect(() => readKustoQueryToolResult({ success: false, error: 'Semantic error' })).toThrow('Semantic error');
        expect(() => readKustoQueryToolResult({ success: false })).toThrow('Kusto query failed');
    });

    it.each([
        null, 'partial JSON', {}, { ...result, success: undefined },
        { ...result, columns: [{ name: 'n' }] }, { ...result, columns: [null] },
        { ...result, rows: [1] }, { ...result, rows: [[1, 2]] }, { ...result, rows: [[{}]] },
        { ...result, rows: [[Infinity]] }, { ...result, rows: [[NaN]] },
        { ...result, rowCount: -1 }, { ...result, rowCount: 0 }, { ...result, rowCount: 1.5 },
        { ...result, rowCount: Number.MAX_SAFE_INTEGER + 1 }, { ...result, truncated: 'false' },
        { ...result, truncated: true }, { ...result, rowCount: 2 },
        { ...result, rows: Array.from({ length: 10_001 }, () => [1]), rowCount: 10_001 },
    ])('rejects malformed results without coercing them into stored data (%#)', value => {
        expect(() => readKustoQueryToolResult(value)).toThrow('Invalid Kusto query tool result');
    });

    it('rejects oversized results including column metadata rather than slicing JSON', () => {
        expect(() => readKustoQueryToolResult({ ...result, rows: [['界'.repeat(MAX_KUSTO_RESULT_BYTES / 3)]] }))
            .toThrow('exceeds the byte limit');
        expect(() => readKustoQueryToolResult({ ...result, columns: [{ name: 'x'.repeat(MAX_KUSTO_RESULT_BYTES), type: 'string' }] }))
            .toThrow('exceeds the byte limit');
    });
});

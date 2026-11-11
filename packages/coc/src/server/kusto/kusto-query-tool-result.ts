import { MAX_KUSTO_ROWS } from '../canvas/kusto-state';
import { MAX_KUSTO_RESULT_BYTES, type KustoQueryResult } from './kusto-exec';

/** Validate the JSON boundary between a tool script and canvas persistence. Never accept partial results. */
export function readKustoQueryToolResult(value: unknown): KustoQueryResult {
    if (!value || typeof value !== 'object') throw new Error('Invalid Kusto query tool result');
    const result = value as Record<string, unknown>;
    if (result.success === false) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Kusto query failed');
    }
    const { columns, rows, rowCount, truncated } = result;
    if (result.success !== true || !Array.isArray(columns) || !Array.isArray(rows)
        || !columns.every(column => column && typeof column.name === 'string' && typeof column.type === 'string')
        || rows.length > MAX_KUSTO_ROWS
        || !rows.every(row => Array.isArray(row) && row.length === columns.length
            && row.every(cell => cell === null || typeof cell === 'string' || typeof cell === 'boolean'
                || (typeof cell === 'number' && Number.isFinite(cell))))
        || !Number.isSafeInteger(rowCount) || (rowCount as number) < rows.length
        || typeof truncated !== 'boolean' || truncated !== ((rowCount as number) > rows.length)) {
        throw new Error('Invalid Kusto query tool result');
    }
    const queryResult = { columns, rows, rowCount, truncated } as KustoQueryResult;
    if (Buffer.byteLength(JSON.stringify(queryResult), 'utf8') > MAX_KUSTO_RESULT_BYTES) {
        throw new Error('Kusto query tool result exceeds the byte limit');
    }
    return queryResult;
}

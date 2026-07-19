/**
 * Server-side Kusto query execution for Kusto canvases (AC-02).
 *
 * Executes a KQL query against a cluster/database with the official
 * `azure-kusto-data` SDK, authenticated with the machine's existing `az login`
 * session via `@azure/identity` `AzureCliCredential` — no shelling out to a
 * Kusto CLI, no temp files, no CSV parsing.
 *
 * The SDK client is created through an injectable factory ({@link KustoExecOptions.clientFactory})
 * so tests exercise success / query-error / auth-error / truncation paths with a
 * mocked client and never touch the network or a real credential.
 *
 * Results are coerced to JSON-safe {@link KustoCellValue}s and truncated to
 * {@link MAX_KUSTO_ROWS}; `rowCount` reports the pre-truncation total.
 */

import {
    MAX_KUSTO_ROWS,
    truncateRows,
    type KustoCellValue,
    type KustoColumn,
} from '../canvas/kusto-state';

/** The inputs a Kusto run needs; all editable per-canvas (AC-02). */
export interface KustoQueryParams {
    clusterUrl: string;
    database: string;
    query: string;
}

/** Typed, truncated result of a query, ready to store on a Kusto canvas. */
export interface KustoQueryResult {
    columns: KustoColumn[];
    /** Rows capped at {@link MAX_KUSTO_ROWS}, row-major aligned to `columns`. */
    rows: KustoCellValue[][];
    /** Total rows returned by the query before truncation. */
    rowCount: number;
    /** True when the result set exceeded the cap and was sliced. */
    truncated: boolean;
}

// ---------------------------------------------------------------------------
// Minimal structural view of the SDK surface we depend on. Declaring it here
// (rather than importing the concrete classes) lets tests inject a plain mock
// and keeps the ESM-only SDK out of the module-load / test graph.
// ---------------------------------------------------------------------------

interface KustoResultColumnLike {
    name: string | null;
    type: string | null;
}

interface KustoResultRowLike {
    getValueAt(index: number): unknown;
}

interface KustoResultTableLike {
    columns: KustoResultColumnLike[];
    rows(): Iterable<KustoResultRowLike>;
}

interface KustoResponseLike {
    primaryResults: KustoResultTableLike[];
}

/** The single method of the SDK's `Client` we call. */
export interface KustoClientLike {
    execute(db: string, query: string): Promise<KustoResponseLike>;
}

/** Builds an authenticated client for a cluster. Overridable in tests. */
export type KustoClientFactory = (params: KustoQueryParams) => KustoClientLike | Promise<KustoClientLike>;

export interface KustoExecOptions {
    clientFactory?: KustoClientFactory;
    /** Row cap; defaults to {@link MAX_KUSTO_ROWS}. */
    cap?: number;
}

/**
 * Default factory: build an `azure-kusto-data` client authenticated with the
 * machine's `az login` session. Loaded lazily via dynamic import because the
 * SDK is ESM-only and only needed when a real query actually runs.
 */
const defaultClientFactory: KustoClientFactory = async ({ clusterUrl }) => {
    const { Client, KustoConnectionStringBuilder } = await import('azure-kusto-data');
    const { AzureCliCredential } = await import('@azure/identity');
    const kcsb = KustoConnectionStringBuilder.withTokenCredential(clusterUrl, new AzureCliCredential());
    return new Client(kcsb) as unknown as KustoClientLike;
};

/** Coerce a raw Kusto cell value into a JSON-safe {@link KustoCellValue}. */
export function coerceCellValue(value: unknown): KustoCellValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
    }
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    // dynamic columns, arrays, or other objects → JSON text
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Run a KQL query and return typed, truncated columns + rows.
 *
 * Throws an `Error` (message preserved) on auth/connection/query failure so the
 * caller can record it as the Kusto canvas's error state.
 */
export async function executeKustoQuery(
    params: KustoQueryParams,
    opts: KustoExecOptions = {},
): Promise<KustoQueryResult> {
    const factory = opts.clientFactory ?? defaultClientFactory;
    const cap = opts.cap ?? MAX_KUSTO_ROWS;

    const client = await factory(params);
    const response = await client.execute(params.database, params.query);

    const table = response?.primaryResults?.[0];
    if (!table) {
        return { columns: [], rows: [], rowCount: 0, truncated: false };
    }

    const columns: KustoColumn[] = table.columns.map((col, i) => ({
        name: col.name ?? `Column${i + 1}`,
        type: col.type ?? 'string',
    }));

    const allRows: KustoCellValue[][] = [];
    for (const row of table.rows()) {
        const cells: KustoCellValue[] = [];
        for (let i = 0; i < columns.length; i++) {
            cells.push(coerceCellValue(row.getValueAt(i)));
        }
        allRows.push(cells);
    }

    const rowCount = allRows.length;
    const { rows, truncated } = truncateRows(allRows, cap);
    return { columns, rows, rowCount, truncated };
}

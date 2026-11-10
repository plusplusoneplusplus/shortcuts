/**
 * Server-side Kusto query execution for Kusto canvases (AC-02).
 *
 * Executes a KQL query against a cluster/database with the official
 * `azure-kusto-data` SDK, authenticated with the machine's existing `az login`
 * session via the host-selected credential — no shelling out to a
 * Kusto CLI, no temp files, no CSV parsing.
 *
 * The SDK client is created through an injectable factory ({@link KustoExecOptions.clientFactory})
 * so tests exercise success / query-error / auth-error / truncation paths with a
 * mocked client and never touch the network or a real credential.
 *
 * Server composition supplies its host-owned, configuration-sensitive factory.
 * Real standalone calls require an explicit factory from a host runtime.
 * Injected factories are used verbatim.
 *
 * Results are coerced to JSON-safe {@link KustoCellValue}s and truncated to
 * {@link MAX_KUSTO_ROWS} and {@link MAX_KUSTO_RESULT_BYTES}; `rowCount` reports
 * the pre-truncation total without converting discarded rows.
 */

import {
    MAX_KUSTO_ROWS,
    type KustoCellValue,
    type KustoColumn,
} from '../canvas/kusto-state';

/** The inputs a Kusto run needs; all editable per-canvas (AC-02). */
export interface KustoQueryParams {
    clusterUrl: string;
    database: string;
    query: string;
}

/** Maximum serialized result size, leaving room in the 16 MiB script envelope. */
export const MAX_KUSTO_RESULT_BYTES = 8 * 1024 * 1024;

/** Typed, bounded result of a query, independent of canvas persistence. */
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

/** Query-only SDK adapter; never expose the SDK's command-dispatching execute(). */
export interface KustoClientLike {
    executeQuery(db: string, query: string): Promise<KustoResponseLike>;
    close?(): void;
}

/** Builds an authenticated client for a cluster. Overridable in tests. */
export type KustoClientFactory = (params: KustoQueryParams) => KustoClientLike | Promise<KustoClientLike>;

export interface KustoExecOptions {
    clientFactory?: KustoClientFactory;
    /** Row cap; defaults to and cannot exceed {@link MAX_KUSTO_ROWS}. */
    cap?: number;
    /** Serialized UTF-8 result cap; cannot exceed {@link MAX_KUSTO_RESULT_BYTES}. */
    maxBytes?: number;
}

/**
 * Build a fresh `azure-kusto-data` client authenticated with the machine's
 * `az login` session. Loaded lazily via dynamic import because the SDK is
 * ESM-only and only needed when a real query actually runs.
 */
export async function buildKustoClient(
    clusterUrl: string,
    credential: import('@azure/identity').TokenCredential,
): Promise<KustoClientLike> {
    const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = await import('azure-kusto-data');
    if (!credential) throw new Error('Kusto SDK client requires the host Rust credential.');
    const kcsb = KustoConnectionStringBuilder.withTokenCredential(clusterUrl, credential);
    const client = new Client(kcsb);
    return {
        executeQuery: (database, query) => {
            // executeQuery always uses /v2/rest/query, even for disguised commands.
            // request_readonly prevents writes and cannot be overridden by a KQL set
            // statement: https://learn.microsoft.com/kusto/api/rest/request-properties
            const properties = new ClientRequestProperties();
            properties.setOption('request_readonly', true);
            return client.executeQuery(database, query, properties);
        },
        close: () => client.close(),
    };
}

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
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
    // dynamic columns, arrays, or other objects → JSON text
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

// ---------------------------------------------------------------------------
// Magic "mock:" queries — exercise the canvas + `kusto_query` tool with inline
// data, no real cluster or `az login`. A `mock:`-prefixed query builds an
// SDK-shaped {@link KustoResponseLike} directly and skips the client factory;
// the synthetic response then flows through the same coercion + truncation as a
// real run. Real KQL never starts with `mock:`, so there is no collision.
// Always active behind the existing `kusto.enabled` gate. See {@link maybeMockResponse}.
// ---------------------------------------------------------------------------

const MOCK_PREFIX = /^mock:/i;

/** Wrap columns + row-major values in the minimal SDK response shape. */
function toResponse(columns: KustoColumn[], rows: KustoCellValue[][]): KustoResponseLike {
    return {
        primaryResults: [
            {
                columns: columns.map(c => ({ name: c.name, type: c.type })),
                rows: () => rows.map(r => ({ getValueAt: (i: number) => r[i] })),
            },
        ],
    };
}

/** A synthetic table of `n` rows, used by `mock:big` to exercise truncation. */
function synthBig(n: number): KustoResponseLike {
    const columns: KustoColumn[] = [
        { name: 'Index', type: 'long' },
        { name: 'Value', type: 'real' },
        { name: 'Label', type: 'string' },
    ];
    // Deterministic (no Math.random / Date.now) so tests are reproducible.
    const rows: KustoCellValue[][] = Array.from({ length: Math.max(0, n) }, (_, i) => [
        i,
        i * 1.5,
        `row-${i}`,
    ]);
    return toResponse(columns, rows);
}

/**
 * Interpret a `mock:` magic query, or return `null` for a normal query.
 *
 * Modes (everything after the case-insensitive `mock:` prefix, trimmed):
 * - `error` / `error: <message>` → **throws** so the canvas shows its error state.
 * - `big` / `big: <N>` → `N` synthetic rows (default `MAX_KUSTO_ROWS + 50`) to
 *   exercise the truncation banner.
 * - otherwise → JSON `{ columns: [{ name, type }], rows: [[...]] }`; malformed
 *   JSON throws (surfaced as the canvas error state, which is fine).
 */
function maybeMockResponse(query: string): KustoResponseLike | null {
    const q = query.trim();
    if (!MOCK_PREFIX.test(q)) return null;
    const rest = q.replace(MOCK_PREFIX, '').trim();

    const err = rest.match(/^error\b:?\s*(.*)$/is);
    if (err) throw new Error(err[1].trim() || 'Mock Kusto error');

    const big = rest.match(/^big\b:?\s*(\d+)?$/i);
    if (big) return synthBig(big[1] ? Number(big[1]) : MAX_KUSTO_ROWS + 50);

    const parsed = JSON.parse(rest) as { columns: KustoColumn[]; rows: KustoCellValue[][] };
    return toResponse(parsed.columns, parsed.rows);
}

/**
 * Run a KQL query and return typed, truncated columns + rows.
 *
 * A `mock:`-prefixed query is served from inline data (see {@link maybeMockResponse})
 * and never touches the SDK; any other query runs through the client factory as usual.
 *
 * Throws an `Error` (message preserved) on auth/connection/query failure — or on a
 * `mock:error` / malformed mock query — so the caller can record it as the Kusto
 * canvas's error state.
 */
export async function executeKustoQuery(
    params: KustoQueryParams,
    opts: KustoExecOptions = {},
): Promise<KustoQueryResult> {
    const cap = opts.cap ?? MAX_KUSTO_ROWS;
    const maxBytes = opts.maxBytes ?? MAX_KUSTO_RESULT_BYTES;
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_KUSTO_ROWS) {
        throw new Error(`Kusto row cap must be an integer between 0 and ${MAX_KUSTO_ROWS}.`);
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_KUSTO_RESULT_BYTES) {
        throw new Error(`Kusto byte cap must be an integer between 1 and ${MAX_KUSTO_RESULT_BYTES}.`);
    }

    if (params.query.trimStart().startsWith('.')) {
        throw new Error('Kusto management commands require explicit approval; use the foreground command tool.');
    }

    let response = maybeMockResponse(params.query); // throws on mock:error / bad JSON
    if (!response) {
        const factory = opts.clientFactory;
        if (!factory) throw new Error('Kusto execution requires a host-owned Rust client factory.');
        const client = await factory(params);
        response = await client.executeQuery(params.database, params.query);
    }

    const table = response?.primaryResults?.[0];
    const columns: KustoColumn[] = (table?.columns ?? []).map((col, i) => ({
        name: col.name ?? `Column${i + 1}`,
        type: col.type ?? 'string',
    }));

    // Reserve the largest possible row-count field and the longer boolean value.
    // Row JSON is measured separately, including commas and UTF-8 escaping.
    let bytes = Buffer.byteLength(JSON.stringify({
        columns, rows: [], rowCount: Number.MAX_SAFE_INTEGER, truncated: false,
    }), 'utf8');
    if (bytes > maxBytes) throw new Error('Kusto result column metadata exceeds the byte limit.');

    const rows: KustoCellValue[][] = [];
    let rowCount = 0;
    let truncated = false;
    for (const row of table?.rows() ?? []) {
        rowCount++;
        // Keep a prefix: once a row cannot fit, count but never convert later rows.
        if (truncated || rows.length >= cap) {
            truncated = true;
            continue;
        }
        const cells = columns.map((_, i) => coerceCellValue(row.getValueAt(i)));
        const rowBytes = Buffer.byteLength(JSON.stringify(cells), 'utf8') + (rows.length ? 1 : 0);
        if (bytes + rowBytes > maxBytes) {
            truncated = true;
            continue;
        }
        bytes += rowBytes;
        rows.push(cells);
    }

    return { columns, rows, rowCount, truncated };
}

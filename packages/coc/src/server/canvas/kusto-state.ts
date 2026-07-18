/**
 * Kusto canvas state (type 'kusto').
 *
 * A Kusto canvas's full state — KQL query, cluster/database, result columns +
 * rows, chart config, and last-run info — is serialized as JSON into the canvas
 * `content` string so it reuses the existing canvas persistence, versioning,
 * and revision-check machinery unchanged (mirrors how excalidraw canvases store
 * their scene JSON in `content`).
 *
 * This module is the single place that (de)serializes that JSON and enforces
 * the {@link MAX_KUSTO_ROWS} truncation cap, so the store, the run endpoint,
 * and the `kusto_query` tool all agree on one contract.
 *
 * Pure — no I/O, no Node built-ins beyond JSON.
 */

import {
    MAX_KUSTO_ROWS,
    type KustoCellValue,
    type KustoChartConfig,
    type KustoColumn,
    type KustoRunInfo,
    type KustoCanvasState,
} from '@plusplusoneplusplus/coc-client';

export {
    MAX_KUSTO_ROWS,
    type KustoCellValue,
    type KustoChartConfig,
    type KustoColumn,
    type KustoRunInfo,
    type KustoCanvasState,
};

/** A blank Kusto canvas; cluster/database optionally pre-filled (AC-07). */
export function createEmptyKustoState(
    seed?: Partial<Pick<KustoCanvasState, 'query' | 'clusterUrl' | 'database' | 'chartConfig'>>,
): KustoCanvasState {
    return {
        query: seed?.query ?? '',
        clusterUrl: seed?.clusterUrl ?? '',
        database: seed?.database ?? '',
        columns: [],
        rows: [],
        truncated: false,
        ...(seed?.chartConfig ? { chartConfig: seed.chartConfig } : {}),
    };
}

/**
 * Cap a result set at {@link MAX_KUSTO_ROWS}. Returns the (possibly sliced)
 * rows and whether truncation occurred. The original row count is left to the
 * caller to record on {@link KustoRunInfo.rowCount}.
 */
export function truncateRows<T>(rows: T[], cap = MAX_KUSTO_ROWS): { rows: T[]; truncated: boolean } {
    if (rows.length > cap) {
        return { rows: rows.slice(0, cap), truncated: true };
    }
    return { rows, truncated: false };
}

/** Serialize a Kusto canvas state to the JSON stored in the canvas content. */
export function serializeKustoState(state: KustoCanvasState): string {
    return JSON.stringify(state, null, 2);
}

function isChartConfig(value: unknown): value is KustoChartConfig {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return type === 'line' || type === 'bar' || type === 'scatter' || type === 'pie' || type === 'stackedArea';
}

function coerceColumns(value: unknown): KustoColumn[] {
    if (!Array.isArray(value)) return [];
    const columns: KustoColumn[] = [];
    for (const entry of value) {
        if (entry && typeof entry === 'object' && typeof (entry as KustoColumn).name === 'string') {
            columns.push({
                name: (entry as KustoColumn).name,
                type: typeof (entry as KustoColumn).type === 'string' ? (entry as KustoColumn).type : 'string',
            });
        }
    }
    return columns;
}

function coerceRows(value: unknown): KustoCellValue[][] {
    if (!Array.isArray(value)) return [];
    const rows: KustoCellValue[][] = [];
    for (const row of value) {
        if (Array.isArray(row)) rows.push(row as KustoCellValue[]);
    }
    return rows;
}

/**
 * Parse the canvas content JSON into a validated {@link KustoCanvasState},
 * tolerating partial/corrupt input by falling back to an empty state and
 * re-enforcing the row cap on read. Never throws.
 */
export function parseKustoState(content: string | undefined | null): KustoCanvasState {
    let raw: unknown;
    try {
        raw = content ? JSON.parse(content) : undefined;
    } catch {
        raw = undefined;
    }
    if (!raw || typeof raw !== 'object') {
        return createEmptyKustoState();
    }
    const obj = raw as Record<string, unknown>;
    const { rows: cappedRows, truncated: overCap } = truncateRows(coerceRows(obj.rows));
    const state: KustoCanvasState = {
        query: typeof obj.query === 'string' ? obj.query : '',
        clusterUrl: typeof obj.clusterUrl === 'string' ? obj.clusterUrl : '',
        database: typeof obj.database === 'string' ? obj.database : '',
        columns: coerceColumns(obj.columns),
        rows: cappedRows,
        truncated: obj.truncated === true || overCap,
    };
    if (isChartConfig(obj.chartConfig)) {
        state.chartConfig = obj.chartConfig;
    }
    const lastRun = obj.lastRun as KustoRunInfo | undefined;
    if (lastRun && typeof lastRun === 'object' && typeof lastRun.timestamp === 'string') {
        state.lastRun = {
            timestamp: lastRun.timestamp,
            status:
                lastRun.status === 'idle' || lastRun.status === 'loading' || lastRun.status === 'success' || lastRun.status === 'error'
                    ? lastRun.status
                    : 'idle',
            ...(typeof lastRun.error === 'string' ? { error: lastRun.error } : {}),
            ...(typeof lastRun.rowCount === 'number' ? { rowCount: lastRun.rowCount } : {}),
        };
    }
    return state;
}

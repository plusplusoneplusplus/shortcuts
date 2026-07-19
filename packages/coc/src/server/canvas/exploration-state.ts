/**
 * Exploration canvas state (type 'exploration').
 *
 * An exploration's full state — KQL query, cluster/database, result columns +
 * rows, chart config, and last-run info — is serialized as JSON into the canvas
 * `content` string so it reuses the existing canvas persistence, versioning,
 * and revision-check machinery unchanged (mirrors how excalidraw canvases store
 * their scene JSON in `content`).
 *
 * This module is the single place that (de)serializes that JSON and enforces
 * the {@link MAX_EXPLORATION_ROWS} truncation cap, so the store, the run
 * endpoint, and the `kusto_query` tool all agree on one contract.
 *
 * Pure — no I/O, no Node built-ins beyond JSON.
 */

import {
    MAX_EXPLORATION_ROWS,
    type ExplorationCellValue,
    type ExplorationChartConfig,
    type ExplorationColumn,
    type ExplorationRunInfo,
    type ExplorationState,
} from '@plusplusoneplusplus/coc-client';

export {
    MAX_EXPLORATION_ROWS,
    type ExplorationCellValue,
    type ExplorationChartConfig,
    type ExplorationColumn,
    type ExplorationRunInfo,
    type ExplorationState,
};

/** A blank exploration; cluster/database optionally pre-filled (AC-07). */
export function createEmptyExplorationState(
    seed?: Partial<Pick<ExplorationState, 'query' | 'clusterUrl' | 'database' | 'chartConfig'>>,
): ExplorationState {
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
 * Cap a result set at {@link MAX_EXPLORATION_ROWS}. Returns the (possibly
 * sliced) rows and whether truncation occurred. The original row count is left
 * to the caller to record on {@link ExplorationRunInfo.rowCount}.
 */
export function truncateRows<T>(rows: T[], cap = MAX_EXPLORATION_ROWS): { rows: T[]; truncated: boolean } {
    if (rows.length > cap) {
        return { rows: rows.slice(0, cap), truncated: true };
    }
    return { rows, truncated: false };
}

/** Serialize an exploration state to the JSON stored in the canvas content. */
export function serializeExplorationState(state: ExplorationState): string {
    return JSON.stringify(state, null, 2);
}

function isChartConfig(value: unknown): value is ExplorationChartConfig {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return type === 'line' || type === 'bar' || type === 'scatter' || type === 'pie' || type === 'stackedArea';
}

function coerceColumns(value: unknown): ExplorationColumn[] {
    if (!Array.isArray(value)) return [];
    const columns: ExplorationColumn[] = [];
    for (const entry of value) {
        if (entry && typeof entry === 'object' && typeof (entry as ExplorationColumn).name === 'string') {
            columns.push({
                name: (entry as ExplorationColumn).name,
                type: typeof (entry as ExplorationColumn).type === 'string' ? (entry as ExplorationColumn).type : 'string',
            });
        }
    }
    return columns;
}

function coerceRows(value: unknown): ExplorationCellValue[][] {
    if (!Array.isArray(value)) return [];
    const rows: ExplorationCellValue[][] = [];
    for (const row of value) {
        if (Array.isArray(row)) rows.push(row as ExplorationCellValue[]);
    }
    return rows;
}

/**
 * Parse the canvas content JSON into a validated {@link ExplorationState},
 * tolerating partial/corrupt input by falling back to an empty state and
 * re-enforcing the row cap on read. Never throws.
 */
export function parseExplorationState(content: string | undefined | null): ExplorationState {
    let raw: unknown;
    try {
        raw = content ? JSON.parse(content) : undefined;
    } catch {
        raw = undefined;
    }
    if (!raw || typeof raw !== 'object') {
        return createEmptyExplorationState();
    }
    const obj = raw as Record<string, unknown>;
    const { rows: cappedRows, truncated: overCap } = truncateRows(coerceRows(obj.rows));
    const state: ExplorationState = {
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
    const lastRun = obj.lastRun as ExplorationRunInfo | undefined;
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

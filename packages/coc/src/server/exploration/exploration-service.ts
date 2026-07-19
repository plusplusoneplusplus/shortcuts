/**
 * Run-and-persist orchestration for exploration canvases (AC-02).
 *
 * Loads an exploration canvas, applies optional query/cluster/database
 * overrides, executes the query server-side ({@link executeKustoQuery}), writes
 * the typed columns + rows and a `lastRun` outcome back into the canvas content,
 * and returns the persisted record. Query/auth failures are captured as the
 * exploration's error state rather than thrown, so the panel and the AI tool
 * both see a stored error.
 *
 * Shared by the AC-02 Run endpoint and the AC-03 `kusto_query` tool so both
 * paths agree on execution, truncation, and persistence.
 */

import type { CanvasStore, CanvasRecord, CanvasEditor } from '../canvas/canvas-store';
import {
    parseExplorationState,
    serializeExplorationState,
    type ExplorationState,
} from '../canvas/exploration-state';
import { executeKustoQuery, type KustoClientFactory } from './kusto-exec';

/** Per-run overrides for the exploration's stored query/cluster/database. */
export interface RunExplorationOverrides {
    query?: string;
    clusterUrl?: string;
    database?: string;
}

export interface RunExplorationOptions {
    overrides?: RunExplorationOverrides;
    /** Who the persisted edit is attributed to. Defaults to 'user'. */
    editor?: CanvasEditor;
    /** Injectable clock for deterministic tests. */
    now?: () => string;
    /** Injectable SDK client factory (mocked in tests). */
    clientFactory?: KustoClientFactory;
}

export type RunExplorationOutcome =
    | { ok: true; canvas: CanvasRecord; state: ExplorationState }
    | { ok: false; reason: 'not-found' }
    | { ok: false; reason: 'wrong-type' }
    | { ok: false; reason: 'persist-failed'; error: string };

/**
 * Execute the (possibly overridden) query for an exploration canvas and persist
 * the result. Success and failure both land as a stored `lastRun`; only
 * missing canvas / wrong type / a store write failure return `ok: false`.
 */
export async function runExploration(
    store: CanvasStore,
    workspaceId: string,
    canvasId: string,
    opts: RunExplorationOptions = {},
): Promise<RunExplorationOutcome> {
    const record = store.getCanvas(workspaceId, canvasId);
    if (!record) {
        return { ok: false, reason: 'not-found' };
    }
    if (record.type !== 'exploration') {
        return { ok: false, reason: 'wrong-type' };
    }

    const now = opts.now ?? (() => new Date().toISOString());
    const editor: CanvasEditor = opts.editor ?? 'user';

    const prev = parseExplorationState(record.content);
    const query = opts.overrides?.query ?? prev.query;
    const clusterUrl = opts.overrides?.clusterUrl ?? prev.clusterUrl;
    const database = opts.overrides?.database ?? prev.database;

    // Base state keeps the chart config and carries the (possibly edited) inputs.
    const base: ExplorationState = {
        ...prev,
        query,
        clusterUrl,
        database,
    };

    let next: ExplorationState;
    if (!query.trim() || !clusterUrl.trim() || !database.trim()) {
        next = {
            ...base,
            lastRun: {
                timestamp: now(),
                status: 'error',
                error: 'Cluster URL, database, and query are all required to run.',
            },
        };
    } else {
        try {
            const result = await executeKustoQuery(
                { clusterUrl, database, query },
                opts.clientFactory ? { clientFactory: opts.clientFactory } : {},
            );
            next = {
                ...base,
                columns: result.columns,
                rows: result.rows,
                truncated: result.truncated,
                lastRun: {
                    timestamp: now(),
                    status: 'success',
                    rowCount: result.rowCount,
                },
            };
        } catch (err) {
            next = {
                ...base,
                lastRun: {
                    timestamp: now(),
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    const saved = store.updateCanvas(workspaceId, canvasId, {
        content: serializeExplorationState(next),
        editor,
    });
    if (!saved.ok) {
        const error = saved.reason === 'edit-mismatch' ? saved.error : saved.reason;
        return { ok: false, reason: 'persist-failed', error };
    }
    return { ok: true, canvas: saved.canvas, state: next };
}

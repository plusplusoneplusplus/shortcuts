/**
 * Exploration LLM tool — `kusto_query` (AC-03).
 *
 * A single tool the AI calls to run a Kusto query for the user. It executes the
 * query server-side through the same {@link runExploration} path used by the
 * AC-02 Run endpoint (official `azure-kusto-data` SDK + `AzureCliCredential`),
 * persists the result into a new or existing exploration canvas, and returns to
 * the model a compact view — column schema, a capped row sample, the total row
 * count — plus a `canvas://<id>` embed link so the exploration renders inline in
 * chat and opens in the side panel.
 *
 * The AI no longer shells out to a Kusto CLI: query execution, truncation, and
 * persistence all funnel through the shared exploration service.
 *
 * Gated by the `exploration.enabled` feature flag (AC-08) at the addon level.
 *
 * Pure Node.js; uses only built-in modules plus the canvas/exploration server
 * helpers. Cross-platform compatible (Linux/Mac/Windows).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasStore } from '../canvas/canvas-store';
import {
    createEmptyExplorationState,
    serializeExplorationState,
} from '../canvas/exploration-state';
import type { ExplorationChartConfig, ExplorationChartType } from '@plusplusoneplusplus/coc-client';
import { runExploration } from '../exploration/exploration-service';
import type { KustoClientFactory } from '../exploration/kusto-exec';
import { emitCanvasUpdated } from '../streaming/sse-handler';

// ============================================================================
// Types
// ============================================================================

export interface ExplorationToolsDeps {
    dataDir: string;
    workspaceId: string;
    /** Process the exploration is linked to; enables SSE events and panel discovery. */
    processId?: string;
    /** Process store used to emit `canvas-updated` SSE events. */
    processStore?: ProcessStore;
    /** Injectable store for tests. Defaults to a dataDir-backed `CanvasStore`. */
    canvasStore?: CanvasStore;
    /** Injectable Kusto SDK client factory (mocked in tests). */
    clientFactory?: KustoClientFactory;
    /** Injectable clock for deterministic tests. */
    now?: () => string;
}

/** Run a Kusto query and persist the result as a new/updated exploration. */
export interface KustoQueryArgs {
    query?: string;
    clusterUrl?: string;
    database?: string;
    /** Existing exploration canvas to update. Omit to create a new one. */
    canvasId?: string;
    /** Title for a newly created exploration. */
    title?: string;
    /** Optional initial chart config applied on first open. */
    chartConfig?: ExplorationChartConfig;
}

/** How many result rows are echoed back to the model for reasoning (AC-03, N=50). */
export const KUSTO_QUERY_ROW_SAMPLE = 50;

const VALID_CHART_TYPES: readonly ExplorationChartType[] = ['line', 'bar', 'scatter', 'pie', 'stackedArea'];

/** Coerce/validate a caller-supplied chart config; returns undefined when absent/invalid. */
function normalizeChartConfig(raw: ExplorationChartConfig | undefined): ExplorationChartConfig | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    if (!VALID_CHART_TYPES.includes(raw.type)) return undefined;
    const config: ExplorationChartConfig = { type: raw.type };
    if (typeof raw.x === 'string') config.x = raw.x;
    if (Array.isArray(raw.y)) config.y = raw.y.filter((c): c is string => typeof c === 'string');
    if (typeof raw.series === 'string') config.series = raw.series;
    return config;
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createExplorationTools(deps: ExplorationToolsDeps): { kustoQuery: Tool<unknown> } {
    const store = deps.canvasStore ?? new CanvasStore(deps.dataDir);

    const emitUpdate = (canvasId: string, title: string, revision: number): void => {
        if (deps.processStore && deps.processId) {
            emitCanvasUpdated(deps.processStore, deps.processId, { canvasId, title, revision, editor: 'ai' });
        }
    };

    const kustoQuery = defineTool<KustoQueryArgs>('kusto_query', {
        description:
            'Run a Kusto (KQL) query for the user against an Azure Data Explorer cluster and show the '
            + 'result as an interactive exploration canvas (editable query, result table, native charts) '
            + 'in the side panel. The query runs server-side via the official Kusto SDK using the machine\'s '
            + 'existing az login — you do NOT shell out to a CLI. Provide query, clusterUrl (e.g. '
            + '"https://help.kusto.windows.net"), and database. Omit canvasId to create a new exploration, or '
            + 'pass canvasId to re-run/update an existing one. Optionally pass an initial chartConfig. Returns '
            + 'the column schema, a sample of the first rows, the total row count, and a `canvas://<id>` embed '
            + 'link — put that link in your reply so the exploration renders inline. The user can then tweak the '
            + 'query and re-run it themselves without another AI turn.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The KQL query text to execute.' },
                clusterUrl: { type: 'string', description: 'Cluster URL, e.g. "https://help.kusto.windows.net".' },
                database: { type: 'string', description: 'Database name to run the query against.' },
                canvasId: { type: 'string', description: 'Existing exploration to update. Omit to create a new one.' },
                title: { type: 'string', description: 'Title for a newly created exploration (create only).' },
                chartConfig: {
                    type: 'object',
                    description: 'Optional initial chart config applied on first open.',
                    properties: {
                        type: { type: 'string', enum: ['line', 'bar', 'scatter', 'pie', 'stackedArea'] },
                        x: { type: 'string', description: 'Column name for the x-axis / category.' },
                        y: { type: 'array', items: { type: 'string' }, description: 'Numeric column name(s) for the y-axis.' },
                        series: { type: 'string', description: 'Optional column to split into a series / group-by.' },
                    },
                    required: ['type'],
                },
            },
            required: ['query', 'clusterUrl', 'database'],
        },
        handler: async (args) => {
            const a = args ?? ({} as KustoQueryArgs);
            const query = typeof a.query === 'string' ? a.query : '';
            const clusterUrl = typeof a.clusterUrl === 'string' ? a.clusterUrl : '';
            const database = typeof a.database === 'string' ? a.database : '';

            if (!query.trim()) return { success: false, error: 'query is required' };
            if (!clusterUrl.trim()) return { success: false, error: 'clusterUrl is required' };
            if (!database.trim()) return { success: false, error: 'database is required' };

            const chartConfig = normalizeChartConfig(a.chartConfig);

            // Resolve the target canvas: an existing exploration, or a fresh one.
            let canvasId = a.canvasId;
            if (canvasId) {
                const existing = store.getCanvas(deps.workspaceId, canvasId);
                if (!existing) {
                    return { success: false, error: `Canvas not found: ${canvasId}` };
                }
                if (existing.type !== 'exploration') {
                    return { success: false, error: `Canvas ${canvasId} is not an exploration (type: ${existing.type})` };
                }
            } else {
                try {
                    const seed = createEmptyExplorationState({
                        query,
                        clusterUrl,
                        database,
                        ...(chartConfig ? { chartConfig } : {}),
                    });
                    const created = store.createCanvas({
                        workspaceId: deps.workspaceId,
                        title: (a.title && a.title.trim()) || 'Kusto Exploration',
                        content: serializeExplorationState(seed),
                        type: 'exploration',
                        processId: deps.processId,
                        editor: 'ai',
                    });
                    canvasId = created.id;
                } catch (err) {
                    return { success: false, error: err instanceof Error ? err.message : String(err) };
                }
            }

            const outcome = await runExploration(store, deps.workspaceId, canvasId, {
                editor: 'ai',
                overrides: { query, clusterUrl, database },
                ...(deps.clientFactory ? { clientFactory: deps.clientFactory } : {}),
                ...(deps.now ? { now: deps.now } : {}),
            });

            if (!outcome.ok) {
                if (outcome.reason === 'not-found') return { success: false, error: `Canvas not found: ${canvasId}` };
                if (outcome.reason === 'wrong-type') return { success: false, error: `Canvas ${canvasId} is not an exploration` };
                return { success: false, error: outcome.error };
            }

            const { canvas, state } = outcome;
            const embed = `canvas://${canvas.id}`;
            emitUpdate(canvas.id, canvas.title, canvas.revision);

            // A stored error state (query/auth failure) is surfaced to the model
            // but is not a tool failure — the exploration persisted and renders.
            if (state.lastRun?.status === 'error') {
                return {
                    success: false,
                    error: state.lastRun.error ?? 'Query failed',
                    canvasId: canvas.id,
                    embed,
                    revision: canvas.revision,
                };
            }

            const rowSample = state.rows.slice(0, KUSTO_QUERY_ROW_SAMPLE);
            return {
                success: true,
                canvasId: canvas.id,
                revision: canvas.revision,
                embed,
                columns: state.columns,
                rowCount: state.lastRun?.rowCount ?? state.rows.length,
                truncated: state.truncated,
                rows: rowSample,
                rowSampleCount: rowSample.length,
                ...(chartConfig ? { chartConfig } : {}),
                created: !a.canvasId,
            };
        },
    });

    return { kustoQuery: kustoQuery as Tool<unknown> };
}

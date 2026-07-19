/**
 * KustoView — interactive Kusto query surface (AC-04/AC-05).
 *
 * Renders a Kusto canvas: an editable KQL query, editable cluster/database
 * fields, a Run button that executes the query server-side (no AI turn) via
 * `POST /canvases/:id/run`, run status, and the result rows in the shared
 * InteractiveTable. Results are CSV-exportable from the stored rows.
 *
 * The full Kusto state rides in the canvas `content` string as JSON, so this
 * component parses it on load and re-parses each returned canvas after a run.
 * The chart view (AC-05) is added alongside the table view.
 */

import { useCallback, useMemo, useState } from 'react';
import type {
    Canvas,
    KustoCellValue,
    KustoChartConfig,
    KustoChartType,
    KustoColumn,
    KustoCanvasState,
} from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';
import { InteractiveTable, tableToCsv } from '../../shared/InteractiveTable';
import { KustoChart, numericColumnNames } from './KustoChart';

export interface KustoViewProps {
    workspaceId: string;
    canvas: Canvas;
    /** Called with the updated canvas after a successful run so the host can refresh. */
    onCanvasSaved?: (canvas: Canvas) => void;
    /** Compact layout for inline chat embeds (hides the editors by default). */
    compact?: boolean;
}

/** Tolerant client-side parse of the Kusto JSON stored in canvas content. */
export function parseKustoContent(content: string | undefined | null): KustoCanvasState {
    const empty: KustoCanvasState = {
        query: '', clusterUrl: '', database: '', columns: [], rows: [], truncated: false,
    };
    if (!content) return empty;
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return empty;
    }
    if (!raw || typeof raw !== 'object') return empty;
    const obj = raw as Record<string, unknown>;
    return {
        query: typeof obj.query === 'string' ? obj.query : '',
        clusterUrl: typeof obj.clusterUrl === 'string' ? obj.clusterUrl : '',
        database: typeof obj.database === 'string' ? obj.database : '',
        columns: Array.isArray(obj.columns) ? (obj.columns as KustoColumn[]) : [],
        rows: Array.isArray(obj.rows) ? (obj.rows as KustoCellValue[][]) : [],
        truncated: obj.truncated === true,
        ...(obj.chartConfig && typeof obj.chartConfig === 'object' ? { chartConfig: obj.chartConfig as KustoCanvasState['chartConfig'] } : {}),
        ...(obj.lastRun && typeof obj.lastRun === 'object' ? { lastRun: obj.lastRun as KustoCanvasState['lastRun'] } : {}),
    };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch] ?? ch);
}

/** Render a cell value as display text (null → empty). */
function cellText(value: KustoCellValue): string {
    if (value === null || value === undefined) return '';
    return String(value);
}

const INPUT_CLASS =
    'w-full text-[11px] px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] '
    + 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]';

function formatTimestamp(iso: string): string {
    try {
        return new Date(iso).toLocaleTimeString();
    } catch {
        return iso;
    }
}

/**
 * Build the follow-up message sent into the owning conversation for AC-06's
 * "Ask AI" loop. It embeds the Kusto canvas's current query text and the target
 * canvas id so the AI can improve the query and persist the result back to the
 * same Kusto canvas via the `kusto_query` tool. The current query is always
 * included so the AI reasons from the real starting point.
 */
export function buildKustoAskAiMessage(query: string, instruction: string, canvasId: string): string {
    const trimmedQuery = query.trim();
    const queryBlock = trimmedQuery
        ? `Current KQL query:\n\`\`\`kql\n${trimmedQuery}\n\`\`\``
        : 'The Kusto canvas has no query yet.';
    return [
        `Please update the Kusto query canvas (canvasId: "${canvasId}") using the `
        + '`kusto_query` tool so the change persists to this existing Kusto query canvas.',
        queryBlock,
        `Requested change: ${instruction.trim()}`,
    ].join('\n\n');
}

export function KustoView({ workspaceId, canvas, onCanvasSaved, compact = false }: KustoViewProps) {
    const client = useCocClient(workspaceId);
    const parsed = useMemo(() => parseKustoContent(canvas.content), [canvas.content]);

    const [query, setQuery] = useState(parsed.query);
    const [clusterUrl, setClusterUrl] = useState(parsed.clusterUrl);
    const [database, setDatabase] = useState(parsed.database);
    // View toggle + local chart config. The AI-supplied initial config is
    // applied on first open by defaulting the view to 'chart' when one exists.
    const [view, setView] = useState<'table' | 'chart'>(parsed.chartConfig ? 'chart' : 'table');
    const [chartConfig, setChartConfig] = useState<KustoChartConfig | undefined>(parsed.chartConfig);
    // Track which canvas revision the local drafts were seeded from so a live
    // AI update (new content) re-seeds the editors instead of clobbering them.
    const [seededFrom, setSeededFrom] = useState(canvas.content);
    if (seededFrom !== canvas.content) {
        setSeededFrom(canvas.content);
        setQuery(parsed.query);
        setClusterUrl(parsed.clusterUrl);
        setDatabase(parsed.database);
        setChartConfig(parsed.chartConfig);
    }

    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);

    // AC-06 Ask-AI loop: a small prompt box that sends a follow-up into the
    // owning conversation (canvas.processId) with the current query + the
    // user's instruction, so the AI improves the query via the kusto_query tool.
    const [askInstruction, setAskInstruction] = useState('');
    const [asking, setAsking] = useState(false);
    const [askError, setAskError] = useState<string | null>(null);
    const [askSent, setAskSent] = useState(false);

    const handleAskAi = useCallback(async () => {
        const instruction = askInstruction.trim();
        if (!instruction || !canvas.processId || asking) return;
        setAsking(true);
        setAskError(null);
        setAskSent(false);
        try {
            await client.processes.sendMessage(
                canvas.processId,
                { content: buildKustoAskAiMessage(query, instruction, canvas.id), mode: 'autopilot' },
                { workspace: workspaceId },
            );
            setAskInstruction('');
            setAskSent(true);
        } catch (err) {
            setAskError(err instanceof Error ? err.message : 'Ask AI failed');
        } finally {
            setAsking(false);
        }
    }, [askInstruction, canvas.processId, canvas.id, asking, client, query, workspaceId]);

    const handleRun = useCallback(async () => {
        if (running) return;
        setRunning(true);
        setRunError(null);
        try {
            const saved = await client.canvases.run(workspaceId, canvas.id, {
                query, clusterUrl, database,
            });
            onCanvasSaved?.(saved);
        } catch (err) {
            setRunError(err instanceof Error ? err.message : 'Run failed');
        } finally {
            setRunning(false);
        }
    }, [client, workspaceId, canvas.id, query, clusterUrl, database, running, onCanvasSaved]);

    const { columns, rows, truncated, lastRun } = parsed;
    const numericColumns = useMemo(() => numericColumnNames(columns, rows), [columns, rows]);

    // Persist a chart-config change back into the canvas content JSON, keeping
    // the current columns/rows/query. Updates local state immediately for
    // responsiveness; the returned canvas re-seeds via onCanvasSaved.
    const persistChartConfig = useCallback(
        async (next: KustoChartConfig | undefined) => {
            setChartConfig(next);
            const state: KustoCanvasState = { ...parsed };
            if (next) state.chartConfig = next;
            else delete state.chartConfig;
            try {
                const saved = await client.canvases.save(workspaceId, canvas.id, {
                    content: JSON.stringify(state),
                    expectedRevision: canvas.revision,
                });
                onCanvasSaved?.(saved);
            } catch {
                // Keep the local config even if the save races a revision bump.
            }
        },
        [parsed, client, workspaceId, canvas.id, canvas.revision, onCanvasSaved],
    );

    const updateConfig = useCallback(
        (patch: Partial<KustoChartConfig>) => {
            const base: KustoChartConfig = chartConfig ?? { type: 'bar', y: [] };
            void persistChartConfig({ ...base, ...patch });
        },
        [chartConfig, persistChartConfig],
    );

    const toggleY = useCallback(
        (name: string) => {
            const current = chartConfig?.y ?? [];
            const next = current.includes(name) ? current.filter(y => y !== name) : [...current, name];
            updateConfig({ y: next });
        },
        [chartConfig, updateConfig],
    );

    const headers = useMemo(() => columns.map(c => c.name), [columns]);
    const stringRows = useMemo(
        () => rows.map(row => columns.map((_, i) => escapeHtml(cellText(row[i] ?? null)))),
        [rows, columns],
    );

    const handleCsvDownload = useCallback(() => {
        const csv = tableToCsv(headers, stringRows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        const slug = canvas.id.replace(/-[0-9a-f]{6}$/, '') || 'kusto-query';
        anchor.download = `${slug}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }, [headers, stringRows, canvas.id]);

    const status = running ? 'loading' : (lastRun?.status ?? 'idle');
    const rowCount = lastRun?.rowCount ?? rows.length;

    return (
        <div className="flex flex-col h-full min-h-0 text-[#1e1e1e] dark:text-[#cccccc]" data-testid="kusto-view">
            {/* Query + connection editors */}
            <div className={`shrink-0 flex flex-col gap-2 p-3 border-b border-[#e0e0e0] dark:border-[#474749] ${compact ? 'gap-1.5 p-2' : ''}`}>
                <div className="flex gap-2">
                    <label className="flex-1 min-w-0">
                        <span className="block text-[9px] uppercase text-[#848484] mb-0.5">Cluster URL</span>
                        <input
                            type="text"
                            className={INPUT_CLASS}
                            value={clusterUrl}
                            onChange={e => setClusterUrl(e.target.value)}
                            placeholder="https://help.kusto.windows.net"
                            data-testid="kusto-cluster"
                        />
                    </label>
                    <label className="flex-1 min-w-0">
                        <span className="block text-[9px] uppercase text-[#848484] mb-0.5">Database</span>
                        <input
                            type="text"
                            className={INPUT_CLASS}
                            value={database}
                            onChange={e => setDatabase(e.target.value)}
                            placeholder="Samples"
                            data-testid="kusto-database"
                        />
                    </label>
                </div>
                <label className="block">
                    <span className="block text-[9px] uppercase text-[#848484] mb-0.5">KQL query</span>
                    <textarea
                        className={`${INPUT_CLASS} font-mono resize-y ${compact ? 'min-h-[48px]' : 'min-h-[72px]'}`}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="StormEvents | take 100"
                        spellCheck={false}
                        data-testid="kusto-query"
                    />
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="px-3 py-1 text-[11px] rounded bg-[#0078d4] text-white font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void handleRun()}
                        disabled={running || !query.trim()}
                        data-testid="kusto-run"
                    >
                        {running ? 'Running…' : 'Run'}
                    </button>
                    <span className="flex-1 text-[10px]" data-testid="kusto-status">
                        {status === 'loading' && <span className="text-[#848484]">Running query…</span>}
                        {status === 'success' && !running && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                                {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
                                {truncated ? ' (truncated to 10,000)' : ''}
                                {lastRun?.timestamp ? ` · ${formatTimestamp(lastRun.timestamp)}` : ''}
                            </span>
                        )}
                        {status === 'error' && !running && (
                            <span className="text-red-500" data-testid="kusto-error">{lastRun?.error ?? 'Query failed'}</span>
                        )}
                        {status === 'idle' && !running && <span className="text-[#848484]">Not run yet</span>}
                    </span>
                    {columns.length > 0 && (
                        <div className="inline-flex rounded border border-[#e0e0e0] dark:border-[#474749] overflow-hidden" role="group" aria-label="View">
                            <button
                                type="button"
                                className={`px-2 py-1 text-[11px] ${view === 'table' ? 'bg-[#0078d4] text-white' : 'text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]'}`}
                                onClick={() => setView('table')}
                                data-testid="kusto-view-table"
                            >
                                Table
                            </button>
                            <button
                                type="button"
                                className={`px-2 py-1 text-[11px] ${view === 'chart' ? 'bg-[#0078d4] text-white' : 'text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]'}`}
                                onClick={() => setView('chart')}
                                data-testid="kusto-view-chart"
                            >
                                Chart
                            </button>
                        </div>
                    )}
                    {columns.length > 0 && (
                        <button
                            type="button"
                            className="px-2 py-1 text-[11px] rounded border border-[#e0e0e0] dark:border-[#474749] text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                            onClick={handleCsvDownload}
                            data-testid="kusto-csv"
                        >
                            CSV
                        </button>
                    )}
                </div>
                {runError && (
                    <div className="text-[10px] text-red-500" data-testid="kusto-run-error">{runError}</div>
                )}

                {/* AC-06 Ask-AI loop — only when the Kusto canvas is linked to a chat. */}
                {!compact && canvas.processId && (
                    <div className="flex flex-col gap-1 pt-1 border-t border-dashed border-[#e0e0e0] dark:border-[#474749]" data-testid="kusto-ask-ai">
                        <span className="block text-[9px] uppercase text-[#848484]">Ask AI to improve this query</span>
                        <div className="flex items-start gap-2">
                            <textarea
                                className={`${INPUT_CLASS} resize-y min-h-[32px]`}
                                value={askInstruction}
                                onChange={e => { setAskInstruction(e.target.value); setAskSent(false); }}
                                placeholder="e.g. add a 7-day rolling average"
                                data-testid="kusto-ask-input"
                            />
                            <button
                                type="button"
                                className="shrink-0 px-3 py-1 text-[11px] rounded bg-[#8b5cf6] text-white font-medium hover:bg-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => void handleAskAi()}
                                disabled={asking || !askInstruction.trim()}
                                data-testid="kusto-ask-send"
                            >
                                {asking ? 'Asking…' : 'Ask AI'}
                            </button>
                        </div>
                        {askSent && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400" data-testid="kusto-ask-sent">
                                Sent to the conversation — the AI will update this Kusto query.
                            </span>
                        )}
                        {askError && (
                            <span className="text-[10px] text-red-500" data-testid="kusto-ask-error">{askError}</span>
                        )}
                    </div>
                )}
            </div>

            {/* Results — table or chart */}
            <div className="flex-1 min-h-0 overflow-auto p-3">
                {columns.length === 0 ? (
                    <div className="text-[11px] italic text-[#848484] text-center py-6" data-testid="kusto-empty">
                        {status === 'error' ? 'Run failed — see the error above.' : 'Run a query to see results.'}
                    </div>
                ) : view === 'chart' ? (
                    <div className="flex flex-col gap-3" data-testid="kusto-chart-view">
                        <ChartControls
                            columns={columns}
                            numericColumns={numericColumns}
                            config={chartConfig}
                            onType={t => updateConfig({ type: t })}
                            onX={x => updateConfig({ x: x || undefined })}
                            onToggleY={toggleY}
                            onSeries={s => updateConfig({ series: s || undefined })}
                        />
                        {chartConfig ? (
                            <KustoChart columns={columns} rows={rows} config={chartConfig} />
                        ) : (
                            <div className="text-[11px] italic text-[#848484] text-center py-6" data-testid="kusto-chart-unconfigured">
                                Pick a chart type and a Y column to draw a chart.
                            </div>
                        )}
                    </div>
                ) : (
                    <InteractiveTable
                        tableKey={`kusto-${canvas.id}-${canvas.revision}`}
                        headers={headers}
                        alignments={columns.map(() => 'left')}
                        rows={stringRows}
                        originalMarkdown=""
                    />
                )}
            </div>
        </div>
    );
}

const CHART_TYPES: { value: KustoChartType; label: string }[] = [
    { value: 'line', label: 'Line' },
    { value: 'bar', label: 'Bar' },
    { value: 'scatter', label: 'Scatter' },
    { value: 'pie', label: 'Pie' },
    { value: 'stackedArea', label: 'Stacked area' },
];

interface ChartControlsProps {
    columns: KustoColumn[];
    numericColumns: string[];
    config: KustoChartConfig | undefined;
    onType: (t: KustoChartType) => void;
    onX: (x: string) => void;
    onToggleY: (name: string) => void;
    onSeries: (s: string) => void;
}

const SELECT_CLASS =
    'text-[11px] px-1.5 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] '
    + 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]';

function ChartControls({ columns, numericColumns, config, onType, onX, onToggleY, onSeries }: ChartControlsProps) {
    const selectedY = config?.y ?? [];
    return (
        <div className="flex flex-wrap items-start gap-3" data-testid="kusto-chart-controls">
            <label className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase text-[#848484]">Type</span>
                <select
                    className={SELECT_CLASS}
                    value={config?.type ?? 'bar'}
                    onChange={e => onType(e.target.value as KustoChartType)}
                    data-testid="kusto-chart-type"
                >
                    {CHART_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
            </label>
            <label className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase text-[#848484]">X axis</span>
                <select
                    className={SELECT_CLASS}
                    value={config?.x ?? ''}
                    onChange={e => onX(e.target.value)}
                    data-testid="kusto-chart-x"
                >
                    <option value="">(row number)</option>
                    {columns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                </select>
            </label>
            <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase text-[#848484]">Y (numeric)</span>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[220px]" data-testid="kusto-chart-y">
                    {numericColumns.length === 0 ? (
                        <span className="text-[10px] italic text-[#848484]">No numeric columns</span>
                    ) : (
                        numericColumns.map(name => (
                            <label key={name} className="inline-flex items-center gap-1 text-[11px]">
                                <input
                                    type="checkbox"
                                    checked={selectedY.includes(name)}
                                    onChange={() => onToggleY(name)}
                                    data-testid={`kusto-chart-y-${name}`}
                                />
                                {name}
                            </label>
                        ))
                    )}
                </div>
            </div>
            <label className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase text-[#848484]">Series</span>
                <select
                    className={SELECT_CLASS}
                    value={config?.series ?? ''}
                    onChange={e => onSeries(e.target.value)}
                    data-testid="kusto-chart-series"
                >
                    <option value="">(none)</option>
                    {columns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                </select>
            </label>
        </div>
    );
}

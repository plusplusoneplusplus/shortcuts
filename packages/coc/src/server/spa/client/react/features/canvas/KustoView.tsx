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
import { createPortal } from 'react-dom';
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
import { KustoChart, numericColumnNames, seriesColor } from './KustoChart';

export interface KustoViewProps {
    workspaceId: string;
    canvas: Canvas;
    /** Called with the updated canvas after a successful run so the host can refresh. */
    onCanvasSaved?: (canvas: Canvas) => void;
    /** Compact layout for inline chat embeds (hides the editors by default). */
    compact?: boolean;
    /**
     * Read-only historical view: renders the stored query + result table from a
     * past revision with no Run, no Ask-AI, and no autosave. Used when viewing an
     * older canvas revision so saved rows render through InteractiveTable instead
     * of the markdown pipeline, and the historical snapshot is never mutated.
     */
    readOnly?: boolean;
    /**
     * Embed compaction: render the cluster/database editors into `connectionSlot`
     * (a node in the host's header) instead of the body, reclaiming the vertical
     * space the labeled connection row would otherwise take. The editors stay
     * owned by this component; only their mount point moves.
     */
    connectionInHeader?: boolean;
    connectionSlot?: HTMLElement | null;
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


/** Tiny stroke icons for the Kusto toolbar (24×24 viewBox, currentColor). */
const ICON_PATHS = {
    server: ['M3 5h18v6H3z', 'M3 13h18v6H3z', 'M7 8h.01', 'M7 16h.01'],
    database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    play: ['M7 4l13 8-13 8z'],
    sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
    send: ['M5 12h14', 'M13 6l6 6-6 6'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    table: ['M3 5h18v14H3z', 'M3 10h18', 'M9 10v9'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
    bar: ['M5 20V11', 'M12 20V5', 'M19 20v-6'],
    line: ['M3 17l6-6 4 4 8-8'],
    area: ['M3 18l6-7 4 4 8-8v11z'],
    scatter: ['M6 16h.01', 'M10 9h.01', 'M15 13h.01', 'M18 6h.01', 'M8 19h.01'],
    pie: ['M12 3v9h9', 'M21 12a9 9 0 1 1-9-9'],
} as const;

type IconName = keyof typeof ICON_PATHS;

function KustoIcon({ name, size = 13, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
        >
            {ICON_PATHS[name].map(d => <path key={d} d={d} />)}
        </svg>
    );
}

const BORDER = 'border-[#e0e0e0] dark:border-[#3c3c3c]';
const CARD_CLASS = `rounded-lg border ${BORDER} bg-white dark:bg-[#252526] overflow-hidden`;
const FIELD_INPUT_CLASS =
    'flex-1 min-w-0 bg-transparent border-0 outline-none text-[12px] text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#a0a0a0]';
const GHOST_BTN_CLASS =
    'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-[#616161] dark:text-[#cccccc] '
    + 'hover:bg-[#f0f0f0] dark:hover:bg-[#2d2d2d] disabled:opacity-50 disabled:cursor-not-allowed';
const SEGMENT_GROUP_CLASS = `inline-flex p-0.5 rounded-md border ${BORDER} bg-[#f5f5f5] dark:bg-[#1e1e1e]`;
const SELECT_CLASS =
    `h-7 text-[12px] px-2 rounded-md border ${BORDER} bg-white dark:bg-[#1e1e1e] `
    + 'text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]';

function segmentClass(active: boolean): string {
    return active
        ? 'bg-white dark:bg-[#37373d] text-[#1e1e1e] dark:text-white font-medium shadow-sm'
        : 'text-[#616161] dark:text-[#a0a0a0] hover:text-[#1e1e1e] dark:hover:text-white';
}

/** Shift+Enter or Ctrl/Cmd+Enter in the query editor runs the query. */
export function isRunShortcut(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    return e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey);
}

export function KustoView({ workspaceId, canvas, onCanvasSaved, compact = false, readOnly = false, connectionInHeader = false, connectionSlot = null }: KustoViewProps) {
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

    // AC-06 Ask-AI loop: a small prompt row, opened from the editor toolbar,
    // that sends a follow-up into the owning conversation (canvas.processId)
    // with the current query + the user's instruction, so the AI improves the
    // query via the kusto_query tool.
    const [askOpen, setAskOpen] = useState(false);
    const [askInstruction, setAskInstruction] = useState('');
    const [asking, setAsking] = useState(false);
    const [askError, setAskError] = useState<string | null>(null);
    const [askSent, setAskSent] = useState(false);

    const handleAskAi = useCallback(async () => {
        const instruction = askInstruction.trim();
        if (readOnly || !instruction || !canvas.processId || asking) return;
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
    }, [askInstruction, canvas.processId, canvas.id, asking, client, query, workspaceId, readOnly]);

    const handleRun = useCallback(async () => {
        if (running || readOnly || !query.trim()) return;
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
    }, [client, workspaceId, canvas.id, query, clusterUrl, database, running, onCanvasSaved, readOnly]);

    const { columns, rows, truncated, lastRun } = parsed;
    const numericColumns = useMemo(() => numericColumnNames(columns, rows), [columns, rows]);

    // Persist a chart-config change back into the canvas content JSON, keeping
    // the current columns/rows/query. Updates local state immediately for
    // responsiveness; the returned canvas re-seeds via onCanvasSaved.
    const persistChartConfig = useCallback(
        async (next: KustoChartConfig | undefined) => {
            setChartConfig(next);
            // Historical views must not mutate the stored snapshot — keep the
            // chart toggle local only.
            if (readOnly) return;
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
        [parsed, client, workspaceId, canvas.id, canvas.revision, onCanvasSaved, readOnly],
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
    const hasResults = columns.length > 0;
    const canAskAi = !compact && !readOnly && !!canvas.processId;

    const connectionFields = (inHeader: boolean) => (
        <>
            <label className={`flex flex-[3] items-center gap-2 min-w-0 ${inHeader ? '' : 'px-2.5'} text-[#848484]`} title="Cluster URL">
                <KustoIcon name="server" />
                <span className="sr-only">Cluster URL</span>
                <input
                    type="text"
                    className={`${FIELD_INPUT_CLASS} font-mono`}
                    value={clusterUrl}
                    onChange={e => setClusterUrl(e.target.value)}
                    placeholder="https://help.kusto.windows.net"
                    spellCheck={false}
                    readOnly={readOnly}
                    data-testid="kusto-cluster"
                />
            </label>
            <span className={`w-px self-stretch ${inHeader ? 'my-1' : ''} bg-[#e0e0e0] dark:bg-[#3c3c3c]`} />
            <label className={`flex flex-[2] items-center gap-2 min-w-0 ${inHeader ? '' : 'px-2.5'} text-[#848484]`} title="Database">
                <KustoIcon name="database" />
                <span className="sr-only">Database</span>
                <input
                    type="text"
                    className={FIELD_INPUT_CLASS}
                    value={database}
                    onChange={e => setDatabase(e.target.value)}
                    placeholder="Samples"
                    spellCheck={false}
                    readOnly={readOnly}
                    data-testid="kusto-database"
                />
            </label>
        </>
    );

    // Body connection bar: cluster + database share one compact row.
    const inlineConnectionEditors = (
        <div
            className={`flex items-center h-8 rounded-lg border ${BORDER} bg-[#f8f8f8] dark:bg-[#1e1e1e]`}
            data-testid="kusto-connection"
        >
            {connectionFields(false)}
        </div>
    );

    // Connection editors mounted into the host header slot.
    const headerConnectionEditors = (
        <div className="flex flex-1 items-center gap-2 min-w-0" data-testid="kusto-connection-header">
            {connectionFields(true)}
        </div>
    );

    const statusBadge = (
        <span className="flex-1 min-w-0 truncate text-[11px]" data-testid="kusto-status">
            {status === 'loading' && <span className="text-[#848484]">Running query…</span>}
            {status === 'success' && !running && (
                <span className="inline-flex items-center gap-1.5 text-[#848484]">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium">
                        {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
                        {truncated ? ' (truncated to 10,000)' : ''}
                    </span>
                    {lastRun?.timestamp ? <span>{formatTimestamp(lastRun.timestamp)}</span> : null}
                </span>
            )}
            {status === 'error' && !running && (
                <span className="px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400" data-testid="kusto-error">
                    {lastRun?.error ?? 'Query failed'}
                </span>
            )}
            {status === 'idle' && !running && <span className="text-[#848484]">Not run yet</span>}
        </span>
    );

    return (
        <div className="flex flex-col h-full min-h-0 text-[#1e1e1e] dark:text-[#cccccc]" data-testid="kusto-view">
            {connectionInHeader && connectionSlot && createPortal(headerConnectionEditors, connectionSlot)}
            <div className={`shrink-0 flex flex-col ${compact ? 'gap-1.5 p-2' : 'gap-2.5 p-3'}`}>
                {!connectionInHeader && inlineConnectionEditors}

                {/* Query editor card with its toolbar underneath */}
                <div className={CARD_CLASS}>
                    <textarea
                        className={`block w-full px-3 py-2 font-mono text-[12px] leading-5 resize-y outline-none bg-[#fafafa] dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#d4d4d4] ${compact ? 'min-h-[48px]' : 'min-h-[88px]'}`}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (!readOnly && isRunShortcut(e)) {
                                e.preventDefault();
                                void handleRun();
                            }
                        }}
                        placeholder="StormEvents | take 100"
                        aria-label="KQL query"
                        spellCheck={false}
                        readOnly={readOnly}
                        data-testid="kusto-query"
                    />
                    <div className={`flex items-center gap-2 px-2 py-1.5 border-t ${BORDER}`}>
                        {!readOnly && (
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] bg-[#0078d4] text-white font-semibold hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => void handleRun()}
                                disabled={running || !query.trim()}
                                title="Run (Shift+Enter)"
                                data-testid="kusto-run"
                            >
                                <KustoIcon name="play" size={10} filled />
                                {running ? 'Running…' : 'Run'}
                            </button>
                        )}
                        {statusBadge}
                        {canAskAi && (
                            <button
                                type="button"
                                className={`${GHOST_BTN_CLASS} ${askOpen ? 'bg-[#f0f0f0] dark:bg-[#2d2d2d]' : ''}`}
                                onClick={() => setAskOpen(open => !open)}
                                aria-expanded={askOpen}
                                data-testid="kusto-ask-toggle"
                            >
                                <span className="text-[#8b5cf6]"><KustoIcon name="sparkle" /></span>
                                Ask AI
                            </button>
                        )}
                    </div>

                    {/* AC-06 Ask-AI loop — only when the Kusto canvas is linked to a chat. */}
                    {canAskAi && askOpen && (
                        <div className={`flex flex-col gap-1 px-2 py-1.5 border-t ${BORDER} bg-[#f8f8f8] dark:bg-[#1e1e1e]`} data-testid="kusto-ask-ai">
                            <div className="flex items-center gap-2">
                                <span className="text-[#8b5cf6] pl-1"><KustoIcon name="sparkle" /></span>
                                <input
                                    type="text"
                                    className={`${FIELD_INPUT_CLASS} h-7`}
                                    value={askInstruction}
                                    onChange={e => { setAskInstruction(e.target.value); setAskSent(false); }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void handleAskAi();
                                        }
                                    }}
                                    placeholder="Describe a change, e.g. add a 7-day rolling average"
                                    aria-label="Ask AI to improve this query"
                                    autoFocus
                                    data-testid="kusto-ask-input"
                                />
                                <button
                                    type="button"
                                    className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-[#8b5cf6] text-white hover:bg-[#7c3aed] disabled:bg-[#d4d4d4] dark:disabled:bg-[#3c3c3c] disabled:cursor-not-allowed"
                                    onClick={() => void handleAskAi()}
                                    disabled={asking || !askInstruction.trim()}
                                    title={asking ? 'Asking…' : 'Ask AI'}
                                    aria-label="Ask AI"
                                    data-testid="kusto-ask-send"
                                >
                                    <KustoIcon name="send" />
                                </button>
                            </div>
                            {askSent && (
                                <span className="pl-1 text-[11px] text-emerald-600 dark:text-emerald-400" data-testid="kusto-ask-sent">
                                    Sent to the conversation — the AI will update this Kusto query.
                                </span>
                            )}
                            {askError && (
                                <span className="pl-1 text-[11px] text-red-500" data-testid="kusto-ask-error">{askError}</span>
                            )}
                        </div>
                    )}
                </div>
                {runError && (
                    <div className="text-[11px] text-red-500" data-testid="kusto-run-error">{runError}</div>
                )}
            </div>

            {/* Results card — table or chart. The table view owns its own
                vertical scroll (so its header can stick), so its wrapper must
                not scroll; chart and empty states keep a scrolling body. */}
            <div className={`flex-1 min-h-0 flex flex-col ${compact ? 'px-2 pb-2' : 'px-3 pb-3'}`}>
                <div className={`${CARD_CLASS} flex-1 min-h-0 flex flex-col`}>
                    <div className={`shrink-0 flex items-center gap-2 pl-3 pr-1.5 py-1 border-b ${BORDER}`}>
                        <span className="text-[12px] font-semibold">Results</span>
                        {hasResults && (
                            <span className="text-[11px] text-[#848484]" data-testid="kusto-result-summary">
                                {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} · {columns.length} column{columns.length === 1 ? '' : 's'}
                            </span>
                        )}
                        <span className="flex-1" />
                        {hasResults && (
                            <div className={SEGMENT_GROUP_CLASS} role="group" aria-label="View">
                                <button
                                    type="button"
                                    className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[12px] ${segmentClass(view === 'table')}`}
                                    onClick={() => setView('table')}
                                    aria-pressed={view === 'table'}
                                    data-testid="kusto-view-table"
                                >
                                    <KustoIcon name="table" size={12} /> Table
                                </button>
                                <button
                                    type="button"
                                    className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[12px] ${segmentClass(view === 'chart')}`}
                                    onClick={() => setView('chart')}
                                    aria-pressed={view === 'chart'}
                                    data-testid="kusto-view-chart"
                                >
                                    <KustoIcon name="chart" size={12} /> Chart
                                </button>
                            </div>
                        )}
                        {hasResults && (
                            <button
                                type="button"
                                className={GHOST_BTN_CLASS}
                                onClick={handleCsvDownload}
                                title="Download CSV"
                                data-testid="kusto-csv"
                            >
                                <KustoIcon name="download" /> CSV
                            </button>
                        )}
                    </div>
                    <div
                        className={
                            hasResults && view !== 'chart'
                                ? 'flex-1 min-h-0 overflow-hidden flex flex-col'
                                : 'flex-1 min-h-0 overflow-auto p-3'
                        }
                    >
                        {!hasResults ? (
                            <div className="text-[12px] text-[#848484] text-center py-8" data-testid="kusto-empty">
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
                                    <KustoChart columns={columns} rows={rows} config={chartConfig} compact={compact} />
                                ) : (
                                    <div className="text-[12px] text-[#848484] text-center py-8" data-testid="kusto-chart-unconfigured">
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
                                fillHeight
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const CHART_TYPES: { value: KustoChartType; label: string; icon: IconName }[] = [
    { value: 'bar', label: 'Bar', icon: 'bar' },
    { value: 'line', label: 'Line', icon: 'line' },
    { value: 'stackedArea', label: 'Stacked area', icon: 'area' },
    { value: 'scatter', label: 'Scatter', icon: 'scatter' },
    { value: 'pie', label: 'Pie', icon: 'pie' },
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

const CONTROL_LABEL_CLASS = 'text-[11px] font-medium text-[#848484]';

function ChartControls({ columns, numericColumns, config, onType, onX, onToggleY, onSeries }: ChartControlsProps) {
    const selectedY = config?.y ?? [];
    const activeType = config?.type ?? 'bar';
    // Chip swatches match the plotted series colors; a split recolors the
    // series by value, so the chips drop their swatch color then.
    const plottedY = selectedY.filter(name => numericColumns.includes(name));
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="kusto-chart-controls">
            <div className={SEGMENT_GROUP_CLASS} role="group" aria-label="Chart type" data-testid="kusto-chart-type" data-value={activeType}>
                {CHART_TYPES.map(t => (
                    <button
                        key={t.value}
                        type="button"
                        className={`inline-flex items-center justify-center w-7 h-6 rounded ${segmentClass(activeType === t.value)}`}
                        onClick={() => onType(t.value)}
                        aria-pressed={activeType === t.value}
                        aria-label={t.label}
                        title={t.label}
                        data-testid={`kusto-chart-type-${t.value}`}
                    >
                        <KustoIcon name={t.icon} size={14} />
                    </button>
                ))}
            </div>
            <label className="inline-flex items-center gap-1.5">
                <span className={CONTROL_LABEL_CLASS}>X</span>
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
            <div className="inline-flex flex-wrap items-center gap-1.5" data-testid="kusto-chart-y">
                <span className={CONTROL_LABEL_CLASS}>Y</span>
                {numericColumns.length === 0 ? (
                    <span className="text-[11px] italic text-[#848484]">No numeric columns</span>
                ) : (
                    numericColumns.map(name => {
                        const on = selectedY.includes(name);
                        const plotIndex = plottedY.indexOf(name);
                        const swatch = on && !config?.series && plotIndex >= 0 ? seriesColor(plotIndex) : undefined;
                        return (
                            <button
                                key={name}
                                type="button"
                                className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[12px] ${on
                                    ? 'border-[#0078d4]/50 bg-[#0078d4]/10 text-[#1e1e1e] dark:text-white'
                                    : `${BORDER} text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white`}`}
                                onClick={() => onToggleY(name)}
                                aria-pressed={on}
                                data-testid={`kusto-chart-y-${name}`}
                            >
                                <span
                                    className="inline-block w-2 h-2 rounded-sm bg-[#c8c8c8] dark:bg-[#555]"
                                    style={swatch ? { backgroundColor: swatch } : undefined}
                                />
                                {name}
                            </button>
                        );
                    })
                )}
            </div>
            <label className="inline-flex items-center gap-1.5">
                <span className={CONTROL_LABEL_CLASS}>Split by</span>
                <select
                    className={SELECT_CLASS}
                    value={config?.series ?? ''}
                    onChange={e => onSeries(e.target.value)}
                    data-testid="kusto-chart-series"
                >
                    <option value="">None</option>
                    {columns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                </select>
            </label>
        </div>
    );
}

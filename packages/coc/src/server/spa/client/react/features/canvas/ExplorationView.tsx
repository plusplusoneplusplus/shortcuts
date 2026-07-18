/**
 * ExplorationView — interactive Kusto data-exploration surface (AC-04/AC-05).
 *
 * Renders an exploration canvas: an editable KQL query, editable cluster/
 * database fields, a Run button that executes the query server-side (no AI
 * turn) via `POST /canvases/:id/run`, run status, and the result rows in the
 * shared InteractiveTable. Results are CSV-exportable from the stored rows.
 *
 * The full exploration state rides in the canvas `content` string as JSON, so
 * this component parses it on load and re-parses each returned canvas after a
 * run. The chart view (AC-05) is added alongside the table view.
 */

import { useCallback, useMemo, useState } from 'react';
import type { Canvas, ExplorationCellValue, ExplorationColumn, ExplorationState } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';
import { InteractiveTable, tableToCsv } from '../../shared/InteractiveTable';

export interface ExplorationViewProps {
    workspaceId: string;
    canvas: Canvas;
    /** Called with the updated canvas after a successful run so the host can refresh. */
    onCanvasSaved?: (canvas: Canvas) => void;
    /** Compact layout for inline chat embeds (hides the editors by default). */
    compact?: boolean;
}

/** Tolerant client-side parse of the exploration JSON stored in canvas content. */
export function parseExplorationContent(content: string | undefined | null): ExplorationState {
    const empty: ExplorationState = {
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
        columns: Array.isArray(obj.columns) ? (obj.columns as ExplorationColumn[]) : [],
        rows: Array.isArray(obj.rows) ? (obj.rows as ExplorationCellValue[][]) : [],
        truncated: obj.truncated === true,
        ...(obj.chartConfig && typeof obj.chartConfig === 'object' ? { chartConfig: obj.chartConfig as ExplorationState['chartConfig'] } : {}),
        ...(obj.lastRun && typeof obj.lastRun === 'object' ? { lastRun: obj.lastRun as ExplorationState['lastRun'] } : {}),
    };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch] ?? ch);
}

/** Render a cell value as display text (null → empty). */
function cellText(value: ExplorationCellValue): string {
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

export function ExplorationView({ workspaceId, canvas, onCanvasSaved, compact = false }: ExplorationViewProps) {
    const client = useCocClient(workspaceId);
    const parsed = useMemo(() => parseExplorationContent(canvas.content), [canvas.content]);

    const [query, setQuery] = useState(parsed.query);
    const [clusterUrl, setClusterUrl] = useState(parsed.clusterUrl);
    const [database, setDatabase] = useState(parsed.database);
    // Track which canvas revision the local drafts were seeded from so a live
    // AI update (new content) re-seeds the editors instead of clobbering them.
    const [seededFrom, setSeededFrom] = useState(canvas.content);
    if (seededFrom !== canvas.content) {
        setSeededFrom(canvas.content);
        setQuery(parsed.query);
        setClusterUrl(parsed.clusterUrl);
        setDatabase(parsed.database);
    }

    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);

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
        const slug = canvas.id.replace(/-[0-9a-f]{6}$/, '') || 'exploration';
        anchor.download = `${slug}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }, [headers, stringRows, canvas.id]);

    const status = running ? 'loading' : (lastRun?.status ?? 'idle');
    const rowCount = lastRun?.rowCount ?? rows.length;

    return (
        <div className="flex flex-col h-full min-h-0 text-[#1e1e1e] dark:text-[#cccccc]" data-testid="exploration-view">
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
                            data-testid="exploration-cluster"
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
                            data-testid="exploration-database"
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
                        data-testid="exploration-query"
                    />
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="px-3 py-1 text-[11px] rounded bg-[#0078d4] text-white font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void handleRun()}
                        disabled={running || !query.trim()}
                        data-testid="exploration-run"
                    >
                        {running ? 'Running…' : 'Run'}
                    </button>
                    <span className="flex-1 text-[10px]" data-testid="exploration-status">
                        {status === 'loading' && <span className="text-[#848484]">Running query…</span>}
                        {status === 'success' && !running && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                                {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
                                {truncated ? ' (truncated to 10,000)' : ''}
                                {lastRun?.timestamp ? ` · ${formatTimestamp(lastRun.timestamp)}` : ''}
                            </span>
                        )}
                        {status === 'error' && !running && (
                            <span className="text-red-500" data-testid="exploration-error">{lastRun?.error ?? 'Query failed'}</span>
                        )}
                        {status === 'idle' && !running && <span className="text-[#848484]">Not run yet</span>}
                    </span>
                    {columns.length > 0 && (
                        <button
                            type="button"
                            className="px-2 py-1 text-[11px] rounded border border-[#e0e0e0] dark:border-[#474749] text-[#616161] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                            onClick={handleCsvDownload}
                            data-testid="exploration-csv"
                        >
                            CSV
                        </button>
                    )}
                </div>
                {runError && (
                    <div className="text-[10px] text-red-500" data-testid="exploration-run-error">{runError}</div>
                )}
            </div>

            {/* Results table */}
            <div className="flex-1 min-h-0 overflow-auto p-3">
                {columns.length === 0 ? (
                    <div className="text-[11px] italic text-[#848484] text-center py-6" data-testid="exploration-empty">
                        {status === 'error' ? 'Run failed — see the error above.' : 'Run a query to see results.'}
                    </div>
                ) : (
                    <InteractiveTable
                        tableKey={`exploration-${canvas.id}-${canvas.revision}`}
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

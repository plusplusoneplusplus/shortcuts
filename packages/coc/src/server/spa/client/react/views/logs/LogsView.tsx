/**
 * LogsView — top-level route component for #logs.
 *
 * Streams live server logs via SSE (/api/logs/stream) and supports:
 * - Level filter (all / info / warn / error)
 * - Free-text search (client-side, highlights matches)
 * - Pause / Resume auto-scroll
 * - Clear in-memory display
 *
 * Color-coded level badges:
 *   trace/debug → gray
 *   info        → blue
 *   warn        → amber
 *   error/fatal → red
 */

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { getApiBase } from '../../utils/config';
import { cn } from '../../shared/cn';

// ── Types ──────────────────────────────────────────────────────────────────

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
    ts: string;
    level: LogLevel;
    component?: string;
    msg: string;
    [key: string]: unknown;
}

const LEVEL_NUM: Record<LogLevel, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

// ── Known structured fields ────────────────────────────────────────────────

/** Fields rendered inline after msg. */
const KNOWN_INLINE_FIELDS = new Set(['method', 'path', 'status', 'durationMs', 'resource', 'id']);
/** All fields that are not "extra" (core meta + inline known fields). */
const CORE_FIELDS = new Set(['ts', 'level', 'component', 'msg', ...KNOWN_INLINE_FIELDS]);

// ── Level badge styles ─────────────────────────────────────────────────────

function levelBadgeClass(level: LogLevel): string {
    switch (level) {
        case 'fatal':
        case 'error':
            return 'bg-[#f14c4c]/20 text-[#f14c4c] dark:bg-[#f14c4c]/30 dark:text-[#f48771]';
        case 'warn':
            return 'bg-[#cca700]/20 text-[#a07500] dark:bg-[#cca700]/30 dark:text-[#cca700]';
        case 'info':
            return 'bg-[#0078d4]/15 text-[#0078d4] dark:bg-[#0078d4]/30 dark:text-[#4fc3f7]';
        default:
            return 'bg-[#888]/15 text-[#616161] dark:bg-[#888]/20 dark:text-[#999]';
    }
}

function rowTextClass(level: LogLevel): string {
    switch (level) {
        case 'fatal':
        case 'error':
            return 'text-[#f14c4c] dark:text-[#f48771]';
        case 'warn':
            return 'text-[#a07500] dark:text-[#cca700]';
        default:
            return '';
    }
}

function methodBadgeClass(method: string): string {
    switch (method.toUpperCase()) {
        case 'GET': return 'bg-[#0078d4]/15 text-[#0078d4] dark:bg-[#0078d4]/30 dark:text-[#4fc3f7]';
        case 'POST': return 'bg-[#16825d]/15 text-[#16825d] dark:bg-[#16825d]/30 dark:text-[#89d185]';
        case 'PATCH':
        case 'PUT': return 'bg-[#cca700]/20 text-[#a07500] dark:bg-[#cca700]/30 dark:text-[#cca700]';
        case 'DELETE': return 'bg-[#f14c4c]/20 text-[#f14c4c] dark:bg-[#f14c4c]/30 dark:text-[#f48771]';
        default: return 'bg-[#888]/15 text-[#616161] dark:bg-[#888]/20 dark:text-[#999]';
    }
}

function statusTextClass(status: number): string {
    if (status >= 500) return 'text-[#f14c4c] dark:text-[#f48771]';
    if (status >= 400) return 'text-[#a07500] dark:text-[#cca700]';
    return 'text-[#16825d] dark:text-[#89d185]';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTs(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
        return iso;
    }
}

function highlightText(text: string, query: string): JSX.Element | string {
    if (!query) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <mark className="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
            {text.slice(idx + query.length)}
        </>
    );
}

// ── Level filter options ───────────────────────────────────────────────────

const FILTER_LEVELS: { label: string; value: LogLevel | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Debug+', value: 'debug' },
    { label: 'Info+', value: 'info' },
    { label: 'Warn+', value: 'warn' },
    { label: 'Error+', value: 'error' },
];

// ── LogRow ─────────────────────────────────────────────────────────────────

function LogRow({ entry, search }: { entry: LogEntry; search: string }) {
    const [expanded, setExpanded] = useState(false);

    const method = typeof entry.method === 'string' ? entry.method : undefined;
    const path = typeof entry.path === 'string' ? entry.path : undefined;
    const status = typeof entry.status === 'number' ? entry.status : undefined;
    const durationMs = typeof entry.durationMs === 'number' ? entry.durationMs : undefined;
    const resource = typeof entry.resource === 'string' ? entry.resource : undefined;
    const id = entry.id !== undefined && entry.id !== null ? String(entry.id) : undefined;

    const unknownFields = Object.keys(entry).filter(k => !CORE_FIELDS.has(k));
    const hasUnknown = unknownFields.length > 0;

    return (
        <Fragment>
            <div
                className={cn(
                    'flex items-start gap-2 py-0.5 px-3 font-mono text-xs leading-5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                    rowTextClass(entry.level),
                )}
                data-testid="log-row"
                data-level={entry.level}
            >
                <span className="shrink-0 text-[#888] dark:text-[#777] w-[90px]">{formatTs(entry.ts)}</span>
                <span className={cn('shrink-0 inline-block rounded px-1 text-[10px] font-semibold uppercase w-[44px] text-center', levelBadgeClass(entry.level))}>
                    {entry.level}
                </span>
                {entry.component && (
                    <span className="shrink-0 text-[#888] dark:text-[#666] w-[80px] truncate" title={entry.component}>
                        {entry.component}
                    </span>
                )}
                <span className="flex-1 min-w-0 break-words whitespace-pre-wrap">
                    {highlightText(entry.msg, search)}
                </span>
                {method && (
                    <span
                        className={cn('shrink-0 inline-block rounded px-1 text-[10px] font-semibold uppercase', methodBadgeClass(method))}
                        data-testid="log-field-method"
                    >
                        {method}
                    </span>
                )}
                {path && (
                    <span
                        className="shrink-0 text-[#888] dark:text-[#666] max-w-[200px] truncate"
                        title={path}
                        data-testid="log-field-path"
                    >
                        {path}
                    </span>
                )}
                {status !== undefined && (
                    <span
                        className={cn('shrink-0 font-semibold', statusTextClass(status))}
                        data-testid="log-field-status"
                    >
                        {status}
                    </span>
                )}
                {durationMs !== undefined && (
                    <span className="shrink-0 text-[#888] dark:text-[#666]" data-testid="log-field-duration">
                        {durationMs}ms
                    </span>
                )}
                {resource && (
                    <span className="shrink-0 text-[#888] dark:text-[#666]" data-testid="log-field-resource">
                        {resource}
                    </span>
                )}
                {id && (
                    <span
                        className="shrink-0 text-[#888] dark:text-[#666] max-w-[80px] truncate"
                        title={id}
                        data-testid="log-field-id"
                    >
                        {id}
                    </span>
                )}
                {hasUnknown && (
                    <button
                        className="shrink-0 text-[#888] dark:text-[#666] hover:text-[#0078d4] px-0.5 leading-none"
                        onClick={() => setExpanded(v => !v)}
                        title={expanded ? 'Collapse details' : 'Expand details'}
                        data-testid="log-expand-toggle"
                        aria-expanded={expanded}
                    >
                        ⋯
                    </button>
                )}
            </div>
            {expanded && hasUnknown && (
                <div
                    className="font-mono text-xs text-[#888] dark:text-[#666] bg-black/[0.03] dark:bg-white/[0.03] px-[130px] py-0.5 flex flex-wrap gap-x-4"
                    data-testid="log-row-details"
                >
                    {unknownFields.map(k => (
                        <span key={k}>
                            <span className="text-[#0078d4] dark:text-[#4fc3f7]">{k}</span>
                            <span>{': '}</span>
                            <span>{JSON.stringify((entry as Record<string, unknown>)[k])}</span>
                        </span>
                    ))}
                </div>
            )}
        </Fragment>
    );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LogsView() {
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
    const [search, setSearch] = useState('');
    const [paused, setPaused] = useState(false);
    const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

    const listRef = useRef<HTMLDivElement>(null);
    const pausedRef = useRef(false);
    const entriesRef = useRef<LogEntry[]>([]);
    const sseRef = useRef<EventSource | null>(null);

    // Keep ref in sync
    pausedRef.current = paused;

    const scrollToBottom = useCallback(() => {
        if (!listRef.current) return;
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }, []);

    const appendEntries = useCallback((incoming: LogEntry[]) => {
        setEntries(prev => {
            const next = [...prev, ...incoming].slice(-2000); // cap at 2000
            entriesRef.current = next;
            return next;
        });
        if (!pausedRef.current) {
            // defer scroll so DOM has updated
            requestAnimationFrame(scrollToBottom);
        }
    }, [scrollToBottom]);

    // SSE connection
    useEffect(() => {
        const apiBase = getApiBase();
        const url = `${apiBase}/logs/stream`;

        const connect = () => {
            const es = new EventSource(url);
            sseRef.current = es;
            setSseStatus('connecting');

            es.addEventListener('history', (e: MessageEvent) => {
                try {
                    const history: LogEntry[] = JSON.parse(e.data);
                    appendEntries(history);
                    setSseStatus('open');
                } catch { /* ignore parse error */ }
            });

            es.addEventListener('log-entry', (e: MessageEvent) => {
                try {
                    const entry: LogEntry = JSON.parse(e.data);
                    appendEntries([entry]);
                } catch { /* ignore */ }
            });

            es.addEventListener('heartbeat', () => {
                setSseStatus('open');
            });

            es.onerror = () => {
                setSseStatus('closed');
                es.close();
                // Reconnect after 3 s
                setTimeout(connect, 3000);
            };

            es.onopen = () => {
                setSseStatus('open');
            };
        };

        connect();

        return () => {
            sseRef.current?.close();
            sseRef.current = null;
        };
    }, [appendEntries]);

    // Auto-scroll when paused state changes from true→false
    useEffect(() => {
        if (!paused) {
            requestAnimationFrame(scrollToBottom);
        }
    }, [paused, scrollToBottom]);

    const handleClear = useCallback(() => {
        setEntries([]);
        entriesRef.current = [];
    }, []);

    // Filtered entries (client-side only)
    const filtered = useMemo(() => {
        const minLevelNum = filterLevel === 'all' ? 0 : (LEVEL_NUM[filterLevel as LogLevel] ?? 0);
        const q = search.trim().toLowerCase();
        return entries.filter(e => {
            if (LEVEL_NUM[e.level] < minLevelNum) return false;
            if (q) {
                const hay = (e.msg + ' ' + (e.component ?? '')).toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [entries, filterLevel, search]);

    const statusDot = {
        connecting: 'bg-[#cca700] animate-pulse',
        open: 'bg-[#16825d] dark:bg-[#89d185]',
        closed: 'bg-[#f14c4c]',
    }[sseStatus];

    const statusLabel = {
        connecting: 'Connecting…',
        open: 'Live',
        closed: 'Disconnected — reconnecting…',
    }[sseStatus];

    return (
        <div id="view-logs" className="flex flex-col h-full overflow-hidden" data-testid="logs-view">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] shrink-0">
                {/* Level filter */}
                <div className="flex items-center gap-1">
                    {FILTER_LEVELS.map(({ label, value }) => (
                        <button
                            key={value}
                            className={cn(
                                'h-6 px-2 rounded text-xs font-medium transition-colors',
                                filterLevel === value
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#616161] dark:text-[#999] hover:bg-black/[0.07] dark:hover:bg-white/[0.1]',
                            )}
                            data-testid={`level-filter-${value}`}
                            onClick={() => setFilterLevel(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Search */}
                <input
                    type="text"
                    className="h-6 px-2 rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-xs placeholder-[#aaa] focus:outline-none focus:border-[#0078d4] w-40"
                    placeholder="Search…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    data-testid="log-search"
                />

                <div className="flex-1" />

                {/* Live indicator */}
                <div className="flex items-center gap-1.5 text-xs text-[#888]" data-testid="sse-status">
                    <span className={cn('w-2 h-2 rounded-full inline-block', statusDot)} />
                    {statusLabel}
                </div>

                {/* Pause / Resume */}
                <button
                    className={cn(
                        'h-6 px-2 rounded text-xs font-medium transition-colors',
                        paused
                            ? 'bg-[#0078d4] text-white'
                            : 'text-[#616161] dark:text-[#999] hover:bg-black/[0.07] dark:hover:bg-white/[0.1]',
                    )}
                    data-testid="pause-btn"
                    onClick={() => setPaused(p => !p)}
                >
                    {paused ? '▶ Resume' : '⏸ Pause'}
                </button>

                {/* Clear */}
                <button
                    className="h-6 px-2 rounded text-xs text-[#616161] dark:text-[#999] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] transition-colors"
                    data-testid="clear-btn"
                    onClick={handleClear}
                >
                    Clear
                </button>
            </div>

            {/* Log list */}
            <div
                ref={listRef}
                className="flex-1 overflow-y-auto overflow-x-hidden py-1"
                data-testid="log-list"
            >
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#888] dark:text-[#666] gap-2 text-sm" data-testid="log-empty-state">
                        <span className="text-2xl">📋</span>
                        {entries.length === 0
                            ? 'No log entries yet. Logs will appear here once activity is recorded.'
                            : 'No entries match the current filter.'}
                    </div>
                ) : (
                    filtered.map((entry, i) => (
                        <LogRow key={i} entry={entry} search={search.trim()} />
                    ))
                )}
            </div>

            {/* Footer: entry count */}
            <div className="shrink-0 px-3 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[10px] text-[#888]">
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} shown
                {entries.length !== filtered.length && ` (${entries.length} total)`}
            </div>
        </div>
    );
}

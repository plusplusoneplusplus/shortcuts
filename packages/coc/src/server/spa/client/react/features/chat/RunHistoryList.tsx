import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import { formatRelativeTime } from '../../utils/format';
import type { RunRecord } from '../schedules/scheduleTypes';

export const HISTORY_PAGE_SIZE = 20;

/** Format milliseconds as a short duration string. */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
}

interface RunHistoryListProps {
    runs: RunRecord[];
    scheduleId: string;
    wsId: string;
    onRunNow: (scheduleId: string) => void;
    isRunning: boolean;
}

export function RunHistoryList({ runs: initialRuns, scheduleId, wsId, onRunNow, isRunning }: RunHistoryListProps) {
    // AC-07: schedule run history loads from the selected clone's server.
    const cloneClient = useCocClient(wsId);
    const [showOutputId, setShowOutputId] = useState<string | null>(null);
    const [history, setHistory] = useState<RunRecord[]>(initialRuns);
    const [historyPage, setHistoryPage] = useState(1);
    const [refreshing, setRefreshing] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Sync from parent (initial load / schedule change)
    useEffect(() => {
        setHistory(initialRuns);
        setHistoryPage(1);
    }, [initialRuns, scheduleId]);

    const refreshHistory = useCallback(async () => {
        setRefreshing(true);
        try {
            const history = await cloneClient.schedules.history(wsId, scheduleId);
            setHistory(history);
        } catch { /* ignore */ }
        setRefreshing(false);
    }, [wsId, scheduleId, cloneClient]);

    // Auto-poll every 3s while any run is in-progress
    useEffect(() => {
        const hasRunning = history.some(r => r.status === 'running');
        if (hasRunning) {
            pollRef.current = setInterval(refreshHistory, 3000);
        } else {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [history, refreshHistory]);

    const visibleHistory = history.slice(0, historyPage * HISTORY_PAGE_SIZE);
    const hasMore = history.length > visibleHistory.length;

    return (
        <div data-testid="run-history">
            <div className="px-4 py-2.5 flex items-center justify-between bg-[#f6f8fa] dark:bg-[#252526] border-b border-[#d0d7de] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1f2328] dark:text-[#cccccc]">
                    Run History{history.length > 0 ? ` (${history.length})` : ''}
                </span>
                <button
                    className="text-[11px] text-[#0969da] dark:text-[#4fc3f7] hover:underline disabled:opacity-50 flex items-center gap-1"
                    onClick={refreshHistory}
                    disabled={refreshing}
                    aria-label="Refresh run history"
                    data-testid="refresh-history-btn"
                >
                    {refreshing ? '…' : '↻'} Refresh
                </button>
            </div>

            {history.length === 0 ? (
                <div className="px-4 py-5 text-center text-[11px] text-[#656d76] dark:text-[#848484]" data-testid="no-runs-empty">
                    No runs yet —{' '}
                    <button
                        className="text-[#0969da] dark:text-[#4fc3f7] hover:underline"
                        onClick={() => onRunNow(scheduleId)}
                        disabled={isRunning}
                        aria-label="Run this schedule"
                    >
                        Run Now
                    </button>
                </div>
            ) : (
                <div className="flex flex-col" data-testid="history-list">
                    {visibleHistory.map(run => {
                        const isExpanded = showOutputId === run.id;
                        const hasOutput = !!(run.stdout || run.stderr);
                        return (
                            <div key={run.id} className="text-[11px] text-[#616161] dark:text-[#999] border-b border-[#eaeef2] dark:border-[#3c3c3c] last:border-b-0" data-testid={`run-row-${run.id}`}>
                                <div className="flex items-start gap-3 px-4 py-2">
                                    {/* Status icon */}
                                    <span className="flex-shrink-0 text-center w-3 mt-[3px]" aria-label={`Run status: ${run.status}`}>
                                        {run.status === 'completed' || run.status === 'success'
                                            ? <span className="inline-block w-2 h-2 rounded-full bg-[#1a7f37] dark:bg-[#3fb950]" />
                                            : run.status === 'failed'
                                                ? <span className="inline-block w-2 h-2 rounded-full bg-[#cf222e] dark:bg-[#f85149]" />
                                                : run.status === 'running'
                                                    ? <span className="inline-block w-3 h-3 border-2 border-[#0969da] border-t-transparent rounded-full animate-spin" aria-label="Running" />
                                                    : <span className="inline-block w-2 h-2 rounded-full bg-[#9a6700] dark:bg-amber-300" />}
                                    </span>
                                    {/* Start time */}
                                    <span className="min-w-0 flex-1 leading-tight" title={run.startedAt}>
                                        <span className="block text-[12px] text-[#1f2328] dark:text-[#cccccc]">{formatRelativeTime(run.startedAt)} · <span className="text-[#656d76] dark:text-[#848484]" data-testid={`iso-date-${run.id}`}>{run.startedAt.replace('T', ' ').replace(/\.\d+Z$/, '')}</span></span>
                                    </span>
                                    {/* Duration */}
                                    <span className="text-right font-mono text-[11px] text-[#656d76] dark:text-[#848484] flex-shrink-0 mt-[2px] tabular-nums">
                                        {run.durationMs != null ? formatDuration(run.durationMs) : '—'}
                                    </span>
                                    {/* Exit code */}
                                    <span className="text-right flex-shrink-0 mt-[2px] min-w-[44px]">
                                        {run.exitCode != null ? (
                                            <span className={cn(
                                                'font-mono text-[11px]',
                                                run.exitCode === 0
                                                    ? 'text-[#656d76] dark:text-[#848484]'
                                                    : 'text-[#cf222e] dark:text-red-400 font-medium'
                                            )} data-testid={`exit-code-${run.id}`}>
                                                exit {run.exitCode}
                                            </span>
                                        ) : null}
                                    </span>
                                    {/* Output toggle */}
                                    <span className="flex justify-end flex-shrink-0 mt-[1px] min-w-[60px]">
                                        {hasOutput ? (
                                            <button
                                                className="text-[11px] text-[#0969da] dark:text-[#4fc3f7] hover:underline select-none leading-tight"
                                                onClick={() => setShowOutputId(isExpanded ? null : run.id)}
                                                aria-expanded={isExpanded}
                                                aria-label={isExpanded ? 'Hide output' : 'Show output'}
                                            >
                                                {isExpanded ? 'Hide output' : 'Output'}
                                            </button>
                                        ) : null}
                                    </span>
                                    {/* Activity link */}
                                    <span className="flex justify-center flex-shrink-0 mt-[1px] w-4">
                                        {run.processId ? (
                                            <button
                                                className="text-[#0969da] dark:text-[#4fc3f7] hover:text-[#0550ae] leading-none"
                                                title="Go to activity"
                                                aria-label="Go to activity"
                                                data-testid={`activity-link-${run.id}`}
                                                onClick={() => {
                                                    location.hash = '#repos/' + encodeURIComponent(wsId) + '/activity/' + encodeURIComponent(run.processId!);
                                                }}
                                            >
                                                ↗
                                            </button>
                                        ) : null}
                                    </span>
                                </div>
                                {hasOutput && isExpanded && (
                                    <pre className="px-4 py-2 bg-[#eaeef2] dark:bg-[#1e1e1e] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all overflow-y-auto max-h-48 border-t border-[#d8dee4] dark:border-[#3c3c3c]" data-testid={`output-block-${run.id}`}>
                                        {run.stdout && <span>{run.stdout}</span>}
                                        {run.stderr && <span className="text-red-400 block">{run.stderr}</span>}
                                    </pre>
                                )}
                            </div>
                        );
                    })}
                    {hasMore && (
                        <button
                            className="px-4 py-2 text-[11px] text-[#0969da] dark:text-[#4fc3f7] hover:underline text-left"
                            onClick={() => setHistoryPage(p => p + 1)}
                            data-testid="load-more-history"
                        >
                            Load more ({history.length - visibleHistory.length} remaining)
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

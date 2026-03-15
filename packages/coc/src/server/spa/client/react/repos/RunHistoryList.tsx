import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';
import type { RunRecord } from './scheduleTypes';

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
            const data = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/schedules/${encodeURIComponent(scheduleId)}/history`);
            setHistory(data?.history || []);
        } catch { /* ignore */ }
        setRefreshing(false);
    }, [wsId, scheduleId]);

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
        <div className="px-3 py-2.5" data-testid="run-history">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase text-[#848484] font-medium">
                    Run History{history.length > 0 ? ` (${history.length})` : ''}
                </span>
                <button
                    className="text-[10px] text-[#0078d4] hover:underline disabled:opacity-50 flex items-center gap-0.5"
                    onClick={refreshHistory}
                    disabled={refreshing}
                    aria-label="Refresh run history"
                    data-testid="refresh-history-btn"
                >
                    {refreshing ? '…' : '↻'} Refresh
                </button>
            </div>

            {history.length === 0 ? (
                <div className="text-[11px] text-[#848484]" data-testid="no-runs-empty">
                    No runs yet —{' '}
                    <button
                        className="text-[#0078d4] hover:underline"
                        onClick={() => onRunNow(scheduleId)}
                        disabled={isRunning}
                        aria-label="Run this schedule"
                    >
                        Run Now
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-0.5" data-testid="history-list">
                    {visibleHistory.map(run => {
                        const isExpanded = showOutputId === run.id;
                        const hasOutput = !!(run.stdout || run.stderr);
                        return (
                            <div key={run.id} className="text-[11px] text-[#616161] dark:text-[#999] py-0.5" data-testid={`run-row-${run.id}`}>
                                <div className="grid items-center gap-2" style={{ gridTemplateColumns: '16px 1fr 44px 44px' }}>
                                    {/* Status icon */}
                                    <span className="flex-shrink-0 text-center" aria-label={`Run status: ${run.status}`}>
                                        {run.status === 'completed'
                                            ? <span className="text-green-600">✅</span>
                                            : run.status === 'failed'
                                                ? <span className="text-red-500">❌</span>
                                                : run.status === 'running'
                                                    ? <span className="inline-block w-3 h-3 border-2 border-[#0078d4] border-t-transparent rounded-full animate-spin" aria-label="Running" />
                                                    : <span className="text-yellow-500">⚠️</span>}
                                    </span>
                                    {/* Start time */}
                                    <span className="truncate" title={run.startedAt}>{formatRelativeTime(run.startedAt)}</span>
                                    {/* Duration */}
                                    <span className="text-right font-mono text-[10px] text-[#848484]">
                                        {run.durationMs != null ? formatDuration(run.durationMs) : '—'}
                                    </span>
                                    {/* Exit code */}
                                    <span className="text-right">
                                        {run.exitCode != null ? (
                                            <span className={cn(
                                                'text-[10px] px-1 py-0.5 rounded font-mono',
                                                run.exitCode === 0
                                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                                    : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                            )} data-testid={`exit-code-${run.id}`}>
                                                {run.exitCode}
                                            </span>
                                        ) : null}
                                    </span>
                                </div>
                                {hasOutput && (
                                    <div className="ml-5 mt-0.5">
                                        <button
                                            className="text-[10px] text-[#0078d4] hover:underline select-none"
                                            onClick={() => setShowOutputId(isExpanded ? null : run.id)}
                                            aria-expanded={isExpanded}
                                            aria-label={isExpanded ? 'Hide output' : 'Show output'}
                                        >
                                            {isExpanded ? 'Hide output' : 'Show output'}
                                        </button>
                                        {isExpanded && (
                                            <pre className="mt-0.5 p-1.5 rounded bg-[#f3f3f3] dark:bg-[#1e1e1e] font-mono text-[9px] whitespace-pre-wrap break-all overflow-y-auto max-h-48" data-testid={`output-block-${run.id}`}>
                                                {run.stdout && <span>{run.stdout}</span>}
                                                {run.stderr && <span className="text-red-400">{run.stderr}</span>}
                                            </pre>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {hasMore && (
                        <button
                            className="mt-1 text-[10px] text-[#0078d4] hover:underline text-left"
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

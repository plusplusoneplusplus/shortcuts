/**
 * RepoSchedulesTab — workspace-scoped schedule management with CRUD, run history.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';
import { fetchWorkflows } from './workflow-api';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { useApp } from '../context/AppContext';
import type { PipelineInfo } from './repoGrouping';

/** Try to reverse-parse a cron expression into a simple interval. */
export function parseCronToInterval(cron: string): { mode: 'interval'; value: string; unit: string } | { mode: 'cron' } {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return { mode: 'cron' };
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const minMatch = minute.match(/^\*\/(\d+)$/);
    if (minMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: minMatch[1], unit: 'minutes' };
    }

    const hrMatch = hour.match(/^\*\/(\d+)$/);
    if (minute === '0' && hrMatch && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: hrMatch[1], unit: 'hours' };
    }

    const dayMatch = dayOfMonth.match(/^\*\/(\d+)$/);
    if (minute === '0' && hour === '0' && dayMatch && month === '*' && dayOfWeek === '*') {
        return { mode: 'interval', value: dayMatch[1], unit: 'days' };
    }

    return { mode: 'cron' };
}

const WEEKDAY_NAMES: Record<string, string> = {
    '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
    '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '7': 'Sunday',
};

/** Human-readable description for common cron patterns. Returns '' for unrecognized. */
export function describeCron(expr: string): string {
    const p = expr.trim().split(/\s+/);
    if (p.length !== 5) return '';
    const [min, hr, dom, mon, dow] = p;

    if (min === '*' && hr === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';

    const minStep = min.match(/^\*\/(\d+)$/);
    if (minStep && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
        return `Every ${minStep[1]} minute${minStep[1] === '1' ? '' : 's'}`;
    }

    const hrStep = hr.match(/^\*\/(\d+)$/);
    if (min === '0' && hrStep && dom === '*' && mon === '*' && dow === '*') {
        return `Every ${hrStep[1]} hour${hrStep[1] === '1' ? '' : 's'}`;
    }

    if (min === '0' && hr === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';

    if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && mon === '*') {
        const hh = hr.padStart(2, '0');
        const mm = min.padStart(2, '0');
        const time = `${hh}:${mm}`;
        if (dow === '*') return `Every day at ${time}`;
        if (dow === '1-5') return `Weekdays at ${time}`;
        if (WEEKDAY_NAMES[dow]) return `Every ${WEEKDAY_NAMES[dow]} at ${time}`;
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
        const hh = hr.padStart(2, '0');
        const mm = min.padStart(2, '0');
        const d = parseInt(dom, 10);
        const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
        return `${d}${suffix} of every month at ${hh}:${mm}`;
    }

    return '';
}

export const CRON_EXAMPLES: { label: string; expr: string }[] = [
    { label: 'Every minute', expr: '* * * * *' },
    { label: 'Every 5 minutes', expr: '*/5 * * * *' },
    { label: 'Every hour', expr: '0 * * * *' },
    { label: 'Every 6 hours', expr: '0 */6 * * *' },
    { label: 'Daily at 9 AM', expr: '0 9 * * *' },
    { label: 'Weekdays at 9 AM', expr: '0 9 * * 1-5' },
    { label: 'Every Sunday at midnight', expr: '0 0 * * 0' },
    { label: '1st of month at noon', expr: '0 12 1 * *' },
];

interface RepoSchedulesTabProps {
    workspaceId: string;
}

interface Schedule {
    id: string;
    name: string;
    target: string;
    targetType?: 'prompt' | 'script';
    cron: string;
    cronDescription: string;
    params: Record<string, string>;
    onFailure: string;
    status: string;
    isRunning: boolean;
    nextRun: string | null;
    createdAt: string;
    outputFolder?: string;
    model?: string;
    mode?: 'ask' | 'plan' | 'autopilot';
}

interface RunRecord {
    id: string;
    scheduleId: string;
    startedAt: string;
    completedAt?: string;
    status: string;
    error?: string;
    durationMs?: number;
    processId?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
}

export function RepoSchedulesTab({ workspaceId }: RepoSchedulesTabProps) {
    const { state, dispatch } = useApp();
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(state.selectedScheduleId);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [duplicateValues, setDuplicateValues] = useState<Partial<Schedule> | null>(null);
    const { isMobile, isTablet } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 256 : 288,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'schedules-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const fetchSchedules = useCallback(async () => {
        try {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules`);
            setSchedules(data?.schedules || []);
        } catch {
            setSchedules([]);
        }
        setLoading(false);
    }, [workspaceId]);

    useEffect(() => {
        setLoading(true);
        fetchSchedules();
    }, [workspaceId, fetchSchedules]);

    // Listen for schedule WebSocket events
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type?.startsWith('schedule-') && msg.repoId === workspaceId) {
                    fetchSchedules();
                }
            } catch { /* ignore */ }
        };
        // Piggyback on existing WS — events come through CustomEvent in App.tsx
        const wsHandler = () => fetchSchedules();
        window.addEventListener('schedule-changed', wsHandler);
        return () => window.removeEventListener('schedule-changed', wsHandler);
    }, [workspaceId, fetchSchedules]);

    const handleSelect = (scheduleId: string) => {
        if (selectedId !== scheduleId) {
            setEditingId(null);
        }
        setSelectedId(scheduleId);
        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: scheduleId });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/' + encodeURIComponent(scheduleId);
        if (isMobile) setMobileShowDetail(true);
    };

    // Fetch history whenever selectedId changes
    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(selectedId)}/history`)
            .then(data => {
                if (!cancelled) setHistory(data?.history || []);
            })
            .catch(() => {
                if (!cancelled) setHistory([]);
            });
        return () => { cancelled = true; };
    }, [selectedId, workspaceId]);

    // Auto-select first schedule when schedules load and nothing is selected
    useEffect(() => {
        if (selectedId === null && schedules.length > 0) {
            const id = schedules[0].id;
            setSelectedId(id);
            dispatch({ type: 'SET_SELECTED_SCHEDULE', id });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/' + encodeURIComponent(id);
        }
    }, [schedules, selectedId, workspaceId, dispatch]);

    const handlePauseResume = async (schedule: Schedule) => {
        const newStatus = schedule.status === 'active' ? 'paused' : 'active';
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(schedule.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
        });
        fetchSchedules();
    };

    const handleRunNow = async (scheduleId: string) => {
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/run`, {
            method: 'POST',
        });
        fetchSchedules();
        if (selectedId === scheduleId) {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/history`);
            setHistory(data?.history || []);
        }
    };

    const handleDelete = async (scheduleId: string) => {
        if (!confirm('Delete this schedule?')) return;
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`, {
            method: 'DELETE',
        });
        if (selectedId === scheduleId) {
            // Deleted the selected schedule — will auto-select first remaining via useEffect
            setSelectedId(null);
            dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules';
        }
        fetchSchedules();
    };

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading schedules...</div>;
    }

    const selectedSchedule = schedules.find(s => s.id === selectedId) ?? null;

    const listPanel = (
        <>
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[11px] uppercase text-[#848484] font-medium">
                    SCHEDULES{schedules.length > 0 ? ` (${schedules.length})` : ''}
                </span>
                <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); if (isMobile) setMobileShowDetail(true); }}>
                    + New
                </Button>
            </div>

            {/* Empty state */}
            {schedules.length === 0 && (
                <div className="p-4 text-center text-sm text-[#848484]">
                    <div className="text-2xl mb-2">🕐</div>
                    <div>No schedules for this repo yet.</div>
                    <div className="text-xs mt-1">Click &quot;+ New&quot; to automate a workflow or script.</div>
                </div>
            )}

            {/* Schedule list */}
            {schedules.length > 0 && (
                <ul className="repo-schedule-list px-2 pb-4 flex flex-col gap-0.5 overflow-y-auto">
                    {schedules.map(schedule => {
                        const isActive = schedule.id === selectedId;
                        return (
                            <li
                                key={schedule.id}
                                className={
                                    'repo-schedule-item flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer ' +
                                    'hover:bg-[#e8e8e8] dark:hover:bg-[#333] ' +
                                    (isActive
                                        ? 'bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]'
                                        : '')
                                }
                                role="option"
                                aria-selected={isActive}
                                onClick={() => handleSelect(schedule.id)}
                            >
                                <span className="flex-shrink-0">
                                    <StatusDot status={schedule.status} isRunning={schedule.isRunning} />
                                </span>
                                <span className={
                                    'flex-1 text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate' +
                                    (isActive ? ' font-medium' : '')
                                }>
                                    {schedule.name}
                                    {schedule.targetType === 'script' && (
                                        <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4] font-medium align-middle">
                                            [Script]
                                        </span>
                                    )}
                                    {(!schedule.targetType || schedule.targetType === 'prompt') && (
                                        <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#848484] font-medium align-middle">
                                            [Prompt]
                                        </span>
                                    )}
                                    {(!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && schedule.mode !== 'autopilot' && (
                                        <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium align-middle capitalize" data-testid="list-mode-badge">{schedule.mode}</span>
                                    )}
                                </span>
                                <span className="text-[10px] text-[#848484] font-mono flex-shrink-0 hidden xl:block">
                                    {schedule.cronDescription}
                                </span>
                                {schedule.nextRun && schedule.status === 'active' && (
                                    <span className="text-[10px] text-[#848484] flex-shrink-0">
                                        {formatRelativeTime(schedule.nextRun)}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );

    const detailContent = (
        <>
            {showCreate ? (
                <div className="px-4 py-3">
                    <CreateScheduleForm
                        workspaceId={workspaceId}
                        onCreated={() => { setShowCreate(false); setDuplicateValues(null); fetchSchedules(); }}
                        onCancel={() => { setShowCreate(false); setDuplicateValues(null); }}
                        initialValues={duplicateValues ? {
                            name: `Copy of ${duplicateValues.name}`,
                            target: duplicateValues.target,
                            targetType: duplicateValues.targetType,
                            cron: duplicateValues.cron,
                            params: duplicateValues.params ? { ...duplicateValues.params } : undefined,
                            onFailure: duplicateValues.onFailure,
                            outputFolder: duplicateValues.outputFolder,
                            model: duplicateValues.model,
                            chatMode: duplicateValues.mode ?? 'autopilot',
                        } : undefined}
                    />
                </div>
            ) : selectedSchedule ? (
                <ScheduleDetail
                    schedule={selectedSchedule}
                    workspaceId={workspaceId}
                    history={history}
                    editingId={editingId}
                    onRunNow={handleRunNow}
                    onPauseResume={handlePauseResume}
                    onEdit={(id) => setEditingId(id)}
                    onDuplicate={(s) => { setDuplicateValues(s); setShowCreate(true); }}
                    onDelete={handleDelete}
                    onCancelEdit={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); fetchSchedules(); }}
                />
            ) : (
                <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                    {schedules.length === 0
                        ? 'Create your first schedule with "+ New"'
                        : 'Select a schedule to view details'}
                </div>
            )}
        </>
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="schedules-split-panel">
                {mobileShowDetail ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="schedules-detail-panel">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                            <button
                                className="text-xs text-[#0078d4] flex items-center gap-1 hover:underline"
                                onClick={() => setMobileShowDetail(false)}
                                data-testid="schedules-back-btn"
                            >
                                ← Schedules
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {detailContent}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="schedules-mobile-list">
                        {listPanel}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="schedules-split-panel">
            {/* Left panel */}
            <div
                className="flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                style={{ width: leftPanelWidth }}
                data-testid="schedules-list-panel"
            >
                {listPanel}
            </div>

            {/* Resize handle */}
            <div
                className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="schedules-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize schedules panel"
                tabIndex={0}
            />

            {/* Right panel */}
            <div className="flex-1 min-w-0 overflow-y-auto" data-testid="schedules-detail-panel">
                {detailContent}
            </div>
        </div>
    );
}

function StatusDot({ status, isRunning }: { status: string; isRunning: boolean }) {
    if (isRunning) return <span title="Running">🔵</span>;
    switch (status) {
        case 'active': return <span title="Active">🟢</span>;
        case 'paused': return <span title="Paused">⏸</span>;
        case 'stopped': return <span title="Stopped">🔴</span>;
        default: return <span>⚪</span>;
    }
}

export interface ScheduleDetailProps {
    schedule: Schedule;
    workspaceId: string;
    history: RunRecord[];
    editingId: string | null;
    onRunNow: (scheduleId: string) => void;
    onPauseResume: (schedule: Schedule) => void;
    onEdit: (scheduleId: string) => void;
    onDuplicate: (schedule: Schedule) => void;
    onDelete: (scheduleId: string) => void;
    onCancelEdit: () => void;
    onSaved: () => void;
}

/** Status badge pill for Active / Paused / Running states. */
function StatusBadge({ status, isRunning }: { status: string; isRunning: boolean }) {
    if (isRunning) {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                aria-label="Status: Running"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                Running
            </span>
        );
    }
    if (status === 'active') {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                aria-label="Status: Active"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Active
            </span>
        );
    }
    if (status === 'paused') {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
                aria-label="Status: Paused"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                Paused
            </span>
        );
    }
    return (
        <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-[#f3f3f3] dark:bg-[#333] text-[#848484]"
            aria-label={`Status: ${status}`}
            data-testid="status-badge"
        >
            {status}
        </span>
    );
}

/** Friendly label for onFailure raw values. */
function failureLabel(raw: string): string {
    switch (raw) {
        case 'continue': return 'Continue on failure';
        case 'stop': return 'Stop on failure';
        case 'notify': return 'Notify on failure';
        default: return raw;
    }
}

/** Format milliseconds as a short duration string. */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
}

const HISTORY_PAGE_SIZE = 20;

export function ScheduleDetail({ schedule, workspaceId, history: initialHistory, editingId, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, onCancelEdit, onSaved }: ScheduleDetailProps) {
    const [showOutputId, setShowOutputId] = useState<string | null>(null);
    const [history, setHistory] = useState<RunRecord[]>(initialHistory);
    const [historyPage, setHistoryPage] = useState(1);
    const [refreshing, setRefreshing] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Sync history from parent (initial load / schedule change)
    useEffect(() => {
        setHistory(initialHistory);
        setHistoryPage(1);
    }, [initialHistory, schedule.id]);

    const refreshHistory = useCallback(async () => {
        setRefreshing(true);
        try {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(schedule.id)}/history`);
            setHistory(data?.history || []);
        } catch { /* ignore */ }
        setRefreshing(false);
    }, [workspaceId, schedule.id]);

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

    const targetBasename = schedule.target.split(/[/\\]/).pop() ?? schedule.target;
    const paramEntries = Object.entries(schedule.params ?? {});
    const visibleHistory = history.slice(0, historyPage * HISTORY_PAGE_SIZE);
    const hasMore = history.length > visibleHistory.length;

    return (
        <div className="flex flex-col gap-0" data-testid="schedule-detail">
            {editingId === schedule.id ? (
                <CreateScheduleForm
                    workspaceId={workspaceId}
                    mode="edit"
                    scheduleId={schedule.id}
                    initialValues={{
                        name: schedule.name,
                        target: schedule.target,
                        targetType: schedule.targetType,
                        cron: schedule.cron,
                        params: { ...schedule.params },
                        onFailure: schedule.onFailure,
                        outputFolder: schedule.outputFolder,
                        model: schedule.model,
                        chatMode: schedule.mode ?? 'autopilot',
                    }}
                    onCreated={onSaved}
                    onCancel={onCancelEdit}
                />
            ) : (
                <>
                    {/* ── Header zone ─────────────────────────────────────── */}
                    <div className="px-3 pt-3 pb-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <div className="flex items-start gap-2 mb-1">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate" data-testid="schedule-name">
                                        {`${schedule.targetType === 'script' ? '⚡' : '📄'} ${schedule.name}`}
                                    </h2>
                                    {schedule.isRunning && (
                                        <span className="w-3 h-3 border-2 border-[#0078d4] border-t-transparent rounded-full animate-spin flex-shrink-0" aria-label="Running" data-testid="running-spinner" />
                                    )}
                                    <StatusBadge status={schedule.status} isRunning={schedule.isRunning} />
                                    {(!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && schedule.mode !== 'autopilot' && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium capitalize" data-testid="mode-badge">{schedule.mode}</span>
                                    )}
                                </div>
                                <div className="text-[10px] text-[#848484] mt-0.5" data-testid="schedule-next-run">
                                    {schedule.isRunning
                                        ? 'Running now…'
                                        : schedule.status === 'active' && schedule.nextRun
                                            ? `Next run: ${formatRelativeTime(schedule.nextRun)}`
                                            : schedule.status === 'paused'
                                                ? 'Paused'
                                                : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Action toolbar ──────────────────────────────────── */}
                    <div className="px-3 py-2 flex items-center gap-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-wrap">
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={schedule.isRunning}
                            onClick={() => onRunNow(schedule.id)}
                            aria-label="Run schedule now"
                        >
                            ▶ Run Now
                        </Button>
                        <div className="w-px h-4 bg-[#d0d0d0] dark:bg-[#555] mx-0.5 flex-shrink-0" />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onPauseResume(schedule)}
                            aria-label={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                        >
                            {schedule.status === 'active' ? '⏸ Pause' : '▶ Resume'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={schedule.isRunning}
                            onClick={() => onEdit(schedule.id)}
                            aria-label="Edit schedule"
                            data-testid="edit-btn"
                        >
                            ✏ Edit
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onDuplicate(schedule)}
                            aria-label="Duplicate schedule"
                            data-testid="duplicate-btn"
                        >
                            ⧉ Duplicate
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onDelete(schedule.id)}
                            aria-label="Delete schedule"
                        >
                            🗑 Delete
                        </Button>
                    </div>

                    {/* ── Info section ────────────────────────────────────── */}
                    <div className="px-3 py-2.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="schedule-info">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                            {/* Target */}
                            <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Target</dt>
                            <dd className="text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                                <span
                                    className="font-medium truncate block"
                                    title={schedule.target}
                                    data-testid="target-basename"
                                >
                                    {targetBasename}
                                </span>
                                {schedule.target !== targetBasename && (
                                    <span className="text-[10px] text-[#848484] dark:text-[#666] font-mono truncate block" title={schedule.target}>
                                        {schedule.target}
                                    </span>
                                )}
                            </dd>

                            {/* Schedule */}
                            <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Schedule</dt>
                            <dd className="text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                                {schedule.cronDescription && (
                                    <span className="block">{schedule.cronDescription}</span>
                                )}
                                <span className="text-[10px] font-mono text-[#848484] dark:text-[#666]">{schedule.cron}</span>
                            </dd>

                            {/* Params */}
                            <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Params</dt>
                            <dd className="min-w-0">
                                {paramEntries.length === 0 ? (
                                    <span className="text-[#848484]">None</span>
                                ) : (
                                    <div className="flex flex-wrap gap-1" data-testid="params-pills">
                                        {paramEntries.map(([k, v]) => (
                                            <span
                                                key={k}
                                                className="text-[10px] px-1.5 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4] dark:text-[#4fc3f7] font-mono"
                                                data-testid={`param-pill-${k}`}
                                            >
                                                {k}={v}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </dd>

                            {/* On Failure */}
                            <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">On Failure</dt>
                            <dd className="text-[#1e1e1e] dark:text-[#cccccc]">{failureLabel(schedule.onFailure)}</dd>

                            {/* Output Folder — only when set */}
                            {schedule.outputFolder && (
                                <>
                                    <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Output</dt>
                                    <dd className="text-[10px] font-mono text-[#1e1e1e] dark:text-[#cccccc] truncate" title={schedule.outputFolder} data-testid="output-folder">
                                        {schedule.outputFolder}
                                    </dd>
                                </>
                            )}

                            {/* Model — only when set */}
                            {schedule.model && (
                                <>
                                    <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Model</dt>
                                    <dd className="text-[#1e1e1e] dark:text-[#cccccc]" data-testid="schedule-model">{schedule.model}</dd>
                                </>
                            )}

                            {/* Created */}
                            <dt className="text-[#848484] dark:text-[#777] whitespace-nowrap font-medium">Created</dt>
                            <dd className="text-[#848484]">{formatRelativeTime(schedule.createdAt)}</dd>
                        </dl>
                    </div>

                    {/* ── Run History ─────────────────────────────────────── */}
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
                                    onClick={() => onRunNow(schedule.id)}
                                    disabled={schedule.isRunning}
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
                </>
            )}
        </div>
    );
}

interface ScheduleTemplateParam {
    key: string;
    placeholder: string;
    type?: 'text' | 'pipeline-select';
}

interface ScheduleTemplate {
    id: string;
    label: string;
    emoji: string;
    name: string;
    target: string;
    targetType?: 'prompt' | 'script';
    cronExpr: string;
    intervalValue: string;
    intervalUnit: string;
    mode: 'cron' | 'interval';
    params: ScheduleTemplateParam[];
    hint: string;
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
    {
        id: 'run-workflow',
        label: 'Run workflow',
        emoji: '🚀',
        name: 'Run Workflow',
        target: 'pipelines/my-pipeline/pipeline.yaml',
        cronExpr: '0 9 * * *',
        intervalValue: '1',
        intervalUnit: 'days',
        mode: 'cron',
        params: [],
        hint: 'Ensure the workflow YAML file exists at the specified target path',
    },
    {
        id: 'run-script',
        label: 'Run Script',
        emoji: '🖥️',
        name: 'Script Runner',
        target: '',
        targetType: 'script',
        cronExpr: '0 * * * *',
        intervalValue: '1',
        intervalUnit: 'hours',
        mode: 'cron',
        params: [
            { key: 'workingDirectory', placeholder: '.' },
        ],
        hint: 'Enter a shell command or path to a script to execute on the schedule.',
    },
    {
        id: 'auto-commit',
        label: 'Auto-commit directory',
        emoji: '💾',
        name: 'Auto-commit',
        target: '.vscode/schedules/auto-commit.md',
        cronExpr: '0 * * * *',
        intervalValue: '1',
        intervalUnit: 'hours',
        mode: 'interval',
        params: [
            { key: 'directory', placeholder: './src' },
            { key: 'message', placeholder: 'chore: auto-save' },
        ],
        hint: 'Target file must exist at .vscode/schedules/auto-commit.md',
    },
    {
        id: 'pull-sync',
        label: 'Pull & sync',
        emoji: '🔄',
        name: 'Pull & Sync',
        target: '.vscode/schedules/pull-sync.md',
        cronExpr: '*/30 * * * *',
        intervalValue: '30',
        intervalUnit: 'minutes',
        mode: 'interval',
        params: [
            { key: 'directory', placeholder: '.' },
        ],
        hint: 'Target file must exist at .vscode/schedules/pull-sync.md',
    },
    {
        id: 'clean-outputs',
        label: 'Clean old outputs',
        emoji: '🧹',
        name: 'Clean Old Outputs',
        target: '.vscode/schedules/clean-outputs.md',
        cronExpr: '0 0 * * 0',
        intervalValue: '7',
        intervalUnit: 'days',
        mode: 'cron',
        params: [
            { key: 'directory', placeholder: './dist' },
            { key: 'maxAgeDays', placeholder: '7' },
        ],
        hint: 'Target file must exist at .vscode/schedules/clean-outputs.md',
    },
];

function CreateScheduleForm({ workspaceId, onCreated, onCancel, mode: formMode = 'create', scheduleId, initialValues }: {
    workspaceId: string;
    onCreated: () => void;
    onCancel: () => void;
    mode?: 'create' | 'edit';
    scheduleId?: string;
    initialValues?: {
        name?: string;
        target?: string;
        targetType?: 'prompt' | 'script';
        cron?: string;
        params?: Record<string, string>;
        onFailure?: string;
        outputFolder?: string;
        model?: string;
        chatMode?: 'ask' | 'plan' | 'autopilot';
    };
}) {
    const cronParsed = initialValues?.cron ? parseCronToInterval(initialValues.cron) : null;
    const [name, setName] = useState(initialValues?.name ?? '');
    const [target, setTarget] = useState(initialValues?.target ?? '');
    const [targetType, setTargetType] = useState<'prompt' | 'script'>(initialValues?.targetType ?? 'prompt');
    const [mode, setMode] = useState<'cron' | 'interval'>(cronParsed?.mode === 'interval' ? 'interval' : (initialValues?.cron ? 'cron' : 'interval'));
    const [cron, setCron] = useState(initialValues?.cron ?? '0 9 * * *');
    const [intervalValue, setIntervalValue] = useState(cronParsed?.mode === 'interval' ? cronParsed.value : '1');
    const [intervalUnit, setIntervalUnit] = useState(cronParsed?.mode === 'interval' ? cronParsed.unit : 'hours');
    const [onFailure, setOnFailure] = useState(initialValues?.onFailure ?? 'notify');
    const [outputFolder, setOutputFolder] = useState(initialValues?.outputFolder ?? `~/.coc/repos/${workspaceId}/tasks`);
    const [model, setModel] = useState(initialValues?.model ?? '');
    const [chatMode, setChatMode] = useState<'ask' | 'plan' | 'autopilot'>(initialValues?.chatMode ?? 'autopilot');
    const [models, setModels] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [params, setParams] = useState<Record<string, string>>(initialValues?.params ? { ...initialValues.params } : {});
    const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
    const [pipelinesLoading, setPipelinesLoading] = useState(false);
    const [manualPipeline, setManualPipeline] = useState(false);

    // Fetch pipelines when run-workflow template is selected
    useEffect(() => {
        if (selectedTemplate !== 'run-workflow') {
            setPipelines([]);
            setPipelinesLoading(false);
            setManualPipeline(false);
            return;
        }
        let cancelled = false;
        setPipelinesLoading(true);
        fetchWorkflows(workspaceId)
            .then(list => { if (!cancelled) setPipelines(list); })
            .catch(() => { if (!cancelled) setPipelines([]); })
            .finally(() => { if (!cancelled) setPipelinesLoading(false); });
        return () => { cancelled = true; };
    }, [selectedTemplate, workspaceId]);

    // Fetch available models once on mount
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + '/queue/models')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (!cancelled) setModels(data?.models ?? (Array.isArray(data) ? data : [])); })
            .catch(() => { /* ignore */ });
        return () => { cancelled = true; };
    }, []);

    const applyTemplate= (templateId: string) => {
        if (selectedTemplate === templateId) {
            setSelectedTemplate(null);
            setName('');
            setTarget('');
            setTargetType('prompt');
            setMode('interval');
            setCron('0 9 * * *');
            setIntervalValue('1');
            setIntervalUnit('hours');
            setParams({});
            setOutputFolder(`~/.coc/repos/${workspaceId}/tasks`);
            setChatMode('autopilot');
            setManualPipeline(false);
            return;
        }
        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;
        setSelectedTemplate(templateId);
        setManualPipeline(false);
        setName(tpl.name);
        setTarget(templateId === 'run-workflow' ? '' : tpl.target);
        setTargetType(tpl.targetType || 'prompt');
        setMode(tpl.mode);
        setCron(tpl.cronExpr);
        setIntervalValue(tpl.intervalValue);
        setIntervalUnit(tpl.intervalUnit);
        const defaults: Record<string, string> = {};
        for (const p of tpl.params) {
            defaults[p.key] = p.placeholder;
        }
        setParams(defaults);
    };

    const intervalToCron = (): string => {
        const val = parseInt(intervalValue, 10) || 1;
        switch (intervalUnit) {
            case 'minutes': return `*/${val} * * * *`;
            case 'hours': return `0 */${val} * * *`;
            case 'days': return `0 0 */${val} * *`;
            default: return `0 */${val} * * *`;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !target.trim()) {
            setError('Name and target are required');
            return;
        }
        setSubmitting(true);
        setError('');

        const cronExpr = mode === 'interval' ? intervalToCron() : cron;

        try {
            const payload = {
                name: name.trim(),
                target: target.trim(),
                targetType,
                cron: cronExpr,
                params,
                onFailure,
                outputFolder: outputFolder.trim() || undefined,
                model: model.trim() || undefined,
                mode: targetType === 'prompt' ? chatMode : undefined,
            };
            const url = formMode === 'edit' && scheduleId
                ? getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`
                : getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules`;
            const res = await fetch(url, {
                method: formMode === 'edit' ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || `Failed (${res.status})`);
                return;
            }
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${formMode === 'edit' ? 'update' : 'create'} schedule`);
        } finally {
            setSubmitting(false);
        }
    };

    const formContent = (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{formMode === 'edit' ? 'Edit Schedule' : 'New Schedule'}</div>

                {/* Template picker (create mode only) */}
                {formMode !== 'edit' && (
                <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="template-picker">
                    {SCHEDULE_TEMPLATES.map(tpl => (
                        <button
                            key={tpl.id}
                            type="button"
                            className={cn(
                                'flex-shrink-0 text-[10px] px-2 py-1 rounded border whitespace-nowrap transition-colors',
                                selectedTemplate === tpl.id
                                    ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4] ring-1 ring-[#0078d4]'
                                    : 'border-[#d0d0d0] dark:border-[#555] text-[#616161] dark:text-[#999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]'
                            )}
                            onClick={() => applyTemplate(tpl.id)}
                            data-testid={`template-${tpl.id}`}
                        >
                            {tpl.emoji} {tpl.label}
                        </button>
                    ))}
                </div>
                )}

                <input
                    className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                    placeholder="Name (e.g., Daily Report)"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />

                {/* Target type picker */}
                <div className="flex items-center gap-2" data-testid="target-type-picker">
                    <span className="text-[10px] text-[#616161] dark:text-[#999]">Type:</span>
                    <button
                        type="button"
                        className={cn('text-[10px] px-2 py-1 rounded', targetType === 'prompt' ? 'bg-[#0078d4] text-white' : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]')}
                        onClick={() => setTargetType('prompt')}
                        data-testid="target-type-prompt"
                    >Prompt</button>
                    <button
                        type="button"
                        className={cn('text-[10px] px-2 py-1 rounded', targetType === 'script' ? 'bg-[#0078d4] text-white' : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]')}
                        onClick={() => setTargetType('script')}
                        data-testid="target-type-script"
                    >Script</button>
                </div>

                {/* Target field — pipeline selector for run-workflow, plain input otherwise */}
                {selectedTemplate === 'run-workflow' && !manualPipeline ? (
                    pipelinesLoading ? (
                        <span className="text-xs px-2 py-1.5 text-[#848484] italic" data-testid="workflow-loading">Loading workflows…</span>
                    ) : pipelines.length > 0 ? (
                        <select
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={target}
                            onChange={e => {
                                if (e.target.value === '__manual__') {
                                    setManualPipeline(true);
                                    setTarget('');
                                    setParams(prev => ({ ...prev, pipeline: '' }));
                                    return;
                                }
                                setTarget(e.target.value);
                                setParams(prev => ({ ...prev, pipeline: e.target.value }));
                            }}
                            data-testid="target-workflow-select"
                        >
                            <option value="" disabled>Select a workflow…</option>
                            {pipelines.map(pl => (
                                <option key={pl.path} value={pl.path}>{pl.name}</option>
                            ))}
                            <option value="__manual__">Other (manual path)…</option>
                        </select>
                    ) : (
                        <input
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            placeholder="Target (e.g., workflows/daily-report/pipeline.yaml)"
                            value={target}
                            onChange={e => {
                                setTarget(e.target.value);
                                setParams(prev => ({ ...prev, pipeline: e.target.value }));
                            }}
                            data-testid="target-workflow-input"
                        />
                    )
                ) : selectedTemplate === 'run-workflow' && manualPipeline ? (
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder="Target (e.g., workflows/daily-report/pipeline.yaml)"
                        value={target}
                        onChange={e => {
                            setTarget(e.target.value);
                            setParams(prev => ({ ...prev, pipeline: e.target.value }));
                        }}
                        data-testid="target-workflow-input"
                    />
                ) : targetType === 'prompt' ? (
                    <textarea
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] resize-y min-h-[60px]"
                        placeholder="Prompt (e.g., Run safe-refactoring-sweep skill…)"
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        data-testid="target-input"
                        rows={3}
                    />
                ) : (
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder='Command / Script (e.g., echo "hello world")'
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        data-testid="target-input"
                    />
                )}

                {/* Working directory — only for script type */}
                {targetType === 'script' && selectedTemplate !== 'run-script' && (
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder="Working directory (optional)"
                        value={params['workingDirectory'] ?? ''}
                        onChange={e => setParams(prev => ({ ...prev, workingDirectory: e.target.value }))}
                        data-testid="working-directory-input"
                    />
                )}

                {/* Output folder — only for prompt type */}
                {(!targetType || targetType === 'prompt') && (
                    <div className="flex flex-col gap-0.5">
                        <label className="text-[10px] text-[#616161] dark:text-[#999]">
                            Output folder <span className="text-[#888]">— task output files (.md) are saved here</span>
                        </label>
                        <input
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            placeholder={`e.g., ~/.coc/repos/${workspaceId}/tasks`}
                            value={outputFolder}
                            onChange={e => setOutputFolder(e.target.value)}
                            data-testid="output-folder-input"
                        />
                    </div>
                )}

                {/* Model selector — only for prompt type */}
                {(!targetType || targetType === 'prompt') && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-[#616161] dark:text-[#999]">Model:</span>
                        <select
                            className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            data-testid="model-select"
                        >
                            <option value="">Default</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                )}

                {/* Chat mode selector — only for prompt type */}
                {(!targetType || targetType === 'prompt') && (
                    <div className="flex items-center gap-2" data-testid="chat-mode-picker">
                        <span className="text-[10px] text-[#616161] dark:text-[#999]">Mode:</span>
                        {(['ask', 'plan', 'autopilot'] as const).map(m => (
                            <button
                                key={m}
                                type="button"
                                className={cn('text-[10px] px-2 py-1 rounded capitalize', chatMode === m ? 'bg-[#0078d4] text-white' : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]')}
                                onClick={() => setChatMode(m)}
                                data-testid={`chat-mode-${m}`}
                            >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
                        ))}
                    </div>
                )}

                {/* Schedule mode toggle */}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className={cn('text-[10px] px-2 py-1 rounded', mode === 'interval' ? 'bg-[#0078d4] text-white' : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]')}
                        onClick={() => setMode('interval')}
                    >Interval</button>
                    <button
                        type="button"
                        className={cn('text-[10px] px-2 py-1 rounded', mode === 'cron' ? 'bg-[#0078d4] text-white' : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]')}
                        onClick={() => setMode('cron')}
                    >Cron</button>
                </div>

                {mode === 'interval' ? (
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[#616161] dark:text-[#999]">Run every</span>
                        <input
                            type="number"
                            min="1"
                            className="w-14 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={intervalValue}
                            onChange={e => setIntervalValue(e.target.value)}
                        />
                        <select
                            className="px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={intervalUnit}
                            onChange={e => setIntervalUnit(e.target.value)}
                        >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                        </select>
                    </div>
                ) : (
                    <div className="flex flex-col gap-1.5" data-testid="cron-hint-panel">
                        <input
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] font-mono"
                            placeholder="0 9 * * *"
                            value={cron}
                            onChange={e => setCron(e.target.value)}
                        />
                        <div className="flex items-center gap-1" data-testid="cron-field-legend">
                            {['min', 'hr', 'dom', 'mon', 'dow'].map(f => (
                                <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-[#616161] dark:text-[#999] font-mono">{f}</span>
                            ))}
                            <span className="text-[9px] text-[#848484] ml-1">minute · hour · day-of-month · month · day-of-week</span>
                        </div>
                        {cron.trim() && describeCron(cron) && (
                            <div className="text-[10px] text-[#0078d4] dark:text-[#4fc3f7]" data-testid="cron-description">
                                {describeCron(cron)}
                            </div>
                        )}
                        <div className="flex flex-wrap gap-1" data-testid="cron-examples">
                            {CRON_EXAMPLES.map(ex => (
                                <button
                                    key={ex.expr}
                                    type="button"
                                    className="text-[9px] px-1.5 py-0.5 rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#2a2a2a] text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#333] hover:text-[#1e1e1e] dark:hover:text-[#ccc] transition-colors"
                                    onClick={() => setCron(ex.expr)}
                                    title={ex.expr}
                                    data-testid={`cron-example-${ex.expr.replace(/\s+/g, '-')}`}
                                >
                                    {ex.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#616161] dark:text-[#999]">On failure:</span>
                    <select
                        className="px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        value={onFailure}
                        onChange={e => setOnFailure(e.target.value)}
                    >
                        <option value="notify">Notify</option>
                        <option value="stop">Stop</option>
                    </select>
                </div>

                {/* Dynamic params fields */}
                {selectedTemplate && (() => {
                    const tpl = SCHEDULE_TEMPLATES.find(t => t.id === selectedTemplate);
                    if (!tpl || tpl.params.length === 0) return null;
                    return (
                        <div className="flex flex-col gap-1.5" data-testid="template-params">
                            <div className="text-[10px] uppercase text-[#848484] font-medium">Parameters</div>
                            {tpl.params.map(p => (
                                <div key={p.key} className="flex items-center gap-1.5 text-xs">
                                    <span className="text-[#616161] dark:text-[#999] w-20 text-right flex-shrink-0">{p.key}:</span>
                                    {p.type === 'pipeline-select' && !manualPipeline ? (
                                        pipelinesLoading ? (
                                            <span className="flex-1 text-[#848484] italic" data-testid="workflow-loading">Loading workflows…</span>
                                        ) : pipelines.length === 0 ? (
                                            <input
                                                className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                                placeholder={p.placeholder}
                                                value={params[p.key] ?? ''}
                                                onChange={e => {
                                                    setParams(prev => ({ ...prev, [p.key]: e.target.value }));
                                                    setTarget(e.target.value);
                                                }}
                                                data-testid={`param-${p.key}`}
                                            />
                                        ) : (
                                            <select
                                                className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                                value={params[p.key] ?? ''}
                                                onChange={e => {
                                                    if (e.target.value === '__manual__') {
                                                        setManualPipeline(true);
                                                        setParams(prev => ({ ...prev, [p.key]: '' }));
                                                        setTarget('');
                                                        return;
                                                    }
                                                    setParams(prev => ({ ...prev, [p.key]: e.target.value }));
                                                    setTarget(e.target.value);
                                                }}
                                                data-testid={`param-${p.key}`}
                                            >
                                                <option value="" disabled>Select a workflow…</option>
                                                {pipelines.map(pl => (
                                                    <option key={pl.path} value={pl.path}>{pl.name}</option>
                                                ))}
                                                <option value="__manual__">Other (manual path)…</option>
                                            </select>
                                        )
                                    ) : (
                                        <input
                                            className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                            placeholder={p.placeholder}
                                            value={params[p.key] ?? ''}
                                            onChange={e => {
                                                setParams(prev => ({ ...prev, [p.key]: e.target.value }));
                                                if (p.type === 'pipeline-select') setTarget(e.target.value);
                                            }}
                                            data-testid={`param-${p.key}`}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* Template hint */}
                {selectedTemplate && (() => {
                    const tpl = SCHEDULE_TEMPLATES.find(t => t.id === selectedTemplate);
                    if (!tpl) return null;
                    return (
                        <div className="text-[10px] italic text-[#848484]" data-testid="template-hint">
                            {tpl.hint}
                        </div>
                    );
                })()}

                {/* Generic params editor (edit/duplicate mode — no template selected) */}
                {!selectedTemplate && Object.keys(params).length > 0 && (
                    <div className="flex flex-col gap-1.5" data-testid="edit-params">
                        <div className="text-[10px] uppercase text-[#848484] font-medium">Parameters</div>
                        {Object.entries(params).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-1.5 text-xs">
                                <span className="text-[#616161] dark:text-[#999] w-20 text-right flex-shrink-0">{key}:</span>
                                <input
                                    className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                    value={value}
                                    onChange={e => setParams(prev => ({ ...prev, [key]: e.target.value }))}
                                    data-testid={`param-${key}`}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {error && <div className="text-[10px] text-red-500">{error}</div>}

                <div className="flex justify-end gap-1.5">
                    <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
                    <Button variant="primary" size="sm" type="submit" disabled={submitting}>
                        {submitting ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save' : 'Create')}
                    </Button>
                </div>
            </form>
        );

    return formContent;
}

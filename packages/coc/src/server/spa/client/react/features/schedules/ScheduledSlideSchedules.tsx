/**
 * ScheduledSlideSchedules — the schedule-definitions section shown at the top of
 * the chat-list "Scheduled" slide (Activity scope `loops`).
 *
 * Renders one row per schedule definition (status dot, name, type / source /
 * mode pills, cadence, next-run) with a "+ New schedule" header button. The
 * existing scheduled run instances continue to render below this section as the
 * "Recent runs" (Running / Queued / History) lists owned by ChatListPane.
 *
 * Self-gates on the `schedulesInScheduledSlide` feature flag: when the flag is
 * OFF the component renders nothing (and never fetches), so the slide stays
 * runs-only — today's behavior. Clicking "+ New schedule" or a row navigates the
 * main pane via the `#repos/{ws}/schedules/...` hash (the main-pane mount lands
 * in a later slice); the sidebar stays on the Scheduled slide.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCocClient } from '../../repos/cloneRouting';
import { useApp } from '../../contexts/AppContext';
import { useSchedulesInScheduledSlideEnabled } from '../../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import { Button } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import { normalizePromptScheduleMode } from './scheduleTypes';
import type { Schedule } from './scheduleTypes';

interface ScheduledSlideSchedulesProps {
    workspaceId: string;
}

type DotColor = 'active' | 'paused' | 'failed' | 'running';

function dotClass(status: string, isRunning: boolean): DotColor {
    if (isRunning) return 'running';
    if (status === 'failed' || status === 'stopped') return 'failed';
    if (status === 'paused') return 'paused';
    return 'active';
}

const DOT_BG: Record<DotColor, string> = {
    active: 'bg-[#1a7f37] dark:bg-[#3fb950]',
    paused: 'bg-[#6e7781] dark:bg-[#8b949e]',
    failed: 'bg-[#cf222e] dark:bg-[#f85149]',
    running: 'bg-[#0969da] dark:bg-[#58a6ff] animate-pulse',
};

function nextRunLabel(schedule: Schedule): string {
    if (schedule.isRunning) return 'running';
    if (schedule.status === 'paused') return 'paused';
    if (schedule.status === 'failed' || schedule.status === 'stopped') return 'failed';
    if (schedule.status === 'active' && schedule.nextRun) return formatRelativeTime(schedule.nextRun);
    return '';
}

function ScheduledSlideRow({
    schedule,
    isActive,
    onSelect,
}: {
    schedule: Schedule;
    isActive: boolean;
    onSelect: (id: string) => void;
}) {
    const nextLabel = nextRunLabel(schedule);
    const isRepo = schedule.source === 'repo';
    const isScript = schedule.targetType === 'script';
    const promptMode = normalizePromptScheduleMode(schedule.mode, 'autopilot');
    const showModePill = !isScript && (!schedule.targetType || schedule.targetType === 'prompt') && !!schedule.mode;
    return (
        <li
            className={
                'scheduled-slide-schedule-row grid items-center cursor-pointer rounded-md mx-1 px-2 py-1.5 ' +
                'transition-colors hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] ' +
                (isActive
                    ? 'bg-[#ddf4ff] dark:bg-[#1a3a5c] shadow-[inset_0_0_0_1px_#b6e3ff] dark:shadow-[inset_0_0_0_1px_#316dca]'
                    : '')
            }
            style={{
                gridTemplateColumns: '10px minmax(0,1fr) auto',
                gridTemplateRows: 'auto auto',
                gridTemplateAreas: '"dot name time" "dot meta meta"',
                columnGap: '8px',
                rowGap: '1px',
            }}
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(schedule.id)}
            data-testid="scheduled-slide-schedule-row"
            data-schedule-id={schedule.id}
        >
            <span className="mt-[2px]" style={{ gridArea: 'dot' }}>
                <span
                    className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${DOT_BG[dotClass(schedule.status, schedule.isRunning)]}`}
                    aria-label={schedule.isRunning ? 'Running' : schedule.status}
                    title={schedule.isRunning ? 'Running' : schedule.status}
                />
            </span>
            <span
                className="flex items-center gap-1.5 min-w-0 text-xs font-medium text-[#1f2328] dark:text-[#cccccc]"
                style={{ gridArea: 'name' }}
            >
                <span className="truncate">{schedule.name}</span>
                {isRepo ? (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#ddf4ff] dark:bg-[#1a3a5c] text-[#0969da] dark:text-[#4fc3f7] border border-[#b6e3ff] dark:border-[#316dca]"
                        data-testid="scheduled-slide-source-repo"
                    >
                        Repo
                    </span>
                ) : (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#848484] border border-[#d8dee4] dark:border-[#3c3c3c]"
                        data-testid="scheduled-slide-source-my"
                    >
                        My
                    </span>
                )}
                {isScript && (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#fff8c5] dark:bg-amber-900/40 text-[#9a6700] dark:text-amber-300 border border-[#d4a72c] dark:border-amber-700/60"
                        data-testid="scheduled-slide-type-script"
                    >
                        Script
                    </span>
                )}
                {showModePill && (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#fbf0ff] dark:bg-purple-900/40 text-[#8250df] dark:text-purple-300 border border-[#e5cffd] dark:border-purple-700/60 capitalize"
                        data-testid="scheduled-slide-mode"
                    >
                        {promptMode === 'autopilot' ? 'Autopilot' : 'Ask'}
                    </span>
                )}
            </span>
            <span
                className="text-[10px] text-[#656d76] dark:text-[#848484] whitespace-nowrap flex-shrink-0 tabular-nums"
                style={{ gridArea: 'time' }}
            >
                {nextLabel}
            </span>
            <span
                className="text-[10px] text-[#656d76] dark:text-[#848484] truncate"
                style={{ gridArea: 'meta' }}
                title={schedule.cronDescription}
            >
                {schedule.cronDescription}
            </span>
        </li>
    );
}

export function ScheduledSlideSchedules({ workspaceId }: ScheduledSlideSchedulesProps) {
    const enabled = useSchedulesInScheduledSlideEnabled();
    const { state, dispatch } = useApp();
    const client = useCocClient(workspaceId);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchSchedules = useCallback(async () => {
        try {
            const next = await client.schedules.list(workspaceId);
            setSchedules(next);
            setError(false);
        } catch {
            setError(true);
        }
        setLoading(false);
    }, [workspaceId, client]);

    // Load on mount / workspace change. Skip entirely when the flag is off so the
    // disabled slide never hits the schedules endpoint.
    useEffect(() => {
        if (!enabled) return;
        setLoading(true);
        fetchSchedules();
    }, [enabled, workspaceId, fetchSchedules]);

    // Live-refresh the definitions list on schedule mutations (create/edit/run).
    useEffect(() => {
        if (!enabled) return;
        const handler = () => fetchSchedules();
        window.addEventListener('schedule-changed', handler);
        return () => window.removeEventListener('schedule-changed', handler);
    }, [enabled, fetchSchedules]);

    const openNew = useCallback(() => {
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/new';
    }, [workspaceId]);

    const openSchedule = useCallback((scheduleId: string) => {
        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: scheduleId });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/' + encodeURIComponent(scheduleId);
    }, [workspaceId, dispatch]);

    const sorted = useMemo(() => {
        // My schedules first, then repo; stable within each by name for a calm list.
        return [...schedules].sort((a, b) => {
            const sa = a.source === 'repo' ? 1 : 0;
            const sb = b.source === 'repo' ? 1 : 0;
            if (sa !== sb) return sa - sb;
            return a.name.localeCompare(b.name);
        });
    }, [schedules]);

    if (!enabled) return null;

    return (
        <div
            className="border-b border-[#eaeef2] dark:border-[#3c3c3c] pb-1"
            data-testid="scheduled-slide-schedules"
        >
            {/* Header: title + count + "+ New schedule" */}
            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                <span className="inline-flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#656d76] dark:text-[#848484]">
                    Schedules
                    {!loading && !error && (
                        <span className="tabular-nums" data-testid="scheduled-slide-schedules-count">
                            {sorted.length}
                        </span>
                    )}
                </span>
                <span className="flex-1" />
                <Button
                    variant="primary"
                    size="sm"
                    onClick={openNew}
                    data-testid="scheduled-slide-new-schedule-btn"
                >
                    + New schedule
                </Button>
            </div>

            {loading ? (
                <div
                    className="px-3 py-3 text-center text-xs text-[#656d76] dark:text-[#848484]"
                    data-testid="scheduled-slide-schedules-loading"
                >
                    Loading schedules…
                </div>
            ) : error ? (
                <div
                    className="mx-3 my-1 px-3 py-2.5 text-center text-xs text-[#656d76] dark:text-[#848484] rounded-md"
                    data-testid="scheduled-slide-schedules-error"
                >
                    Couldn't load schedules —{' '}
                    <button
                        type="button"
                        className="text-[#0969da] dark:text-[#4fc3f7] hover:underline"
                        onClick={() => { setLoading(true); setError(false); fetchSchedules(); }}
                        data-testid="scheduled-slide-schedules-retry"
                    >
                        retry
                    </button>
                </div>
            ) : sorted.length === 0 ? (
                <div
                    className="mx-3 my-1 px-3 py-3 text-center text-xs text-[#656d76] dark:text-[#848484] rounded-md"
                    data-testid="scheduled-slide-schedules-empty"
                >
                    No schedules yet.
                </div>
            ) : (
                <ul
                    className="flex flex-col gap-0.5 py-0.5"
                    role="listbox"
                    aria-label="Schedules"
                    data-testid="scheduled-slide-schedules-list"
                >
                    {sorted.map(schedule => (
                        <ScheduledSlideRow
                            key={schedule.id}
                            schedule={schedule}
                            isActive={schedule.id === state.selectedScheduleId}
                            onSelect={openSchedule}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

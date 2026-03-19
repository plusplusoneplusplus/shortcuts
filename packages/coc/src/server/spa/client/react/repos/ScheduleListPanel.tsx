import { useState } from 'react';
import { Button } from '../shared';
import { formatRelativeTime } from '../utils/format';
import { StatusDot } from './ScheduleStatusBadge';
import type { Schedule } from './scheduleTypes';

interface ScheduleListPanelProps {
    schedules: Schedule[];
    selectedId: string | null;
    onSelect: (scheduleId: string) => void;
    onNew: () => void;
    loading: boolean;
}

function ScheduleItem({ schedule, isActive, onSelect }: { schedule: Schedule; isActive: boolean; onSelect: (id: string) => void }) {
    return (
        <li
            className={
                'repo-schedule-item flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer ' +
                'hover:bg-[#e8e8e8] dark:hover:bg-[#333] ' +
                (isActive
                    ? 'bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]'
                    : '')
            }
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(schedule.id)}
        >
            <span className="flex-shrink-0">
                <StatusDot status={schedule.status} isRunning={schedule.isRunning} />
            </span>
            <span className={
                'flex-1 text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate' +
                (isActive ? ' font-medium' : '')
            }>
                {schedule.name}
                {schedule.source === 'repo' ? (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium align-middle">
                        [Repo]
                    </span>
                ) : schedule.targetType === 'script' ? (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4] font-medium align-middle">
                        [Script]
                    </span>
                ) : (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#848484] font-medium align-middle">
                        [Prompt]
                    </span>
                )}
                {schedule.source !== 'repo' && (!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && schedule.mode !== 'autopilot' && (
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
}

export function ScheduleListPanel({ schedules, selectedId, onSelect, onNew, loading: _loading }: ScheduleListPanelProps) {
    const [userCollapsed, setUserCollapsed] = useState(false);
    const [repoCollapsed, setRepoCollapsed] = useState(false);

    const userSchedules = schedules.filter(s => s.source !== 'repo');
    const repoSchedules = schedules.filter(s => s.source === 'repo');

    return (
        <>
            {/* ── MY SCHEDULES section ─────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    onClick={() => setUserCollapsed(v => !v)}
                    aria-expanded={!userCollapsed}
                    data-testid="my-schedules-header"
                >
                    <span>{userCollapsed ? '▶' : '▼'}</span>
                    MY SCHEDULES{userSchedules.length > 0 ? ` (${userSchedules.length})` : ''}
                </button>
                <Button variant="primary" size="sm" onClick={onNew} data-testid="new-schedule-btn">
                    + New
                </Button>
            </div>

            {!userCollapsed && (
                <>
                    {userSchedules.length === 0 ? (
                        <div className="px-4 pb-2 text-center text-sm text-[#848484]">
                            <div className="text-2xl mb-1">🕐</div>
                            <div className="text-xs">No schedules yet. Click &quot;+ New&quot; to create one.</div>
                        </div>
                    ) : (
                        <ul className="repo-schedule-list px-2 pb-1 flex flex-col gap-0.5 overflow-y-auto" data-testid="user-schedules-list">
                            {userSchedules.map(schedule => (
                                <ScheduleItem
                                    key={schedule.id}
                                    schedule={schedule}
                                    isActive={schedule.id === selectedId}
                                    onSelect={onSelect}
                                />
                            ))}
                        </ul>
                    )}
                </>
            )}

            {/* ── REPO SCHEDULES section ──────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-2 pb-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    onClick={() => setRepoCollapsed(v => !v)}
                    aria-expanded={!repoCollapsed}
                    data-testid="repo-schedules-header"
                >
                    <span>{repoCollapsed ? '▶' : '▼'}</span>
                    REPO SCHEDULES{repoSchedules.length > 0 ? ` (${repoSchedules.length})` : ''}
                </button>
            </div>

            {!repoCollapsed && (
                <>
                    <div className="px-4 pb-1 text-[10px] text-[#848484] font-mono" data-testid="repo-schedules-path">
                        .github/schedule/
                    </div>
                    {repoSchedules.length === 0 ? (
                        <div className="px-4 pb-3 text-xs text-[#848484]">
                            No repo schedules found.
                        </div>
                    ) : (
                        <ul className="repo-schedule-list px-2 pb-4 flex flex-col gap-0.5 overflow-y-auto" data-testid="repo-schedules-list">
                            {repoSchedules.map(schedule => (
                                <ScheduleItem
                                    key={schedule.id}
                                    schedule={schedule}
                                    isActive={schedule.id === selectedId}
                                    onSelect={onSelect}
                                />
                            ))}
                        </ul>
                    )}
                </>
            )}
        </>
    );
}

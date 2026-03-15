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

export function ScheduleListPanel({ schedules, selectedId, onSelect, onNew, loading: _loading }: ScheduleListPanelProps) {
    return (
        <>
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[11px] uppercase text-[#848484] font-medium">
                    SCHEDULES{schedules.length > 0 ? ` (${schedules.length})` : ''}
                </span>
                <Button variant="primary" size="sm" onClick={onNew}>
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
}

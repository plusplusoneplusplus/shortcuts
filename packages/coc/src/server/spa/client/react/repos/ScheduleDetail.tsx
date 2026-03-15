import { Button } from '../shared';
import { formatRelativeTime } from '../utils/format';
import { StatusBadge, failureLabel } from './ScheduleStatusBadge';
import { RunHistoryList } from './RunHistoryList';
import type { Schedule, RunRecord } from './scheduleTypes';
import { CreateScheduleForm } from './CreateScheduleForm';

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

export function ScheduleDetail({ schedule, workspaceId, history, editingId, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, onCancelEdit, onSaved }: ScheduleDetailProps) {
    const targetBasename = schedule.target.split(/[/\\]/).pop() ?? schedule.target;
    const paramEntries = Object.entries(schedule.params ?? {});

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
                    <RunHistoryList
                        runs={history}
                        scheduleId={schedule.id}
                        wsId={workspaceId}
                        onRunNow={onRunNow}
                        isRunning={schedule.isRunning}
                    />
                </>
            )}
        </div>
    );
}

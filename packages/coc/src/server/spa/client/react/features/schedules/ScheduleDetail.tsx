import { Button } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import { StatusBadge, failureLabel } from './ScheduleStatusBadge';
import { RunHistoryList } from '../chat/RunHistoryList';
import type { Schedule, RunRecord } from './scheduleTypes';
import { CreateScheduleForm } from './CreateScheduleForm';
import { PromptScheduleForm } from './PromptScheduleForm';
import { useState, useCallback, useMemo } from 'react';

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

function computeSuccessRate(history: RunRecord[]): number | null {
    if (!history.length) return null;
    const completed = history.filter(r => r.status !== 'running');
    if (!completed.length) return null;
    const ok = completed.filter(r => r.status === 'completed' || r.status === 'success').length;
    return Math.round((ok / completed.length) * 100);
}

export function ScheduleDetail({ schedule, workspaceId, history, editingId, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, onCancelEdit, onSaved }: ScheduleDetailProps) {
    const targetBasename = schedule.target.split(/[/\\]/).pop() ?? schedule.target;
    const paramEntries = Object.entries(schedule.params ?? {});
    const [showCommitReminder, setShowCommitReminder] = useState(false);

    const handleSaved = useCallback(() => {
        if (schedule.source === 'repo') {
            setShowCommitReminder(true);
        }
        onSaved();
    }, [schedule.source, onSaved]);

    const lastRun = useMemo(() => history.find(r => r.status !== 'running'), [history]);
    const successRate = useMemo(() => computeSuccessRate(history), [history]);
    const crumbParent = schedule.source === 'repo' ? 'Repo schedules' : 'My schedules';

    return (
        <div className="flex flex-col gap-0" data-testid="schedule-detail">
            {editingId === schedule.id ? (
                (!schedule.targetType || schedule.targetType === 'prompt') && !Object.keys(schedule.params ?? {}).some(k => k === 'pipeline') ? (
                    <PromptScheduleForm
                        workspaceId={workspaceId}
                        mode="edit"
                        scheduleId={schedule.id}
                        initialValues={{
                            name: schedule.name,
                            target: schedule.target,
                            cron: schedule.cron,
                            model: schedule.model,
                            chatMode: schedule.mode ?? 'ask',
                            outputFolder: schedule.outputFolder,
                            onFailure: schedule.onFailure,
                        }}
                        onCreated={handleSaved}
                        onCancel={onCancelEdit}
                    />
                ) : (
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
                        onCreated={handleSaved}
                        onCancel={onCancelEdit}
                    />
                )
            ) : (
                <>
                    {/* ── Header zone ─────────────────────────────────────── */}
                    <div className="px-5 pt-4 pb-3 bg-white dark:bg-[#1e1e1e] border-b border-[#eaeef2] dark:border-[#3c3c3c]">
                        <div className="text-[11px] text-[#656d76] dark:text-[#848484] mb-1.5 flex items-center gap-1 flex-wrap">
                            <span>{crumbParent}</span>
                            <span className="text-[#afb8c1] dark:text-[#555]" aria-hidden>/</span>
                            <span className="font-mono">{targetBasename}</span>
                        </div>
                        <h2
                            className="m-0 text-lg font-semibold text-[#1f2328] dark:text-[#cccccc] leading-tight flex items-center gap-2 flex-wrap"
                            data-testid="schedule-name"
                        >
                            <span className="text-[#656d76] dark:text-[#848484]" aria-hidden>
                                {schedule.targetType === 'script' ? '🛠️' : '📄'}
                            </span>
                            <span>{schedule.name}</span>
                            {schedule.isRunning && (
                                <span
                                    className="w-3 h-3 border-2 border-[#0969da] border-t-transparent rounded-full animate-spin flex-shrink-0"
                                    aria-label="Running"
                                    data-testid="running-spinner"
                                />
                            )}
                            <StatusBadge status={schedule.status} isRunning={schedule.isRunning} />
                            {(!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && schedule.mode !== 'autopilot' && (
                                <span
                                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-[#8250df] dark:text-purple-300 font-medium capitalize"
                                    data-testid="mode-badge"
                                >
                                    {schedule.mode}
                                </span>
                            )}
                            {schedule.source === 'repo' && (
                                <span
                                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium"
                                    data-testid="repo-source-badge"
                                >
                                    Defined in <code className="font-mono">.github/schedules/</code>
                                </span>
                            )}
                        </h2>
                        <div className="mt-2.5 flex items-center gap-x-5 gap-y-1 flex-wrap text-xs">
                            <span data-testid="schedule-next-run">
                                {schedule.isRunning
                                    ? 'Running now…'
                                    : schedule.status === 'active' && schedule.nextRun
                                        ? (<><span className="text-[#656d76] dark:text-[#848484]">Next run:</span>{' '}<b className="text-[#1f2328] dark:text-[#cccccc] font-semibold">{formatRelativeTime(schedule.nextRun)}</b></>)
                                        : schedule.status === 'paused'
                                            ? 'Paused'
                                            : ''}
                            </span>
                            <span>
                                <span className="text-[#656d76] dark:text-[#848484]">Cadence</span>{' '}
                                <b className="text-[#1f2328] dark:text-[#cccccc] font-semibold">{schedule.cronDescription}</b>
                            </span>
                            <span>
                                <span className="text-[#656d76] dark:text-[#848484]">Last run</span>{' '}
                                <b className="text-[#1f2328] dark:text-[#cccccc] font-semibold">{lastRun ? formatRelativeTime(lastRun.startedAt) : '—'}</b>
                            </span>
                            <span>
                                <span className="text-[#656d76] dark:text-[#848484]">Success 30d</span>{' '}
                                <b className="text-[#1f2328] dark:text-[#cccccc] font-semibold">{successRate == null ? '—' : `${successRate}%`}</b>
                            </span>
                        </div>
                    </div>

                    {/* ── Action toolbar ──────────────────────────────────── */}
                    <div className="px-5 py-2.5 flex items-center gap-2 flex-wrap bg-white dark:bg-[#1e1e1e] border-b border-[#eaeef2] dark:border-[#3c3c3c]">
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={schedule.isRunning}
                            onClick={() => onRunNow(schedule.id)}
                            aria-label="Run schedule now"
                        >
                            ▶ Run Now
                        </Button>
                        <span className="flex-1" />
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
                        <span className="flex-1" />
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onDelete(schedule.id)}
                            aria-label="Delete schedule"
                        >
                            🗑 Delete
                        </Button>
                    </div>

                    {/* ── Commit reminder for repo schedule edits ──────────── */}
                    {showCommitReminder && (
                        <div
                            className="mx-5 mt-3 px-3 py-2 rounded text-xs bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 flex items-start gap-2"
                            data-testid="commit-reminder"
                        >
                            <span className="flex-1">
                                Schedule updated. Changes saved to <code className="font-mono">.github/schedules/</code> — commit to share with your team.
                            </span>
                            <button
                                className="text-teal-500 hover:text-teal-700 dark:hover:text-teal-200 font-bold leading-none flex-shrink-0"
                                onClick={() => setShowCommitReminder(false)}
                                aria-label="Dismiss reminder"
                            >
                                ×
                            </button>
                        </div>
                    )}

                    {/* ── Body cards ─────────────────────────────────────── */}
                    <div className="px-5 py-5 flex flex-col gap-4 bg-[#f6f8fa] dark:bg-[#181818]">
                        {/* Configuration card */}
                        <section className="bg-white dark:bg-[#1e1e1e] border border-[#d0d7de] dark:border-[#3c3c3c] rounded-md overflow-hidden">
                            <header className="px-4 py-2.5 text-xs font-semibold text-[#1f2328] dark:text-[#cccccc] bg-[#f6f8fa] dark:bg-[#252526] border-b border-[#d0d7de] dark:border-[#3c3c3c]">
                                Configuration
                            </header>
                            <div className="px-4 py-3" data-testid="schedule-info">
                                <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-xs items-baseline">
                                    {/* Target */}
                                    <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Target</dt>
                                    <dd className="text-[#1f2328] dark:text-[#cccccc] min-w-0 m-0">
                                        <span
                                            className="font-medium block"
                                            title={schedule.target}
                                            data-testid="target-basename"
                                        >
                                            {targetBasename}
                                        </span>
                                        {schedule.target !== targetBasename && (
                                            <span className="text-[10px] text-[#656d76] dark:text-[#666] font-mono break-all block" title={schedule.target}>
                                                {schedule.target}
                                            </span>
                                        )}
                                    </dd>

                                    {/* Schedule */}
                                    <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Schedule</dt>
                                    <dd className="text-[#1f2328] dark:text-[#cccccc] min-w-0 m-0">
                                        {schedule.cronDescription && (
                                            <span className="block">{schedule.cronDescription}</span>
                                        )}
                                        <code className="text-[10px] font-mono text-[#1f2328] dark:text-[#cccccc] bg-[#eaeef2] dark:bg-[#252526] px-1.5 py-0.5 rounded inline-block mt-0.5">
                                            {schedule.cron}
                                        </code>
                                    </dd>

                                    {/* Params */}
                                    <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Params</dt>
                                    <dd className="min-w-0 m-0">
                                        {paramEntries.length === 0 ? (
                                            <span className="text-[#656d76] dark:text-[#848484]">None</span>
                                        ) : (
                                            <div className="flex flex-wrap gap-1" data-testid="params-pills">
                                                {paramEntries.map(([k, v]) => (
                                                    <span
                                                        key={k}
                                                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eaeef2] dark:bg-[#1a3a5c] text-[#1f2328] dark:text-[#4fc3f7] font-mono"
                                                        data-testid={`param-pill-${k}`}
                                                    >
                                                        {k}={v}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </dd>

                                    {/* On Failure */}
                                    <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">On Failure</dt>
                                    <dd className="text-[#1f2328] dark:text-[#cccccc] m-0">{failureLabel(schedule.onFailure)}</dd>

                                    {/* Output Folder — only when set */}
                                    {schedule.outputFolder && (
                                        <>
                                            <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Output</dt>
                                            <dd className="text-[10px] font-mono text-[#1f2328] dark:text-[#cccccc] break-all m-0" title={schedule.outputFolder} data-testid="output-folder">
                                                {schedule.outputFolder}
                                            </dd>
                                        </>
                                    )}

                                    {/* Model — only when set */}
                                    {schedule.model && (
                                        <>
                                            <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Model</dt>
                                            <dd className="text-[#1f2328] dark:text-[#cccccc] m-0" data-testid="schedule-model">{schedule.model}</dd>
                                        </>
                                    )}

                                    {/* Created */}
                                    <dt className="text-[#656d76] dark:text-[#777] whitespace-nowrap font-medium">Created</dt>
                                    <dd className="text-[#656d76] dark:text-[#848484] m-0">{formatRelativeTime(schedule.createdAt)}</dd>
                                </dl>
                            </div>
                        </section>

                        {/* Run History card */}
                        <section className="bg-white dark:bg-[#1e1e1e] border border-[#d0d7de] dark:border-[#3c3c3c] rounded-md overflow-hidden">
                            <RunHistoryList
                                runs={history}
                                scheduleId={schedule.id}
                                wsId={workspaceId}
                                onRunNow={onRunNow}
                                isRunning={schedule.isRunning}
                            />
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}

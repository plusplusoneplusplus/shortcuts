import { Button } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import { StatusBadge, failureLabel } from './ScheduleStatusBadge';
import { RunHistoryList } from '../chat/RunHistoryList';
import type { Schedule, RunRecord } from './scheduleTypes';
import { normalizePromptScheduleMode } from './scheduleTypes';
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
    /**
     * Whether to render the "Duplicate" action. Defaults to `true` (Repo ▸
     * Schedules tab). The Scheduled-slide main pane passes `false` — duplicate
     * is intentionally out of scope for that surface (this pass).
     */
    showDuplicate?: boolean;
}

function computeSuccessRate(history: RunRecord[]): number | null {
    if (!history.length) return null;
    const completed = history.filter(r => r.status !== 'running');
    if (!completed.length) return null;
    const ok = completed.filter(r => r.status === 'completed' || r.status === 'success').length;
    return Math.round((ok / completed.length) * 100);
}

// Inline GitHub Primer-style icons used in the schedule detail header.
const PromptIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z" />
    </svg>
);

const ScriptIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm7.47 3.97a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L10.69 9 9.22 7.53a.75.75 0 0 1 0-1.06ZM6.78 6.47 8.25 8 6.78 9.47A.749.749 0 0 1 5.503 8.94a.749.749 0 0 1 .215-.734L6.94 7 5.72 5.78a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Z" />
    </svg>
);

const RepoIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
);

const PlayIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="m4 2 10 6-10 6V2Z" />
    </svg>
);

const PauseIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M3 2h3v12H3Zm7 0h3v12h-3Z" />
    </svg>
);

const EditIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758ZM4.176 13.085l-1.115.318.318-1.115Z" />
    </svg>
);

const CopyIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
        <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
);

const TrashIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.749 1.749 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
    </svg>
);

interface TypeLabelInfo {
    text: 'Notes' | 'Repo' | 'Script' | 'Prompt';
    pillClass: string;
    testId: string;
}

function typeLabel(schedule: Schedule): TypeLabelInfo {
    if (schedule.name === 'Notes Auto-Commit') {
        return {
            text: 'Notes',
            pillClass: 'bg-[#ffeff7] dark:bg-pink-900/40 text-[#bf3989] dark:text-pink-300 border-[#ffadda] dark:border-pink-700/60',
            testId: 'type-label-notes',
        };
    }
    if (schedule.source === 'repo') {
        return {
            text: 'Repo',
            pillClass: 'bg-[#ddf4ff] dark:bg-[#1a3a5c] text-[#0969da] dark:text-[#4fc3f7] border-[#b6e3ff] dark:border-[#316dca]',
            testId: 'type-label-repo',
        };
    }
    if (schedule.targetType === 'script') {
        return {
            text: 'Script',
            pillClass: 'bg-[#fff8c5] dark:bg-amber-900/40 text-[#9a6700] dark:text-amber-300 border-[#d4a72c] dark:border-amber-700/60',
            testId: 'type-label-script',
        };
    }
    return {
        text: 'Prompt',
        pillClass: 'bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#848484] border-[#d8dee4] dark:border-[#3c3c3c]',
        testId: 'type-label-prompt',
    };
}

function HeaderIcon({ schedule }: { schedule: Schedule }) {
    const className = 'w-4 h-4 text-[#656d76] dark:text-[#848484] flex-shrink-0';
    if (schedule.source === 'repo') return <RepoIcon className={className} />;
    if (schedule.targetType === 'script') return <ScriptIcon className={className} />;
    return <PromptIcon className={className} />;
}

export function ScheduleDetail({ schedule, workspaceId, history, editingId, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, onCancelEdit, onSaved, showDuplicate = true }: ScheduleDetailProps) {
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
    const tLabel = typeLabel(schedule);
    const promptMode = normalizePromptScheduleMode(schedule.mode, 'autopilot');

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
                            chatMode: normalizePromptScheduleMode(schedule.mode, 'ask'),
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
                            chatMode: promptMode,
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
                            <HeaderIcon schedule={schedule} />
                            <span>{schedule.name}</span>
                            {schedule.isRunning && (
                                <span
                                    className="w-3 h-3 border-2 border-[#0969da] border-t-transparent rounded-full animate-spin flex-shrink-0"
                                    aria-label="Running"
                                    data-testid="running-spinner"
                                />
                            )}
                            <StatusBadge status={schedule.status} isRunning={schedule.isRunning} />
                            <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-4 border ${tLabel.pillClass}`}
                                data-testid={tLabel.testId}
                                data-type-label={tLabel.text.toLowerCase()}
                            >
                                {tLabel.text}
                            </span>
                            {(!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && promptMode !== 'autopilot' && (
                                <span
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#fbf0ff] dark:bg-purple-900/40 text-[#8250df] dark:text-purple-300 border border-[#e5cffd] dark:border-purple-700/60 font-medium leading-4 capitalize"
                                    data-testid="mode-badge"
                                >
                                    {promptMode}
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
                            variant="success"
                            size="sm"
                            disabled={schedule.isRunning}
                            onClick={() => onRunNow(schedule.id)}
                            aria-label="Run schedule now"
                        >
                            <PlayIcon />
                            Run now
                        </Button>
                        <span className="flex-1" />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onPauseResume(schedule)}
                            aria-label={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
                        >
                            {schedule.status === 'active' ? <PauseIcon /> : <PlayIcon />}
                            {schedule.status === 'active' ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={schedule.isRunning}
                            onClick={() => onEdit(schedule.id)}
                            aria-label="Edit schedule"
                            data-testid="edit-btn"
                        >
                            <EditIcon />
                            Edit
                        </Button>
                        {showDuplicate && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onDuplicate(schedule)}
                                aria-label="Duplicate schedule"
                                data-testid="duplicate-btn"
                            >
                                <CopyIcon />
                                Duplicate
                            </Button>
                        )}
                        <span className="flex-1" />
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onDelete(schedule.id)}
                            aria-label="Delete schedule"
                        >
                            <TrashIcon />
                            Delete
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
                                                        className="text-[11px] px-[7px] py-px rounded-full bg-[#eaeef2] dark:bg-[#2a2a2a] text-[#1f2328] dark:text-[#cccccc] font-mono leading-4"
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

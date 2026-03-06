/**
 * RepoSchedulesTab — workspace-scoped schedule management with CRUD, run history.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';
import { fetchPipelines } from './pipeline-api';
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
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [duplicateValues, setDuplicateValues] = useState<Partial<Schedule> | null>(null);

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
            setSelectedId(schedules[0].id);
        }
    }, [schedules, selectedId]);

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
        }
        fetchSchedules();
    };

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading schedules...</div>;
    }

    const selectedSchedule = schedules.find(s => s.id === selectedId) ?? null;

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left panel */}
            <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <span className="text-[11px] uppercase text-[#848484] font-medium">
                        SCHEDULES{schedules.length > 0 ? ` (${schedules.length})` : ''}
                    </span>
                    <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); }}>
                        + New
                    </Button>
                </div>

                {/* Empty state */}
                {schedules.length === 0 && (
                    <div className="p-4 text-center text-sm text-[#848484]">
                        <div className="text-2xl mb-2">🕐</div>
                        <div>No schedules for this repo yet.</div>
                        <div className="text-xs mt-1">Click &quot;+ New&quot; to automate a pipeline or script.</div>
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
            </div>

            {/* Right panel */}
            <div className="flex-1 min-w-0 overflow-y-auto">
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
                            } : undefined}
                        />
                    </div>
                ) : selectedSchedule ? (
                    <div className="px-4 py-3">
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
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        {schedules.length === 0
                            ? 'Create your first schedule with "+ New"'
                            : 'Select a schedule to view details'}
                    </div>
                )}
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

export function ScheduleDetail({ schedule, workspaceId, history, editingId, onRunNow, onPauseResume, onEdit, onDuplicate, onDelete, onCancelEdit, onSaved }: ScheduleDetailProps) {
    return (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2.5">
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
                    }}
                    onCreated={onSaved}
                    onCancel={onCancelEdit}
                />
            ) : (
                <>
                    {/* Actions */}
                    <div className="flex gap-1.5 mb-2.5">
                        <Button variant="primary" size="sm" onClick={() => onRunNow(schedule.id)}>Run Now</Button>
                        <Button variant="secondary" size="sm" onClick={() => onPauseResume(schedule)}>
                            {schedule.status === 'active' ? 'Pause' : 'Resume'}
                        </Button>
                        <Button variant="secondary" size="sm" disabled={schedule.isRunning} onClick={() => onEdit(schedule.id)} data-testid="edit-btn">Edit</Button>
                        <Button variant="secondary" size="sm" onClick={() => onDuplicate(schedule)} data-testid="duplicate-btn">Duplicate</Button>
                        <Button variant="danger" size="sm" onClick={() => onDelete(schedule.id)}>Delete</Button>
                    </div>

                    {/* Details */}
                    <div className="text-xs text-[#616161] dark:text-[#999] space-y-1 mb-2.5">
                        <div><span className="font-medium">Target:</span> {schedule.target}</div>
                        <div><span className="font-medium">Schedule:</span> {schedule.cron} · {schedule.cronDescription}</div>
                        {Object.keys(schedule.params).length > 0 && (
                            <div><span className="font-medium">Params:</span> {JSON.stringify(schedule.params)}</div>
                        )}
                        <div><span className="font-medium">On Failure:</span> {schedule.onFailure}</div>
                    </div>
                </>
            )}

            {/* Run History */}
            {history.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-[#848484] font-medium mb-1">Run History</div>
                    <div className="flex flex-col gap-0.5">
                        {history.map(run => (
                            <div key={run.id} className="text-[10px] text-[#616161] dark:text-[#999] py-0.5">
                                <div className="flex items-center gap-2">
                                    <span>
                                        {run.status === 'completed' ? '✔' : run.status === 'failed' ? '✖' : run.status === 'running' ? '🔄' : '⚠'}
                                    </span>
                                    <span className="flex-1">{formatRelativeTime(run.startedAt)}</span>
                                    {run.durationMs != null && (
                                        <span>{Math.round(run.durationMs / 1000)}s</span>
                                    )}
                                    {run.exitCode != null && (
                                        <span className={run.exitCode === 0 ? 'text-green-600' : 'text-red-500'}>
                                            Exit: {run.exitCode}
                                        </span>
                                    )}
                                    <span className={cn(
                                        run.status === 'completed' ? 'text-green-600' :
                                        run.status === 'failed' ? 'text-red-500' : ''
                                    )}>
                                        {run.status}
                                    </span>
                                </div>
                                {(run.stdout || run.stderr) && (
                                    <details className="mt-0.5 ml-4">
                                        <summary className="cursor-pointer text-[#0078d4] hover:underline select-none">
                                            output
                                        </summary>
                                        <div className="mt-0.5 p-1.5 rounded bg-[#f3f3f3] dark:bg-[#1e1e1e] font-mono text-[9px] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                                            {run.stdout && <div>{run.stdout}</div>}
                                            {run.stderr && <div className="text-red-400">{run.stderr}</div>}
                                        </div>
                                    </details>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {history.length === 0 && (
                <div className="text-[10px] text-[#848484]">No runs yet</div>
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
        id: 'run-pipeline',
        label: 'Run pipeline',
        emoji: '🚀',
        name: 'Run Workflow',
        target: 'pipelines/my-pipeline/pipeline.yaml',
        cronExpr: '0 9 * * *',
        intervalValue: '1',
        intervalUnit: 'days',
        mode: 'cron',
        params: [],
        hint: 'Ensure the pipeline YAML file exists at the specified target path',
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
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [params, setParams] = useState<Record<string, string>>(initialValues?.params ? { ...initialValues.params } : {});
    const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
    const [pipelinesLoading, setPipelinesLoading] = useState(false);
    const [manualPipeline, setManualPipeline] = useState(false);

    // Fetch pipelines when run-pipeline template is selected
    useEffect(() => {
        if (selectedTemplate !== 'run-pipeline') {
            setPipelines([]);
            setPipelinesLoading(false);
            setManualPipeline(false);
            return;
        }
        let cancelled = false;
        setPipelinesLoading(true);
        fetchPipelines(workspaceId)
            .then(list => { if (!cancelled) setPipelines(list); })
            .catch(() => { if (!cancelled) setPipelines([]); })
            .finally(() => { if (!cancelled) setPipelinesLoading(false); });
        return () => { cancelled = true; };
    }, [selectedTemplate, workspaceId]);

    const applyTemplate = (templateId: string) => {
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
            setManualPipeline(false);
            return;
        }
        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;
        setSelectedTemplate(templateId);
        setManualPipeline(false);
        setName(tpl.name);
        setTarget(templateId === 'run-pipeline' ? '' : tpl.target);
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

                {/* Target field — pipeline selector for run-pipeline, plain input otherwise */}
                {selectedTemplate === 'run-pipeline' && !manualPipeline ? (
                    pipelinesLoading ? (
                        <span className="text-xs px-2 py-1.5 text-[#848484] italic" data-testid="pipeline-loading">Loading pipelines…</span>
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
                            data-testid="target-pipeline-select"
                        >
                            <option value="" disabled>Select a pipeline…</option>
                            {pipelines.map(pl => (
                                <option key={pl.path} value={pl.path}>{pl.name}</option>
                            ))}
                            <option value="__manual__">Other (manual path)…</option>
                        </select>
                    ) : (
                        <input
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            placeholder="Target (e.g., pipelines/daily-report/pipeline.yaml)"
                            value={target}
                            onChange={e => {
                                setTarget(e.target.value);
                                setParams(prev => ({ ...prev, pipeline: e.target.value }));
                            }}
                            data-testid="target-pipeline-input"
                        />
                    )
                ) : selectedTemplate === 'run-pipeline' && manualPipeline ? (
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder="Target (e.g., pipelines/daily-report/pipeline.yaml)"
                        value={target}
                        onChange={e => {
                            setTarget(e.target.value);
                            setParams(prev => ({ ...prev, pipeline: e.target.value }));
                        }}
                        data-testid="target-pipeline-input"
                    />
                ) : (
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder={targetType === 'script' ? 'Command / Script (e.g., echo "hello world")' : 'Target (e.g., pipelines/daily-report/pipeline.yaml)'}
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
                                            <span className="flex-1 text-[#848484] italic" data-testid="pipeline-loading">Loading pipelines…</span>
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
                                                <option value="" disabled>Select a pipeline…</option>
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

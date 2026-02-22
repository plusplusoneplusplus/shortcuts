/**
 * RepoSchedulesTab — workspace-scoped schedule management with CRUD, run history.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';

interface RepoSchedulesTabProps {
    workspaceId: string;
}

interface Schedule {
    id: string;
    name: string;
    target: string;
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
}

export function RepoSchedulesTab({ workspaceId }: RepoSchedulesTabProps) {
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [showCreate, setShowCreate] = useState(false);

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

    const handleToggleExpand = async (scheduleId: string) => {
        if (expandedId === scheduleId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(scheduleId);
        try {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/history`);
            setHistory(data?.history || []);
        } catch {
            setHistory([]);
        }
    };

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
        if (expandedId === scheduleId) {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/history`);
            setHistory(data?.history || []);
        }
    };

    const handleDelete = async (scheduleId: string) => {
        if (!confirm('Delete this schedule?')) return;
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`, {
            method: 'DELETE',
        });
        if (expandedId === scheduleId) setExpandedId(null);
        fetchSchedules();
    };

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading schedules...</div>;
    }

    return (
        <div className="p-4 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase text-[#848484] font-medium">
                    Schedules {schedules.length > 0 && `(${schedules.length})`}
                </span>
                <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>+ New</Button>
            </div>

            {/* Empty state */}
            {schedules.length === 0 && !showCreate && (
                <div className="p-4 text-center text-sm text-[#848484]">
                    <div className="text-2xl mb-2">🕐</div>
                    <div>No schedules for this repo yet.</div>
                    <div className="text-xs mt-1">Click "+ New" to automate a pipeline or script.</div>
                </div>
            )}

            {/* Create dialog */}
            {showCreate && (
                <CreateScheduleForm
                    workspaceId={workspaceId}
                    onCreated={() => { setShowCreate(false); fetchSchedules(); }}
                    onCancel={() => setShowCreate(false)}
                />
            )}

            {/* Schedule list */}
            {schedules.map(schedule => (
                <Card key={schedule.id} className="p-0 overflow-hidden">
                    {/* Row */}
                    <button
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] transition-colors"
                        onClick={() => handleToggleExpand(schedule.id)}
                    >
                        <span className="flex-shrink-0">
                            <StatusDot status={schedule.status} isRunning={schedule.isRunning} />
                        </span>
                        <span className="flex-1 text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                            {schedule.name}
                        </span>
                        <span className="text-[10px] text-[#848484] font-mono flex-shrink-0">
                            {schedule.cronDescription}
                        </span>
                        {schedule.nextRun && schedule.status === 'active' && (
                            <span className="text-[10px] text-[#848484] flex-shrink-0">
                                next: {formatRelativeTime(schedule.nextRun).replace(' ago', '') || new Date(schedule.nextRun).toLocaleString()}
                            </span>
                        )}
                        <span className="text-[10px] text-[#848484]">{expandedId === schedule.id ? '▼' : '▶'}</span>
                    </button>

                    {/* Expanded detail */}
                    {expandedId === schedule.id && (
                        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2.5">
                            {/* Actions */}
                            <div className="flex gap-1.5 mb-2.5">
                                <Button variant="primary" size="sm" onClick={() => handleRunNow(schedule.id)}>Run Now</Button>
                                <Button variant="secondary" size="sm" onClick={() => handlePauseResume(schedule)}>
                                    {schedule.status === 'active' ? 'Pause' : 'Resume'}
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => handleDelete(schedule.id)}>Delete</Button>
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

                            {/* Run History */}
                            {history.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase text-[#848484] font-medium mb-1">Run History</div>
                                    <div className="flex flex-col gap-0.5">
                                        {history.map(run => (
                                            <div key={run.id} className="flex items-center gap-2 text-[10px] text-[#616161] dark:text-[#999] py-0.5">
                                                <span>
                                                    {run.status === 'completed' ? '✔' : run.status === 'failed' ? '✖' : run.status === 'running' ? '🔄' : '⚠'}
                                                </span>
                                                <span className="flex-1">{formatRelativeTime(run.startedAt)}</span>
                                                {run.durationMs != null && (
                                                    <span>{Math.round(run.durationMs / 1000)}s</span>
                                                )}
                                                <span className={cn(
                                                    run.status === 'completed' ? 'text-green-600' :
                                                    run.status === 'failed' ? 'text-red-500' : ''
                                                )}>
                                                    {run.status}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {history.length === 0 && (
                                <div className="text-[10px] text-[#848484]">No runs yet</div>
                            )}
                        </div>
                    )}
                </Card>
            ))}
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

interface ScheduleTemplateParam {
    key: string;
    placeholder: string;
}

interface ScheduleTemplate {
    id: string;
    label: string;
    emoji: string;
    name: string;
    target: string;
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
        name: 'Run Pipeline',
        target: 'pipelines/my-pipeline/pipeline.yaml',
        cronExpr: '0 9 * * *',
        intervalValue: '1',
        intervalUnit: 'days',
        mode: 'cron',
        params: [
            { key: 'pipeline', placeholder: 'pipelines/my-pipeline/pipeline.yaml' },
        ],
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
];

function CreateScheduleForm({ workspaceId, onCreated, onCancel }: {
    workspaceId: string;
    onCreated: () => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState('');
    const [target, setTarget] = useState('');
    const [mode, setMode] = useState<'cron' | 'interval'>('interval');
    const [cron, setCron] = useState('0 9 * * *');
    const [intervalValue, setIntervalValue] = useState('1');
    const [intervalUnit, setIntervalUnit] = useState('hours');
    const [onFailure, setOnFailure] = useState('notify');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [params, setParams] = useState<Record<string, string>>({});

    const applyTemplate = (templateId: string) => {
        if (selectedTemplate === templateId) {
            setSelectedTemplate(null);
            setName('');
            setTarget('');
            setMode('interval');
            setCron('0 9 * * *');
            setIntervalValue('1');
            setIntervalUnit('hours');
            setParams({});
            return;
        }
        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;
        setSelectedTemplate(templateId);
        setName(tpl.name);
        setTarget(tpl.target);
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
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    target: target.trim(),
                    cron: cronExpr,
                    params,
                    onFailure,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || `Failed (${res.status})`);
                return;
            }
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create schedule');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="p-3">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">New Schedule</div>

                {/* Template picker */}
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

                <input
                    className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                    placeholder="Name (e.g., Daily Report)"
                    value={name}
                    onChange={e => setName(e.target.value)}
                />

                <input
                    className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                    placeholder="Target (e.g., pipelines/daily-report/pipeline.yaml)"
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                />

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
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] font-mono"
                        placeholder="0 9 * * *"
                        value={cron}
                        onChange={e => setCron(e.target.value)}
                    />
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
                                    <input
                                        className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                        placeholder={p.placeholder}
                                        value={params[p.key] ?? ''}
                                        onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                                        data-testid={`param-${p.key}`}
                                    />
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

                {error && <div className="text-[10px] text-red-500">{error}</div>}

                <div className="flex justify-end gap-1.5">
                    <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
                    <Button variant="primary" size="sm" disabled={submitting}>
                        {submitting ? 'Creating...' : 'Create'}
                    </Button>
                </div>
            </form>
        </Card>
    );
}

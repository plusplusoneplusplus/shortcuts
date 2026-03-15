import { useState, useEffect } from 'react';
import { Button, cn } from '../shared';
import { getApiBase } from '../utils/config';
import { fetchWorkflows } from './workflow-api';
import { parseCronToInterval, describeCron, intervalToCron, CRON_EXAMPLES } from '../utils/cron';
import { SCHEDULE_TEMPLATES } from './scheduleTemplates';
import type { PipelineInfo } from './repoGrouping';

export function CreateScheduleForm({ workspaceId, onCreated, onCancel, mode: formMode = 'create', scheduleId, initialValues }: {
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !target.trim()) {
            setError('Name and target are required');
            return;
        }
        setSubmitting(true);
        setError('');

        const cronExpr = mode === 'interval' ? intervalToCron(intervalValue, intervalUnit) : cron;

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

    return (
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
}

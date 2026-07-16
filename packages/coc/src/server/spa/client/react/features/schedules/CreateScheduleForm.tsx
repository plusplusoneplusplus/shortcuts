import { useState, useEffect } from 'react';
import { Button, cn } from '../../ui';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { getSpaCocClient } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { getActiveProvider } from '../../utils/config';
import { fetchWorkflows } from '../workflow/workflow-api';
import { describeCron, parseCronToInterval, intervalToCron } from '../../utils/cron';
import { SCHEDULE_TEMPLATES } from './scheduleTemplates';
import { ScheduleTriggerPanel } from './ScheduleTriggerPanel';
import { TaskDefs } from '../../../../../tasks/task-types';
import type { WorkflowDefinition } from '@plusplusoneplusplus/coc-client';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { normalizePromptScheduleMode } from './scheduleTypes';
import type { PromptScheduleMode } from './scheduleTypes';

type ActionKind = 'workflow' | 'prompt' | 'script' | 'notes-auto-commit';
type SchedulePreset = 'every-30-minutes' | 'hourly' | 'daily-9' | 'weekdays-9' | 'custom-interval' | 'custom-cron';
type TargetType = 'prompt' | 'script';
type TimingMode = 'interval' | 'cron';

interface ScheduleFormInitialValues {
    name?: string;
    target?: string;
    targetType?: TargetType;
    cron?: string;
    params?: Record<string, string>;
    onFailure?: string;
    outputFolder?: string;
    model?: string;
    chatMode?: PromptScheduleMode;
}

const DEFAULT_CRON = '0 * * * *';
const NOTES_AUTO_COMMIT_NAME = 'Notes Auto-Commit';

const ACTION_CARDS: Array<{ kind: ActionKind; title: string; description: string }> = [
    { kind: 'workflow', title: 'Workflow', description: 'Run a saved workflow YAML' },
    { kind: 'prompt', title: 'Prompt', description: 'Ask CoC to do recurring work' },
    { kind: 'script', title: 'Script', description: 'Run a command' },
    { kind: 'notes-auto-commit', title: 'Notes auto-commit', description: 'Save notes changes periodically' },
];

const SCHEDULE_PRESETS: Array<{ value: SchedulePreset; label: string; cron?: string }> = [
    { value: 'every-30-minutes', label: 'Every 30 minutes', cron: '*/30 * * * *' },
    { value: 'hourly', label: 'Hourly', cron: '0 * * * *' },
    { value: 'daily-9', label: 'Daily at 9:00', cron: '0 9 * * *' },
    { value: 'weekdays-9', label: 'Weekdays at 9:00', cron: '0 9 * * 1-5' },
    { value: 'custom-interval', label: 'Custom...' },
];

function defaultOutputFolder(workspaceId: string): string {
    return `~/.coc/repos/${workspaceId}/tasks`;
}

function getTemplate(templateId: string) {
    return SCHEDULE_TEMPLATES.find(t => t.id === templateId);
}

function defaultNameForAction(actionKind: ActionKind): string {
    switch (actionKind) {
        case 'workflow': return getTemplate(TaskDefs.runWorkflow.kind)?.name ?? 'Run Workflow';
        case 'script': return 'Run Script';
        case 'notes-auto-commit': return NOTES_AUTO_COMMIT_NAME;
        case 'prompt': return 'Recurring Prompt';
    }
}

function templateIdForAction(actionKind: ActionKind): string | null {
    if (actionKind === 'workflow') {
        return TaskDefs.runWorkflow.kind;
    }
    if (actionKind === 'script') {
        return TaskDefs.runScript.kind;
    }
    if (actionKind === 'notes-auto-commit') {
        return 'notes-auto-commit';
    }
    return null;
}

function inferActionKind(initialValues?: ScheduleFormInitialValues): ActionKind {
    if (!initialValues) {
        return 'prompt';
    }
    const params = initialValues.params ?? {};
    const target = initialValues.target ?? '';
    if (initialValues.targetType === 'script') {
        return initialValues.name === NOTES_AUTO_COMMIT_NAME ? 'notes-auto-commit' : 'script';
    }
    if (params.pipeline || /\.(ya?ml)$/i.test(target)) {
        return 'workflow';
    }
    return 'prompt';
}

function inferSchedulePreset(cron?: string): SchedulePreset {
    if (!cron) {
        return 'hourly';
    }
    const trimmed = cron.trim();
    const known = SCHEDULE_PRESETS.find(preset => preset.cron === trimmed);
    if (known) {
        return known.value;
    }
    return parseCronToInterval(trimmed).mode === 'interval' ? 'custom-interval' : 'custom-cron';
}

function cronForPreset(preset: SchedulePreset): string | null {
    return SCHEDULE_PRESETS.find(item => item.value === preset)?.cron ?? null;
}

function isFiveFieldCron(expr: string): boolean {
    return expr.trim().split(/\s+/).length === 5;
}

function hasAdvancedValues(initialValues: ScheduleFormInitialValues | undefined, workspaceId: string, preset: SchedulePreset): boolean {
    if (!initialValues) {
        return false;
    }
    const params = initialValues.params ?? {};
    return Boolean(
        initialValues.model
        || (initialValues.chatMode && normalizePromptScheduleMode(initialValues.chatMode) !== 'autopilot')
        || (initialValues.outputFolder && initialValues.outputFolder !== defaultOutputFolder(workspaceId))
        || (initialValues.onFailure && initialValues.onFailure !== 'notify')
        || Object.keys(params).some(key => key !== 'pipeline' && key !== 'workingDirectory')
        || preset === 'custom-cron'
        || preset === 'custom-interval',
    );
}

function actionSummaryLabel(actionKind: ActionKind, target: string): string {
    if (actionKind === 'workflow') {
        return target ? `workflow "${target}"` : 'the selected workflow';
    }
    if (actionKind === 'script') {
        return target ? `command "${target}"` : 'the configured command';
    }
    if (actionKind === 'notes-auto-commit') {
        return 'notes changes';
    }
    return target ? `"${target.slice(0, 64)}${target.length > 64 ? '...' : ''}"` : 'the prompt';
}

function timingSummary(preset: SchedulePreset, cron: string, mode: TimingMode, intervalValue: string, intervalUnit: string): string {
    if (preset === 'custom-interval' || mode === 'interval') {
        return `every ${intervalValue || '1'} ${intervalUnit}`;
    }
    return describeCron(cron) || cron;
}

function buildScheduleSummary(
    actionKind: ActionKind,
    name: string,
    target: string,
    preset: SchedulePreset,
    cron: string,
    mode: TimingMode,
    intervalValue: string,
    intervalUnit: string,
    targetType: TargetType,
    chatMode: PromptScheduleMode,
    outputFolder: string,
    onFailure: string,
    workingDirectory: string | undefined,
): string[] {
    const displayName = name.trim() || defaultNameForAction(actionKind);
    const lines = [
        `Runs "${displayName}" (${actionSummaryLabel(actionKind, target)}) ${timingSummary(preset, cron, mode, intervalValue, intervalUnit)}.`,
    ];
    if (targetType === 'prompt') {
        lines.push(`Output: ${outputFolder.trim() || 'default tasks folder'}.`);
        lines.push(`Mode: ${chatMode === 'ask' ? 'Ask' : 'Autopilot'}.`);
    } else {
        if (workingDirectory) {
            lines.push(`Working directory: ${workingDirectory}.`);
        }
        lines.push(`Failure behavior: ${onFailure}.`);
    }
    return lines;
}

function applyTemplateParams(templateId: string | null): Record<string, string> {
    const template = templateId ? getTemplate(templateId) : null;
    const params: Record<string, string> = {};
    for (const param of template?.params ?? []) {
        params[param.key] = param.placeholder;
    }
    return params;
}

export function CreateScheduleForm({ workspaceId, onCreated, onCancel, mode: formMode = 'create', scheduleId, initialValues }: {
    workspaceId: string;
    onCreated: () => void;
    onCancel: () => void;
    mode?: 'create' | 'edit';
    scheduleId?: string;
    initialValues?: ScheduleFormInitialValues;
}) {
    // AC-07: schedule create/update target the selected clone's server (provider
    // model catalog stays on the default origin — it is not workspace-scoped).
    const cloneClient = useCocClient(workspaceId);
    const workflowsEnabled = useWorkflowsEnabled();
    const inferredActionKind = inferActionKind(initialValues);
    const workflowActionBlocked = !workflowsEnabled && inferredActionKind === 'workflow';
    const initialActionKind = workflowActionBlocked ? 'prompt' : inferredActionKind;
    const initialPreset = inferSchedulePreset(initialValues?.cron);
    const cronParsed = initialValues?.cron ? parseCronToInterval(initialValues.cron) : null;
    const initialTemplateId = templateIdForAction(initialActionKind);
    const initialCron = initialValues?.cron ?? cronForPreset(initialPreset) ?? DEFAULT_CRON;
    const initialTarget = workflowActionBlocked ? '' : initialValues?.target ?? '';
    const initialParams = workflowActionBlocked
        ? {}
        : initialValues?.params ? { ...initialValues.params } : applyTemplateParams(initialTemplateId);

    const [actionKind, setActionKind] = useState<ActionKind>(initialActionKind);
    const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>(initialPreset);
    const [name, setName] = useState(initialValues?.name ?? defaultNameForAction(initialActionKind));
    const [target, setTarget] = useState(initialTarget);
    const [targetType, setTargetType] = useState<TargetType>(initialValues?.targetType ?? (initialActionKind === 'script' || initialActionKind === 'notes-auto-commit' ? 'script' : 'prompt'));
    const [mode, setMode] = useState<TimingMode>(initialPreset === 'custom-interval' ? 'interval' : 'cron');
    const [cron, setCron] = useState(initialCron);
    const [intervalValue, setIntervalValue] = useState(cronParsed?.mode === 'interval' ? cronParsed.value : '1');
    const [intervalUnit, setIntervalUnit] = useState(cronParsed?.mode === 'interval' ? cronParsed.unit : 'hours');
    const [onFailure, setOnFailure] = useState(initialValues?.onFailure ?? 'notify');
    const [outputFolder, setOutputFolder] = useState(initialValues?.outputFolder ?? defaultOutputFolder(workspaceId));
    const [model, setModel] = useState(initialValues?.model ?? '');
    const [chatMode, setChatMode] = useState<PromptScheduleMode>(normalizePromptScheduleMode(initialValues?.chatMode, 'autopilot'));
    const [models, setModels] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(initialTemplateId);
    const [params, setParams] = useState<Record<string, string>>(initialParams);
    const [pipelines, setPipelines] = useState<WorkflowDefinition[]>([]);
    const [pipelinesLoading, setPipelinesLoading] = useState(false);
    const [manualPipeline, setManualPipeline] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedValues(initialValues, workspaceId, initialPreset));

    useEffect(() => {
        if (workflowsEnabled || actionKind !== 'workflow') {
            return;
        }
        setActionKind('prompt');
        setSelectedTemplate(null);
        setTarget('');
        setTargetType('prompt');
        setParams({});
        setManualPipeline(false);
        setName(prev => prev === defaultNameForAction('workflow') ? defaultNameForAction('prompt') : prev);
    }, [workflowsEnabled, actionKind]);

    useEffect(() => {
        if (selectedTemplate !== TaskDefs.runWorkflow.kind) {
            setPipelines([]);
            setPipelinesLoading(false);
            setManualPipeline(false);
            return;
        }
        let cancelled = false;
        setPipelinesLoading(true);
        fetchWorkflows(workspaceId)
            .then(list => {
                if (!cancelled) {
                    setPipelines(Array.isArray(list) ? list : []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPipelines([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setPipelinesLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [selectedTemplate, workspaceId]);

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().agentProviders.listModels(getActiveProvider())
            .then(data => {
                if (!cancelled) {
                    setModels(Array.isArray(data.models) ? data.models.map((m: any) => m.id ?? m) : []);
                }
            })
            .catch(() => { /* keep the model override optional when the model API is unavailable */ });
        return () => { cancelled = true; };
    }, []);

    const selectAction = (nextAction: ActionKind) => {
        const templateId = templateIdForAction(nextAction);
        const template = templateId ? getTemplate(templateId) : null;
        setActionKind(nextAction);
        setSelectedTemplate(templateId);
        setManualPipeline(false);
        setName(defaultNameForAction(nextAction));
        setTarget('');
        setTargetType(nextAction === 'script' || nextAction === 'notes-auto-commit' ? 'script' : 'prompt');
        setParams(applyTemplateParams(templateId));
        if (template) {
            const nextPreset = inferSchedulePreset(template.cronExpr);
            setSchedulePreset(nextPreset);
            setMode(template.mode);
            setCron(template.cronExpr);
            setIntervalValue(template.intervalValue);
            setIntervalUnit(template.intervalUnit);
        } else {
            setSchedulePreset('hourly');
            setMode('cron');
            setCron(DEFAULT_CRON);
            setIntervalValue('1');
            setIntervalUnit('hours');
        }
    };

    const selectPreset = (preset: SchedulePreset) => {
        setSchedulePreset(preset);
        const presetCron = cronForPreset(preset);
        if (presetCron) {
            setMode('cron');
            setCron(presetCron);
            return;
        }
        setMode('interval');
    };

    const updateCustomMode = (nextMode: TimingMode) => {
        setMode(nextMode);
        setSchedulePreset(nextMode === 'interval' ? 'custom-interval' : 'custom-cron');
    };

    const updateCron = (nextCron: string) => {
        setCron(nextCron);
        if (schedulePreset !== 'custom-cron') {
            setSchedulePreset('custom-cron');
        }
        if (mode !== 'cron') {
            setMode('cron');
        }
    };

    const updateWorkflowTarget = (nextTarget: string) => {
        setTarget(nextTarget);
        setParams(prev => ({ ...prev, pipeline: nextTarget }));
    };

    const validate = (): string | null => {
        if (!name.trim()) {
            return 'Add a schedule name.';
        }
        if (actionKind === 'workflow' && !target.trim()) {
            return 'Select a workflow or enter a workflow path.';
        }
        if (actionKind === 'prompt' && !target.trim()) {
            return 'Enter the prompt to run.';
        }
        if (actionKind === 'script' && !target.trim()) {
            return 'Enter the command to run.';
        }
        if (actionKind === 'notes-auto-commit' && !target.trim()) {
            return 'Enter the command to run.';
        }
        const cronExpr = mode === 'interval' ? intervalToCron(intervalValue, intervalUnit) : cron;
        if (!isFiveFieldCron(cronExpr)) {
            return 'Enter a valid 5-field cron expression.';
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) {
            setError(validationError);
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
            if (formMode === 'edit' && scheduleId) {
                await cloneClient.schedules.update(workspaceId, scheduleId, payload);
            } else {
                await cloneClient.schedules.create(workspaceId, payload);
            }
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${formMode === 'edit' ? 'update' : 'create'} schedule`);
        } finally {
            setSubmitting(false);
        }
    };

    const selectedTemplateDef = selectedTemplate ? getTemplate(selectedTemplate) : null;
    const visibleActionCards = ACTION_CARDS.filter(card => card.kind !== 'workflow' || workflowsEnabled);
    const formDescription = formMode === 'edit'
        ? 'Update what runs, when it runs, or advanced execution options.'
        : workflowsEnabled
            ? 'Automate a prompt, workflow, script, or notes task. Start simple; open Advanced for model, cron, output, and failure settings.'
            : 'Automate a prompt, script, or notes task. Start simple; open Advanced for model, cron, output, and failure settings.';
    const rawCronVisible = mode === 'cron';
    const summary = buildScheduleSummary(
        actionKind,
        name,
        target,
        schedulePreset,
        cron,
        mode,
        intervalValue,
        intervalUnit,
        targetType,
        chatMode,
        outputFolder,
        onFailure,
        params.workingDirectory,
    );

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{formMode === 'edit' ? 'Edit Schedule' : 'New Schedule'}</div>
                <div className="text-[11px] text-[#616161] dark:text-[#999]">
                    {formDescription}
                </div>
            </div>

            <section className="flex flex-col gap-2" aria-label="What should run?">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">What should run?</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="schedule-action-cards">
                    {visibleActionCards.map(card => {
                        const selected = actionKind === card.kind;
                        return (
                            <button
                                key={card.kind}
                                type="button"
                                className={cn(
                                    'text-left rounded border p-2 transition-colors',
                                    selected
                                        ? 'border-[#0078d4] bg-[#0078d4]/10 ring-1 ring-[#0078d4]'
                                        : 'border-[#d0d0d0] dark:border-[#555] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
                                )}
                                onClick={() => selectAction(card.kind)}
                                data-testid={`schedule-action-${card.kind}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{card.title}</span>
                                    {selected && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0078d4] text-white">Selected</span>}
                                </div>
                                <div className="text-[10px] text-[#616161] dark:text-[#999] mt-0.5">{card.description}</div>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="flex flex-col gap-2" aria-label="Configure the selected action">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Configure the selected action</div>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-[#616161] dark:text-[#999]">Schedule name</span>
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        placeholder="Name (e.g., Daily Report)"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />
                </label>

                {actionKind === 'workflow' && (
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-[#616161] dark:text-[#999]">Workflow</label>
                        {!manualPipeline && pipelinesLoading ? (
                            <span className="text-xs px-2 py-1.5 text-[#848484] italic" data-testid="workflow-loading">Loading workflows...</span>
                        ) : !manualPipeline && pipelines.length > 0 ? (
                            <select
                                className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                value={target}
                                onChange={e => {
                                    if (e.target.value === '__manual__') {
                                        setManualPipeline(true);
                                        updateWorkflowTarget('');
                                        return;
                                    }
                                    updateWorkflowTarget(e.target.value);
                                }}
                                data-testid="target-workflow-select"
                            >
                                <option value="" disabled>Select a workflow...</option>
                                {pipelines.map(pl => (
                                    <option key={pl.path} value={pl.path}>{pl.name}</option>
                                ))}
                                <option value="__manual__">Other (manual path)...</option>
                            </select>
                        ) : (
                            <input
                                className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                placeholder="workflows/daily-report/pipeline.yaml"
                                value={target}
                                onChange={e => updateWorkflowTarget(e.target.value)}
                                data-testid="target-workflow-input"
                            />
                        )}
                    </div>
                )}

                {actionKind === 'prompt' && (
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-[#616161] dark:text-[#999]">Prompt</span>
                        <textarea
                            className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] resize-y min-h-[72px]"
                            placeholder="Run the weekly repo health check..."
                            value={target}
                            onChange={e => setTarget(e.target.value)}
                            data-testid="target-input"
                            rows={3}
                        />
                    </label>
                )}

                {actionKind === 'script' && (
                    <>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] text-[#616161] dark:text-[#999]">Command</span>
                            <input
                                className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                placeholder="npm run report"
                                value={target}
                                onChange={e => setTarget(e.target.value)}
                                data-testid="target-input"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] text-[#616161] dark:text-[#999]">Working directory</span>
                            <input
                                className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                placeholder="."
                                value={params.workingDirectory ?? ''}
                                onChange={e => setParams(prev => ({ ...prev, workingDirectory: e.target.value }))}
                                data-testid="working-directory-input"
                            />
                        </label>
                    </>
                )}

                {actionKind === 'notes-auto-commit' && (
                    <div className="text-xs rounded border border-[#d0d0d0] dark:border-[#555] p-2 text-[#616161] dark:text-[#999]" data-testid="notes-auto-commit-info">
                        Automatically commit notes changes on a recurring schedule.
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-2" aria-label="When should it run?">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">When should it run?</div>
                <div className="flex flex-wrap gap-1.5" data-testid="schedule-preset-picker">
                    {SCHEDULE_PRESETS.map(preset => (
                        <button
                            key={preset.value}
                            type="button"
                            className={cn(
                                'text-[10px] px-2 py-1 rounded border transition-colors',
                                schedulePreset === preset.value || (preset.value === 'custom-interval' && schedulePreset === 'custom-cron')
                                    ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4] ring-1 ring-[#0078d4]'
                                    : 'border-[#d0d0d0] dark:border-[#555] text-[#616161] dark:text-[#999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
                            )}
                            onClick={() => selectPreset(preset.value)}
                            data-testid={`schedule-preset-${preset.value}`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                {(schedulePreset === 'custom-interval' || schedulePreset === 'custom-cron') && (
                    <div className="flex flex-col gap-1.5 rounded border border-[#d0d0d0] dark:border-[#555] p-2" data-testid="custom-schedule-panel">
                        <div className="text-[10px] font-medium text-[#616161] dark:text-[#999]">Custom schedule</div>
                        <ScheduleTriggerPanel
                            mode={mode}
                            onModeChange={updateCustomMode}
                            intervalValue={intervalValue}
                            onIntervalValueChange={setIntervalValue}
                            intervalUnit={intervalUnit}
                            onIntervalUnitChange={setIntervalUnit}
                            cron={cron}
                            onCronChange={updateCron}
                        />
                    </div>
                )}
            </section>

            <section className="flex flex-col gap-1 rounded border border-[#d0d0d0] dark:border-[#555] p-2" aria-label="Summary" data-testid="schedule-summary">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Summary</div>
                {summary.map(line => (
                    <div key={line} className="text-[10px] text-[#616161] dark:text-[#999]">{line}</div>
                ))}
            </section>

            <section className="flex flex-col gap-2 rounded border border-[#d0d0d0] dark:border-[#555] p-2" data-testid="advanced-options">
                <button
                    type="button"
                    className="flex items-start justify-between gap-2 text-left"
                    onClick={() => setAdvancedOpen(open => !open)}
                    aria-expanded={advancedOpen}
                    data-testid="advanced-options-toggle"
                >
                    <span>
                        <span className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{advancedOpen ? 'v' : '>'} Advanced options</span>
                        <span className="block text-[10px] text-[#616161] dark:text-[#999]">Model, mode, output folder, failure behavior, cron, and raw parameters.</span>
                    </span>
                    {Object.keys(params).length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-[#616161] dark:text-[#999]">custom parameters</span>}
                </button>

                {advancedOpen && (
                    <div className="flex flex-col gap-2" data-testid="advanced-options-panel">
                        {targetType === 'prompt' && (
                            <>
                                <SegmentedControl
                                    label="Execution mode"
                                    options={[
                                        { value: 'ask' as const, label: 'Ask', testId: 'chat-mode-ask' },
                                        { value: 'autopilot' as const, label: 'Autopilot', testId: 'chat-mode-autopilot' },
                                    ]}
                                    value={chatMode}
                                    onChange={setChatMode}
                                    data-testid="chat-mode-picker"
                                />

                                <label className="flex items-center gap-2 text-xs">
                                    <span className="text-[#616161] dark:text-[#999]">Model</span>
                                    <select
                                        className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                        value={model}
                                        onChange={e => setModel(e.target.value)}
                                        data-testid="model-select"
                                    >
                                        <option value="">Default</option>
                                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-1">
                                    <span className="text-[10px] text-[#616161] dark:text-[#999]">Output folder</span>
                                    <input
                                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                        placeholder={`e.g., ${defaultOutputFolder(workspaceId)}`}
                                        value={outputFolder}
                                        onChange={e => setOutputFolder(e.target.value)}
                                        data-testid="output-folder-input"
                                    />
                                </label>
                            </>
                        )}

                        <label className="flex items-center gap-2 text-xs">
                            <span className="text-[#616161] dark:text-[#999]">Failure behavior</span>
                            <select
                                className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                value={onFailure}
                                onChange={e => setOnFailure(e.target.value)}
                                data-testid="on-failure-select"
                            >
                                <option value="notify">Notify</option>
                                <option value="stop">Stop</option>
                            </select>
                        </label>

                        {rawCronVisible && (
                            <label className="flex flex-col gap-1">
                                <span className="text-[10px] text-[#616161] dark:text-[#999]">Cron expression</span>
                                <input
                                    className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] font-mono"
                                    placeholder="0 9 * * *"
                                    value={cron}
                                    onChange={e => updateCron(e.target.value)}
                                    data-testid="advanced-cron-input"
                                />
                                <span className="text-[9px] text-[#848484] font-mono">min · hr · dom · mon · dow</span>
                            </label>
                        )}

                        {selectedTemplateDef && selectedTemplateDef.hint && (
                            <div className="text-[10px] italic text-[#848484]" data-testid="template-hint">
                                {selectedTemplateDef.hint}
                            </div>
                        )}

                        {Object.keys(params).length > 0 && (
                            <div className="flex flex-col gap-1.5" data-testid={selectedTemplate ? 'template-params' : 'edit-params'}>
                                <div className="text-[10px] uppercase text-[#848484] font-medium">Parameters</div>
                                {Object.entries(params).map(([key, value]) => (
                                    <div key={key} className="flex items-center gap-1.5 text-xs">
                                        <span className="text-[#616161] dark:text-[#999] w-24 text-right flex-shrink-0">{key}:</span>
                                        <input
                                            className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                            value={value}
                                            onChange={e => {
                                                setParams(prev => ({ ...prev, [key]: e.target.value }));
                                                if (key === 'pipeline') {
                                                    setTarget(e.target.value);
                                                }
                                            }}
                                            data-testid={`param-${key}`}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </section>

            {error && <div className="text-[10px] text-red-500" data-testid="schedule-form-error">{error}</div>}

            <div className="flex justify-end gap-1.5">
                <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="sm" type="submit" disabled={submitting}>
                    {submitting ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save' : 'Create')}
                </Button>
            </div>
        </form>
    );
}

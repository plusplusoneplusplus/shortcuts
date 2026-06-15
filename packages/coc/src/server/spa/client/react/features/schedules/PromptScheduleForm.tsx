/**
 * PromptScheduleForm — simplified prompt-first schedule creation.
 *
 * Designed for the most common case: recurring AI prompts.
 * Advanced automation (workflow/script/notes) stays in CreateScheduleForm.
 */

import { useState, useEffect } from 'react';
import { Button, cn } from '../../ui';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { getSpaCocClient } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { getActiveProvider } from '../../utils/config';
import { ScheduleTriggerPanel } from './ScheduleTriggerPanel';
import {
    PROMPT_SCHEDULE_PRESETS,
    WEEKDAY_CHIPS,
    MANUAL_PLACEHOLDER_CRON,
    presetToCron,
    inferPresetFromCron,
    describePromptSchedule,
} from './schedulePresets';
import type { PromptSchedulePreset } from './schedulePresets';
import { normalizePromptScheduleMode } from './scheduleTypes';
import type { PromptScheduleMode } from './scheduleTypes';

export interface PromptScheduleFormValues {
    name?: string;
    target?: string;
    cron?: string;
    model?: string;
    chatMode?: PromptScheduleMode;
    outputFolder?: string;
    onFailure?: string;
}

function defaultOutputFolder(workspaceId: string): string {
    return `~/.coc/repos/${workspaceId}/tasks`;
}

/** Determine whether to show the controls-drawer on mount. */
function hasNonDefaultOptions(vals: PromptScheduleFormValues | undefined, workspaceId: string): boolean {
    if (!vals) return false;
    return Boolean(
        vals.model
        || (vals.outputFolder && vals.outputFolder !== defaultOutputFolder(workspaceId))
        || (vals.onFailure && vals.onFailure !== 'notify'),
    );
}

export function PromptScheduleForm({ workspaceId, onCreated, onCancel, onAdvanced, mode: formMode = 'create', scheduleId, initialValues }: {
    workspaceId: string;
    onCreated: () => void;
    onCancel: () => void;
    /** Switch to the full CreateScheduleForm for workflow/script/notes. */
    onAdvanced?: () => void;
    mode?: 'create' | 'edit';
    scheduleId?: string;
    initialValues?: PromptScheduleFormValues;
}) {
    // AC-07: schedule create/update/disable target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    // Infer preset from existing cron on edit
    const inferred = initialValues?.cron ? inferPresetFromCron(initialValues.cron) : null;

    const [name, setName] = useState(initialValues?.name ?? '');
    const [instructions, setInstructions] = useState(initialValues?.target ?? '');
    const [chatMode, setChatMode] = useState<PromptScheduleMode>(normalizePromptScheduleMode(initialValues?.chatMode, 'ask'));
    const [model, setModel] = useState(initialValues?.model ?? '');
    const [outputFolder, setOutputFolder] = useState(initialValues?.outputFolder ?? defaultOutputFolder(workspaceId));
    const [onFailure, setOnFailure] = useState(initialValues?.onFailure ?? 'notify');
    const [models, setModels] = useState<string[]>([]);
    const [preset, setPreset] = useState<PromptSchedulePreset>(inferred?.preset ?? 'daily');
    const [hour, setHour] = useState(inferred?.hour ?? 9);
    const [minute, setMinute] = useState(inferred?.minute ?? 0);
    const [dayOfWeek, setDayOfWeek] = useState(inferred?.dayOfWeek ?? '1');
    // Custom schedule state (only used when preset === 'custom')
    const [customTimingMode, setCustomTimingMode] = useState<'interval' | 'cron'>('cron');
    const [customCron, setCustomCron] = useState(initialValues?.cron ?? '0 9 * * *');
    const [customIntervalValue, setCustomIntervalValue] = useState('1');
    const [customIntervalUnit, setCustomIntervalUnit] = useState('hours');
    const [optionsOpen, setOptionsOpen] = useState(hasNonDefaultOptions(initialValues, workspaceId));

    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Load available models
    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().agentProviders.listModels(getActiveProvider())
            .then(data => {
                if (!cancelled) setModels(Array.isArray(data.models) ? data.models.map((m: any) => m.id ?? m) : []);
            })
            .catch(() => { /* model override stays optional */ });
        return () => { cancelled = true; };
    }, []);

    const showTimePicker = preset === 'daily' || preset === 'weekdays' || preset === 'weekly';
    const showDayPicker = preset === 'weekly';

    const scheduleSummary = preset === 'custom'
        ? 'Custom schedule.'
        : describePromptSchedule(preset, hour, minute, dayOfWeek);

    const modeSummary = `Mode: ${chatMode === 'ask' ? 'Ask' : 'Autopilot'}.`;

    const validate = (): string | null => {
        if (!name.trim()) return 'Give your routine a name.';
        if (!instructions.trim()) return 'Write the prompt instructions.';
        if (preset === 'custom') {
            const cronExpr = customTimingMode === 'interval'
                ? `${customIntervalValue} * * * *`  // simplified check
                : customCron;
            if (cronExpr.trim().split(/\s+/).length !== 5) return 'Enter a valid 5-field cron expression.';
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) { setError(validationError); return; }
        setSubmitting(true);
        setError('');

        let cronExpr: string;
        let shouldPause = false;
        if (preset === 'manual') {
            cronExpr = MANUAL_PLACEHOLDER_CRON;
            shouldPause = true;
        } else if (preset === 'custom') {
            if (customTimingMode === 'interval') {
                const val = parseInt(customIntervalValue, 10) || 1;
                switch (customIntervalUnit) {
                    case 'minutes': cronExpr = `*/${val} * * * *`; break;
                    case 'hours': cronExpr = `0 */${val} * * *`; break;
                    case 'days': cronExpr = `0 0 */${val} * *`; break;
                    default: cronExpr = `0 */${val} * * *`;
                }
            } else {
                cronExpr = customCron;
            }
        } else {
            cronExpr = presetToCron(preset, hour, minute, dayOfWeek);
        }

        try {
            const payload = {
                name: name.trim(),
                target: instructions.trim(),
                targetType: 'prompt' as const,
                cron: cronExpr,
                params: {} as Record<string, string>,
                onFailure,
                outputFolder: outputFolder.trim() || undefined,
                model: model.trim() || undefined,
                mode: chatMode,
            };
            if (formMode === 'edit' && scheduleId) {
                await cloneClient.schedules.update(workspaceId, scheduleId, payload);
            } else {
                const result = await cloneClient.schedules.create(workspaceId, payload);
                if (shouldPause && result?.id) {
                    try { await cloneClient.schedules.disable(workspaceId, result.id); } catch { /* best effort */ }
                }
            }
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${formMode === 'edit' ? 'update' : 'create'} schedule`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="prompt-schedule-form">
            {/* Local-only notice */}
            <div className="flex items-start gap-2 px-3 py-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300" data-testid="local-notice">
                <span className="flex-shrink-0 mt-0.5">🕐</span>
                <span>Local schedules only run while this CoC server is awake.</span>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    {formMode === 'edit' ? 'Edit Prompt Routine' : 'New Prompt Routine'}
                </div>
                {onAdvanced && formMode === 'create' && (
                    <button
                        type="button"
                        className="text-[10px] text-[#0078d4] hover:underline"
                        onClick={onAdvanced}
                        data-testid="switch-to-advanced"
                    >
                        Other automation →
                    </button>
                )}
            </div>

            {/* Name */}
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Name</span>
                <input
                    className="text-xs px-2.5 py-2 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                    placeholder="daily-code-review"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    data-testid="prompt-name-input"
                />
            </label>

            {/* Instructions */}
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Instructions</span>
                <textarea
                    className="text-xs px-2.5 py-2 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] resize-y min-h-[96px]"
                    placeholder="Review open PRs and summarize any issues..."
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    data-testid="prompt-instructions-input"
                    rows={4}
                />
                {/* Inline execution options below the editor */}
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <SegmentedControl
                        label="Mode"
                        options={[
                            { value: 'ask' as const, label: 'Ask', testId: 'prompt-mode-ask' },
                            { value: 'autopilot' as const, label: 'Autopilot', testId: 'prompt-mode-autopilot' },
                        ]}
                        value={chatMode}
                        onChange={setChatMode}
                    />
                    <label className="flex items-center gap-1 text-xs">
                        <span className="text-[#616161] dark:text-[#999]">Model</span>
                        <select
                            className="px-1.5 py-0.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] text-[10px]"
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            data-testid="prompt-model-select"
                        >
                            <option value="">Default</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </label>
                </div>
            </label>

            {/* Schedule */}
            <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Schedule</span>
                <div className="flex flex-wrap gap-1.5" data-testid="prompt-schedule-chips">
                    {PROMPT_SCHEDULE_PRESETS.map(p => (
                        <button
                            key={p.value}
                            type="button"
                            className={cn(
                                'text-[11px] px-2.5 py-1 rounded-full border transition-colors',
                                preset === p.value
                                    ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4] font-medium'
                                    : 'border-[#d0d0d0] dark:border-[#555] text-[#616161] dark:text-[#999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
                            )}
                            onClick={() => setPreset(p.value)}
                            data-testid={`prompt-preset-${p.value}`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Time picker */}
                {showTimePicker && (
                    <div className="flex items-center gap-2 text-xs" data-testid="prompt-time-picker">
                        <span className="text-[#616161] dark:text-[#999]">At</span>
                        <select
                            className="px-1.5 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={hour}
                            onChange={e => setHour(parseInt(e.target.value, 10))}
                            data-testid="prompt-hour-select"
                        >
                            {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                            ))}
                        </select>
                        <span className="text-[#616161] dark:text-[#999]">:</span>
                        <select
                            className="px-1.5 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={minute}
                            onChange={e => setMinute(parseInt(e.target.value, 10))}
                            data-testid="prompt-minute-select"
                        >
                            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Hourly minute picker */}
                {preset === 'hourly' && (
                    <div className="flex items-center gap-2 text-xs" data-testid="prompt-minute-picker">
                        <span className="text-[#616161] dark:text-[#999]">At minute</span>
                        <select
                            className="px-1.5 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                            value={minute}
                            onChange={e => setMinute(parseInt(e.target.value, 10))}
                            data-testid="prompt-hourly-minute-select"
                        >
                            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Day picker for weekly */}
                {showDayPicker && (
                    <div className="flex flex-wrap gap-1" data-testid="prompt-day-picker">
                        {WEEKDAY_CHIPS.map(d => (
                            <button
                                key={d.value}
                                type="button"
                                className={cn(
                                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                                    dayOfWeek === d.value
                                        ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4] font-medium'
                                        : 'border-[#d0d0d0] dark:border-[#555] text-[#616161] dark:text-[#999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
                                )}
                                onClick={() => setDayOfWeek(d.value)}
                                data-testid={`prompt-day-${d.short.toLowerCase()}`}
                            >
                                {d.short}
                            </button>
                        ))}
                    </div>
                )}

                {/* Custom schedule trigger panel */}
                {preset === 'custom' && (
                    <div className="rounded border border-[#d0d0d0] dark:border-[#555] p-2" data-testid="prompt-custom-schedule">
                        <ScheduleTriggerPanel
                            mode={customTimingMode}
                            onModeChange={setCustomTimingMode}
                            intervalValue={customIntervalValue}
                            onIntervalValueChange={setCustomIntervalValue}
                            intervalUnit={customIntervalUnit}
                            onIntervalUnitChange={setCustomIntervalUnit}
                            cron={customCron}
                            onCronChange={setCustomCron}
                        />
                    </div>
                )}

                {/* Summary */}
                <div className="text-[11px] text-[#0078d4] dark:text-[#4fc3f7]" data-testid="prompt-schedule-summary">
                    {scheduleSummary} {modeSummary}
                </div>
            </div>

            {/* Additional options (collapsible) */}
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc]"
                    onClick={() => setOptionsOpen(o => !o)}
                    aria-expanded={optionsOpen}
                    data-testid="prompt-options-toggle"
                >
                    <span>{optionsOpen ? '▾' : '▸'}</span>
                    <span>Additional options</span>
                </button>

                {optionsOpen && (
                    <div className="flex flex-col gap-2 pl-3 border-l-2 border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="prompt-options-panel">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] text-[#616161] dark:text-[#999]">Output folder</span>
                            <input
                                className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                placeholder={defaultOutputFolder(workspaceId)}
                                value={outputFolder}
                                onChange={e => setOutputFolder(e.target.value)}
                                data-testid="prompt-output-folder"
                            />
                        </label>
                        <label className="flex items-center gap-2 text-xs">
                            <span className="text-[#616161] dark:text-[#999]">On failure</span>
                            <select
                                className="flex-1 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                                value={onFailure}
                                onChange={e => setOnFailure(e.target.value)}
                                data-testid="prompt-on-failure"
                            >
                                <option value="notify">Notify</option>
                                <option value="stop">Stop</option>
                            </select>
                        </label>
                    </div>
                )}
            </div>

            {/* Error */}
            {error && <div className="text-[10px] text-red-500" data-testid="prompt-form-error">{error}</div>}

            {/* Actions */}
            <div className="flex justify-end gap-1.5">
                <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
                <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    disabled={submitting || (!name.trim() || !instructions.trim())}
                    data-testid="prompt-submit-btn"
                >
                    {submitting ? (formMode === 'edit' ? 'Saving...' : 'Creating...') : (formMode === 'edit' ? 'Save' : 'Create')}
                </Button>
            </div>
        </form>
    );
}

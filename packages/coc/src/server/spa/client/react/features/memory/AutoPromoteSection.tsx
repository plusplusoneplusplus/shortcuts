import { useCallback, useEffect, useState } from 'react';
import type { MemoryStats } from './memoryApi';
import { getWorkspacePreferences, patchWorkspacePreferences, type PerRepoPrefsClient } from '../../hooks/preferences/preferencesApi';

type AutoPromoteMode = 'off' | 'threshold' | 'cron' | 'cron+threshold';

interface AutoPromoteSectionProps {
    repoId: string;
    enabled: boolean;
    stats: MemoryStats | null;
    onSaved: () => void;
}

interface AutoPromoteForm {
    mode: AutoPromoteMode;
    thresholdCount: number;
    minIntervalMinutes: number;
    cron: string;
    minScore: number;
    minRecallCount: number;
    minUniqueQueries: number;
}

const DEFAULT_FORM: AutoPromoteForm = {
    mode: 'off',
    thresholdCount: 25,
    minIntervalMinutes: 30,
    cron: '0 3 * * *',
    minScore: 0.75,
    minRecallCount: 3,
    minUniqueQueries: 2,
};

export function AutoPromoteSection({ repoId, enabled, stats, onSaved }: AutoPromoteSectionProps) {
    const [form, setForm] = useState<AutoPromoteForm>(DEFAULT_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const prefs = await getWorkspacePreferences(repoId).catch((): PerRepoPrefsClient => ({}));
            const auto = prefs.boundedMemory?.autoPromote;
            setForm({
                mode: auto?.mode ?? 'off',
                thresholdCount: auto?.thresholdCount ?? DEFAULT_FORM.thresholdCount,
                minIntervalMinutes: Math.round((auto?.minIntervalMs ?? DEFAULT_FORM.minIntervalMinutes * 60_000) / 60_000),
                cron: auto?.cron ?? DEFAULT_FORM.cron,
                minScore: auto?.gates?.minScore ?? DEFAULT_FORM.minScore,
                minRecallCount: auto?.gates?.minRecallCount ?? DEFAULT_FORM.minRecallCount,
                minUniqueQueries: auto?.gates?.minUniqueQueries ?? DEFAULT_FORM.minUniqueQueries,
            });
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load auto-promotion settings');
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    useEffect(() => { void load(); }, [load]);

    const update = <K extends keyof AutoPromoteForm>(key: K, value: AutoPromoteForm[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const current = await getWorkspacePreferences(repoId).catch((): PerRepoPrefsClient => ({}));
            await patchWorkspacePreferences(repoId, {
                boundedMemory: {
                    ...current.boundedMemory,
                    enabled,
                    autoPromote: {
                        mode: form.mode,
                        cron: form.cron,
                        thresholdCount: form.thresholdCount,
                        minIntervalMs: form.minIntervalMinutes * 60_000,
                        gates: {
                            minScore: form.minScore,
                            minRecallCount: form.minRecallCount,
                            minUniqueQueries: form.minUniqueQueries,
                        },
                    },
                },
            });
            onSaved();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to save auto-promotion settings');
        } finally {
            setSaving(false);
        }
    };

    const autoStatus = stats?.autoPromote;

    return (
        <section
            className="mb-3 rounded border border-[#d7d7d7] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-3"
            data-testid="auto-promote-section"
        >
            <div className="flex items-start gap-3">
                <div className="flex-1">
                    <h4 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        Automatic promotion
                    </h4>
                    <p className="mt-0.5 text-xs text-[#616161] dark:text-[#999]">
                        Opt-in background promotion for captured memory candidates. Manual promotion stays available.
                    </p>
                </div>
                {autoStatus?.lastSkipReason && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
                        Last skip: {autoStatus.lastSkipReason}
                    </span>
                )}
            </div>

            {loading ? (
                <div className="mt-3 text-xs text-[#848484]">Loading…</div>
            ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Mode
                        <select
                            value={form.mode}
                            onChange={event => update('mode', event.target.value as AutoPromoteMode)}
                            disabled={!enabled}
                            className="mt-1 w-full px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="auto-promote-mode"
                        >
                            <option value="off">Off</option>
                            <option value="threshold">Threshold</option>
                            <option value="cron">Cron</option>
                            <option value="cron+threshold">Cron + threshold</option>
                        </select>
                    </label>
                    <NumberField label="Threshold" value={form.thresholdCount} min={1} disabled={!enabled || form.mode === 'off' || form.mode === 'cron'} onChange={value => update('thresholdCount', value)} testId="auto-promote-threshold" />
                    <NumberField label="Min interval (min)" value={form.minIntervalMinutes} min={0} disabled={!enabled || form.mode === 'off'} onChange={value => update('minIntervalMinutes', value)} testId="auto-promote-interval" />
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Cron
                        <input
                            value={form.cron}
                            onChange={event => update('cron', event.target.value)}
                            disabled={!enabled || form.mode === 'off' || form.mode === 'threshold'}
                            className="mt-1 w-full px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="auto-promote-cron"
                        />
                    </label>
                    <NumberField label="Min score" value={form.minScore} min={0} max={1} step={0.01} disabled={!enabled || form.mode === 'off'} onChange={value => update('minScore', value)} testId="auto-promote-min-score" />
                    <NumberField label="Min recalls" value={form.minRecallCount} min={1} disabled={!enabled || form.mode === 'off'} onChange={value => update('minRecallCount', value)} testId="auto-promote-min-recalls" />
                    <NumberField label="Min unique queries" value={form.minUniqueQueries} min={1} disabled={!enabled || form.mode === 'off'} onChange={value => update('minUniqueQueries', value)} testId="auto-promote-min-unique" />
                    <div className="flex items-end justify-end">
                        <button
                            type="button"
                            onClick={save}
                            disabled={!enabled || saving}
                            className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid="auto-promote-save"
                        >
                            {saving ? 'Saving…' : 'Save auto-promotion'}
                        </button>
                    </div>
                </div>
            )}

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#848484]">
                <span>Pending: {stats?.pendingRawCount ?? 0}</span>
                <span>Last trigger: {autoStatus?.lastTrigger ?? 'none'}</span>
                <span>Last run: {autoStatus?.lastAutoRunAt ? new Date(autoStatus.lastAutoRunAt).toLocaleString() : 'never'}</span>
                <span>Next run: {autoStatus?.nextRunAt ? new Date(autoStatus.nextRunAt).toLocaleString() : 'not scheduled'}</span>
            </div>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </section>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    step,
    disabled,
    onChange,
    testId,
}: {
    label: string;
    value: number;
    min: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    testId: string;
}) {
    return (
        <label className="text-xs text-[#616161] dark:text-[#999]">
            {label}
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={event => onChange(Number(event.target.value))}
                className="mt-1 w-full px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                data-testid={testId}
            />
        </label>
    );
}

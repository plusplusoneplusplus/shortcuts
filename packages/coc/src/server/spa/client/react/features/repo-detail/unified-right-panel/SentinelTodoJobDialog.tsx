import { useId, useState } from 'react';
import type { CocClient, SentinelScheduledJob, SentinelScheduledJobInput } from '@plusplusoneplusplus/coc-client';
import { useProviderModels, type AgentProvider } from '../../../hooks/useProviderModels';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { SCRUB_CRON_PRESETS, validateScrubCron } from '../../../../../../schedule/scrub-cron';
import { describeCron } from '../../../utils/cron';

const INPUT = 'w-full min-w-0 rounded border border-[#e0e0e0] bg-transparent px-2 py-1 text-xs dark:border-[#3c3c3c]';
type Draft = {
    name: string; instructions: string; provider: AgentProvider; model: string; effort: string;
    mode: 'ask' | 'autopilot'; cron: string; enabled: boolean; threshold: string;
};
function concreteProvider(value?: string): AgentProvider {
    return value === 'codex' || value === 'claude' || value === 'opencode' ? value : 'copilot';
}
export function SentinelTodoJobDialog({ job, client, baseUrl, busy, error, onSave, onClose }: {
    job?: SentinelScheduledJob; client: CocClient; baseUrl?: string; busy: boolean; error: string | null;
    onSave: (input: SentinelScheduledJobInput) => Promise<boolean>; onClose: () => void;
}) {
    const id = useId();
    const [draft, setDraft] = useState<Draft>(() => ({
        name: job?.name ?? '', instructions: job?.instructions ?? '', provider: concreteProvider(job?.provider),
        model: job?.model ?? '', effort: job?.effort ?? '', mode: job?.mode ?? 'ask',
        cron: job?.cron ?? '', enabled: job?.enabled ?? true, threshold: String(job?.autoCompactThreshold ?? 100_000),
    }));
    const { models, loading, error: modelError, reload } = useProviderModels(draft.provider, { baseUrl, client });
    const cronError = draft.cron.trim() ? validateScrubCron(draft.cron) : undefined;
    const threshold = Number(draft.threshold);
    const thresholdError = !Number.isSafeInteger(threshold) || threshold <= 0;
    const valid = !!draft.name.trim() && !!draft.instructions.trim() && !!draft.model.trim() && !cronError && !thresholdError;
    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
    const save = () => onSave({
        name: draft.name.trim(), instructions: draft.instructions.trim(), provider: draft.provider,
        model: draft.model.trim(), effort: draft.effort, mode: draft.mode, cron: draft.cron.trim(),
        enabled: draft.enabled, autoCompactThreshold: threshold,
    });
    return <Dialog open title={job ? 'Edit job' : 'New job'} trapFocus disableClose={busy} onClose={() => { if (!busy) onClose(); }}>
        <form aria-label={job ? 'Edit job' : 'New job'} className="flex min-w-0 flex-col gap-2" onSubmit={event => { event.preventDefault(); if (valid && !busy) void save(); }}>
            <label htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} data-dialog-initial-focus className={INPUT} value={draft.name} maxLength={120} required disabled={busy}
                onChange={event => update('name', event.target.value)} />
            <label htmlFor={`${id}-instructions`}>Instructions</label>
            <textarea id={`${id}-instructions`} className={`${INPUT} min-h-[100px]`} value={draft.instructions} maxLength={32_000} required disabled={busy}
                onChange={event => update('instructions', event.target.value)} />
            <p className="text-xs text-[#616161] dark:text-[#9d9d9d]">Each run receives a fresh read-only To-do snapshot by file path. Sentinel reviews the result and updates its list.</p>
            <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor={`${id}-provider`}>Provider</label>
                    <select id={`${id}-provider`} className={INPUT} value={draft.provider} disabled={busy}
                        onChange={event => setDraft(previous => ({ ...previous, provider: concreteProvider(event.target.value), model: '', effort: '' }))}>
                        <option value="copilot">Copilot</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option>
                    </select></div>
                <div><label htmlFor={`${id}-model`}>Model</label>
                    <input id={`${id}-model`} className={INPUT} list={`${id}-models`} value={draft.model} required maxLength={200} disabled={busy}
                        placeholder={loading ? 'Loading models...' : 'Model ID'} onChange={event => update('model', event.target.value)} />
                    <datalist id={`${id}-models`}>{models.filter(model => model.enabled).map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
                <div><label htmlFor={`${id}-effort`}>Effort</label>
                    <select id={`${id}-effort`} className={INPUT} value={draft.effort} disabled={busy} onChange={event => update('effort', event.target.value)}>
                        <option value="">Provider default</option>{['low', 'medium', 'high', 'xhigh', 'max'].map(effort => <option key={effort} value={effort}>{effort}</option>)}
                    </select></div>
                <div><label htmlFor={`${id}-mode`}>Mode</label>
                    <select id={`${id}-mode`} className={INPUT} value={draft.mode} disabled={busy}
                        onChange={event => update('mode', event.target.value === 'autopilot' ? 'autopilot' : 'ask')}>
                        <option value="ask">Ask</option><option value="autopilot">Autopilot</option>
                    </select></div>
            </div>
            {modelError && <p role="alert" className="text-xs">Could not load models: {modelError} <Button size="sm" variant="secondary" onClick={reload}>Retry models</Button></p>}
            {draft.mode === 'autopilot' && <p role="status" className="rounded bg-[#e8912d]/15 p-2 text-xs text-[#b5650f] dark:text-[#cca700]">Autopilot can change files and run commands without waiting for approval. Use Ask for read-only jobs.</p>}
            <label htmlFor={`${id}-preset`}>Schedule preset</label>
            <select id={`${id}-preset`} className={INPUT} value={!draft.cron ? 'manual' : draft.cron === '0 * * * *' || SCRUB_CRON_PRESETS.some(preset => preset.cron === draft.cron) ? draft.cron : 'custom'}
                disabled={busy} onChange={event => { if (event.target.value !== 'custom') update('cron', event.target.value === 'manual' ? '' : event.target.value); }}>
                <option value="manual">Manual only</option><option value="0 * * * *">Every hour</option>
                {SCRUB_CRON_PRESETS.map(preset => <option key={preset.cron} value={preset.cron}>{preset.label}</option>)}
                <option value="custom">Custom cron</option>
            </select>
            <label htmlFor={`${id}-cron`}>Cron (optional, 5 fields, at most once an hour)</label>
            <input id={`${id}-cron`} className={INPUT} value={draft.cron} maxLength={200} disabled={busy}
                aria-invalid={!!cronError} aria-describedby={`${id}-cron-help`} placeholder="0 9 * * *" onChange={event => update('cron', event.target.value)} />
            <p id={`${id}-cron-help`} role={cronError ? 'alert' : undefined} className="text-xs">{cronError ?? (draft.cron ? describeCron(draft.cron) || draft.cron : 'Run now only')}. Owning server local time.</p>
            <label htmlFor={`${id}-threshold`}>Auto-compact threshold (tokens)</label>
            <input id={`${id}-threshold`} className={INPUT} type="number" min="1" step="1" required value={draft.threshold} disabled={busy}
                aria-invalid={thresholdError} onChange={event => update('threshold', event.target.value)} />
            {thresholdError && <p role="alert">Enter a positive whole number of tokens.</p>}
            <label className="text-xs"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => update('enabled', event.target.checked)} /> Enabled</label>
            {error && <p role="alert" className="text-xs text-[#c72e2e] dark:text-[#f48771]">{error}</p>}
            <div className="mt-2 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={!valid || busy}>{busy ? 'Saving...' : job ? 'Save job' : 'Create job'}</Button></div>
        </form>
    </Dialog>;
}

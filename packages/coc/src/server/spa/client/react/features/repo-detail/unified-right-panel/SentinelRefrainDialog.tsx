import { useId, useState } from 'react';
import type { CocClient, SentinelRefrain, SentinelRefrainInput } from '@plusplusoneplusplus/coc-client';
import { useProviderModels, type AgentProvider } from '../../../hooks/useProviderModels';
import { TIER_KEYS, useProviderEffortTiers, type EffortTierKey, type LocalEffortTiersMap } from '../../../hooks/useProviderEffortTiers';
import { resolveEffectiveTier } from '../../../utils/resolveEffortTier';
import { EffortTierSelector } from '../../chat/EffortTierSelector';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { SCRUB_CRON_PRESETS, validateScrubCron } from '../../../../../../schedule/scrub-cron';
import { describeCron } from '../../../utils/cron';
import { formatThresholdInput, parseThresholdInput } from '../../../utils/autoCompactThreshold';

const INPUT = 'w-full min-w-0 rounded border border-[#e0e0e0] bg-transparent px-2 py-1 text-xs dark:border-[#3c3c3c]';
type Draft = {
    name: string; instructions: string; provider: AgentProvider; model: string; effort: string; effortTier: EffortTierKey | '';
    mode: 'ask' | 'autopilot'; cron: string; enabled: boolean; threshold: string; gateScript: string;
};
function concreteProvider(value?: string): AgentProvider {
    return value === 'codex' || value === 'claude' || value === 'opencode' ? value : 'copilot';
}
function tierKey(value?: string): EffortTierKey | '' {
    return TIER_KEYS.find(key => key === value) ?? '';
}
/** Mirrors the composer: a stored tier, else the tier matching a legacy model/effort, else Medium. */
function desiredTier(draft: Draft, tiers: LocalEffortTiersMap): EffortTierKey {
    return draft.effortTier || TIER_KEYS.find(key => !!draft.model && tiers[key]?.model === draft.model
        && (tiers[key]?.reasoningEffort ?? '') === draft.effort) || 'medium';
}
/**
 * `effortLevelsEnabled` is the owning server's flag. With it on and tiers configured for the
 * provider, the job stores a shared effort tier the owning server resolves at each run;
 * otherwise it keeps the explicit model and reasoning effort.
 */
export function SentinelRefrainDialog({ job, client, baseUrl, effortLevelsEnabled, busy, error, onSave, onClose }: {
    job?: SentinelRefrain; client: CocClient; baseUrl?: string; effortLevelsEnabled: boolean; busy: boolean; error: string | null;
    onSave: (input: SentinelRefrainInput) => Promise<boolean>; onClose: () => void;
}) {
    const id = useId();
    const [draft, setDraft] = useState<Draft>(() => ({
        name: job?.name ?? '', instructions: job?.instructions ?? '', provider: concreteProvider(job?.provider),
        model: job?.model ?? '', effort: job?.effort ?? '', effortTier: tierKey(job?.effortTier), mode: job?.mode ?? 'ask',
        cron: job?.cron ?? '', enabled: job?.enabled ?? true, threshold: formatThresholdInput(job?.autoCompactThreshold ?? 100_000),
        gateScript: job?.gateScript ?? '',
    }));
    const { models, loading, error: modelError, reload } = useProviderModels(draft.provider, { baseUrl, client });
    const { tiers, loading: tiersLoading } = useProviderEffortTiers(draft.provider, baseUrl, client);
    const hasTiers = (['low', 'medium', 'high'] as const).some(key => !!tiers[key]?.model);
    const tierMode = effortLevelsEnabled && (tiersLoading || hasTiers);
    const selectedTier = resolveEffectiveTier(desiredTier(draft, tiers), tiers);
    const aiValid = tierMode ? !tiersLoading && !!tiers[selectedTier]?.model : !!draft.model.trim();
    const cronError = draft.cron.trim() ? validateScrubCron(draft.cron) : undefined;
    const threshold = parseThresholdInput(draft.threshold);
    const thresholdError = threshold === undefined;
    const gateError = draft.gateScript.trim() && !draft.cron.trim() ? 'A gate script needs a cron schedule.' : undefined;
    const valid = !!draft.name.trim() && !!draft.instructions.trim() && aiValid && !cronError && !thresholdError && !gateError;
    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
    const save = () => onSave({
        name: draft.name.trim(), instructions: draft.instructions.trim(), provider: draft.provider,
        // The server drops model/effort for a tier; an empty tier clears a stored one.
        ...(tierMode ? { effortTier: selectedTier } : { model: draft.model.trim(), effort: draft.effort, effortTier: '' }), mode: draft.mode, cron: draft.cron.trim(),
        enabled: draft.enabled, autoCompactThreshold: threshold,
        // Sent as typed so an unchanged script keeps its gate state; blank clears the gate.
        gateScript: draft.gateScript.trim() ? draft.gateScript : '',
    });
    return <Dialog open title={job ? 'Edit refrain' : 'New refrain'} trapFocus disableClose={busy} onClose={() => { if (!busy) onClose(); }}>
        <form aria-label={job ? 'Edit refrain' : 'New refrain'} className="flex min-w-0 flex-col gap-2" onSubmit={event => { event.preventDefault(); if (valid && !busy) void save(); }}>
            <label htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} data-dialog-initial-focus className={INPUT} value={draft.name} maxLength={120} required disabled={busy}
                onChange={event => update('name', event.target.value)} />
            <label htmlFor={`${id}-instructions`}>Instructions</label>
            <textarea id={`${id}-instructions`} className={`${INPUT} min-h-[100px]`} value={draft.instructions} maxLength={32_000} required disabled={busy}
                onChange={event => update('instructions', event.target.value)} />
            <p className="text-xs text-[#616161] dark:text-[#9d9d9d]">Each run receives your instructions and the current gate result, when configured. Coda handles automatic To-do review.</p>
            <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor={`${id}-provider`}>Provider</label>
                    <select id={`${id}-provider`} className={INPUT} value={draft.provider} disabled={busy}
                        onChange={event => setDraft(previous => ({ ...previous, provider: concreteProvider(event.target.value), model: '', effort: '', effortTier: '' }))}>
                        <option value="copilot">Copilot</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option>
                    </select></div>
                {tierMode ? <div><span id={`${id}-tier`}>Effort tier</span>
                    <div role="group" aria-labelledby={`${id}-tier`}>
                        <EffortTierSelector
                            settingsBaseUrl={baseUrl} provider={draft.provider} tiers={tiers} selectedTier={selectedTier} disabled={busy || tiersLoading}
                            onChange={tier => update('effortTier', tier)} data-testid="sentinel-refrain-effort-tier" />
                    </div></div> : <>
                <div><label htmlFor={`${id}-model`}>Model</label>
                    <input id={`${id}-model`} className={INPUT} list={`${id}-models`} value={draft.model} required maxLength={200} disabled={busy}
                        placeholder={loading ? 'Loading models...' : 'Model ID'} onChange={event => update('model', event.target.value)} />
                    <datalist id={`${id}-models`}>{models.filter(model => model.enabled).map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></div>
                <div><label htmlFor={`${id}-effort`}>Effort</label>
                    <select id={`${id}-effort`} className={INPUT} value={draft.effort} disabled={busy} onChange={event => update('effort', event.target.value)}>
                        <option value="">Provider default</option>{['low', 'medium', 'high', 'xhigh'].map(effort => <option key={effort} value={effort}>{effort}</option>)}
                    </select></div></>}
                <div><label htmlFor={`${id}-mode`}>Mode</label>
                    <select id={`${id}-mode`} className={INPUT} value={draft.mode} disabled={busy}
                        onChange={event => update('mode', event.target.value === 'autopilot' ? 'autopilot' : 'ask')}>
                        <option value="ask">Ask</option><option value="autopilot">Autopilot</option>
                    </select></div>
            </div>
            {!tierMode && modelError && <p role="alert" className="text-xs">Could not load models: {modelError} <Button size="sm" variant="secondary" onClick={reload}>Retry models</Button></p>}
            {draft.mode === 'autopilot' && <p role="status" className="rounded bg-[#e8912d]/15 p-2 text-xs text-[#b5650f] dark:text-[#cca700]">Autopilot can change files and run commands without waiting for approval. Use Ask for read-only refrains.</p>}
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
            <label htmlFor={`${id}-threshold`}>Auto-compact threshold (K tokens)</label>
            <span className="inline-flex w-40 max-w-full min-w-0 items-center rounded border border-[#e0e0e0] dark:border-[#3c3c3c]">
                <input id={`${id}-threshold`} className={`${INPUT} border-0 text-right tabular-nums`} type="text" inputMode="decimal"
                    required value={draft.threshold} disabled={busy} aria-invalid={thresholdError} aria-describedby={`${id}-threshold-help`}
                    onChange={event => update('threshold', event.target.value)} />
                <span aria-hidden="true" className="pr-2 text-xs text-[#616161] dark:text-[#9d9d9d]">K</span>
            </span>
            <p id={`${id}-threshold-help`} role={thresholdError ? 'alert' : undefined} className="text-xs">
                {thresholdError ? 'Enter a positive K value, up to 3 decimals, within the safe integer token range.'
                    : '1K = 1,000 tokens; up to 3 decimals.'}
            </p>
            <label htmlFor={`${id}-gate`}>Gate script (optional)</label>
            <textarea id={`${id}-gate`} className={`${INPUT} min-h-[80px] font-mono`} value={draft.gateScript} maxLength={32_000} disabled={busy}
                spellCheck={false} aria-invalid={!!gateError} aria-describedby={`${id}-gate-help`} placeholder="return items.length ? { items } : null;"
                onChange={event => update('gateScript', event.target.value)} />
            <p id={`${id}-gate-help`} role={gateError ? 'alert' : undefined} className="text-xs">{gateError
                ?? 'Async JS body run before scheduled runs and Run now with tools and state (its previous result). Return a non-empty JSON value to start a run with it in the prompt; null, false, "", [] or {} skips. Empty results skip both scheduled runs and Run now.'}</p>
            <label className="text-xs"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => update('enabled', event.target.checked)} /> Enabled</label>
            {error && <p role="alert" className="text-xs text-[#c72e2e] dark:text-[#f48771]">{error}</p>}
            <div className="mt-2 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={!valid || busy}>{busy ? 'Saving...' : job ? 'Save refrain' : 'Create refrain'}</Button></div>
        </form>
    </Dialog>;
}

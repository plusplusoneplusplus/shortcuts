/**
 * Sentinel auto-compact section of the context-usage popover.
 *
 * The draft (switch + threshold) is held by `useSentinelAutoCompact` in the
 * chat, so closing the popover keeps unsaved edits. Saving writes through the
 * conversation's clone-routed client; the owning server runs the check after
 * each persisted response and the compaction itself, so nothing here
 * compacts or depends on this tab staying open.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
    AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES,
    AUTO_COMPACT_THRESHOLD_DEFAULT,
    AUTO_COMPACT_THRESHOLD_MAX,
    AUTO_COMPACT_THRESHOLD_MIN,
    AUTO_COMPACT_THRESHOLD_STEP,
    type CocClient,
    type ProcessAutoCompactState,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { cn } from '../../ui/cn';
import { formatTokenCount, type ContextAutoCompact, type ContextAutoCompactStatus } from '../../ui/ContextUsagePopover';

interface CompactionRecord { state?: string; taskId?: string; error?: string }

/** Pill status from the saved state and the conversation's compaction record. */
export function deriveAutoCompactStatus(state: ProcessAutoCompactState | undefined, compaction: CompactionRecord | undefined): ContextAutoCompactStatus {
    if (!state?.enabled) return 'off';
    if (state.taskId && compaction?.taskId === state.taskId && (compaction.state === 'queued' || compaction.state === 'running')) {
        return compaction.state;
    }
    return state.paused ? 'paused' : 'enabled';
}

export function parseThresholdInput(value: string): number | undefined {
    if (!/^\d+$/.test(value.trim())) return undefined;
    const pct = Number(value);
    return pct >= AUTO_COMPACT_THRESHOLD_MIN && pct <= AUTO_COMPACT_THRESHOLD_MAX && pct % AUTO_COMPACT_THRESHOLD_STEP === 0 ? pct : undefined;
}

const RUNNING_NOTE = 'A running compaction can’t be cancelled. Codex stops after 120s; Copilot and Claude have no time limit.';

/** One-line description of the runtime state, or `undefined` when there is nothing to say. */
export function describeAutoCompact(state: ProcessAutoCompactState | undefined, status: ContextAutoCompactStatus, pct: number | undefined): string | undefined {
    if (!state?.enabled) return undefined;
    if (status === 'queued') return 'Auto-compact queued — runs after earlier messages.';
    if (status === 'running') return `Compacting in the background. ${RUNNING_NOTE}`;
    const last = state.lastResult;
    if (state.paused?.reason === 'unsupported') return 'Paused: this provider doesn’t support compaction.';
    if (state.paused) {
        return `Paused after ${AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES} unsuccessful attempts${last?.error ? ` (${last.error})` : ''}.`;
    }
    if (pct === undefined) return 'Context usage isn’t reported yet; the threshold applies once it is.';
    switch (last?.outcome) {
        case 'succeeded': {
            const freed = last.tokensBefore !== undefined && last.tokensAfter !== undefined ? last.tokensBefore - last.tokensAfter : undefined;
            return `Last auto-compact succeeded${freed !== undefined ? ` — freed ~${formatTokenCount(Math.max(0, freed))} tokens` : ''}.`;
        }
        case 'insufficient': return 'Last auto-compact freed too little. Tries again after the next response.';
        case 'failed': return `Last auto-compact failed${last.error ? `: ${last.error}` : ''}. Tries again after the next response.`;
        case 'cancelled': return 'Queued auto-compact was cancelled. Checks again after the next response.';
        default: return undefined;
    }
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export interface AutoCompactPanelProps {
    state: ProcessAutoCompactState | undefined;
    status: ContextAutoCompactStatus;
    tokenLimit: number;
    usedPercent: number | undefined;
    draftEnabled: boolean;
    draftThreshold: string;
    dirty: boolean;
    saveState: SaveState;
    actionError?: string;
    onDraftChange: (draft: { enabled?: boolean; threshold?: string }) => void;
    onSave: () => void;
    onDiscard: () => void;
    onCancelQueued: () => void;
    onResume: () => void;
}

export function AutoCompactPanel(props: AutoCompactPanelProps) {
    const { state, status, tokenLimit, usedPercent, draftEnabled, draftThreshold, dirty, saveState, actionError } = props;
    const threshold = parseThresholdInput(draftThreshold);
    const invalid = threshold === undefined;
    const sliderValue = threshold ?? Number(state?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_DEFAULT);
    const runtime = describeAutoCompact(state, status, usedPercent);
    const ids = useId();
    const headingId = `${ids}-heading`;
    const saveStatusId = `${ids}-save-status`;
    const saveMessage = invalid
        ? `Use ${AUTO_COMPACT_THRESHOLD_MIN}–${AUTO_COMPACT_THRESHOLD_MAX}% in steps of ${AUTO_COMPACT_THRESHOLD_STEP}.`
        : saveState.kind === 'saving' ? 'Saving…'
        : saveState.kind === 'saved' && !dirty ? 'Saved. Applies after the next response.'
        : saveState.kind === 'error' ? `Couldn’t save the setting: ${saveState.message}`
        : undefined;
    const overThreshold = draftEnabled && threshold !== undefined && usedPercent !== undefined && usedPercent > threshold && status === 'enabled' && !dirty;

    return (
        <section
            aria-label="Auto-compact for this Sentinel chat"
            data-testid="auto-compact-panel"
            className="mt-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
            onKeyDown={event => { if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && dirty && !invalid) props.onSave(); }}
        >
            <div className="flex items-center justify-between gap-2">
                <span id={headingId} className="font-medium">Auto-compact · this Sentinel chat</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={draftEnabled}
                    aria-labelledby={headingId}
                    data-testid="auto-compact-switch"
                    onClick={() => props.onDraftChange({ enabled: !draftEnabled })}
                    className={cn('relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#0078d4]',
                        draftEnabled ? 'bg-[#0078d4] dark:bg-[#3794ff]' : 'bg-[#c8c8c8] dark:bg-[#5a5a5a]')}
                >
                    <span aria-hidden="true" className={cn('inline-block h-3 w-3 rounded-full bg-white transition-transform', draftEnabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
                </button>
            </div>
            <p className="mt-1 text-[#848484] dark:text-[#999999]">
                After a response, compact in the background when total context exceeds the threshold.
            </p>
            <div className={cn('mt-2 flex flex-wrap items-center gap-x-2 gap-y-1', !draftEnabled && 'opacity-60')}>
                <input
                    type="range"
                    min={AUTO_COMPACT_THRESHOLD_MIN}
                    max={AUTO_COMPACT_THRESHOLD_MAX}
                    step={AUTO_COMPACT_THRESHOLD_STEP}
                    value={sliderValue}
                    disabled={!draftEnabled}
                    aria-label="Auto-compact threshold"
                    aria-valuetext={`${sliderValue}% of the context limit`}
                    data-testid="auto-compact-slider"
                    onChange={event => props.onDraftChange({ threshold: event.target.value })}
                    className="flex-1 min-w-[96px] accent-[#0078d4]"
                />
                <span className="inline-flex items-center gap-0.5">
                    <input
                        type="number"
                        inputMode="numeric"
                        min={AUTO_COMPACT_THRESHOLD_MIN}
                        max={AUTO_COMPACT_THRESHOLD_MAX}
                        step={AUTO_COMPACT_THRESHOLD_STEP}
                        value={draftThreshold}
                        disabled={!draftEnabled}
                        aria-label="Auto-compact threshold percent"
                        aria-invalid={invalid || undefined}
                        aria-describedby={saveStatusId}
                        data-testid="auto-compact-input"
                        onChange={event => props.onDraftChange({ threshold: event.target.value })}
                        className={cn('w-12 px-1 py-0.5 rounded-sm border bg-white dark:bg-[#252526] tabular-nums text-right',
                            invalid ? 'border-[#f14c4c]' : 'border-[#c8c8c8] dark:border-[#3c3c3c]')}
                    />
                    <span aria-hidden="true">%</span>
                </span>
                <span className="w-full text-[#848484] dark:text-[#999999] tabular-nums" data-testid="auto-compact-token-equivalent">
                    ≈ {formatTokenCount(Math.round(tokenLimit * sliderValue / 100))} of {formatTokenCount(tokenLimit)} tokens
                </span>
            </div>
            {dirty && (
                <div className="mt-2 flex items-center gap-2">
                    <button type="button" data-testid="auto-compact-save" disabled={invalid || saveState.kind === 'saving'} onClick={props.onSave}
                        className="px-2 py-0.5 rounded-sm bg-[#0078d4] text-white disabled:opacity-50">Save</button>
                    <button type="button" data-testid="auto-compact-discard" disabled={saveState.kind === 'saving'} onClick={props.onDiscard}
                        className="px-2 py-0.5 rounded-sm border border-[#c8c8c8] dark:border-[#3c3c3c]">Discard</button>
                </div>
            )}
            <p id={saveStatusId} role="status" aria-live="polite" data-testid="auto-compact-save-status"
                className={cn('mt-1 min-h-[1em]', (invalid || saveState.kind === 'error') ? 'text-[#f14c4c] dark:text-[#f48771]' : 'text-[#848484] dark:text-[#999999]')}>
                {saveMessage}
            </p>
            <div role="status" aria-live="polite" data-testid="auto-compact-runtime" data-status={status}
                className={cn('mt-1 flex flex-wrap items-center gap-2', status === 'paused' ? 'text-[#f14c4c] dark:text-[#f48771]' : 'text-[#5a5a5a] dark:text-[#999999]')}>
                {overThreshold && <span>Over the threshold — checked again after the next response.</span>}
                {runtime && <span>{runtime}</span>}
                {status === 'queued' && (
                    <button type="button" data-testid="auto-compact-cancel" onClick={props.onCancelQueued}
                        className="px-2 py-0.5 rounded-sm border border-[#c8c8c8] dark:border-[#3c3c3c]">Cancel</button>
                )}
                {status === 'paused' && (
                    <button type="button" data-testid="auto-compact-resume" onClick={props.onResume}
                        className="px-2 py-0.5 rounded-sm border border-[#c8c8c8] dark:border-[#3c3c3c]">Resume</button>
                )}
                {actionError && <span className="text-[#f14c4c] dark:text-[#f48771]">{actionError}</span>}
            </div>
        </section>
    );
}

const STATUS_LABEL: Record<ContextAutoCompactStatus, string> = {
    off: 'auto-compact off',
    enabled: 'auto-compact on',
    queued: 'auto-compact queued',
    running: 'auto-compacting',
    paused: 'auto-compact paused',
};

/**
 * Popover state for a Sentinel chat. Returns `undefined` for other chats so
 * they render no auto-compact controls.
 */
export function useSentinelAutoCompact({ isSentinel, processId, workspaceId, client, metadata, usedTokens, tokenLimit, onState, onCancelQueued }: {
    isSentinel: boolean;
    processId: string | null | undefined;
    workspaceId: string | undefined;
    client: CocClient;
    metadata: { autoCompact?: ProcessAutoCompactState; compaction?: CompactionRecord } | undefined;
    usedTokens: number | undefined;
    tokenLimit: number | undefined;
    /** Merge a saved state into the chat's process record. */
    onState: (state: ProcessAutoCompactState) => void;
    onCancelQueued: () => Promise<void>;
}): ContextAutoCompact | undefined {
    const state = metadata?.autoCompact;
    const savedEnabled = state?.enabled ?? false;
    const savedThreshold = String(state?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_DEFAULT);
    const [draft, setDraft] = useState<{ enabled: boolean; threshold: string } | null>(null);
    const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
    const [actionError, setActionError] = useState<string>();

    // A different conversation starts clean.
    useEffect(() => { setDraft(null); setSaveState({ kind: 'idle' }); setActionError(undefined); }, [processId]);

    const enabled = draft?.enabled ?? savedEnabled;
    const threshold = draft?.threshold ?? savedThreshold;
    const dirty = draft !== null && (draft.enabled !== savedEnabled || draft.threshold !== savedThreshold);
    const query = workspaceId ? { workspace: workspaceId } : undefined;

    const save = useCallback(async () => {
        const pct = parseThresholdInput(threshold);
        if (!processId || pct === undefined) return;
        setSaveState({ kind: 'saving' });
        try {
            const { autoCompact } = await client.processes.updateAutoCompact(processId, { enabled, thresholdPercent: pct }, query);
            onState(autoCompact);
            setDraft(null);
            setSaveState({ kind: 'saved' });
        } catch (error) {
            setSaveState({ kind: 'error', message: getSpaCocClientErrorMessage(error, 'Request failed.') });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, processId, enabled, threshold, workspaceId, onState]);

    const resume = useCallback(async () => {
        if (!processId) return;
        setActionError(undefined);
        try {
            onState((await client.processes.resumeAutoCompact(processId, query)).autoCompact);
        } catch (error) {
            setActionError(`Couldn’t resume: ${getSpaCocClientErrorMessage(error, 'Request failed.')}`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, processId, workspaceId, onState]);

    const cancelQueued = useCallback(async () => {
        setActionError(undefined);
        try { await onCancelQueued(); } catch (error) {
            setActionError(`Couldn’t cancel: ${getSpaCocClientErrorMessage(error, 'Request failed.')}`);
        }
    }, [onCancelQueued]);

    const status = deriveAutoCompactStatus(state, metadata?.compaction);
    const limit = tokenLimit && tokenLimit > 0 ? tokenLimit : undefined;
    const usedPercent = limit !== undefined && typeof usedTokens === 'number' ? (usedTokens / limit) * 100 : undefined;

    return useMemo(() => {
        if (!isSentinel || !processId || limit === undefined) return undefined;
        return {
            status,
            thresholdPercent: state?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_DEFAULT,
            label: `${STATUS_LABEL[status]}${status !== 'off' ? ` at ${state?.thresholdPercent}%` : ''}`,
            panel: (
                <AutoCompactPanel
                    state={state}
                    status={status}
                    tokenLimit={limit}
                    usedPercent={usedPercent}
                    draftEnabled={enabled}
                    draftThreshold={threshold}
                    dirty={dirty}
                    saveState={saveState}
                    actionError={actionError}
                    onDraftChange={change => {
                        setSaveState(prev => prev.kind === 'error' || prev.kind === 'saved' ? { kind: 'idle' } : prev);
                        setDraft({ enabled: change.enabled ?? enabled, threshold: change.threshold ?? threshold });
                    }}
                    onSave={() => { void save(); }}
                    onDiscard={() => { setDraft(null); setSaveState({ kind: 'idle' }); }}
                    onCancelQueued={() => { void cancelQueued(); }}
                    onResume={() => { void resume(); }}
                />
            ),
        };
    }, [isSentinel, processId, limit, status, state, usedPercent, enabled, threshold, dirty, saveState, actionError, save, cancelQueued, resume]);
}

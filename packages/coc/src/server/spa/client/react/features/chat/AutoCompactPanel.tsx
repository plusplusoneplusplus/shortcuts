/**
 * Sentinel-only context controls. Drafts outlive the popover; writes are
 * serialized and bound to the exact conversation/workspace/client owner.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES,
    AUTO_COMPACT_THRESHOLD_DEFAULT,
    type CocClient,
    type ProcessAutoCompactState,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { cn } from '../../ui/cn';
import { formatTokenCount, type ContextAutoCompact, type ContextAutoCompactStatus } from '../../ui/ContextUsagePopover';

interface CompactionRecord { state?: string; taskId?: string; error?: string }

const RUNNING_DETAILS = 'Codex: 120s; Copilot/Claude: no overall deadline. Cancellation is queued-only.';

function validState(state: ProcessAutoCompactState | undefined): ProcessAutoCompactState | undefined {
    return state && typeof state === 'object' && !Array.isArray(state) && !('thresholdPercent' in state)
        && typeof state.enabled === 'boolean' && Number.isSafeInteger(state.thresholdTokens) && state.thresholdTokens > 0 ? state : undefined;
}

export function deriveAutoCompactStatus(state: ProcessAutoCompactState | undefined, compaction: CompactionRecord | undefined): ContextAutoCompactStatus {
    if (!validState(state)?.enabled) return 'off';
    if (state?.taskId && compaction?.taskId === state.taskId && (compaction.state === 'queued' || compaction.state === 'running')) return compaction.state;
    return state?.paused ? 'paused' : 'enabled';
}

/** k input accepts whole tokens (up to three decimal places), without rounding. */
export function parseThresholdInput(value: string): number | undefined {
    if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return undefined;
    const [whole, fraction = ''] = value.trim().split('.');
    const tokens = Number(`${whole}${fraction.padEnd(3, '0')}`);
    return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}

function formatThresholdInput(tokens: number): string {
    const remainder = tokens % 1000;
    return `${Math.floor(tokens / 1000)}${remainder ? `.${String(remainder).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}

export function describeAutoCompact(state: ProcessAutoCompactState | undefined, status: ContextAutoCompactStatus, usedTokens: number | undefined): string | undefined {
    if (!state?.enabled) return undefined;
    if (status === 'queued') return 'Queued after earlier messages.';
    if (status === 'running') return 'Compacting in the background...';
    const last = state.lastResult;
    if (state.paused?.reason === 'unsupported') return 'Paused: this provider does not support compaction.';
    if (state.paused) return `Paused after ${AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES} unsuccessful attempts${last?.error ? `: ${last.error}` : '.'}`;
    if (usedTokens === undefined) return 'Usage not reported yet; checks after a response once available.';
    switch (last?.outcome) {
        case 'succeeded': {
            const freed = last.tokensBefore !== undefined && last.tokensAfter !== undefined ? last.tokensBefore - last.tokensAfter : undefined;
            return `Auto-compacted${freed !== undefined ? ` · freed ~${formatTokenCount(Math.max(0, freed))} tokens` : ''}.`;
        }
        case 'insufficient': return 'Freed too little. Tries after the next response.';
        case 'failed': return `Failed${last.error ? `: ${last.error}` : '.'} Tries after the next response.`;
        case 'cancelled': return 'Queued compaction cancelled. Checks after the next response.';
        default: return undefined;
    }
}

type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };
type Draft = { enabled: boolean; threshold: string };

export interface AutoCompactPanelProps {
    state: ProcessAutoCompactState | undefined;
    status: ContextAutoCompactStatus;
    tokenLimit: number | undefined;
    usedTokens: number | undefined;
    draftEnabled: boolean;
    draftThreshold: string;
    dirty: boolean;
    saveState: SaveState;
    actionError?: string;
    configurationError?: boolean;
    actionPending?: boolean;
    onDraftChange: (draft: { enabled?: boolean; threshold?: string }) => void;
    onSave: () => void;
    onCancelQueued: () => void;
    onResume: () => void;
}

export function AutoCompactPanel(props: AutoCompactPanelProps) {
    const { state, status, tokenLimit, usedTokens, draftEnabled, draftThreshold, dirty, saveState, actionError } = props;
    const threshold = parseThresholdInput(draftThreshold);
    const invalid = threshold === undefined;
    const id = useId();
    const runtime = describeAutoCompact(state, status, usedTokens);
    const warning = tokenLimit === undefined ? 'Context limit unknown; this threshold may not fire before the window fills.'
        : threshold !== undefined && threshold >= tokenLimit ? 'Threshold meets/exceeds the context limit; it may not fire before the window fills.' : undefined;
    let message: string | undefined;
    if (invalid) message = 'Enter a positive k value, up to 3 decimals, within the safe token range.';
    else if (saveState.kind === 'error') message = `Could not save: ${saveState.message}`;
    else if (actionError) message = actionError;
    else if (saveState.kind === 'saving') message = 'Saving...';
    else if (props.configurationError) message = 'Stored threshold is invalid. Set a token threshold to configure this chat.';
    else if (status === 'queued' || status === 'running' || status === 'paused') message = runtime;
    else if (warning) message = warning;
    else if (dirty) message = 'Unsaved. Press Enter or leave the input to retry.';
    else if (runtime) message = runtime;
    else if (saveState.kind === 'saved') message = 'Saved. Checked after next response.';
    else if (draftEnabled) message = `Runs after a response goes over ${draftThreshold}k tokens.`;
    const error = invalid || saveState.kind === 'error' || !!actionError || props.configurationError;

    return (
        <section aria-label="Auto-compact for this Sentinel chat" data-testid="auto-compact-panel"
            className="mt-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]">
            <div className="flex items-center gap-2" data-testid="auto-compact-row">
                <button type="button" role="switch" aria-checked={draftEnabled} aria-label="Auto-compact"
                    data-testid="auto-compact-switch" onClick={() => props.onDraftChange({ enabled: !draftEnabled })}
                    className={cn('relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#0078d4]',
                        draftEnabled ? 'bg-[#0078d4] dark:bg-[#3794ff]' : 'bg-[#c8c8c8] dark:bg-[#5a5a5a]')}>
                    <span aria-hidden="true" className={cn('inline-block h-3 w-3 rounded-full bg-white transition-transform', draftEnabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
                </button>
                <label htmlFor={`${id}-input`} className="whitespace-nowrap">Auto-compact at</label>
                <span className={cn('inline-flex items-center rounded border bg-white dark:bg-[#252526]', !draftEnabled && 'opacity-60',
                    invalid ? 'border-[#f14c4c]' : 'border-[#c8c8c8] dark:border-[#3c3c3c]')}>
                    <input id={`${id}-input`} type="text" inputMode="decimal" value={draftThreshold} disabled={!draftEnabled}
                        aria-label="Auto-compact threshold in k tokens" aria-invalid={invalid || undefined} aria-describedby={`${id}-status`}
                        data-testid="auto-compact-input" onChange={event => props.onDraftChange({ threshold: event.target.value })}
                        onBlur={props.onSave} onKeyDown={event => {
                            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); props.onSave(); }
                        }}
                        className="w-12 min-w-0 px-1 py-0.5 bg-transparent text-right tabular-nums focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#0078d4]" />
                    <span aria-hidden="true" className="pr-1 text-[#848484] dark:text-[#999999]">k</span>
                </span>
            </div>
            <div id={`${id}-status`} role="status" aria-live="polite" data-testid="auto-compact-status" data-status={status}
                className={cn('mt-1 min-h-[1em] flex items-baseline gap-2', error ? 'text-[#f14c4c] dark:text-[#f48771]' : 'text-[#848484] dark:text-[#999999]')}>
                <span title={status === 'running' ? RUNNING_DETAILS : undefined}>{message}</span>
                {status === 'queued' && <button type="button" disabled={props.actionPending || saveState.kind === 'saving'} data-testid="auto-compact-cancel" onClick={props.onCancelQueued}
                    className="underline flex-shrink-0 disabled:opacity-50">Cancel</button>}
                {status === 'paused' && <button type="button" disabled={props.actionPending || saveState.kind === 'saving'} data-testid="auto-compact-resume" onClick={props.onResume}
                    className="underline flex-shrink-0 disabled:opacity-50">Resume</button>}
            </div>
        </section>
    );
}

const STATUS_LABEL: Record<ContextAutoCompactStatus, string> = {
    off: 'auto-compact off', enabled: 'auto-compact on', queued: 'auto-compact queued', running: 'auto-compacting', paused: 'auto-compact paused',
};

interface PanelSession {
    draft: Draft | null;
    saved: ProcessAutoCompactState | undefined;
    saveState: SaveState;
    actionError?: string;
    inFlight: boolean;
    commitPending: boolean;
    actionPending: boolean;
}

export function useSentinelAutoCompact({ isSentinel, processId, workspaceId, client, metadata, usedTokens, tokenLimit, onState, onCancelQueued }: {
    isSentinel: boolean;
    processId: string | null | undefined;
    workspaceId: string | undefined;
    client: CocClient;
    metadata: { autoCompact?: ProcessAutoCompactState; compaction?: CompactionRecord } | undefined;
    usedTokens: number | undefined;
    tokenLimit: number | undefined;
    onState: (state: ProcessAutoCompactState) => void;
    onCancelQueued: () => Promise<void>;
}): ContextAutoCompact | undefined {
    const session = useMemo<PanelSession>(() => ({ draft: null, saved: undefined, saveState: { kind: 'idle' },
        inFlight: false, commitPending: false, actionPending: false }), [client, processId, workspaceId, isSentinel]);
    const active = useRef<PanelSession>();
    active.current = session;
    const [, render] = useState(0);
    useEffect(() => {
        active.current = session;
        return () => { if (active.current === session) active.current = undefined; };
    }, [session]);
    session.saved = validState(metadata?.autoCompact);
    const draft = () => session.draft ?? { enabled: session.saved?.enabled ?? false, threshold: formatThresholdInput(session.saved?.thresholdTokens ?? AUTO_COMPACT_THRESHOLD_DEFAULT) };
    const dirty = () => !!session.draft && (session.draft.enabled !== (session.saved?.enabled ?? false)
        || parseThresholdInput(session.draft.threshold) !== (session.saved?.thresholdTokens ?? AUTO_COMPACT_THRESHOLD_DEFAULT));
    const notify = () => { if (active.current === session) render(value => value + 1); };
    const query = workspaceId ? { workspace: workspaceId } : undefined;

    async function save() {
        if (active.current !== session || !isSentinel || !processId) return;
        if (session.inFlight || session.actionPending) { session.commitPending = true; return; }
        const submitted = draft();
        // Turning off must remain possible even while the token draft is invalid.
        const tokens = parseThresholdInput(submitted.threshold)
            ?? (!submitted.enabled ? session.saved?.thresholdTokens ?? AUTO_COMPACT_THRESHOLD_DEFAULT : undefined);
        if (tokens === undefined || !dirty()
            || (session.saved?.enabled === submitted.enabled && session.saved.thresholdTokens === tokens)) return;
        session.inFlight = true;
        session.saveState = { kind: 'saving' };
        notify();
        try {
            const { autoCompact } = await client.processes.updateAutoCompact(processId, { enabled: submitted.enabled, thresholdTokens: tokens }, query);
            if (active.current !== session) return;
            session.saved = autoCompact;
            if (session.draft?.enabled === submitted.enabled && session.draft.threshold === submitted.threshold
                && parseThresholdInput(submitted.threshold) !== undefined) session.draft = null;
            session.saveState = { kind: 'saved' };
            onState(autoCompact);
        } catch (error) {
            if (active.current !== session) return;
            session.saveState = { kind: 'error', message: getSpaCocClientErrorMessage(error, 'Request failed.') };
            const latest = draft();
            // Duplicate Enter/blur never retries a failure, but a newer committed
            // setting still gets its own attempt.
            session.commitPending = session.commitPending && (latest.enabled !== submitted.enabled
                || parseThresholdInput(latest.threshold) !== parseThresholdInput(submitted.threshold));
        } finally {
            session.inFlight = false;
            notify();
        }
        if (session.commitPending && active.current === session) { session.commitPending = false; void save(); }
    }

    async function action(kind: 'resume' | 'cancel') {
        if (!processId || session.inFlight || session.actionPending || active.current !== session) return;
        session.actionPending = true;
        session.actionError = undefined;
        notify();
        try {
            if (kind === 'cancel') await onCancelQueued();
            else {
                const { autoCompact } = await client.processes.resumeAutoCompact(processId, query);
                if (active.current === session) onState(autoCompact);
            }
        } catch (error) {
            if (active.current === session) session.actionError = `Could not ${kind}: ${getSpaCocClientErrorMessage(error, 'Request failed.')}`;
        } finally { session.actionPending = false; notify(); }
        if (session.commitPending && active.current === session) { session.commitPending = false; void save(); }
    }

    if (!isSentinel || !processId) return undefined;
    const state = validState(metadata?.autoCompact);
    const status = deriveAutoCompactStatus(state, metadata?.compaction);
    const limit = typeof tokenLimit === 'number' && Number.isFinite(tokenLimit) && tokenLimit > 0 ? tokenLimit : undefined;
    const usage = typeof usedTokens === 'number' && Number.isFinite(usedTokens) && usedTokens >= 0 ? usedTokens : undefined;
    const current = draft();
    return {
        status,
        thresholdTokens: state?.thresholdTokens ?? AUTO_COMPACT_THRESHOLD_DEFAULT,
        label: `${STATUS_LABEL[status]}${status !== 'off' ? ` at ${formatThresholdInput(state?.thresholdTokens ?? AUTO_COMPACT_THRESHOLD_DEFAULT)}k tokens` : ''}`,
        panel: <AutoCompactPanel state={state} status={status} tokenLimit={limit} usedTokens={usage}
            draftEnabled={current.enabled} draftThreshold={current.threshold} dirty={dirty()} saveState={session.saveState}
            actionError={session.actionError} actionPending={session.actionPending} configurationError={!!metadata?.autoCompact && !state}
            onDraftChange={change => {
                const prior = draft();
                session.draft = { enabled: change.enabled ?? prior.enabled, threshold: change.threshold ?? prior.threshold };
                session.saveState = session.inFlight ? { kind: 'saving' } : { kind: 'idle' };
                notify();
                if (change.enabled !== undefined) void save();
            }}
            onSave={() => { void save(); }} onCancelQueued={() => { void action('cancel'); }} onResume={() => { void action('resume'); }} />,
    };
}

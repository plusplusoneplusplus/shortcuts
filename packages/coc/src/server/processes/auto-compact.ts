/**
 * Sentinel auto-compact: a per-conversation, opt-in threshold that compacts
 * the provider session in the background after a persisted assistant response
 * pushes total context usage strictly above the threshold.
 *
 * State lives at `metadata.autoCompact` (see `ProcessAutoCompactState`). The
 * check runs only from the lifecycle runner after a completed response, never
 * from UI timers or while a response streams. It admits the same durable
 * compaction task as `/compact` (forced onto the queue so it always runs in the
 * background), so ordering, restart recovery, dedupe and queued-only
 * cancellation are those of manual compaction. Running compactions keep the
 * provider's own lifecycle: Codex times out after 120s, Copilot and Claude
 * have no CoC-level deadline.
 */

import type { AIProcess, ConversationTurn, GenericProcessMetadata, ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import {
    AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES,
    type AutoCompactOutcome,
    type AutoCompactSettingsRequest,
    type ProcessAutoCompactState,
} from '@plusplusoneplusplus/coc-client';
import { normalizeChatMode } from '../tasks/task-types';
import { compactProcess, type CompactionQueueBridge } from './compact-process';
import { processOperationAdmission } from './process-operation-admission';
import { APIError } from '../errors';

export type AutoCompactSkipReason =
    | 'not-sentinel' | 'disabled' | 'paused' | 'no-response' | 'already-evaluated'
    | 'unknown-usage' | 'below-threshold' | 'already-compacting';

export type AutoCompactCheckResult =
    | { action: 'skipped'; reason: AutoCompactSkipReason }
    | { action: 'queued'; taskId?: string }
    | { action: 'failed'; error: string; settlementError?: string };

const UNSUPPORTED_STATE_ERROR = 'Unsupported auto-compact settings. Explicitly configure enabled and thresholdTokens with PUT before resuming.';

export function isSentinelProcess(proc: Pick<AIProcess, 'metadata'> | undefined): boolean {
    return normalizeChatMode(proc?.metadata?.mode) === 'sentinel';
}

export function readAutoCompact(metadata: GenericProcessMetadata | undefined): ProcessAutoCompactState | undefined {
    const value = metadata?.autoCompact as ProcessAutoCompactState | undefined;
    return value && typeof parseAutoCompactSettings(value) !== 'string' ? value : undefined;
}

/** Validates a settings body; returns an error message when invalid. */
export function parseAutoCompactSettings(body: unknown): AutoCompactSettingsRequest | string {
    const value = body as Partial<AutoCompactSettingsRequest> | undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'auto-compact settings must be an object';
    if (typeof value?.enabled !== 'boolean') return 'enabled must be a boolean';
    if ('thresholdPercent' in value) return 'thresholdPercent is unsupported; explicitly configure thresholdTokens';
    const tokens = value.thresholdTokens;
    if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens <= 0) {
        return 'thresholdTokens must be a finite positive safe integer';
    }
    return { enabled: value.enabled, thresholdTokens: tokens };
}

/** Total context-token usage, independent of the model's reported limit. */
export function contextUsageTokens(proc: Pick<AIProcess, 'currentTokens'>): number | undefined {
    const used = proc.currentTokens;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return undefined;
    return used;
}

function latestResponseTurn(turns: ConversationTurn[] | undefined): ConversationTurn | undefined {
    for (let i = (turns?.length ?? 0) - 1; i >= 0; i--) {
        const turn = turns![i];
        if (turn.role === 'assistant' && !turn.displayOnly) return turn.streaming ? undefined : turn;
    }
    return undefined;
}

function withAutoCompact(metadata: GenericProcessMetadata | undefined, autoCompact: ProcessAutoCompactState): GenericProcessMetadata {
    return { ...(metadata ?? { type: 'chat' }), autoCompact };
}

/**
 * Persist the user's setting. Any change re-arms a paused or failing state; a
 * save never triggers compaction by itself.
 */
export async function saveAutoCompactSettings(
    store: ProcessStore, processId: string, workspaceId: string | undefined, settings: AutoCompactSettingsRequest,
): Promise<ProcessAutoCompactState | undefined> {
    const parsed = parseAutoCompactSettings(settings);
    if (typeof parsed === 'string') throw new APIError(400, parsed, 'INVALID_AUTO_COMPACT_SETTINGS');
    return processOperationAdmission.runExclusive(processId, async () => {
        const proc = await store.getProcess(processId, workspaceId);
        if (!proc) return undefined;
        const prior = readAutoCompact(proc.metadata);
        const changed = !prior || prior.enabled !== parsed.enabled || prior.thresholdTokens !== parsed.thresholdTokens;
        const next: ProcessAutoCompactState = { ...prior, ...parsed, updatedAt: new Date().toISOString() };
        if (changed) {
            next.consecutiveFailures = 0;
            delete next.paused;
        }
        await store.updateProcess(proc.id, { metadata: withAutoCompact(proc.metadata, next) });
        return next;
    });
}

/** Clear a pause and its failure streak. The next response re-evaluates. */
export async function resumeAutoCompact(
    store: ProcessStore, processId: string, workspaceId: string | undefined,
): Promise<ProcessAutoCompactState | undefined> {
    return processOperationAdmission.runExclusive(processId, async () => {
        const proc = await store.getProcess(processId, workspaceId);
        const prior = readAutoCompact(proc?.metadata);
        if (proc?.metadata?.autoCompact !== undefined && !prior) {
            throw new APIError(409, UNSUPPORTED_STATE_ERROR, 'AUTO_COMPACT_UNSUPPORTED_STATE');
        }
        if (!proc || !prior) return prior;
        const next: ProcessAutoCompactState = { ...prior, consecutiveFailures: 0 };
        delete next.paused;
        await store.updateProcess(proc.id, { metadata: withAutoCompact(proc.metadata, next) });
        return next;
    });
}

/**
 * Apply a settled automatic attempt to the state. Success clears the streak;
 * failed or insufficient attempts extend it and pause at the limit; an
 * unsupported provider pauses at once; queued cancellation is the user's
 * choice and changes nothing else.
 */
export function settleAutoCompactState(
    state: ProcessAutoCompactState,
    outcome: AutoCompactOutcome,
    details: Omit<NonNullable<ProcessAutoCompactState['lastResult']>, 'outcome' | 'at'> = {},
): ProcessAutoCompactState {
    const at = new Date().toISOString();
    const next: ProcessAutoCompactState = { ...state, lastResult: { outcome, at, ...details } };
    delete next.taskId;
    if (outcome === 'succeeded') next.consecutiveFailures = 0;
    if (outcome === 'failed' || outcome === 'insufficient') {
        next.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
        if (next.consecutiveFailures >= AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES) next.paused = { reason: 'failures', at };
    }
    if (outcome === 'unsupported') next.paused = { reason: 'unsupported', at };
    return next;
}

/**
 * Metadata update for a cancelled queued compaction: settles the automatic
 * state when the cancelled task was the automatic one.
 */
export function autoCompactCancelledMetadata(metadata: GenericProcessMetadata, taskId: string): GenericProcessMetadata {
    const state = readAutoCompact(metadata);
    if (state?.taskId !== taskId) return metadata;
    return withAutoCompact(metadata, settleAutoCompactState(state, 'cancelled', { turnIndex: state.lastEvaluatedTurnIndex }));
}

/**
 * A recorded automatic task that is no longer queued or running (for example
 * a compaction interrupted by a restart) settles from its compaction record.
 */
function reconcileStaleAttempt(proc: AIProcess, state: ProcessAutoCompactState, bridge: CompactionQueueBridge): ProcessAutoCompactState {
    if (!state.taskId) return state;
    const own = proc.metadata?.compaction?.taskId === state.taskId ? proc.metadata.compaction : undefined;
    const status = bridge.getTask ? bridge.getTask(state.taskId)?.status : own?.state;
    if (status === 'queued' || status === 'running') return state;
    const outcome: AutoCompactOutcome = own?.state === 'completed' ? 'succeeded' : own?.state === 'cancelled' ? 'cancelled' : 'failed';
    return settleAutoCompactState(state, outcome, {
        turnIndex: state.lastEvaluatedTurnIndex,
        ...(own?.error ? { error: own.error } : {}),
    });
}

/**
 * Post-response check. Called only after a completed, persisted assistant
 * response. Claims the response atomically (`lastEvaluatedTurnIndex`) so each
 * response gets at most one automatic attempt across events, tabs and restarts.
 */
export async function maybeAutoCompactAfterResponse(
    store: ProcessStore, bridge: CompactionQueueBridge | undefined, processId: string, workspaceId?: string,
): Promise<AutoCompactCheckResult> {
    if (!bridge?.enqueue) return { action: 'skipped', reason: 'disabled' };
    const claim = await processOperationAdmission.runExclusive(processId, async (): Promise<AutoCompactCheckResult | AIProcess> => {
        const proc = await store.getProcess(processId, workspaceId);
        if (!proc || !isSentinelProcess(proc)) return { action: 'skipped', reason: 'not-sentinel' };
        const stored = readAutoCompact(proc.metadata);
        if (proc.metadata?.autoCompact !== undefined && !stored) {
            getLogger().warn(LogCategory.AI, `[AutoCompact] Check failed for ${proc.id}: ${UNSUPPORTED_STATE_ERROR}`);
            return { action: 'failed', error: UNSUPPORTED_STATE_ERROR };
        }
        if (!stored?.enabled) return { action: 'skipped', reason: 'disabled' };
        const state = reconcileStaleAttempt(proc, stored, bridge);
        const persist = (next: ProcessAutoCompactState) => store.updateProcess(proc.id, { metadata: withAutoCompact(proc.metadata, next) });
        if (state !== stored) await persist(state);
        if (state.paused) return { action: 'skipped', reason: 'paused' };
        const response = latestResponseTurn(proc.conversationTurns);
        if (!response) return { action: 'skipped', reason: 'no-response' };
        if ((state.lastEvaluatedTurnIndex ?? -1) >= response.turnIndex) return { action: 'skipped', reason: 'already-evaluated' };
        const tokens = contextUsageTokens(proc);
        if (tokens === undefined) return { action: 'skipped', reason: 'unknown-usage' };
        if (tokens <= state.thresholdTokens) return { action: 'skipped', reason: 'below-threshold' };
        const compaction = proc.metadata?.compaction;
        if (state.taskId || compaction?.state === 'queued' || compaction?.state === 'running' || bridge.findCompactionTask?.(proc.id)) {
            await persist({ ...state, lastEvaluatedTurnIndex: response.turnIndex });
            return { action: 'skipped', reason: 'already-compacting' };
        }
        const claimed: ProcessAutoCompactState = { ...state, lastEvaluatedTurnIndex: response.turnIndex };
        await persist(claimed);
        return { ...proc, metadata: withAutoCompact(proc.metadata, claimed) };
    });
    if ('action' in claim) return claim;
    try {
        const outcome = await compactProcess(store, claim, undefined, bridge, undefined, { trigger: 'auto' });
        return { action: 'queued', taskId: outcome.taskId };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
            await settleAutoCompaction(store, claim.id, undefined, { error: message });
        } catch (settleError) {
            const settlementError = settleError instanceof Error ? settleError.message : String(settleError);
            getLogger().warn(LogCategory.AI, `[AutoCompact] Failed to record admission outcome for ${claim.id}: ${settlementError}; original compaction error: ${message}`);
            return { action: 'failed', error: message, settlementError };
        }
        return { action: 'failed', error: message };
    }
}

/**
 * Settle an automatic compaction from its persisted compaction record and the
 * refreshed usage. `taskId` must match the recorded automatic task (omitted
 * only when admission itself failed). Insufficient means usage still strictly
 * exceeds the threshold after a completed compaction.
 */
export async function settleAutoCompaction(
    store: ProcessStore,
    processId: string,
    taskId: string | undefined,
    result: { unsupported?: boolean; error?: string; tokensBefore?: number },
): Promise<ProcessAutoCompactState | undefined> {
    return processOperationAdmission.runExclusive(processId, async () => {
        const proc = await store.getProcess(processId);
        const state = readAutoCompact(proc?.metadata);
        if (!proc || !state || (taskId !== undefined && state.taskId !== taskId)) return undefined;
        const compaction = proc.metadata?.compaction;
        const tokens = contextUsageTokens(proc);
        const succeeded = !result.unsupported && !result.error && compaction?.taskId === taskId && compaction?.state === 'completed';
        const outcome: AutoCompactOutcome = result.unsupported ? 'unsupported'
            : !succeeded ? 'failed'
            : tokens !== undefined && tokens > state.thresholdTokens ? 'insufficient' : 'succeeded';
        const error = result.error ?? (outcome === 'failed' ? compaction?.error : undefined);
        const next = settleAutoCompactState(state, outcome, {
            turnIndex: state.lastEvaluatedTurnIndex,
            ...(result.tokensBefore !== undefined ? { tokensBefore: result.tokensBefore } : {}),
            ...(succeeded && typeof proc.currentTokens === 'number' ? { tokensAfter: proc.currentTokens } : {}),
            ...(typeof proc.tokenLimit === 'number' ? { tokenLimit: proc.tokenLimit } : {}),
            ...(error ? { error } : {}),
        });
        await store.updateProcess(proc.id, { metadata: withAutoCompact(proc.metadata, next) });
        return next;
    });
}

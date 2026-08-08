/**
 * Chat Turn Settlement
 *
 * How a chat turn *finishes*: rolling up cumulative token usage, emitting the
 * turn-end `token-usage` event, and capturing the note-edit snapshot for
 * note-chat turns.
 *
 * These were previously inlined at the end of the follow-up path, which made
 * them impossible to test without driving a full SDK invocation. They are
 * pure/narrow functions here so completion semantics have one home.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIProcess, ConversationTurn, ProcessStore, TokenUsage } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { buildLiveConversationCostEstimate } from '../processes/process-metadata-read-model';
import { readNoteContent, appendNoteEditSnapshot, SNAPSHOT_SIZE_LIMIT } from './note-chat-executor';

// ============================================================================
// Cumulative token usage
// ============================================================================

/**
 * Roll this turn's usage into the conversation's running total.
 *
 * Counters (`inputTokens` … `turnCount`) accumulate; optional counters
 * (`cost`, `actualUsdCost`, `duration`) accumulate only once the provider
 * starts reporting them, so a provider that never reports cost leaves the
 * field `undefined` rather than pinning it to `0`. Session gauges
 * (`tokenLimit`, `currentTokens`, and the three breakdown gauges) are
 * point-in-time values, so the latest reading replaces the previous one.
 *
 * Returns `previous` unchanged when the turn reported no usage.
 */
export function buildCumulativeTokenUsage(
    previous: TokenUsage | undefined,
    usage: TokenUsage | undefined,
): TokenUsage | undefined {
    if (!usage) return previous;
    return {
        inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
        cacheReadTokens: (previous?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
        cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
        totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
        turnCount: (previous?.turnCount ?? 0) + usage.turnCount,
        cost: usage.cost !== undefined
            ? (previous?.cost ?? 0) + usage.cost
            : previous?.cost,
        actualUsdCost: usage.actualUsdCost !== undefined
            ? (previous?.actualUsdCost ?? 0) + usage.actualUsdCost
            : previous?.actualUsdCost,
        duration: usage.duration !== undefined
            ? (previous?.duration ?? 0) + usage.duration
            : previous?.duration,
        tokenLimit: usage.tokenLimit ?? previous?.tokenLimit,
        currentTokens: usage.currentTokens ?? previous?.currentTokens,
        systemTokens: usage.systemTokens ?? previous?.systemTokens,
        toolDefinitionsTokens: usage.toolDefinitionsTokens ?? previous?.toolDefinitionsTokens,
        conversationTokens: usage.conversationTokens ?? previous?.conversationTokens,
    };
}

/**
 * Build the process-level session-gauge updates for a settled turn.
 *
 * Each gauge falls back to its current persisted value when this turn did not
 * report one, so a provider that omits a gauge mid-conversation does not blank
 * the meter. Keys the turn has nothing to say about are omitted entirely.
 */
export function buildSessionTokenUpdates(
    current: Pick<AIProcess, 'tokenLimit' | 'currentTokens' | 'systemTokens' | 'toolDefinitionsTokens' | 'conversationTokens'>,
    usage: TokenUsage | undefined,
): Partial<Pick<AIProcess, 'tokenLimit' | 'currentTokens' | 'systemTokens' | 'toolDefinitionsTokens' | 'conversationTokens'>> {
    const tokenLimit = usage?.tokenLimit ?? current.tokenLimit;
    const currentTokens = usage?.currentTokens ?? current.currentTokens;
    const systemTokens = usage?.systemTokens ?? current.systemTokens;
    const toolDefinitionsTokens = usage?.toolDefinitionsTokens ?? current.toolDefinitionsTokens;
    const conversationTokens = usage?.conversationTokens ?? current.conversationTokens;
    return {
        ...(tokenLimit !== undefined ? { tokenLimit } : {}),
        ...(currentTokens !== undefined ? { currentTokens } : {}),
        ...(systemTokens !== undefined ? { systemTokens } : {}),
        ...(toolDefinitionsTokens !== undefined ? { toolDefinitionsTokens } : {}),
        ...(conversationTokens !== undefined ? { conversationTokens } : {}),
    };
}

// ============================================================================
// Turn-end token usage event
// ============================================================================

export interface EmitTurnTokenUsageInput {
    store: ProcessStore;
    processId: string;
    workspaceId?: string;
    /** Index of the assistant turn this usage belongs to. */
    turnIndex: number;
    tokenUsage: TokenUsage | undefined;
    /** Full turn list after the append, used for the live cost estimate. */
    allTurns: ConversationTurn[];
    /** Log prefix so each path keeps its existing wording. */
    logLabel: string;
}

/**
 * Emit the turn-end `token-usage` process event.
 *
 * Re-reads the process so the emitted cumulative total and cost estimate
 * reflect the write that just landed. Non-fatal by contract: a failure here
 * must never fail an otherwise-successful turn.
 */
export async function emitTurnTokenUsage(input: EmitTurnTokenUsageInput): Promise<void> {
    const { store, processId, tokenUsage, turnIndex, allTurns, workspaceId, logLabel } = input;
    if (!tokenUsage) return;
    try {
        const currentProc = await store.getProcess(processId, workspaceId);
        const cumulativeTokenUsage = currentProc?.cumulativeTokenUsage;
        store.emitProcessEvent(processId, {
            type: 'token-usage',
            turnIndex,
            tokenUsage,
            ...(cumulativeTokenUsage ? { cumulativeTokenUsage } : {}),
            ...(currentProc ? { conversationCostEstimate: buildLiveConversationCostEstimate(currentProc, allTurns) } : {}),
            sessionTokenLimit: tokenUsage.tokenLimit,
            sessionCurrentTokens: tokenUsage.currentTokens,
            ...(tokenUsage.systemTokens          != null ? { sessionSystemTokens:       tokenUsage.systemTokens }          : {}),
            ...(tokenUsage.toolDefinitionsTokens != null ? { sessionToolTokens:         tokenUsage.toolDefinitionsTokens } : {}),
            ...(tokenUsage.conversationTokens    != null ? { sessionConversationTokens: tokenUsage.conversationTokens }    : {}),
        });
    } catch (err) {
        getLogger().debug(
            LogCategory.AI,
            `${logLabel} Failed to emit token usage event for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

// ============================================================================
// Note edit snapshot
// ============================================================================

export interface CaptureNoteEditSnapshotInput {
    store: ProcessStore;
    processId: string;
    dataDir: string;
    workspaceId: string;
    notePath: string;
    /** Note content read before the turn ran. */
    preEditContent: string;
    /** Index of the assistant turn that produced the edit. */
    turnIndex: number;
    /** Log prefix so each path keeps its existing wording. */
    logLabel: string;
}

/**
 * Persist an inline-diff snapshot when a note-chat turn changed the note.
 *
 * No-op when the note is unreadable or unchanged. Snapshots larger than
 * {@link SNAPSHOT_SIZE_LIMIT} on either side are recorded as `tooLarge` with
 * empty bodies so the conversation record stays bounded. Non-fatal by
 * contract: a failure here must never fail an otherwise-successful turn.
 */
export async function captureNoteEditSnapshot(input: CaptureNoteEditSnapshotInput): Promise<void> {
    const { store, processId, dataDir, workspaceId, notePath, preEditContent, turnIndex, logLabel } = input;
    try {
        const postEditContent = await readNoteContent(dataDir, workspaceId, notePath);
        if (postEditContent === undefined || postEditContent === preEditContent) return;

        const tooLarge = preEditContent.length > SNAPSHOT_SIZE_LIMIT
            || postEditContent.length > SNAPSHOT_SIZE_LIMIT;
        await appendNoteEditSnapshot(store, processId, {
            editId: `${processId}-${turnIndex}`,
            notePath,
            preEditContent: tooLarge ? '' : preEditContent,
            postEditContent: tooLarge ? '' : postEditContent,
            timestamp: new Date().toISOString(),
            turnIndex,
            ...(tooLarge ? { tooLarge: true } : {}),
        });
    } catch (err) {
        getLogger().debug(
            LogCategory.AI,
            `${logLabel} Failed to capture note edit snapshot for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

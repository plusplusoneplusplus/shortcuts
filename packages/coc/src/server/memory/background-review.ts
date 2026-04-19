/**
 * Background Memory Review — post-task review of conversations for
 * durable fact extraction using the bounded memory tool.
 *
 * After a task completes with a sufficiently long conversation, a
 * lightweight background review task is enqueued. A cheap model replays
 * the conversation and calls the memory tool to persist durable facts
 * the main model may have missed.
 */

import type { ConversationTurn } from '@plusplusoneplusplus/forge';

// ── Configuration ──────────────────────────────────────────────────

export interface BackgroundReviewConfig {
    /** Minimum user turns before a review is triggered (default: 6) */
    minTurns: number;
    /** Maximum conversation turns to include in the review snapshot (default: 80) */
    maxSnapshotTurns: number;
    /** Model to use for the review (default: use server's default model) */
    model?: string;
    /** Timeout for the review task in ms (default: 60_000) */
    timeoutMs: number;
}

export const DEFAULT_REVIEW_CONFIG: BackgroundReviewConfig = {
    minTurns: 6,
    maxSnapshotTurns: 80,
    model: undefined,
    timeoutMs: 60_000,
};

// ── Review Prompt ──────────────────────────────────────────────────

export const MEMORY_REVIEW_PROMPT = `\
Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — their preferences, \
corrections, or expectations about how you should behave?
2. Has the user expressed conventions, environment details, or recurring \
patterns about their project or workflow?
3. Did the user correct you on something that indicates a stable preference \
or fact worth remembering for future sessions?

If something stands out, save it using the memory tool. Each fact should be \
a single, self-contained statement. Prefer compact phrasing.

If nothing is worth saving, just say "Nothing to save." and stop.`;

// ── Payload type ───────────────────────────────────────────────────

export interface BackgroundReviewPayload {
    readonly kind: 'background-review';
    /** The process whose conversation is being reviewed */
    sourceProcessId: string;
    /** Workspace that owns the process */
    workspaceId: string;
    /** Snapshot of conversation turns (user + assistant only, tool calls stripped) */
    conversationSnapshot: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** Timeout for the review AI call */
    timeoutMs?: number;
}

export function isBackgroundReviewPayload(
    payload: Record<string, unknown>,
): payload is Record<string, unknown> & BackgroundReviewPayload {
    return payload.kind === 'background-review';
}

// ── Trigger logic ──────────────────────────────────────────────────

/**
 * Count user turns in a conversation turn array.
 * Only counts non-streaming, non-historical turns with role 'user'.
 */
export function countUserTurns(turns: Array<{ role: string; streaming?: boolean; historical?: boolean }>): number {
    return turns.filter(t => t.role === 'user' && !t.streaming && !t.historical).length;
}

/**
 * Build a lightweight conversation snapshot for the review agent.
 * Strips tool calls, tool results, streaming turns, and historical turns.
 * Truncates long assistant responses to keep the snapshot compact.
 */
export function buildReviewSnapshot(
    turns: ConversationTurn[],
    maxTurns: number,
): BackgroundReviewPayload['conversationSnapshot'] {
    const relevant = turns
        .filter(t => !t.streaming && !t.historical && (t.role === 'user' || t.role === 'assistant'))
        .slice(-maxTurns);

    return relevant.map(t => ({
        role: t.role as 'user' | 'assistant',
        content: t.role === 'assistant' && t.content.length > 4000
            ? t.content.slice(0, 4000) + '… (truncated)'
            : t.content,
    }));
}

/**
 * Determine whether a background review should be enqueued for a
 * completed process.
 *
 * Returns the review payload if conditions are met, or null if not.
 */
export function shouldEnqueueReview(
    processId: string,
    workspaceId: string,
    turns: ConversationTurn[],
    config: BackgroundReviewConfig,
): BackgroundReviewPayload | null {
    const userTurnCount = countUserTurns(turns);
    if (userTurnCount < config.minTurns) return null;

    const snapshot = buildReviewSnapshot(turns, config.maxSnapshotTurns);
    if (snapshot.length < 2) return null;

    return {
        kind: 'background-review',
        sourceProcessId: processId,
        workspaceId,
        conversationSnapshot: snapshot,
        timeoutMs: config.timeoutMs,
    };
}

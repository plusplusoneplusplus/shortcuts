/**
 * Narrow, transcript-free projections for request-correlated relays (for
 * example the desktop Sentinel mirror). Stores answer these questions with
 * bounded indexed reads instead of hydrating a whole conversation.
 *
 * `projectRelayRequest` is the reference semantics: it must agree with the
 * SQLite implementation in `SqliteProcessStore.getRelayRequestProjection`.
 */

import type { AIProcessStatus, ConversationTurn } from './ai/process-types';
import type { PendingMessage } from './ai/process-interfaces';

/** Owner and status fields of one process, without turns or pending payloads. */
export interface ProcessOwnerProjection {
    id: string;
    /** `metadata.workspaceId`, the authoritative owner used by relays. */
    workspaceId?: string;
    mode?: string;
    status: AIProcessStatus;
    error?: string;
}

/** The settled assistant turn that failed a request, reduced to safe evidence fields. */
export interface RelayFailureEvidence {
    interrupted: boolean;
    interruptionReason?: string;
    content: string;
}

/**
 * One request's result evidence, bounded by its user turn and the next user turn.
 * `found` is false when no user turn carries the request ID.
 */
export interface RelayRequestProjection {
    found: boolean;
    /** A buffered pending message still carries the request ID (not yet a turn). */
    pending: boolean;
    /** True when a later user turn bounds the request. */
    closed: boolean;
    /** Content of the last settled, non-display, non-interrupted assistant turn. */
    answer?: string;
    /** Last settled non-display assistant turn when it carries failure evidence. */
    failure?: RelayFailureEvidence;
}

/** Reference implementation over an in-memory transcript (file stores and parity tests). */
export function projectRelayRequest(
    turns: readonly ConversationTurn[], requestId: string, pendingMessages: readonly PendingMessage[] = [],
): RelayRequestProjection {
    const pending = pendingMessages.some(message => message.relayRequestId === requestId);
    const start = turns.findIndex(turn => turn.role === 'user' && turn.relayRequestId === requestId);
    if (start < 0) return { found: false, pending, closed: false };
    const following = turns.slice(start + 1);
    const nextUser = following.findIndex(turn => turn.role === 'user');
    const window = nextUser >= 0 ? following.slice(0, nextUser) : following;
    const settled = window.filter(turn => turn.role === 'assistant' && !turn.streaming && !turn.displayOnly);
    const answer = settled.filter(turn => !turn.interrupted).at(-1);
    const last = settled.at(-1);
    const failed = last && (last.interrupted || last.interruptionReason !== undefined || last.content?.startsWith('Error: '));
    return {
        found: true,
        pending,
        closed: nextUser >= 0,
        ...(answer ? { answer: answer.content ?? '' } : {}),
        ...(failed ? {
            failure: {
                interrupted: !!last.interrupted,
                ...(last.interruptionReason !== undefined ? { interruptionReason: last.interruptionReason } : {}),
                content: last.content ?? '',
            },
        } : {}),
    };
}

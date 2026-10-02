/**
 * Answer extraction shared by the Teams and WhatsApp answer relays. Each relay
 * keeps its own receipt rules and decides which status text to send.
 */

import type { ConversationTurn } from '@plusplusoneplusplus/forge';

export type RelayTerminalStatus = 'completed' | 'failed' | 'cancelled';

/** Fixed texts relayed when a request has no usable assistant answer. */
export const RELAY_ANSWER_TEXT = {
    failed: 'This request could not be completed.',
    cancelled: 'This request was cancelled.',
    empty: 'This request completed without a text answer.',
} as const;

export function isTerminalStatus(status: string | undefined): status is RelayTerminalStatus {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Index of the user turn that carried relay request `requestId`, or -1. */
export function findRequestTurn(turns: readonly ConversationTurn[], requestId: string): number {
    return turns.findIndex(turn => turn.role === 'user' && turn.relayRequestId === requestId);
}

/**
 * The request's answer: the last settled assistant turn after `userIndex` and
 * before the next user turn (`userIndex` -1 scans from the first turn).
 * `closed` is true when a later user turn bounds the request.
 */
export function findRequestAnswer(
    turns: readonly ConversationTurn[],
    userIndex: number,
): { answer: ConversationTurn | undefined; closed: boolean } {
    const following = turns.slice(userIndex + 1);
    const nextUser = following.findIndex(turn => turn.role === 'user');
    const answer = (nextUser >= 0 ? following.slice(0, nextUser) : following)
        .filter(turn => turn.role === 'assistant' && !turn.streaming && !turn.displayOnly && !turn.interrupted)
        .at(-1);
    return { answer, closed: nextUser >= 0 };
}

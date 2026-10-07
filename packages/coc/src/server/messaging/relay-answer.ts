/**
 * Answer extraction shared by the Teams and WhatsApp answer relays. Each relay
 * keeps its own receipt rules and decides which status text to send.
 */

import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import { CHAT_IMAGE_FAILURE_TEXT } from '../executors/chat-image-policy';

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

/** Safe failure details from this request only; never forward raw exceptions or partial output. */
export function findRequestFailureText(
    turns: readonly ConversationTurn[], userIndex: number, processError?: string,
): string {
    if (userIndex < 0) return RELAY_ANSWER_TEXT.failed;
    const following = turns.slice(userIndex + 1);
    const nextUser = following.findIndex(turn => turn.role === 'user');
    const last = (nextUser >= 0 ? following.slice(0, nextUser) : following)
        .filter(turn => turn.role === 'assistant' && !turn.streaming && !turn.displayOnly).at(-1);
    const error = last?.interruptionReason
        ?? (last?.content?.startsWith('Error: ') ? last.content.slice(7) : undefined)
        ?? (nextUser < 0 ? processError : undefined);
    const imageFailure = Object.values(CHAT_IMAGE_FAILURE_TEXT).find(message => message === error);
    if (imageFailure) return imageFailure;
    if (!error || !/\b(?:session|usage) limit\b/i.test(error)) return RELAY_ANSWER_TEXT.failed;
    // Only project a clock time and known timezone, never arbitrary exception text.
    const reset = /\bresets?\s+(?:at\s+)?((?:1[0-2]|[1-9])(?::[0-5]\d)?\s*[ap]m|(?:[01]?\d|2[0-3]):[0-5]\d)\s*\((UTC|GMT)\)/i.exec(error);
    return `Provider ${/\bsession limit\b/i.test(error) ? 'session' : 'usage'} limit reached.`
        + (reset ? ` Resets at ${reset[1]} (${reset[2].toUpperCase()}).` : '')
        + ' Send a follow-up after the reset to retry.';
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

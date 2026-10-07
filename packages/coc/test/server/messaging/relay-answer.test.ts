/**
 * Unit tests for the answer-extraction helpers shared by the Teams and WhatsApp relays.
 */

import { describe, it, expect } from 'vitest';
import { CHAT_IMAGE_FAILURE_TEXT } from '../../../src/server/executors/chat-image-policy';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import {
    RELAY_ANSWER_TEXT,
    findRequestAnswer,
    findRequestFailureText,
    findRequestTurn,
    isTerminalStatus,
} from '../../../src/server/messaging/relay-answer';

function turn(role: 'user' | 'assistant', content: string, extra: Partial<ConversationTurn> = {}): ConversationTurn {
    return { role, content, timestamp: new Date(0), ...extra } as ConversationTurn;
}

describe('isTerminalStatus', () => {
    it('accepts only completed, failed, and cancelled', () => {
        expect(['completed', 'failed', 'cancelled'].every(isTerminalStatus)).toBe(true);
        expect(['running', 'queued', '', undefined].some(isTerminalStatus)).toBe(false);
    });
});

describe('RELAY_ANSWER_TEXT', () => {
    it('keeps the user-visible relay texts stable', () => {
        expect(RELAY_ANSWER_TEXT).toEqual({
            failed: 'This request could not be completed.',
            cancelled: 'This request was cancelled.',
            empty: 'This request completed without a text answer.',
        });
    });
});

describe('findRequestTurn', () => {
    it('finds the user turn carrying the request id', () => {
        const turns = [
            turn('user', 'first'),
            turn('assistant', 'answer', { relayRequestId: 'req-1' }),
            turn('user', 'second', { relayRequestId: 'req-1' }),
        ];
        expect(findRequestTurn(turns, 'req-1')).toBe(2);
        expect(findRequestTurn(turns, 'missing')).toBe(-1);
    });
});

describe('findRequestAnswer', () => {
    it('returns the last settled assistant turn before the next user turn', () => {
        const turns = [
            turn('user', 'q1'),
            turn('assistant', 'draft'),
            turn('assistant', 'final'),
            turn('assistant', 'still streaming', { streaming: true }),
            turn('assistant', 'display only', { displayOnly: true }),
            turn('assistant', 'interrupted', { interrupted: true }),
            turn('user', 'q2'),
            turn('assistant', 'later answer'),
        ];
        expect(findRequestAnswer(turns, 0)).toEqual({ answer: turns[2], closed: true });
        expect(findRequestAnswer(turns, 6)).toEqual({ answer: turns[7], closed: false });
    });

    it('scans from the first turn when the request turn is unknown', () => {
        const turns = [turn('assistant', 'orphan answer'), turn('user', 'q')];
        expect(findRequestAnswer(turns, -1)).toEqual({ answer: turns[0], closed: true });
    });

    it('reports no answer when the request has no settled assistant turn', () => {
        const turns = [turn('user', 'q'), turn('assistant', 'partial', { streaming: true })];
        expect(findRequestAnswer(turns, 0)).toEqual({ answer: undefined, closed: false });
    });
});

describe('findRequestFailureText', () => {
    it.each(Object.values(CHAT_IMAGE_FAILURE_TEXT))('relays only the exact safe image failure: %s', message => {
        expect(findRequestFailureText([turn('user', 'q'), turn('assistant', `Error: ${message}`)], 0)).toBe(message);
        expect(findRequestFailureText([turn('user', 'q')], 0, message)).toBe(message);
        expect(findRequestFailureText([turn('user', 'q')], 0, `${message} secret-token`)).toBe(RELAY_ANSWER_TEXT.failed);
        expect(findRequestFailureText([turn('user', 'q'), turn('user', 'later')], 0, message)).toBe(RELAY_ANSWER_TEXT.failed);
    });

    const limit = "You've hit your session limit · resets 7:10pm (UTC)";
    const notice = 'Provider session limit reached. Resets at 7:10pm (UTC). Send a follow-up after the reset to retry.';

    it('relays a safe limit notice from an interrupted turn, excluding partial output', () => {
        expect(findRequestFailureText([
            turn('user', 'question'),
            turn('assistant', 'private partial output', { interrupted: true, interruptionReason: limit }),
        ], 0)).toBe(notice);
    });

    it('recognizes an error turn without partial output and a current process failure', () => {
        expect(findRequestFailureText([turn('user', 'q'), turn('assistant', `Error: ${limit}`)], 0)).toBe(notice);
        expect(findRequestFailureText([turn('user', 'q')], 0, limit)).toBe(notice);
    });

    it('uses the matched request error even after a later request fails', () => {
        const turns = [turn('user', 'q1'),
            turn('assistant', '', { interrupted: true, interruptionReason: limit }),
            turn('user', 'q2'), turn('assistant', 'Error: private exception')];
        expect(findRequestFailureText(turns, 0, 'private exception')).toBe(notice);
        expect(findRequestFailureText(turns, 2, limit)).toBe(RELAY_ANSWER_TEXT.failed);
    });

    it('does not borrow errors from earlier or later requests, or an unknown request', () => {
        const turns = [turn('user', 'q1'), turn('assistant', 'answer'), turn('user', 'q2'),
            turn('assistant', '', { interrupted: true, interruptionReason: limit }), turn('user', 'q3')];
        expect(findRequestFailureText(turns, 0, limit)).toBe(RELAY_ANSWER_TEXT.failed);
        expect(findRequestFailureText(turns, 4)).toBe(RELAY_ANSWER_TEXT.failed);
        expect(findRequestFailureText(turns, -1, limit)).toBe(RELAY_ANSWER_TEXT.failed);
    });

    it('ignores streaming, display-only and ordinary assistant content', () => {
        const turns = [turn('user', 'q'), turn('assistant', limit),
            turn('assistant', `Error: ${limit}`, { streaming: true }),
            turn('assistant', `Error: ${limit}`, { displayOnly: true })];
        expect(findRequestFailureText(turns, 0)).toBe(RELAY_ANSWER_TEXT.failed);
    });

    it.each([
        ['private exception with /secret/path and token=secret', RELAY_ANSWER_TEXT.failed],
        ['Usage limit reached; resets at 19:10 (GMT)', 'Provider usage limit reached. Resets at 19:10 (GMT). Send a follow-up after the reset to retry.'],
        ['Session limit reached; resets 99:99pm (UTC)', 'Provider session limit reached. Send a follow-up after the reset to retry.'],
        ['Session limit reached; resets <script>secret</script>', 'Provider session limit reached. Send a follow-up after the reset to retry.'],
        ['Session limit reached; resets 7pm (UTC); token=secret', 'Provider session limit reached. Resets at 7pm (UTC). Send a follow-up after the reset to retry.'],
    ])('projects only recognized details from %s', (error, expected) => {
        expect(findRequestFailureText([turn('user', 'q')], 0, error)).toBe(expected);
    });
});

/**
 * Unit tests for the answer-extraction helpers shared by the Teams and WhatsApp relays.
 */

import { describe, it, expect } from 'vitest';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import {
    RELAY_ANSWER_TEXT,
    findRequestAnswer,
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

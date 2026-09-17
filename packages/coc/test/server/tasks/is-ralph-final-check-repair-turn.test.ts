/**
 * Guards the gate on Ralph final-check repair-turn routing.
 *
 * Repair turns run as chat follow-ups, and the follow-up path fires
 * `onRalphNext` only for them. If this predicate widened to "any ralph-mode
 * follow-up", an ordinary user reply on a Ralph conversation would start
 * driving the loop.
 */

import { describe, it, expect } from 'vitest';
import { isRalphFinalCheckRepairTurn } from '../../../src/server/tasks/task-types';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: 'chat',
        mode: 'ralph',
        prompt: 'Re-emit the result block.',
        processId: 'queue_1',
        workspaceId: 'ws-1',
        context: {
            ralph: {
                sessionId: 'sess-1',
                finalCheck: { kind: 'goal-gap-check', checkIndex: 1, repairTurn: true },
            },
        },
        ...overrides,
    };
}

describe('isRalphFinalCheckRepairTurn', () => {
    it('accepts a ralph final-check repair follow-up', () => {
        expect(isRalphFinalCheckRepairTurn(payload())).toBe(true);
    });

    it('rejects an ordinary ralph-mode follow-up with no finalCheck context', () => {
        expect(isRalphFinalCheckRepairTurn(payload({
            context: { ralph: { sessionId: 'sess-1' } },
        }))).toBe(false);
    });

    it('rejects the original final-check task itself', () => {
        expect(isRalphFinalCheckRepairTurn(payload({
            context: { ralph: { sessionId: 'sess-1', finalCheck: { checkIndex: 1 } } },
        }))).toBe(false);
    });

    it('rejects a non-ralph-mode payload carrying the flag', () => {
        expect(isRalphFinalCheckRepairTurn(payload({ mode: 'autopilot' }))).toBe(false);
    });

    it('rejects payloads with no context at all', () => {
        expect(isRalphFinalCheckRepairTurn(payload({ context: undefined }))).toBe(false);
    });
});

/**
 * Tests for getRalphTaskKind — the single discriminator shared by the executor
 * (prompt-rewrite decision) and the bridge (completion routing).
 */

import { describe, it, expect } from 'vitest';
import { getRalphTaskKind } from '../../../src/server/ralph/task-kind';
import type { RalphContext } from '../../../src/server/tasks/task-types';

const FINAL_CHECK: RalphContext['finalCheck'] = {
    kind: 'goal-gap-check',
    checkIndex: 1,
    sourceIteration: 3,
    loopIndex: 1,
};

const SUBMIT: RalphContext['submit'] = { kind: 'submit-pr', submitIndex: 1 };

describe('getRalphTaskKind', () => {
    it('returns "iteration" for an undefined context', () => {
        expect(getRalphTaskKind(undefined)).toBe('iteration');
    });

    it('returns "iteration" for a plain iteration context', () => {
        expect(getRalphTaskKind({
            originalGoal: 'Build a REST API',
            sessionId: 'sess-1',
            currentIteration: 2,
            maxIterations: 10,
        })).toBe('iteration');
    });

    it('returns "final-check" when finalCheck is set', () => {
        expect(getRalphTaskKind({
            originalGoal: 'Build a REST API',
            finalCheck: FINAL_CHECK,
        })).toBe('final-check');
    });

    it('returns "submit" when submit is set', () => {
        expect(getRalphTaskKind({
            originalGoal: 'Build a REST API',
            submit: SUBMIT,
        })).toBe('submit');
    });

    it('prefers final-check when both markers are somehow present', () => {
        expect(getRalphTaskKind({
            originalGoal: 'Build a REST API',
            finalCheck: FINAL_CHECK,
            submit: SUBMIT,
        })).toBe('final-check');
    });
});

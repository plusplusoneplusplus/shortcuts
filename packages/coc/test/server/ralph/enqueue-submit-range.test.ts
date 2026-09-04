/**
 * Tests for `deriveSubmitCommitRange` — the pure derivation that closes a
 * Ralph session's PR-submit commit range and drops already-submitted commits.
 */

import { describe, it, expect } from 'vitest';
import { deriveSubmitCommitRange } from '../../../src/server/ralph/enqueue-submit';
import type { RalphIterationRecord, RalphSessionRecord } from '../../../src/server/ralph/types';

function iter(overrides: Partial<RalphIterationRecord>): RalphIterationRecord {
    return {
        iteration: 1,
        loopIndex: 1,
        taskId: 't',
        processId: 'p',
        startedAt: '2026-08-19T00:00:00Z',
        status: 'completed',
        ...overrides,
    };
}

function session(overrides: Partial<RalphSessionRecord> = {}): RalphSessionRecord {
    return {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'g',
        maxIterations: 5,
        currentIteration: 1,
        phase: 'complete',
        startedAt: '2026-08-19T00:00:00Z',
        iterations: [],
        ...overrides,
    };
}

describe('deriveSubmitCommitRange — endSha', () => {
    it('takes the headSha of the last completed iteration', () => {
        const rec = session({
            iterations: [
                iter({ iteration: 1, headSha: 'aaa' }),
                iter({ iteration: 2, headSha: 'bbb' }),
            ],
        });

        expect(deriveSubmitCommitRange(rec).endSha).toBe('bbb');
    });

    it('skips running, failed, and cancelled iterations', () => {
        const rec = session({
            iterations: [
                iter({ iteration: 1, headSha: 'aaa' }),
                iter({ iteration: 2, status: 'failed', headSha: 'bad-1' }),
                iter({ iteration: 3, status: 'cancelled', headSha: 'bad-2' }),
                iter({ iteration: 4, status: 'running', headSha: 'bad-3' }),
            ],
        });

        expect(deriveSubmitCommitRange(rec).endSha).toBe('aaa');
    });

    it('uses the highest completed iteration number regardless of array order', () => {
        const rec = session({
            iterations: [
                iter({ iteration: 3, headSha: 'ccc' }),
                iter({ iteration: 1, headSha: 'aaa' }),
            ],
        });

        expect(deriveSubmitCommitRange(rec).endSha).toBe('ccc');
    });

    it('is undefined for a legacy session whose iterations carry no headSha', () => {
        const rec = session({ iterations: [iter({ iteration: 1 })] });

        expect(deriveSubmitCommitRange(rec).endSha).toBeUndefined();
    });

    it('is undefined when there are no iterations at all', () => {
        expect(deriveSubmitCommitRange(session()).endSha).toBeUndefined();
    });
});

describe('deriveSubmitCommitRange — excludeShas', () => {
    it('unions the commit SHAs of every prior submit', () => {
        const rec = session({
            submits: [
                { submitIndex: 1, status: 'submitted', taskId: 't1', startedAt: 's', commitShas: ['aaa', 'bbb'] },
                { submitIndex: 2, status: 'submitted', taskId: 't2', startedAt: 's', commitShas: ['ccc'] },
            ],
        });

        expect(deriveSubmitCommitRange(rec).excludeShas).toEqual(['aaa', 'bbb', 'ccc']);
    });

    it('de-duplicates SHAs reported by more than one submit', () => {
        const rec = session({
            submits: [
                { submitIndex: 1, status: 'submitted', taskId: 't1', startedAt: 's', commitShas: ['aaa', 'bbb'] },
                { submitIndex: 2, status: 'submitted', taskId: 't2', startedAt: 's', commitShas: ['bbb', 'ccc'] },
            ],
        });

        expect(deriveSubmitCommitRange(rec).excludeShas).toEqual(['aaa', 'bbb', 'ccc']);
    });

    it('tolerates submits that recorded no commit SHAs', () => {
        const rec = session({
            submits: [
                { submitIndex: 1, status: 'failed', taskId: 't1', startedAt: 's', error: 'boom' },
            ],
        });

        expect(deriveSubmitCommitRange(rec).excludeShas).toEqual([]);
    });

    it('is empty when the session has never been submitted', () => {
        expect(deriveSubmitCommitRange(session()).excludeShas).toEqual([]);
    });
});

/**
 * Tests for ralph-session-grouping utility.
 */
import { describe, it, expect } from 'vitest';
import {
    groupByRalphSession,
    getRalphSessionId,
    getRalphPhase,
    isRalphTask,
    type RalphSession,
} from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';

function makeTask(overrides: any = {}): any {
    return {
        id: `task-${Math.random().toString(36).slice(2)}`,
        type: 'chat',
        status: 'completed',
        createdAt: Date.now(),
        ...overrides,
    };
}

function makeGrillingTask(sessionId: string, overrides: any = {}): any {
    return makeTask({
        payload: {
            mode: 'ask',
            context: {
                ralph: {
                    sessionId,
                    phase: 'grilling',
                },
            },
        },
        ...overrides,
    });
}

function makeIterationTask(sessionId: string, iteration: number, overrides: any = {}): any {
    return makeTask({
        payload: {
            mode: 'ralph',
            context: {
                ralph: {
                    sessionId,
                    phase: 'executing',
                    currentIteration: iteration,
                },
            },
        },
        ...overrides,
    });
}

function makeIterationHistoryItem(sessionId: string, iteration: number, overrides: any = {}): any {
    // History item shape (from GET /api/workspaces/:id/history): no `payload`,
    // top-level `mode` and top-level `ralph`.
    return makeTask({
        mode: 'ralph',
        ralph: {
            sessionId,
            phase: 'executing',
            currentIteration: iteration,
        },
        ...overrides,
    });
}

function makeGrillingHistoryItem(sessionId: string, overrides: any = {}): any {
    return makeTask({
        mode: 'ask',
        ralph: {
            sessionId,
            phase: 'grilling',
        },
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// getRalphSessionId / getRalphPhase / isRalphTask
// ---------------------------------------------------------------------------

describe('getRalphSessionId', () => {
    it('returns undefined for non-ralph task', () => {
        expect(getRalphSessionId(makeTask())).toBeUndefined();
    });
    it('returns sessionId from payload.context.ralph', () => {
        const task = makeGrillingTask('sess-1');
        expect(getRalphSessionId(task)).toBe('sess-1');
    });
    it('returns sessionId from top-level ralph (history item shape)', () => {
        const item = makeIterationHistoryItem('sess-2', 3);
        expect(getRalphSessionId(item)).toBe('sess-2');
    });
});

describe('getRalphPhase', () => {
    it('returns undefined for non-ralph task', () => {
        expect(getRalphPhase(makeTask())).toBeUndefined();
    });
    it('returns grilling for grilling tasks', () => {
        expect(getRalphPhase(makeGrillingTask('s'))).toBe('grilling');
    });
    it('returns executing for iteration tasks', () => {
        expect(getRalphPhase(makeIterationTask('s', 1))).toBe('executing');
    });
    it('returns phase from top-level ralph (history item shape)', () => {
        expect(getRalphPhase(makeIterationHistoryItem('s', 1))).toBe('executing');
        expect(getRalphPhase(makeGrillingHistoryItem('s'))).toBe('grilling');
    });
});

describe('isRalphTask', () => {
    it('returns false for non-ralph task', () => {
        expect(isRalphTask(makeTask())).toBe(false);
    });
    it('returns true for ralph task', () => {
        expect(isRalphTask(makeGrillingTask('sess-1'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// groupByRalphSession
// ---------------------------------------------------------------------------

describe('groupByRalphSession', () => {
    it('returns empty array for empty input', () => {
        expect(groupByRalphSession([])).toEqual([]);
    });

    it('returns standalone tasks unchanged when no ralph tasks', () => {
        const t1 = makeTask({ createdAt: 1000 });
        const t2 = makeTask({ createdAt: 2000 });
        const result = groupByRalphSession([t1, t2]);
        expect(result).toHaveLength(2);
        // Both should have no kind
        expect(result.every(e => e.kind === undefined || e.kind !== 'ralph-session')).toBe(true);
    });

    it('groups ralph tasks by sessionId, leaving non-ralph tasks standalone', () => {
        const standalone = makeTask({ createdAt: 5000 });
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const iter1 = makeIterationTask('sess-1', 1, { createdAt: 2000 });

        const result = groupByRalphSession([standalone, grilling, iter1]);

        expect(result).toHaveLength(2);
        const session = result.find(e => e.kind === 'ralph-session') as RalphSession;
        expect(session).toBeDefined();
        expect(session.sessionId).toBe('sess-1');
        expect(session.grillingProcess).toBe(grilling);
        expect(session.iterations).toHaveLength(1);
    });

    it('creates separate groups for multiple sessions', () => {
        const g1 = makeGrillingTask('sess-1', { createdAt: 3000 });
        const i1 = makeIterationTask('sess-1', 1, { createdAt: 4000 });
        const g2 = makeGrillingTask('sess-2', { createdAt: 1000 });
        const i2 = makeIterationTask('sess-2', 1, { createdAt: 2000 });

        const result = groupByRalphSession([g1, i1, g2, i2]);

        expect(result).toHaveLength(2);
        expect(result.every(e => e.kind === 'ralph-session')).toBe(true);
        const ids = result.map((e: any) => e.sessionId);
        expect(ids).toContain('sess-1');
        expect(ids).toContain('sess-2');
    });

    it('session with only grilling process has phase=grilling', () => {
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const result = groupByRalphSession([grilling]);
        const session = result[0] as RalphSession;
        expect(session.kind).toBe('ralph-session');
        expect(session.phase).toBe('grilling');
        expect(session.grillingProcess).toBe(grilling);
        expect(session.iterations).toHaveLength(0);
    });

    it('session with grilling + running iteration has phase=executing', () => {
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const i1 = makeIterationTask('sess-1', 1, { createdAt: 2000, status: 'running' });
        const i2 = makeIterationTask('sess-1', 2, { createdAt: 3000, status: 'completed' });

        const result = groupByRalphSession([grilling, i1, i2]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('executing');
        expect(session.iterations).toHaveLength(2);
    });

    it('session where all iterations are completed (history shape, no explicit phase=complete) has phase=complete', () => {
        // Regression: history items always carry ralph.phase='executing'; the session should
        // be treated as complete when every iteration has status='completed'.
        const i1 = makeIterationHistoryItem('sess-h2', 1, { createdAt: 2000, status: 'completed' });
        const i2 = makeIterationHistoryItem('sess-h2', 2, { createdAt: 3000, status: 'completed' });
        const i3 = makeIterationHistoryItem('sess-h2', 3, { createdAt: 4000, status: 'completed' });

        const result = groupByRalphSession([i1, i2, i3]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('complete');
        expect(session.iterations).toHaveLength(3);
    });

    it('session with completed final iteration has phase=complete', () => {
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const i1 = makeIterationTask('sess-1', 1, {
            createdAt: 2000,
            status: 'completed',
            payload: {
                mode: 'ralph',
                context: {
                    ralph: {
                        sessionId: 'sess-1',
                        phase: 'complete',
                        currentIteration: 1,
                    },
                },
            },
        });

        const result = groupByRalphSession([grilling, i1]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('complete');
    });

    it('propagates hasUnseen when session item is in unseenIds', () => {
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const iter = makeIterationTask('sess-1', 1, { createdAt: 2000 });
        const unseenIds = new Set([grilling.id]);

        const result = groupByRalphSession([grilling, iter], unseenIds);
        const session = result[0] as RalphSession;
        expect(session.hasUnseen).toBe(true);
    });

    it('hasUnseen is false when no session items are unseen', () => {
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const unseenIds = new Set<string>(['other-task-id']);

        const result = groupByRalphSession([grilling], unseenIds);
        const session = result[0] as RalphSession;
        expect(session.hasUnseen).toBe(false);
    });

    it('sorts result by latest timestamp descending', () => {
        const standalone = makeTask({ createdAt: 9000 });
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });
        const iter = makeIterationTask('sess-1', 1, { createdAt: 2000 });

        const result = groupByRalphSession([grilling, iter, standalone]);
        // standalone has ts 9000, session has latestTimestamp 2000
        expect(result[0]).toBe(standalone);
        expect((result[1] as RalphSession).kind).toBe('ralph-session');
    });

    it('sorts iterations by currentIteration ascending within session', () => {
        const i2 = makeIterationTask('sess-1', 2, { createdAt: 3000 });
        const i1 = makeIterationTask('sess-1', 1, { createdAt: 2000 });
        const grilling = makeGrillingTask('sess-1', { createdAt: 1000 });

        const result = groupByRalphSession([i2, i1, grilling]);
        const session = result[0] as RalphSession;
        expect(session.iterations[0].payload.context.ralph.currentIteration).toBe(1);
        expect(session.iterations[1].payload.context.ralph.currentIteration).toBe(2);
    });

    // ---------------------------------------------------------------------
    // History-item shape (regression: completed Ralph runs)
    // ---------------------------------------------------------------------

    it('groups history items that carry ralph metadata at the top level', () => {
        const grilling = makeGrillingHistoryItem('sess-h', { createdAt: 1000 });
        const i1 = makeIterationHistoryItem('sess-h', 1, { createdAt: 2000 });
        const i2 = makeIterationHistoryItem('sess-h', 2, { createdAt: 3000 });

        const result = groupByRalphSession([grilling, i1, i2]);
        expect(result).toHaveLength(1);
        const session = result[0] as RalphSession;
        expect(session.kind).toBe('ralph-session');
        expect(session.sessionId).toBe('sess-h');
        expect(session.grillingProcess).toBe(grilling);
        expect(session.iterations).toHaveLength(2);
        expect(session.iterations[0]).toBe(i1);
        expect(session.iterations[1]).toBe(i2);
    });

    it('collapses mixed live queue_task + history items sharing one sessionId', () => {
        const live = makeIterationTask('sess-mix', 1, { createdAt: 1000 });
        const h2 = makeIterationHistoryItem('sess-mix', 2, { createdAt: 2000 });
        const h3 = makeIterationHistoryItem('sess-mix', 3, { createdAt: 3000 });
        const h4 = makeIterationHistoryItem('sess-mix', 4, { createdAt: 4000 });
        const h5 = makeIterationHistoryItem('sess-mix', 5, { createdAt: 5000 });

        const result = groupByRalphSession([live, h2, h3, h4, h5]);
        expect(result).toHaveLength(1);
        const session = result[0] as RalphSession;
        expect(session.iterations).toHaveLength(5);
        const iters = session.iterations.map(getRalphSessionId);
        expect(iters.every(id => id === 'sess-mix')).toBe(true);
        // Sorted ascending by currentIteration regardless of source shape.
        const ordered = session.iterations.map((t: any) =>
            t.payload?.context?.ralph?.currentIteration ?? t.ralph?.currentIteration,
        );
        expect(ordered).toEqual([1, 2, 3, 4, 5]);
    });
});

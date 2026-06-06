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

    it('session with failed Ralph phase has phase=failed', () => {
        const failedIter = makeIterationTask('sess-failed', 1, {
            createdAt: 2000,
            status: 'failed',
            payload: {
                mode: 'ralph',
                context: {
                    ralph: {
                        sessionId: 'sess-failed',
                        phase: 'failed',
                        currentIteration: 1,
                    },
                },
            },
        });

        const result = groupByRalphSession([failedIter]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('failed');
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

    // ---------------------------------------------------------------------
    // Ask-mode follow-up regression: follow-ups run in 'ask' mode with
    // ralph.phase='executing', so they must appear in the iterations list.
    // ---------------------------------------------------------------------

    it('ask-mode follow-up to a ralph session appears in iterations', () => {
        const grilling = makeGrillingTask('sess-fu', { createdAt: 1000 });
        const iter1 = makeIterationTask('sess-fu', 1, { createdAt: 2000 });
        // Follow-up runs in ask mode but with ralph context
        const followUp = makeTask({
            createdAt: 3000,
            payload: {
                mode: 'ask',
                context: {
                    ralph: {
                        sessionId: 'sess-fu',
                        phase: 'executing',
                        currentIteration: 0,
                    },
                },
            },
        });

        const result = groupByRalphSession([grilling, iter1, followUp]);
        expect(result).toHaveLength(1);
        const session = result[0] as RalphSession;
        expect(session.grillingProcess).toBe(grilling);
        // Both the iteration and the follow-up must be in iterations
        expect(session.iterations).toHaveLength(2);
        expect(session.iterations).toContain(iter1);
        expect(session.iterations).toContain(followUp);
    });

    it('ask-mode follow-up history item appears in iterations', () => {
        const iter1 = makeIterationHistoryItem('sess-hfu', 1, { createdAt: 2000 });
        // History follow-up: top-level mode='ask' with ralph metadata
        const followUp = makeTask({
            createdAt: 3000,
            mode: 'ask',
            ralph: {
                sessionId: 'sess-hfu',
                phase: 'executing',
                currentIteration: 0,
            },
        });

        const result = groupByRalphSession([iter1, followUp]);
        expect(result).toHaveLength(1);
        const session = result[0] as RalphSession;
        expect(session.iterations).toHaveLength(2);
        expect(session.iterations).toContain(iter1);
        expect(session.iterations).toContain(followUp);
    });

    it('follow-ups with same iteration number are sorted by timestamp', () => {
        const iter1 = makeIterationTask('sess-ts', 1, { createdAt: 2000 });
        const followUp1 = makeTask({
            createdAt: 3000,
            payload: {
                mode: 'ask',
                context: {
                    ralph: {
                        sessionId: 'sess-ts',
                        phase: 'executing',
                        currentIteration: 0,
                    },
                },
            },
        });
        const followUp2 = makeTask({
            createdAt: 4000,
            payload: {
                mode: 'ask',
                context: {
                    ralph: {
                        sessionId: 'sess-ts',
                        phase: 'executing',
                        currentIteration: 0,
                    },
                },
            },
        });

        const result = groupByRalphSession([followUp2, iter1, followUp1]);
        const session = result[0] as RalphSession;
        expect(session.iterations).toHaveLength(3);
        // iteration 0 items first (sorted by timestamp), then iteration 1
        expect(session.iterations[0]).toBe(followUp1);
        expect(session.iterations[1]).toBe(followUp2);
        expect(session.iterations[2]).toBe(iter1);
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

    // ---------------------------------------------------------------------
    // Sort timestamp regression: completed Ralph sessions must use end-time,
    // not lastActivityAt, so late server-side turn appends (follow-ups,
    // retries, post-completion tool events) don't keep floating a finished
    // session above newer chats. See plan: "My Ralph session, the group, is
    // from nine hours ago, but he is still being put at the top".
    // ---------------------------------------------------------------------

    it('completed ralph session ignores lastActivityAt for sort timestamp', () => {
        const NINE_H_AGO = 1000;
        const ONE_H_AGO = 8 * 3600_000;

        // Completed iteration: ended 9h ago but a late post-completion turn
        // bumped lastActivityAt forward by 8h (now only 1h ago).
        const completedIter = makeIterationHistoryItem('sess-old', 1, {
            status: 'completed',
            endTime: NINE_H_AGO,
            completedAt: NINE_H_AGO,
            lastActivityAt: ONE_H_AGO,
        });

        const result = groupByRalphSession([completedIter]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('complete');
        // Must use end-time, not the bumped lastActivityAt.
        expect(session.latestTimestamp).toBe(NINE_H_AGO);
    });

    it('completed ralph session sorts below a newer standalone chat even when its lastActivityAt is fresher', () => {
        const NINE_H_AGO = 1000;
        const FIVE_H_AGO = 4 * 3600_000;
        const ONE_H_AGO = 8 * 3600_000;

        // Finished ralph session with stale end-time but freshly bumped
        // lastActivityAt (the bug scenario).
        const oldRalph = makeIterationHistoryItem('sess-old', 1, {
            id: 'old-ralph',
            status: 'completed',
            endTime: NINE_H_AGO,
            completedAt: NINE_H_AGO,
            lastActivityAt: ONE_H_AGO,
        });

        // A normal chat that genuinely completed 5h ago.
        const newerChat = makeTask({
            id: 'newer-chat',
            status: 'completed',
            endTime: FIVE_H_AGO,
            completedAt: FIVE_H_AGO,
            lastActivityAt: FIVE_H_AGO,
            createdAt: FIVE_H_AGO,
        });

        const result = groupByRalphSession([oldRalph, newerChat]);
        // newerChat (5h ago) must sort above the 9h-old completed session.
        expect(result[0]).toBe(newerChat);
        expect((result[1] as RalphSession).kind).toBe('ralph-session');
    });

    it('still-running ralph session keeps using lastActivityAt so live activity floats to the top', () => {
        const TWO_H_AGO = 1000;
        const NOW = 7200_000;

        // Executing iteration (no end-time yet) with a fresh activity bump.
        const runningIter = makeIterationTask('sess-live', 1, {
            status: 'running',
            startedAt: TWO_H_AGO,
            createdAt: TWO_H_AGO,
            lastActivityAt: NOW,
        });

        // A standalone chat that completed earlier than the live activity.
        const olderChat = makeTask({
            id: 'older-chat',
            status: 'completed',
            endTime: NOW - 3600_000,
            completedAt: NOW - 3600_000,
            lastActivityAt: NOW - 3600_000,
            createdAt: NOW - 3600_000,
        });

        const result = groupByRalphSession([olderChat, runningIter]);
        const session = result.find((e: any) => e.kind === 'ralph-session') as RalphSession;
        expect(session.phase).toBe('executing');
        // Live activity wins for non-complete sessions.
        expect(session.latestTimestamp).toBe(NOW);
        expect(result[0]).toBe(session);
    });

    it('completed ralph session takes the latest end-time across all iterations', () => {
        const T1 = 1000;
        const T2 = 5000;
        const T3 = 9000;

        const i1 = makeIterationHistoryItem('sess-end', 1, {
            id: 'i1',
            status: 'completed',
            endTime: T1,
            completedAt: T1,
            lastActivityAt: T3 + 100_000, // late append on early iteration
        });
        const i2 = makeIterationHistoryItem('sess-end', 2, {
            id: 'i2',
            status: 'completed',
            endTime: T2,
            completedAt: T2,
            lastActivityAt: T2,
        });
        const i3 = makeIterationHistoryItem('sess-end', 3, {
            id: 'i3',
            status: 'completed',
            endTime: T3,
            completedAt: T3,
            lastActivityAt: T3,
        });

        const result = groupByRalphSession([i1, i2, i3]);
        const session = result[0] as RalphSession;
        expect(session.phase).toBe('complete');
        // Latest end-time across iterations, *not* the bumped lastActivityAt on i1.
        expect(session.latestTimestamp).toBe(T3);
    });

    // ---------------------------------------------------------------------
    // loopCount
    // ---------------------------------------------------------------------

    it('loopCount defaults to 1 for a single-loop session (no loopIndex on tasks)', () => {
        const g = makeGrillingTask('sess-lc', { createdAt: 1000 });
        const i1 = makeIterationTask('sess-lc', 1, { createdAt: 2000 });
        const result = groupByRalphSession([g, i1]);
        const session = result[0] as RalphSession;
        expect(session.loopCount).toBe(1);
    });

    it('loopCount reflects the max loopIndex across all session tasks', () => {
        const i1 = makeIterationTask('sess-ml', 1, {
            createdAt: 1000,
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-ml', phase: 'executing', currentIteration: 1, loopIndex: 1 } } },
        });
        const i2 = makeIterationTask('sess-ml', 2, {
            createdAt: 2000,
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-ml', phase: 'executing', currentIteration: 2, loopIndex: 2 } } },
        });
        const i3 = makeIterationTask('sess-ml', 3, {
            createdAt: 3000,
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-ml', phase: 'executing', currentIteration: 3, loopIndex: 2 } } },
        });
        const result = groupByRalphSession([i1, i2, i3]);
        const session = result[0] as RalphSession;
        expect(session.loopCount).toBe(2);
    });

    it('loopCount reads loopIndex from history-item top-level ralph field', () => {
        const i1 = makeIterationHistoryItem('sess-hl', 1, {
            createdAt: 1000,
            ralph: { sessionId: 'sess-hl', phase: 'executing', currentIteration: 1, loopIndex: 3 },
        });
        const result = groupByRalphSession([i1]);
        const session = result[0] as RalphSession;
        expect(session.loopCount).toBe(3);
    });

    // ---------------------------------------------------------------------
    // title (goal-derived)
    // ---------------------------------------------------------------------

    it('derives the session title from a live grilling task originalGoal', () => {
        const g = makeGrillingTask('sess-title', {
            createdAt: 1000,
            payload: { mode: 'ask', context: { ralph: { sessionId: 'sess-title', phase: 'grilling', originalGoal: 'Reviewing Codex skill access for the dashboard' } } },
        });
        const session = groupByRalphSession([g])[0] as RalphSession;
        expect(session.title).toBe('Reviewing Codex skill access for the dashboard');
    });

    it('derives the session title from a history-item top-level ralph.originalGoal', () => {
        const i1 = makeIterationHistoryItem('sess-hist-title', 1, {
            createdAt: 1000,
            ralph: { sessionId: 'sess-hist-title', phase: 'executing', currentIteration: 1, originalGoal: '## Goal\nImprove Ralph session group titles' },
        });
        const session = groupByRalphSession([i1])[0] as RalphSession;
        expect(session.title).toBe('Improve Ralph session group titles');
    });

    it('prefers the grilling process goal over iteration goals', () => {
        const g = makeGrillingTask('sess-pref', {
            createdAt: 1000,
            payload: { mode: 'ask', context: { ralph: { sessionId: 'sess-pref', phase: 'grilling', originalGoal: 'Primary confirmed goal text' } } },
        });
        const i1 = makeIterationTask('sess-pref', 1, {
            createdAt: 2000,
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-pref', phase: 'executing', currentIteration: 1, originalGoal: 'Secondary iteration goal text' } } },
        });
        const session = groupByRalphSession([g, i1])[0] as RalphSession;
        expect(session.title).toBe('Primary confirmed goal text');
    });

    it('falls back through iterations when the grilling process lacks a goal', () => {
        const g = makeGrillingTask('sess-fall', { createdAt: 1000 });
        const i1 = makeIterationTask('sess-fall', 1, {
            createdAt: 2000,
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-fall', phase: 'executing', currentIteration: 1, originalGoal: 'Iteration-supplied goal' } } },
        });
        const session = groupByRalphSession([g, i1])[0] as RalphSession;
        expect(session.title).toBe('Iteration-supplied goal');
    });

    it('falls back to "Ralph Session" when no goal metadata is present', () => {
        const g = makeGrillingTask('sess-nogoal', { createdAt: 1000 });
        const session = groupByRalphSession([g])[0] as RalphSession;
        expect(session.title).toBe('Ralph Session');
    });
});

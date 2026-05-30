/**
 * Unit tests for enqueue-final-check.ts (AC-01).
 *
 * Covers:
 *  - In-memory idempotency (wasFinalCheckEnqueued / markFinalCheckEnqueued)
 *  - Persistent duplicate detection (sessionHasFinalCheckFor)
 *  - nextCheckIndex computation
 *  - buildFinalCheckTaskPayload structure
 *  - buildFinalCheckStartRecord shape
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    finalCheckIdempotencyKey,
    wasFinalCheckEnqueued,
    markFinalCheckEnqueued,
    _clearFinalCheckEnqueuedSet,
    sessionHasFinalCheckFor,
    nextCheckIndex,
    buildFinalCheckTaskPayload,
    buildFinalCheckStartRecord,
} from '../../../src/server/ralph/enqueue-final-check';
import type { RalphSessionRecord } from '../../../src/server/ralph/types';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<RalphSessionRecord>): RalphSessionRecord {
    return {
        sessionId: 'sess-01',
        workspaceId: 'ws-01',
        originalGoal: 'Do the thing.',
        maxIterations: 20,
        currentIteration: 4,
        phase: 'complete',
        startedAt: '2026-01-01T00:00:00.000Z',
        iterations: [],
        ...overrides,
    };
}

// ── In-memory idempotency ─────────────────────────────────────────────────────

describe('finalCheckIdempotencyKey', () => {
    it('returns "<sessionId>:<sourceIteration>"', () => {
        expect(finalCheckIdempotencyKey('sess-01', 4)).toBe('sess-01:4');
    });
});

describe('wasFinalCheckEnqueued / markFinalCheckEnqueued', () => {
    beforeEach(() => { _clearFinalCheckEnqueuedSet(); });

    it('returns false before any mark', () => {
        expect(wasFinalCheckEnqueued('sess-01', 4)).toBe(false);
    });

    it('returns true after marking', () => {
        markFinalCheckEnqueued('sess-01', 4);
        expect(wasFinalCheckEnqueued('sess-01', 4)).toBe(true);
    });

    it('is scoped by sessionId', () => {
        markFinalCheckEnqueued('sess-01', 4);
        expect(wasFinalCheckEnqueued('sess-02', 4)).toBe(false);
    });

    it('is scoped by sourceIteration', () => {
        markFinalCheckEnqueued('sess-01', 4);
        expect(wasFinalCheckEnqueued('sess-01', 5)).toBe(false);
    });

    it('returns false after clear', () => {
        markFinalCheckEnqueued('sess-01', 4);
        _clearFinalCheckEnqueuedSet();
        expect(wasFinalCheckEnqueued('sess-01', 4)).toBe(false);
    });
});

// ── Persistent duplicate detection ───────────────────────────────────────────

describe('sessionHasFinalCheckFor', () => {
    it('returns false when finalChecks is absent (legacy session)', () => {
        const session = makeSession();
        expect(sessionHasFinalCheckFor(session, 4)).toBe(false);
    });

    it('returns false when finalChecks is empty', () => {
        const session = makeSession({ finalChecks: [] });
        expect(sessionHasFinalCheckFor(session, 4)).toBe(false);
    });

    it('returns true when a check with matching sourceIteration exists', () => {
        const session = makeSession({
            finalChecks: [{
                checkIndex: 1, loopIndex: 1, sourceIteration: 4,
                startedAt: '2026-01-01T00:00:00.000Z', status: 'completed',
            }],
        });
        expect(sessionHasFinalCheckFor(session, 4)).toBe(true);
    });

    it('returns false when no check matches the given sourceIteration', () => {
        const session = makeSession({
            finalChecks: [{
                checkIndex: 1, loopIndex: 1, sourceIteration: 4,
                startedAt: '2026-01-01T00:00:00.000Z', status: 'completed',
            }],
        });
        expect(sessionHasFinalCheckFor(session, 5)).toBe(false);
    });
});

// ── nextCheckIndex ────────────────────────────────────────────────────────────

describe('nextCheckIndex', () => {
    it('returns 1 when finalChecks is absent', () => {
        expect(nextCheckIndex(makeSession())).toBe(1);
    });

    it('returns 1 when finalChecks is empty', () => {
        expect(nextCheckIndex(makeSession({ finalChecks: [] }))).toBe(1);
    });

    it('returns length + 1', () => {
        const session = makeSession({
            finalChecks: [
                { checkIndex: 1, loopIndex: 1, sourceIteration: 4, startedAt: '', status: 'completed' },
                { checkIndex: 2, loopIndex: 2, sourceIteration: 8, startedAt: '', status: 'completed' },
            ],
        });
        expect(nextCheckIndex(session)).toBe(3);
    });
});

// ── buildFinalCheckTaskPayload ────────────────────────────────────────────────

describe('buildFinalCheckTaskPayload', () => {
    it('produces a chat/ralph task with the correct context shape', () => {
        const result = buildFinalCheckTaskPayload({
            workspaceId: 'ws-01',
            sessionId: 'sess-01',
            originalGoal: 'Do the thing.',
            checkIndex: 1,
            sourceIteration: 4,
            loopIndex: 1,
            progressPath: '/home/user/.coc/repos/ws-01/ralph-sessions/sess-01/progress.md',
        });

        expect(result.type).toBe('chat');
        expect(result.payload.kind).toBe('chat');
        expect(result.payload.mode).toBe('ralph');
        expect(result.payload.context.ralph.finalCheck).toMatchObject({
            kind: 'goal-gap-check',
            checkIndex: 1,
            sourceIteration: 4,
            loopIndex: 1,
        });
        expect(result.payload.context.ralph.sessionId).toBe('sess-01');
        expect(result.payload.context.ralph.workspaceId ?? result.payload.workspaceId).toBe('ws-01');
    });

    it('includes the progress path in the prompt', () => {
        const result = buildFinalCheckTaskPayload({
            workspaceId: 'ws-01',
            sessionId: 'sess-01',
            originalGoal: 'Do the thing.',
            checkIndex: 1,
            sourceIteration: 4,
            loopIndex: 1,
            progressPath: '/home/user/.coc/repos/ws-01/ralph-sessions/sess-01/progress.md',
        });
        expect(result.payload.prompt).toContain('progress.md');
    });

    it('includes read-only instructions in the prompt', () => {
        const result = buildFinalCheckTaskPayload({
            workspaceId: 'ws-01',
            sessionId: 'sess-01',
            originalGoal: 'Do the thing.',
            checkIndex: 1,
            sourceIteration: 4,
            loopIndex: 1,
            progressPath: '/progress.md',
        });
        expect(result.payload.prompt).toContain('read-only');
    });

    it('sets displayName to include checkIndex and sessionId', () => {
        const result = buildFinalCheckTaskPayload({
            workspaceId: 'ws-01',
            sessionId: 'sess-01',
            originalGoal: 'Goal.',
            checkIndex: 2,
            sourceIteration: 8,
            loopIndex: 2,
            progressPath: '/progress.md',
        });
        expect(result.displayName).toContain('2');
        expect(result.displayName).toContain('sess-01');
    });

    it('sets continuationOfSessionId to sessionId for queue-continuity (AC-02)', () => {
        const result = buildFinalCheckTaskPayload({
            workspaceId: 'ws-01',
            sessionId: 'sess-01',
            originalGoal: 'Goal.',
            checkIndex: 1,
            sourceIteration: 4,
            loopIndex: 1,
            progressPath: '/progress.md',
        });
        expect(result.continuationOfSessionId).toBe('sess-01');
    });
});

// ── buildFinalCheckStartRecord ────────────────────────────────────────────────

describe('buildFinalCheckStartRecord', () => {
    it('builds a queued-status record', () => {
        const nowIso = '2026-01-01T12:00:00.000Z';
        const rec = buildFinalCheckStartRecord(1, 1, 4, 'task-123', 'proc-456', nowIso);
        expect(rec.checkIndex).toBe(1);
        expect(rec.loopIndex).toBe(1);
        expect(rec.sourceIteration).toBe(4);
        expect(rec.taskId).toBe('task-123');
        expect(rec.processId).toBe('proc-456');
        expect(rec.startedAt).toBe(nowIso);
        expect(rec.status).toBe('queued');
        expect(rec.hasGaps).toBeUndefined();
    });

    it('uses current timestamp when nowIso is omitted', () => {
        const before = Date.now();
        const rec = buildFinalCheckStartRecord(1, 1, 4, 'task-123');
        const after = Date.now();
        const ts = new Date(rec.startedAt).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });
});

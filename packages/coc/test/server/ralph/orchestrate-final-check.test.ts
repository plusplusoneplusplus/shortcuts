/**
 * Unit tests for orchestrate-final-check.ts (AC-03, AC-04, AC-05).
 *
 * Covers:
 *  - Clean result → broadcastSessionComplete('signal')
 *  - Gap result below cap → startNewLoop + enqueueTask + record gapLoopStarted
 *  - Gap result at cap → broadcastSessionComplete('cap') + capReached: true
 *  - Unparseable response → record status=failed + broadcastSessionComplete('final-check-failed')
 *  - Missing gapFixGoal → synthesize from gaps (goalSynthesized flag)
 *  - startNewLoop failure → record gapLoopStarted=false + broadcast
 *  - enqueueTask failure → record gapLoopStarted=false + broadcast
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { orchestrateFinalCheck, type OrchestrateFinalCheckDeps } from '../../../src/server/ralph/orchestrate-final-check';
import type { RalphSessionRecord, RalphFinalCheckRecord } from '../../../src/server/ralph/types';

// ── Shared test fixtures ──────────────────────────────────────────────────────

const SESSION_ID = 'sess-01';
const WORKSPACE_ID = 'ws-01';
const PROCESS_ID = 'proc-01';
const TASK_ID = 'task-01';
const LOOP_INDEX = 1;
const SOURCE_ITERATION = 4;
const CHECK_INDEX = 1;
const NOW = '2026-01-01T00:00:00.000Z';

const MARKER = 'RALPH_FINAL_CHECK_RESULT';

function makeCleanResponse(): string {
    return `RALPH_FINAL_CHECK_RESULT\n\`\`\`json\n${JSON.stringify({
        marker: MARKER,
        hasGaps: false,
        summary: 'All acceptance criteria are satisfied.',
        gaps: [],
    }, null, 2)}\n\`\`\``;
}

function makeGapsResponse(gapFixGoal?: string): string {
    const obj: Record<string, unknown> = {
        marker: MARKER,
        hasGaps: true,
        summary: 'Two gaps found.',
        gaps: [
            { id: 'GAP-01', title: 'Missing test', evidence: 'No test run.', recommendedAction: 'Run tests.' },
        ],
    };
    if (gapFixGoal !== undefined) obj.gapFixGoal = gapFixGoal;
    return `RALPH_FINAL_CHECK_RESULT\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
}

function makeSession(overrides?: Partial<RalphSessionRecord>): RalphSessionRecord {
    return {
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        originalGoal: 'Do the thing.',
        maxIterations: 20,
        currentIteration: SOURCE_ITERATION,
        phase: 'complete',
        terminalReason: 'RALPH_COMPLETE',
        startedAt: '2026-01-01T00:00:00.000Z',
        iterations: [],
        ...overrides,
    };
}

function makeDeps(overrides?: Partial<OrchestrateFinalCheckDeps>): OrchestrateFinalCheckDeps {
    const upsertFinalCheckRecord = vi.fn().mockResolvedValue(makeSession());
    const appendFinalCheckSection = vi.fn().mockResolvedValue(undefined);
    const readSessionRecord = vi.fn().mockResolvedValue(makeSession());
    const startNewLoop = vi.fn().mockResolvedValue(makeSession({
        maxIterations: 40,
        currentIteration: SOURCE_ITERATION,
        phase: 'executing',
        loops: [
            { loopIndex: 1, goal: 'original', startIteration: 1, startedAt: NOW },
            { loopIndex: 2, goal: 'gap-fix', startIteration: SOURCE_ITERATION + 1, startedAt: NOW },
        ],
    }));

    const store = {
        upsertFinalCheckRecord,
        appendFinalCheckSection,
        readSessionRecord: readSessionRecord as any,
        startNewLoop: startNewLoop as any,
    } as any;

    return {
        store,
        enqueueTask: vi.fn().mockReturnValue('new-task-id'),
        broadcastSessionComplete: vi.fn(),
        maxGapFixLoops: 3,
        ...overrides,
    };
}

function makeInput(responseText: string, deps: OrchestrateFinalCheckDeps) {
    return {
        workspaceId: WORKSPACE_ID,
        sessionId: SESSION_ID,
        checkIndex: CHECK_INDEX,
        loopIndex: LOOP_INDEX,
        sourceIteration: SOURCE_ITERATION,
        taskId: TASK_ID,
        processId: PROCESS_ID,
        responseText,
        deps,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('orchestrateFinalCheck', () => {

    describe('clean result (hasGaps: false)', () => {
        it('persists a completed/clean record', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeCleanResponse(), deps));

            expect(deps.store.upsertFinalCheckRecord).toHaveBeenCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ status: 'completed', hasGaps: false, gapLoopStarted: false }),
            );
        });

        it('broadcasts session-complete with reason "signal"', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeCleanResponse(), deps));

            expect(deps.broadcastSessionComplete).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'signal', sessionId: SESSION_ID }),
            );
        });

        it('does not call enqueueTask', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeCleanResponse(), deps));
            expect(deps.enqueueTask).not.toHaveBeenCalled();
        });

        it('does not call startNewLoop', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeCleanResponse(), deps));
            expect(deps.store.startNewLoop).not.toHaveBeenCalled();
        });
    });

    describe('gaps result below cap', () => {
        it('calls startNewLoop with a gap-focused goal', async () => {
            const deps = makeDeps();
            const gapFixGoal = 'Fix only the listed gaps.';
            await orchestrateFinalCheck(makeInput(makeGapsResponse(gapFixGoal), deps));

            expect(deps.store.startNewLoop).toHaveBeenCalledWith(
                WORKSPACE_ID, SESSION_ID, gapFixGoal, expect.any(Number), expect.any(String),
            );
        });

        it('enqueues a gap-fix iteration task', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));
            expect(deps.enqueueTask).toHaveBeenCalledTimes(1);
        });

        it('keeps auto-provider routing requested for gap-fix iterations instead of carrying the resolved provider', async () => {
            const deps = makeDeps({
                provider: 'claude',
                extraContext: {
                    autoProviderRouting: {
                        requested: true,
                        selectedByAuto: true,
                        provider: 'claude',
                        fallbackUsed: false,
                    },
                },
            });

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            const enqueuedTask = (deps.enqueueTask as Mock).mock.calls[0][0];
            expect(enqueuedTask.payload.provider).toBeUndefined();
            expect(enqueuedTask.payload.context.autoProviderRouting.requested).toBe(true);
        });

        it('persists record with gapLoopStarted=true and gapCount=1', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.store.upsertFinalCheckRecord).toHaveBeenLastCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({
                    status: 'completed',
                    hasGaps: true,
                    gapCount: 1,
                    gapLoopStarted: true,
                }),
            );
        });

        it('does NOT broadcast session-complete', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));
            expect(deps.broadcastSessionComplete).not.toHaveBeenCalled();
        });
    });

    describe('gaps result at cap', () => {
        it('does not call startNewLoop', async () => {
            const session = makeSession({
                finalChecks: [
                    { checkIndex: 1, loopIndex: 1, sourceIteration: 2, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 2, loopIndex: 2, sourceIteration: 6, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 3, loopIndex: 3, sourceIteration: 10, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                ],
            });
            const deps = makeDeps();
            (deps.store.readSessionRecord as Mock).mockResolvedValue(session);

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.store.startNewLoop).not.toHaveBeenCalled();
        });

        it('persists capReached: true', async () => {
            const session = makeSession({
                finalChecks: [
                    { checkIndex: 1, loopIndex: 1, sourceIteration: 2, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 2, loopIndex: 2, sourceIteration: 6, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 3, loopIndex: 3, sourceIteration: 10, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                ],
            });
            const deps = makeDeps();
            (deps.store.readSessionRecord as Mock).mockResolvedValue(session);

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.store.upsertFinalCheckRecord).toHaveBeenCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ capReached: true, gapLoopStarted: false }),
            );
        });

        it('broadcasts session-complete with reason "cap"', async () => {
            const session = makeSession({
                finalChecks: [
                    { checkIndex: 1, loopIndex: 1, sourceIteration: 2, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 2, loopIndex: 2, sourceIteration: 6, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                    { checkIndex: 3, loopIndex: 3, sourceIteration: 10, startedAt: NOW, status: 'completed', gapLoopStarted: true },
                ],
            });
            const deps = makeDeps();
            (deps.store.readSessionRecord as Mock).mockResolvedValue(session);

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.broadcastSessionComplete).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'cap' }),
            );
        });
    });

    describe('unparseable response', () => {
        it('records status=failed with explicit gap metadata', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput('This is not a valid response', deps));

            expect(deps.store.upsertFinalCheckRecord).toHaveBeenCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ status: 'failed', hasGaps: false, gapCount: 0 }),
            );
        });

        it('broadcasts session-complete with reason "final-check-failed"', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput('Not parseable.', deps));

            expect(deps.broadcastSessionComplete).toHaveBeenCalledWith(
                expect.objectContaining({ reason: 'final-check-failed' }),
            );
        });

        it('does not call enqueueTask', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput('Bad response.', deps));
            expect(deps.enqueueTask).not.toHaveBeenCalled();
        });
    });

    describe('missing gapFixGoal', () => {
        it('synthesizes a goal from gaps when gapFixGoal is absent', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeGapsResponse(), deps));

            // The parser synthesizes the goal before orchestrate sees it
            const callArg = (deps.store.startNewLoop as Mock).mock.calls[0][2] as string;
            expect(callArg).toContain('Missing test');
        });

        it('sets goalSynthesized=true in the persisted record (from parser)', async () => {
            const deps = makeDeps();
            await orchestrateFinalCheck(makeInput(makeGapsResponse(), deps));

            // The parser sets goalSynthesized: true; orchestrate passes it through
            expect(deps.store.upsertFinalCheckRecord).toHaveBeenLastCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ goalSynthesized: true }),
            );
        });
    });

    describe('startNewLoop failure', () => {
        it('persists gapLoopStarted=false and does not enqueue', async () => {
            const deps = makeDeps();
            (deps.store.startNewLoop as Mock).mockRejectedValue(new Error('Session not eligible'));

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.enqueueTask).not.toHaveBeenCalled();
            expect(deps.store.upsertFinalCheckRecord).toHaveBeenLastCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ gapLoopStarted: false }),
            );
        });
    });

    describe('enqueueTask failure', () => {
        it('persists gapLoopStarted=false and broadcasts a terminal event', async () => {
            const deps = makeDeps({
                enqueueTask: vi.fn().mockImplementation(() => {
                    throw new Error('Queue full');
                }),
            });

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            expect(deps.store.upsertFinalCheckRecord).toHaveBeenLastCalledWith(
                WORKSPACE_ID, SESSION_ID, CHECK_INDEX,
                expect.objectContaining({ gapLoopStarted: false, hasGaps: true, gapCount: 1 }),
            );
            expect(deps.broadcastSessionComplete).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                    sessionId: SESSION_ID,
                    processId: PROCESS_ID,
                    totalIterations: SOURCE_ITERATION,
                    reason: 'final-check-gap-enqueue-failed',
                }),
            );
        });
    });

    describe('legacy session (no finalChecks array)', () => {
        it('correctly reports no existing gap loops (cap check passes)', async () => {
            const session = makeSession(); // no finalChecks
            const deps = makeDeps({ maxGapFixLoops: 3 });
            (deps.store.readSessionRecord as Mock).mockResolvedValue(session);

            await orchestrateFinalCheck(makeInput(makeGapsResponse('Fix it.'), deps));

            // Should start a loop (not hit cap on first check)
            expect(deps.store.startNewLoop).toHaveBeenCalledTimes(1);
        });
    });
});

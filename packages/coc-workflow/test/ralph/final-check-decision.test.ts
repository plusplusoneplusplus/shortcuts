import { describe, expect, it } from 'vitest';
import {
    decideRalphFinalCheckActions,
    formatFinalCheckProgressSection,
    type RalphFinalCheckAction,
    type RalphSessionRecord,
} from '../../src/ralph';

const MARKER = 'RALPH_FINAL_CHECK_RESULT';
const NOW = '2026-06-03T00:00:00.000Z';

const baseInput = {
    taskId: 'task-1',
    processId: 'process-1',
    workspaceId: 'ws-1',
    sessionId: 'ralph-1',
    checkIndex: 1,
    loopIndex: 1,
    sourceIteration: 4,
    maxGapFixLoops: 3,
    nowIso: NOW,
    adapterContext: { scheduleId: 'schedule-1', scheduleRunId: 'run-1' },
};

function wrapFinalCheck(json: unknown): string {
    return `${MARKER}\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\``;
}

function cleanResponse(): string {
    return wrapFinalCheck({
        marker: MARKER,
        hasGaps: false,
        summary: 'All acceptance criteria are satisfied.',
        gaps: [],
    });
}

function gapsResponse(gapFixGoal?: string): string {
    return wrapFinalCheck({
        marker: MARKER,
        hasGaps: true,
        summary: 'One gap remains.',
        gaps: [
            {
                id: 'GAP-01',
                title: 'Missing validation',
                evidence: 'No build output was recorded.',
                recommendedAction: 'Run the package build.',
                validation: 'npm run build',
            },
        ],
        ...(gapFixGoal !== undefined ? { gapFixGoal } : {}),
    });
}

function contradictoryResponse(): string {
    return wrapFinalCheck({
        marker: MARKER,
        hasGaps: false,
        summary: 'Looks clean but lists a gap.',
        gaps: [
            {
                id: 'GAP-01',
                title: 'Contradiction',
                evidence: 'A gap is present.',
                recommendedAction: 'Fix it.',
            },
        ],
    });
}

function sessionWithGapLoops(count: number): Pick<RalphSessionRecord, 'finalChecks'> {
    return {
        finalChecks: Array.from({ length: count }, (_, index) => ({
            checkIndex: index + 1,
            loopIndex: index + 1,
            sourceIteration: (index + 1) * 2,
            startedAt: NOW,
            status: 'completed' as const,
            gapLoopStarted: true,
        })),
    };
}

function action<T extends RalphFinalCheckAction['type']>(
    actions: RalphFinalCheckAction<typeof baseInput.adapterContext>[],
    type: T,
): Extract<RalphFinalCheckAction<typeof baseInput.adapterContext>, { type: T }> {
    const found = actions.find(item => item.type === type);
    expect(found).toBeDefined();
    return found as Extract<RalphFinalCheckAction<typeof baseInput.adapterContext>, { type: T }>;
}

describe('formatFinalCheckProgressSection', () => {
    it('formats clean, failed, and gaps sections using the existing journal grammar', () => {
        const clean = formatFinalCheckProgressSection({
            checkIndex: 1,
            loopIndex: 2,
            timestamp: NOW,
            result: {
                status: 'clean',
                hasGaps: false,
                summary: 'All done.',
                gaps: [],
            },
        });
        expect(clean).toContain(`## Final Check 1 - CLEAN - ${NOW}`);
        expect(clean).toContain('Loop: 2');

        const failed = formatFinalCheckProgressSection({
            checkIndex: 2,
            loopIndex: 2,
            timestamp: NOW,
            result: {
                status: 'unparseable',
                hasGaps: false,
                summary: '',
                gaps: [],
                error: 'No marker',
            },
        });
        expect(failed).toContain(`## Final Check 2 - FAILED - ${NOW}`);
        expect(failed).toContain('Error: No marker');

        const gaps = formatFinalCheckProgressSection({
            checkIndex: 3,
            loopIndex: 2,
            timestamp: NOW,
            result: {
                status: 'gaps',
                hasGaps: true,
                summary: 'Gap remains.',
                gaps: [{
                    id: 'GAP-01',
                    title: 'Missing validation',
                    evidence: 'No output.',
                    recommendedAction: 'Run tests.',
                    validation: 'npm test',
                }],
                gapFixGoal: 'Fix the missing validation.',
            },
        });
        expect(gaps).toContain(`## Final Check 3 - GAPS - ${NOW}`);
        expect(gaps).toContain('### Gaps (1)');
        expect(gaps).toContain('Validation: `npm test`');
        expect(gaps).toContain('Fix the missing validation.');
    });
});

describe('decideRalphFinalCheckActions', () => {
    it('records a clean final-check output and broadcasts signal completion', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: cleanResponse(),
            session: { finalChecks: [{ checkIndex: 1, loopIndex: 1, sourceIteration: 4, startedAt: 'started-at', status: 'running' }] },
        });

        expect(decision.result.status).toBe('clean');
        expect(decision.actions.map(item => item.type)).toEqual([
            'appendFinalCheckSection',
            'upsertFinalCheckRecord',
            'broadcastSessionComplete',
        ]);
        expect(action(decision.actions, 'appendFinalCheckSection')).toMatchObject({
            section: expect.stringContaining('## Final Check 1 - CLEAN'),
            adapterContext: baseInput.adapterContext,
        });
        expect(action(decision.actions, 'upsertFinalCheckRecord').record).toMatchObject({
            status: 'completed',
            hasGaps: false,
            gapCount: 0,
            gapLoopStarted: false,
            startedAt: 'started-at',
            completedAt: NOW,
            taskId: 'task-1',
            processId: 'process-1',
        });
        expect(action(decision.actions, 'broadcastSessionComplete')).toMatchObject({
            totalIterations: 4,
            reason: 'signal',
        });
    });

    it('records unparseable output as final-check-failed', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: 'No structured result here.',
            session: null,
        });

        expect(decision.result.status).toBe('unparseable');
        expect(decision.progressSection).toContain('FAILED');
        expect(action(decision.actions, 'upsertFinalCheckRecord').record).toMatchObject({
            status: 'failed',
            hasGaps: false,
            gapCount: 0,
        });
        expect(action(decision.actions, 'broadcastSessionComplete').reason).toBe('final-check-failed');
    });

    it('records contradictory output as final-check-failed', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: contradictoryResponse(),
            session: null,
        });

        expect(decision.result.status).toBe('invalid');
        expect(decision.result.error).toContain('non-empty');
        expect(action(decision.actions, 'upsertFinalCheckRecord').record).toMatchObject({
            status: 'failed',
            hasGaps: false,
            gapCount: 0,
        });
        expect(action(decision.actions, 'broadcastSessionComplete').reason).toBe('final-check-failed');
    });

    it('starts a gap-fix loop when gaps are below maxGapFixLoops', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: gapsResponse('Fix only GAP-01.'),
            session: sessionWithGapLoops(2),
        });

        expect(decision.result.status).toBe('gaps');
        expect(decision.existingGapFixLoops).toBe(2);
        expect(decision.actions.map(item => item.type)).toEqual([
            'appendFinalCheckSection',
            'startGapFixLoop',
        ]);
        expect(action(decision.actions, 'startGapFixLoop')).toMatchObject({
            gapFixGoal: 'Fix only GAP-01.',
            gapCount: 1,
            goalSynthesized: false,
            existingGapFixLoops: 2,
            maxGapFixLoops: 3,
            startFailureReason: 'final-check-gap-loop-start-failed',
            enqueueFailureReason: 'final-check-gap-enqueue-failed',
            failureRecord: {
                status: 'completed',
                hasGaps: true,
                gapCount: 1,
                gapLoopStarted: false,
                goalSynthesized: false,
            },
            successRecordBase: {
                status: 'completed',
                hasGaps: true,
                gapCount: 1,
                gapLoopStarted: true,
            },
        });
    });

    it('caps gap-fix automation when gaps reach maxGapFixLoops', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: gapsResponse('Fix only GAP-01.'),
            session: sessionWithGapLoops(3),
        });

        expect(decision.existingGapFixLoops).toBe(3);
        expect(decision.actions.map(item => item.type)).toEqual([
            'appendFinalCheckSection',
            'upsertFinalCheckRecord',
            'broadcastSessionComplete',
        ]);
        expect(action(decision.actions, 'upsertFinalCheckRecord').record).toMatchObject({
            status: 'completed',
            hasGaps: true,
            gapCount: 1,
            gapLoopStarted: false,
            capReached: true,
        });
        expect(action(decision.actions, 'broadcastSessionComplete')).toMatchObject({
            totalIterations: 4,
            reason: 'cap',
        });
    });

    it('synthesizes a missing gapFixGoal and marks the start intent', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: gapsResponse(),
            session: sessionWithGapLoops(0),
        });

        const start = action(decision.actions, 'startGapFixLoop');
        expect(decision.result.goalSynthesized).toBe(true);
        expect(start.goalSynthesized).toBe(true);
        expect(start.gapFixGoal).toContain('Missing validation');
        expect(start.failureRecord).toMatchObject({ goalSynthesized: true });
        expect(start.successRecordBase).toMatchObject({ goalSynthesized: true });
    });
});

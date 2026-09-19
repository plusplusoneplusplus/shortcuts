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

function repairedCheckRecord(checkIndex: number) {
    return {
        checkIndex,
        loopIndex: 1,
        sourceIteration: 4,
        startedAt: NOW,
        status: 'running' as const,
        repairAttempted: true,
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

    it('requests a format-repair turn for unparseable output instead of ending the session', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: 'No structured result here.',
            session: null,
        });

        expect(decision.result.status).toBe('unparseable');
        expect(decision.progressSection).toContain('RESULT FORMAT REPAIR REQUESTED');
        const repair = action(decision.actions, 'requestFinalCheckRepair');
        expect(repair.repairPrompt).toContain('RALPH_FINAL_CHECK_RESULT');
        expect(repair.repairPrompt).toContain('Do not re-run any validation');
        expect(repair.pendingRecord).toMatchObject({ status: 'running', repairAttempted: true });
        expect(repair.failureRecord).toMatchObject({ status: 'failed', repairAttempted: true });
        expect(repair.failureSection).toContain('FAILED');
        expect(decision.actions.some(a => a.type === 'broadcastSessionComplete')).toBe(false);
        expect(decision.actions.some(a => a.type === 'upsertFinalCheckRecord')).toBe(false);
    });

    it('takes the same repair path for contradictory (invalid) output', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: contradictoryResponse(),
            session: null,
        });

        expect(decision.result.status).toBe('invalid');
        expect(decision.result.error).toContain('non-empty');
        expect(action(decision.actions, 'requestFinalCheckRepair').pendingRecord.repairAttempted).toBe(true);
        expect(decision.actions.some(a => a.type === 'broadcastSessionComplete')).toBe(false);
    });

    it('fails the check when a repair was already attempted for this checkIndex', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: 'Still no structured result.',
            session: { finalChecks: [repairedCheckRecord(baseInput.checkIndex)] },
        });

        expect(decision.progressSection).toContain('FAILED');
        expect(decision.actions.some(a => a.type === 'requestFinalCheckRepair')).toBe(false);
        expect(action(decision.actions, 'upsertFinalCheckRecord').record).toMatchObject({ status: 'failed' });
        expect(action(decision.actions, 'broadcastSessionComplete').reason).toBe('final-check-failed');
    });

    it('does not reuse another checkIndex\'s repair attempt', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            checkIndex: 2,
            responseText: 'No structured result here.',
            session: { finalChecks: [repairedCheckRecord(1)] },
        });

        expect(decision.actions.some(a => a.type === 'requestFinalCheckRepair')).toBe(true);
    });

    it('omits hasGaps/gapCount on a failed record rather than asserting zero gaps', () => {
        const decision = decideRalphFinalCheckActions({
            ...baseInput,
            responseText: 'Nope.',
            session: { finalChecks: [repairedCheckRecord(baseInput.checkIndex)] },
        });

        const record = action(decision.actions, 'upsertFinalCheckRecord').record;
        expect(record).not.toHaveProperty('hasGaps');
        expect(record).not.toHaveProperty('gapCount');
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

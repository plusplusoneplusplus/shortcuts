import { describe, expect, it } from 'vitest';
import * as workflowRalph from '@plusplusoneplusplus/coc-workflow/ralph';
import {
    appendProgress,
    parseRalphSignal,
} from '../../../src/server/executors/ralph-signal-parser';
import { buildFinalCheckPrompt } from '../../../src/server/ralph/final-check-prompt';
import { parseFinalCheckResult } from '../../../src/server/ralph/final-check-result-parser';
import { buildRalphIterationPrompt } from '../../../src/server/ralph/iteration-prompt';
import {
    RalphSessionStore,
    parseProgressSections,
} from '../../../src/server/ralph/ralph-session-store';
import type {
    RalphFinalCheckRecord as CompatFinalCheckRecord,
    RalphSessionRecord as CompatSessionRecord,
} from '../../../src/server/ralph/types';
import type {
    RalphFinalCheckRecord as WorkflowFinalCheckRecord,
    RalphSessionRecord as WorkflowSessionRecord,
} from '@plusplusoneplusplus/coc-workflow/ralph';

function acceptsWorkflowSessionRecord(record: WorkflowSessionRecord): WorkflowSessionRecord {
    return record;
}

function acceptsWorkflowFinalCheckRecord(record: WorkflowFinalCheckRecord): WorkflowFinalCheckRecord {
    return record;
}

describe('Ralph CoC compatibility exports', () => {
    it('re-exports portable parser and prompt helpers from coc-workflow/ralph', () => {
        expect(parseRalphSignal).toBe(workflowRalph.parseRalphSignal);
        expect(appendProgress).toBe(workflowRalph.appendProgress);
        expect(buildRalphIterationPrompt).toBe(workflowRalph.buildRalphIterationPrompt);
        expect(buildFinalCheckPrompt).toBe(workflowRalph.buildFinalCheckPrompt);
        expect(parseFinalCheckResult).toBe(workflowRalph.parseFinalCheckResult);
    });

    it('keeps CoC progress-section parsing compatible with the portable helper', () => {
        const progress = [
            '# Ralph Session: sess-1',
            '## Iteration 1 — RALPH_NEXT — 2026-06-03T00:00:00.000Z',
            'Files: a.ts',
            '## Iteration 2 - RALPH_COMPLETE - 2026-06-03T00:10:00.000Z',
            'Remaining: none',
        ].join('\n');

        expect(parseProgressSections(progress)).toEqual(workflowRalph.parseProgressSections(progress));
        expect(RalphSessionStore.parseProgressSections(progress)).toEqual(workflowRalph.parseProgressSections(progress));
    });

    it('keeps CoC type aliases assignable to the portable record contracts', () => {
        const compatSession: CompatSessionRecord = {
            sessionId: 'sess-1',
            workspaceId: 'ws-1',
            originalGoal: 'Goal',
            maxIterations: 20,
            currentIteration: 1,
            phase: 'complete',
            startedAt: '2026-06-03T00:00:00.000Z',
            completedAt: '2026-06-03T00:05:00.000Z',
            terminalReason: 'RALPH_COMPLETE',
            iterations: [{
                iteration: 1,
                loopIndex: 1,
                taskId: 'task-1',
                processId: 'queue_proc-1',
                startedAt: '2026-06-03T00:00:00.000Z',
                endedAt: '2026-06-03T00:05:00.000Z',
                status: 'completed',
                exitSignal: 'RALPH_COMPLETE',
            }],
        };

        const compatFinalCheck: CompatFinalCheckRecord = {
            checkIndex: 1,
            loopIndex: 1,
            sourceIteration: 1,
            taskId: 'task-final',
            processId: 'queue_final',
            startedAt: '2026-06-03T00:06:00.000Z',
            completedAt: '2026-06-03T00:07:00.000Z',
            status: 'completed',
            hasGaps: false,
            gapCount: 0,
            gapLoopStarted: false,
            summary: 'Clean.',
        };

        expect(acceptsWorkflowSessionRecord(compatSession).sessionId).toBe('sess-1');
        expect(acceptsWorkflowFinalCheckRecord(compatFinalCheck).status).toBe('completed');
    });
});

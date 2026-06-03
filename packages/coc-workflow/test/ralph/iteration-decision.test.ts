import { describe, expect, it } from 'vitest';
import { decideRalphIterationActions, type RalphIterationAction } from '../../src/ralph';

const baseInput = {
    taskId: 'task-1',
    processId: 'queue_task-1',
    workspaceId: 'ws-1',
    sessionId: 'ralph-1',
    originalGoal: 'Complete the goal.',
    currentIteration: 1,
    maxIterations: 3,
    adapterContext: { scheduleId: 'schedule-1', scheduleRunId: 'run-1' },
    iterationStartMs: 1234,
};

function action<T extends RalphIterationAction['type']>(
    actions: RalphIterationAction<typeof baseInput.adapterContext>[],
    type: T,
): Extract<RalphIterationAction<typeof baseInput.adapterContext>, { type: T }> {
    const found = actions.find(item => item.type === type);
    expect(found).toBeDefined();
    return found as Extract<RalphIterationAction<typeof baseInput.adapterContext>, { type: T }>;
}

describe('decideRalphIterationActions', () => {
    it('records and enqueues the next iteration when RALPH_NEXT is below the cap', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'Work done.\n\nRALPH_PROGRESS:\nFiles: a.ts\nRemaining: more\nRALPH_NEXT',
        });

        expect(decision).toMatchObject({
            signal: 'RALPH_NEXT',
            progress: 'Files: a.ts\nRemaining: more',
            currentIteration: 1,
            maxIterations: 3,
            shouldContinue: true,
        });
        expect(decision.terminalReason).toBeUndefined();
        expect(decision.actions.map(item => item.type)).toEqual(['recordIteration', 'enqueueNextIteration']);

        expect(action(decision.actions, 'recordIteration')).toMatchObject({
            iteration: 1,
            maxIterations: 3,
            signal: 'RALPH_NEXT',
            progressBody: 'Files: a.ts\nRemaining: more',
            shouldContinue: true,
            taskId: 'task-1',
            processId: 'queue_task-1',
            originalGoal: 'Complete the goal.',
            iterationStartMs: 1234,
        });

        expect(action(decision.actions, 'enqueueNextIteration')).toMatchObject({
            iteration: 2,
            maxIterations: 3,
            sessionId: 'ralph-1',
            continuationOfSessionId: 'ralph-1',
            displayName: 'Ralph iteration 2 (ralph-1)',
            originalGoal: 'Complete the goal.',
            adapterContext: baseInput.adapterContext,
        });
    });

    it('records, surfaces CAP_REACHED, and completes the session when RALPH_NEXT is at the cap', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            currentIteration: 3,
            maxIterations: 3,
            responseText: 'Still more to do.\nRALPH_PROGRESS:\nRemaining: more\nRALPH_NEXT',
        });

        expect(decision).toMatchObject({
            signal: 'RALPH_NEXT',
            shouldContinue: false,
            terminalReason: 'CAP_REACHED',
            completionReason: 'cap',
        });
        expect(decision.actions.map(item => item.type)).toEqual([
            'recordIteration',
            'surfaceTerminalReason',
            'completeSession',
        ]);
        expect(action(decision.actions, 'recordIteration')).toMatchObject({
            shouldContinue: false,
            terminalReason: 'CAP_REACHED',
        });
        expect(action(decision.actions, 'surfaceTerminalReason')).toMatchObject({
            iteration: 3,
            signal: 'RALPH_NEXT',
            terminalReason: 'CAP_REACHED',
            completionReason: 'cap',
        });
        expect(action(decision.actions, 'completeSession')).toMatchObject({
            processId: 'queue_task-1',
            totalIterations: 3,
            terminalReason: 'CAP_REACHED',
            completionReason: 'cap',
        });
    });

    it('records, surfaces RALPH_COMPLETE, and requests a final check when complete', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            currentIteration: 2,
            maxIterations: 5,
            responseText: 'All done.\n\nRALPH_PROGRESS:\nRemaining: none\nRALPH_COMPLETE',
        });

        expect(decision).toMatchObject({
            signal: 'RALPH_COMPLETE',
            shouldContinue: false,
            terminalReason: 'RALPH_COMPLETE',
            completionReason: 'signal',
        });
        expect(decision.actions.map(item => item.type)).toEqual([
            'recordIteration',
            'surfaceTerminalReason',
            'enqueueFinalCheck',
        ]);
        expect(action(decision.actions, 'recordIteration')).toMatchObject({
            iteration: 2,
            shouldContinue: false,
            terminalReason: 'RALPH_COMPLETE',
        });
        expect(action(decision.actions, 'enqueueFinalCheck')).toMatchObject({
            sourceIteration: 2,
            maxIterations: 5,
            sessionId: 'ralph-1',
            continuationOfSessionId: 'ralph-1',
            originalGoal: 'Complete the goal.',
            terminalReason: 'RALPH_COMPLETE',
            completionReason: 'signal',
            adapterContext: baseInput.adapterContext,
        });
    });

    it('records, surfaces NO_SIGNAL, and completes the session for missing or invalid signals', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'I forgot to emit a valid Ralph signal. RALPH_NEXTEND',
        });

        expect(decision).toMatchObject({
            signal: 'NONE',
            progress: '',
            shouldContinue: false,
            terminalReason: 'NO_SIGNAL',
            completionReason: 'cap',
        });
        expect(decision.actions.map(item => item.type)).toEqual([
            'recordIteration',
            'surfaceTerminalReason',
            'completeSession',
        ]);
        expect(action(decision.actions, 'recordIteration')).toMatchObject({
            signal: 'NONE',
            progressBody: '',
            shouldContinue: false,
            terminalReason: 'NO_SIGNAL',
        });
        expect(action(decision.actions, 'completeSession')).toMatchObject({
            totalIterations: 1,
            terminalReason: 'NO_SIGNAL',
            completionReason: 'cap',
        });
    });

    it('falls back to processId for continuation when no sessionId is present', () => {
        const decision = decideRalphIterationActions({
            responseText: 'Next.\nRALPH_NEXT',
            taskId: 'task-no-session',
            processId: 'queue_no-session',
            currentIteration: 1,
            maxIterations: 2,
        });

        expect(action(decision.actions, 'enqueueNextIteration')).toMatchObject({
            sessionId: 'queue_no-session',
            continuationOfSessionId: 'queue_no-session',
            displayName: 'Ralph iteration 2',
        });
    });
});

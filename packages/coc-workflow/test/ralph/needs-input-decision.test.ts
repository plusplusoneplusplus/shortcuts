import { describe, expect, it } from 'vitest';
import {
    decideRalphIterationActions,
    formatProgressSection,
    parseFinalCheckResult,
    parseProgressSections,
    parseRalphSignal,
    parseRalphSubmitResult,
} from '../../src/ralph';

const baseInput = {
    taskId: 'task-2',
    processId: 'queue_task-2',
    workspaceId: 'ws-1',
    sessionId: 'ralph-1',
    originalGoal: 'Complete the goal.',
    currentIteration: 2,
    maxIterations: 5,
    iterationStartMs: 99,
};

const validBlock = [
    'RALPH_NEEDS_INPUT',
    '```json',
    JSON.stringify({
        context: 'The [decision] item says SQLite but the repo only ships Postgres.',
        questions: [{
            question: 'Which store should I use?',
            type: 'select',
            options: [{ value: 'sqlite', label: 'SQLite' }, { value: 'pg', label: 'Postgres' }],
            recommendation: 'pg',
        }],
    }),
    '```',
].join('\n');

describe('decideRalphIterationActions — RALPH_NEEDS_INPUT', () => {
    it('returns awaitInput with no enqueue or terminal action for a valid block', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: `Blocked.\n\nRALPH_PROGRESS:\nFiles: none\nRemaining: need answer\n${validBlock}`,
        });

        expect(decision.signal).toBe('RALPH_NEEDS_INPUT');
        expect(decision.shouldContinue).toBe(false);
        expect(decision.terminalReason).toBeUndefined();
        expect(decision.completionReason).toBeUndefined();
        expect(decision.progress).toBe('Files: none\nRemaining: need answer');
        expect(decision.inputRequest?.questions[0].recommendation).toBe('pg');
        expect(decision.actions.map(a => a.type)).toEqual(['recordIteration', 'awaitInput']);
        expect(decision.actions[0]).toMatchObject({
            signal: 'RALPH_NEEDS_INPUT',
            shouldContinue: false,
            iteration: 2,
            signalSource: 'response',
        });
        expect(decision.actions[0]).not.toHaveProperty('terminalReason', expect.anything());
        expect(decision.actions[1]).toMatchObject({
            type: 'awaitInput',
            workspaceId: 'ws-1',
            sessionId: 'ralph-1',
            iteration: 2,
            taskId: 'task-2',
            processId: 'queue_task-2',
            request: { context: expect.stringContaining('SQLite') },
        });
    });

    it('lets a valid block win over a stray RALPH_NEXT token', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: `${validBlock}\nRALPH_NEXT`,
        });
        expect(decision.signal).toBe('RALPH_NEEDS_INPUT');
        expect(decision.actions.some(a => a.type === 'enqueueNextIteration')).toBe(false);
    });

    it('still awaits input at the iteration cap (the user decides what happens next)', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            currentIteration: 5,
            responseText: validBlock,
        });
        expect(decision.actions.map(a => a.type)).toEqual(['recordIteration', 'awaitInput']);
    });

    it('falls back to NO_SIGNAL for a malformed block', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'RALPH_NEEDS_INPUT\n```json\n{"context": "x", "questions": [}\n```',
        });
        expect(decision.signal).toBe('NONE');
        expect(decision.terminalReason).toBe('NO_SIGNAL');
        expect(decision.actions.some(a => a.type === 'awaitInput')).toBe(false);
    });

    it('falls back to the inline signal when the block is malformed but RALPH_NEXT is present', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'RALPH_NEEDS_INPUT\n```json\n{"questions": []}\n```\nRALPH_NEXT',
        });
        expect(decision.signal).toBe('RALPH_NEXT');
        expect(decision.actions.map(a => a.type)).toEqual(['recordIteration', 'enqueueNextIteration']);
    });

    it('treats a journal-only RALPH_NEEDS_INPUT section as no signal', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'I am blocked but forgot the block.',
            recentProgressSections: [{ iteration: 2, signal: 'RALPH_NEEDS_INPUT', body: 'Remaining: answer' }],
        });
        expect(decision.signal).toBe('NONE');
        expect(decision.terminalReason).toBe('NO_SIGNAL');
    });

    it('still recovers an earlier decisive section when a later NEEDS_INPUT section exists', () => {
        const decision = decideRalphIterationActions({
            ...baseInput,
            responseText: 'No inline token.',
            recentProgressSections: [
                { iteration: 2, signal: 'RALPH_NEXT', body: 'Remaining: more' },
                { iteration: 2, signal: 'RALPH_NEEDS_INPUT', body: 'Remaining: answer' },
            ],
        });
        expect(decision.signal).toBe('RALPH_NEXT');
    });
});

describe('RALPH_NEEDS_INPUT journal and signal parsing', () => {
    it('round-trips a RALPH_NEEDS_INPUT journal header', () => {
        const md = formatProgressSection({
            iteration: 3,
            signal: 'RALPH_NEEDS_INPUT',
            timestamp: '2026-09-29T00:00:00Z',
            body: 'Files: none',
        });
        expect(parseProgressSections(md)).toEqual([
            { iteration: 3, signal: 'RALPH_NEEDS_INPUT', timestamp: '2026-09-29T00:00:00Z', body: 'Files: none' },
        ]);
        expect(parseProgressSections('## Iteration 4 - RALPH_NEEDS_INPUT - 2026-09-29T00:00:00Z\nx')[0].signal)
            .toBe('RALPH_NEEDS_INPUT');
    });

    it('ends the RALPH_PROGRESS block at RALPH_NEEDS_INPUT without reporting it as the signal', () => {
        const result = parseRalphSignal('RALPH_PROGRESS:\nFiles: a.ts\nRALPH_NEEDS_INPUT\n```json\n{}\n```');
        expect(result).toEqual({ signal: 'NONE', progress: 'Files: a.ts' });
    });
});

describe('RALPH_NEEDS_INPUT outside iteration tasks', () => {
    it('is unparseable as a final-check result', () => {
        expect(parseFinalCheckResult(validBlock).status).toBe('unparseable');
    });

    it('is unparseable as a submit result', () => {
        expect(parseRalphSubmitResult(validBlock).status).toBe('unparseable');
    });
});

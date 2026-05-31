/**
 * Unit tests for Ralph iteration task construction.
 */
import { describe, expect, it } from 'vitest';
import { buildRalphIterationTask } from '../../../src/server/ralph/enqueue-iteration';

describe('buildRalphIterationTask', () => {
    it('builds an iteration prompt with skill pointer and <goal> block', () => {
        const task = buildRalphIterationTask({
            workspaceId: 'ws-1',
            workingDirectory: 'C:\\repo',
            folderPath: 'C:\\repo',
            sessionId: 'sess-1',
            originalGoal: 'Implement a feature and test it.',
            iteration: 2,
            maxIterations: 5,
        });

        expect(task.payload.prompt).toContain('ultra-ralph');
        expect(task.payload.prompt).toContain('<goal>');
        expect(task.payload.prompt).toContain('Implement a feature and test it.');
        expect(task.payload.prompt).not.toContain('<work_intent>');
        expect(Object.keys(task.payload.context)).toEqual(['ralph']);
        expect(task.payload.context).not.toHaveProperty('skills');
        expect(task.payload.context.ralph).toMatchObject({
            phase: 'executing',
            sessionId: 'sess-1',
            originalGoal: 'Implement a feature and test it.',
            currentIteration: 2,
            maxIterations: 5,
        });
    });

    it('includes iteration counter in user prompt', () => {
        const task = buildRalphIterationTask({
            sessionId: 'sess-2',
            originalGoal: 'Build auth',
            iteration: 3,
            maxIterations: 10,
        });

        expect(task.payload.prompt).toContain('Iteration 3 of 10.');
    });

    it('includes progress path when dataDir and workspaceId are provided', () => {
        const task = buildRalphIterationTask({
            workspaceId: 'ws-test',
            sessionId: 'sess-3',
            originalGoal: 'Some goal',
            iteration: 1,
            maxIterations: 5,
            dataDir: '/home/user/.coc',
        });

        expect(task.payload.prompt).toContain('progress.md');
        expect(task.payload.prompt).toContain('sess-3');
    });

    it('omits progress path when dataDir is missing', () => {
        const task = buildRalphIterationTask({
            workspaceId: 'ws-1',
            sessionId: 'sess-no-datadir',
            originalGoal: 'Build feature',
            iteration: 1,
            maxIterations: 5,
        });

        expect(task.payload.prompt).not.toContain('progress.md');
    });

    it('preserves explicit caller context while keeping Ralph orchestration metadata', () => {
        const task = buildRalphIterationTask({
            sessionId: 'sess-2',
            originalGoal: '',
            iteration: 1,
            maxIterations: 3,
            extraContext: { attachments: [{ path: 'notes.txt' }] },
        });

        expect(task.payload.prompt).not.toContain('<goal>');
        expect(task.payload.context.attachments).toEqual([{ path: 'notes.txt' }]);
        expect(task.payload.context).not.toHaveProperty('skills');
        expect(task.payload.context.ralph.sessionId).toBe('sess-2');
    });
});

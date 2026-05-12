/**
 * Unit tests for Ralph iteration task construction.
 */
import { describe, expect, it } from 'vitest';
import { buildRalphIterationTask } from '../../../src/server/ralph/enqueue-iteration';

describe('buildRalphIterationTask', () => {
    it('builds an iteration prompt with work intent and no implicit skills context', () => {
        const task = buildRalphIterationTask({
            workspaceId: 'ws-1',
            workingDirectory: 'C:\\repo',
            folderPath: 'C:\\repo',
            sessionId: 'sess-1',
            originalGoal: 'Implement a feature and test it.',
            iteration: 2,
            maxIterations: 5,
        });

        expect(task.payload.prompt).toContain('<work_intent>');
        expect(task.payload.prompt).toContain('<goal>');
        expect(task.payload.prompt).toContain('Implement a feature and test it.');
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

    it('preserves explicit caller context while keeping Ralph orchestration metadata', () => {
        const task = buildRalphIterationTask({
            sessionId: 'sess-2',
            originalGoal: '',
            iteration: 1,
            maxIterations: 3,
            extraContext: { attachments: [{ path: 'notes.txt' }] },
        });

        expect(task.payload.prompt).toContain('<work_intent>');
        expect(task.payload.prompt).not.toContain('<goal>');
        expect(task.payload.context.attachments).toEqual([{ path: 'notes.txt' }]);
        expect(task.payload.context).not.toHaveProperty('skills');
        expect(task.payload.context.ralph.sessionId).toBe('sess-2');
    });
});

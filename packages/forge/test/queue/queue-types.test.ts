/**
 * Tests for queue type definitions — QueuedTask with generic payload.
 */

import { describe, it, expect } from 'vitest';
import {
    type QueuedTask,
} from '../../src/queue/types';

describe('QueuedTask — folderPath field', () => {
    it('accepts folderPath as a top-level optional field', () => {
        const task: Partial<QueuedTask> = {
            id: 'task-1',
            repoId: 'repo-1',
            folderPath: 'feature/subfolder',
        };
        expect(task.folderPath).toBe('feature/subfolder');
    });

    it('allows omitting folderPath', () => {
        const task: Partial<QueuedTask> = {
            id: 'task-2',
            repoId: 'repo-1',
        };
        expect(task.folderPath).toBeUndefined();
    });
});

describe('QueuedTask — generic payload', () => {
    it('payload is Record<string, unknown>', () => {
        const task: Partial<QueuedTask> = {
            id: 'task-3',
            type: 'follow-prompt',
            payload: { promptFilePath: '/test/prompt.md', folderPath: 'feature/sub' },
        };
        expect(task.payload?.promptFilePath).toBe('/test/prompt.md');
        expect(task.payload?.folderPath).toBe('feature/sub');
    });

    it('type is a plain string', () => {
        const task: Partial<QueuedTask> = {
            id: 'task-4',
            type: 'my-custom-type',
        };
        expect(task.type).toBe('my-custom-type');
    });
});

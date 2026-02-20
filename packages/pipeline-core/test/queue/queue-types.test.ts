/**
 * Tests for queue type definitions — folderPath field on FollowPromptPayload and QueuedTask.
 */

import { describe, it, expect } from 'vitest';
import {
    isFollowPromptPayload,
    type FollowPromptPayload,
    type QueuedTask,
} from '../../src/queue/types';

describe('FollowPromptPayload — folderPath field', () => {
    it('accepts folderPath as an optional string', () => {
        const payload: FollowPromptPayload = {
            promptContent: 'test prompt',
            folderPath: 'feature/sub',
        };
        expect(payload.folderPath).toBe('feature/sub');
    });

    it('allows omitting folderPath', () => {
        const payload: FollowPromptPayload = {
            promptFilePath: '/some/path.md',
        };
        expect(payload.folderPath).toBeUndefined();
    });

    it('isFollowPromptPayload still returns true with folderPath set', () => {
        const payload: FollowPromptPayload = {
            promptContent: 'hello',
            folderPath: 'my-folder',
        };
        expect(isFollowPromptPayload(payload)).toBe(true);
    });

    it('isFollowPromptPayload still returns true without folderPath', () => {
        const payload: FollowPromptPayload = {
            promptFilePath: '/p.md',
        };
        expect(isFollowPromptPayload(payload)).toBe(true);
    });
});

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

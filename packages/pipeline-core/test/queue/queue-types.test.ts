/**
 * Tests for queue type definitions — folderPath field on FollowPromptPayload and QueuedTask.
 */

import { describe, it, expect } from 'vitest';
import {
    isFollowPromptPayload,
    isRunPipelinePayload,
    type FollowPromptPayload,
    type RunPipelinePayload,
    type AIClarificationPayload,
    type CustomTaskPayload,
    type TaskGenerationPayload,
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

describe('RunPipelinePayload — type and guard', () => {
    it('isRunPipelinePayload returns true for valid payload', () => {
        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: '/workspace/.vscode/pipelines/my-pipeline',
            workingDirectory: '/workspace',
        };
        expect(isRunPipelinePayload(payload)).toBe(true);
    });

    it('isRunPipelinePayload returns false for FollowPromptPayload', () => {
        const payload: FollowPromptPayload = {
            promptContent: 'test',
        };
        expect(isRunPipelinePayload(payload)).toBe(false);
    });

    it('isRunPipelinePayload returns false for AIClarificationPayload', () => {
        const payload: AIClarificationPayload = {
            prompt: 'explain this',
        };
        expect(isRunPipelinePayload(payload)).toBe(false);
    });

    it('isRunPipelinePayload returns false for CustomTaskPayload', () => {
        const payload: CustomTaskPayload = {
            data: { foo: 'bar' },
        };
        expect(isRunPipelinePayload(payload)).toBe(false);
    });

    it('isRunPipelinePayload returns false for TaskGenerationPayload', () => {
        const payload: TaskGenerationPayload = {
            kind: 'task-generation',
            workingDirectory: '/workspace',
            prompt: 'create a task',
        };
        expect(isRunPipelinePayload(payload)).toBe(false);
    });

    it('accepts all optional fields', () => {
        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: '/workspace/.vscode/pipelines/my-pipeline',
            workingDirectory: '/workspace',
            model: 'gpt-4',
            params: { key: 'value', other: 'param' },
            workspaceId: 'ws-123',
        };
        expect(payload.model).toBe('gpt-4');
        expect(payload.params).toEqual({ key: 'value', other: 'param' });
        expect(payload.workspaceId).toBe('ws-123');
        expect(isRunPipelinePayload(payload)).toBe(true);
    });

    it('requires kind, pipelinePath, and workingDirectory', () => {
        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: '/path/to/pipeline',
            workingDirectory: '/workspace',
        };
        expect(payload.kind).toBe('run-pipeline');
        expect(payload.pipelinePath).toBe('/path/to/pipeline');
        expect(payload.workingDirectory).toBe('/workspace');
    });
});

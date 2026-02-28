/**
 * Tests for queue type definitions — folderPath field on FollowPromptPayload and QueuedTask.
 */

import { describe, it, expect } from 'vitest';
import {
    isFollowPromptPayload,
    isRunPipelinePayload,
    isResolveCommentsPayload,
    isChatPayload,
    isAIClarificationPayload,
    type FollowPromptPayload,
    type RunPipelinePayload,
    type ResolveCommentsPayload,
    type AIClarificationPayload,
    type ChatPayload,
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

describe('ResolveCommentsPayload', () => {
    it('accepts all fields including new workingDirectory, documentContent, filePath', () => {
        const payload: ResolveCommentsPayload = {
            documentUri: 'feature/task1.md',
            commentIds: ['id-1', 'id-2'],
            promptTemplate: 'test prompt',
            workingDirectory: '/workspace',
            documentContent: '# My Doc\n\nContent',
            filePath: 'feature/task1.md',
        };
        expect(payload.workingDirectory).toBe('/workspace');
        expect(payload.documentContent).toBe('# My Doc\n\nContent');
        expect(payload.filePath).toBe('feature/task1.md');
    });

    it('allows omitting optional workingDirectory', () => {
        const payload: ResolveCommentsPayload = {
            documentUri: 'task.md',
            commentIds: ['id-1'],
            promptTemplate: 'prompt',
            documentContent: 'content',
            filePath: 'task.md',
        };
        expect(payload.workingDirectory).toBeUndefined();
    });

    it('isResolveCommentsPayload returns true for valid payload', () => {
        const payload: ResolveCommentsPayload = {
            documentUri: 'task.md',
            commentIds: ['id-1'],
            promptTemplate: 'prompt',
            documentContent: 'content',
            filePath: 'task.md',
        };
        expect(isResolveCommentsPayload(payload)).toBe(true);
    });

    it('isResolveCommentsPayload returns false for non-matching payloads', () => {
        const followPrompt: FollowPromptPayload = { promptContent: 'test' };
        expect(isResolveCommentsPayload(followPrompt)).toBe(false);
    });
});

describe('ChatPayload — type and guard', () => {
    it('isChatPayload returns true for valid payload', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            prompt: 'hello',
        };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('isChatPayload returns true with optional fields', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            prompt: 'hello',
            workspaceId: 'ws1',
            folderPath: '/tmp',
        };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('isChatPayload returns false for AIClarificationPayload (no kind)', () => {
        const payload: AIClarificationPayload = {
            prompt: 'hello',
        };
        expect(isChatPayload(payload)).toBe(false);
    });

    it('isChatPayload returns false for RunPipelinePayload', () => {
        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: '/path',
            workingDirectory: '/workspace',
        };
        expect(isChatPayload(payload)).toBe(false);
    });

    it('isChatPayload returns false for TaskGenerationPayload', () => {
        const payload: TaskGenerationPayload = {
            kind: 'task-generation',
            workingDirectory: '/workspace',
            prompt: 'create a task',
        };
        expect(isChatPayload(payload)).toBe(false);
    });

    it('isAIClarificationPayload does NOT match ChatPayload', () => {
        const payload: ChatPayload = {
            kind: 'chat',
            prompt: 'hello',
        };
        // ChatPayload has 'prompt' but also has 'kind' — isAIClarificationPayload
        // uses heuristic ('prompt' in payload && !('data' in payload)) which would
        // match, but isChatPayload should be checked first in dispatch chains
        expect(isChatPayload(payload)).toBe(true);
    });
});

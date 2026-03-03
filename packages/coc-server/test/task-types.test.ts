/**
 * Task Types Tests
 *
 * Tests for the domain-specific task type guards that were moved from
 * pipeline-core to coc-server.
 */

import { describe, it, expect } from 'vitest';
import {
    isFollowPromptPayload,
    isResolveCommentsPayload,
    isAIClarificationPayload,
    isChatPayload,
    isCustomTaskPayload,
    isTaskGenerationPayload,
    isRunPipelinePayload,
    isRunScriptPayload,
} from '../src/task-types';
import type {
    FollowPromptPayload,
    ResolveCommentsPayload,
    AIClarificationPayload,
    ChatPayload,
    TaskGenerationPayload,
    RunPipelinePayload,
    RunScriptPayload,
    CustomTaskPayload,
} from '../src/task-types';
import type { MCPServerConfig } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// isFollowPromptPayload
// ============================================================================

describe('isFollowPromptPayload', () => {
    it('returns true when promptFilePath is present', () => {
        const payload: Record<string, unknown> = { promptFilePath: '/tmp/prompt.md' };
        expect(isFollowPromptPayload(payload)).toBe(true);
    });

    it('returns true when promptContent is present', () => {
        const payload: Record<string, unknown> = { promptContent: 'Do something' };
        expect(isFollowPromptPayload(payload)).toBe(true);
    });

    it('returns false for unrelated payload', () => {
        const payload: Record<string, unknown> = { documentUri: '/tmp/doc' };
        expect(isFollowPromptPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isResolveCommentsPayload
// ============================================================================

describe('isResolveCommentsPayload', () => {
    it('returns true for valid payload', () => {
        const payload: Record<string, unknown> = {
            documentUri: '/tmp/doc',
            commentIds: ['c1'],
            promptTemplate: 'tmpl',
            documentContent: 'content',
            filePath: '/path',
        };
        expect(isResolveCommentsPayload(payload)).toBe(true);
    });

    it('returns false when commentIds is missing', () => {
        const payload: Record<string, unknown> = { documentUri: '/tmp/doc' };
        expect(isResolveCommentsPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isAIClarificationPayload
// ============================================================================

describe('isAIClarificationPayload', () => {
    it('returns true for payload with prompt and no data', () => {
        const payload: Record<string, unknown> = { prompt: 'explain this' };
        expect(isAIClarificationPayload(payload)).toBe(true);
    });

    it('returns false when data is present (CustomTaskPayload)', () => {
        const payload: Record<string, unknown> = { prompt: 'x', data: {} };
        expect(isAIClarificationPayload(payload)).toBe(false);
    });

    it('returns false when prompt is missing', () => {
        const payload: Record<string, unknown> = { workingDirectory: '/tmp' };
        expect(isAIClarificationPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isChatPayload
// ============================================================================

describe('isChatPayload', () => {
    it('returns true for payload with kind: chat', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('returns true for payload with kind: chat and skillNames', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello', skillNames: ['impl'] };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('returns false for different kind', () => {
        const payload: Record<string, unknown> = { kind: 'task-generation', prompt: 'x' };
        expect(isChatPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isCustomTaskPayload
// ============================================================================

describe('isCustomTaskPayload', () => {
    it('returns true when data is present', () => {
        const payload: Record<string, unknown> = { data: { prompt: 'custom' } };
        expect(isCustomTaskPayload(payload)).toBe(true);
    });

    it('returns false when data is missing', () => {
        const payload: Record<string, unknown> = { prompt: 'not custom' };
        expect(isCustomTaskPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isTaskGenerationPayload
// ============================================================================

describe('isTaskGenerationPayload', () => {
    it('returns true for payload with kind: task-generation', () => {
        const payload: Record<string, unknown> = {
            kind: 'task-generation',
            workingDirectory: '/tmp',
            prompt: 'Create feature',
        };
        expect(isTaskGenerationPayload(payload)).toBe(true);
    });

    it('returns false for FollowPromptPayload', () => {
        const payload: Record<string, unknown> = { promptFilePath: '/tmp/prompt.md' };
        expect(isTaskGenerationPayload(payload)).toBe(false);
    });

    it('returns false for AIClarificationPayload', () => {
        const payload: Record<string, unknown> = { prompt: 'explain', workingDirectory: '/tmp' };
        expect(isTaskGenerationPayload(payload)).toBe(false);
    });

    it('returns false for CustomTaskPayload', () => {
        const payload: Record<string, unknown> = { data: { prompt: 'custom' } };
        expect(isTaskGenerationPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isRunPipelinePayload
// ============================================================================

describe('isRunPipelinePayload', () => {
    it('returns true for payload with kind: run-pipeline', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-pipeline',
            pipelinePath: '/tmp/pipeline',
            workingDirectory: '/tmp',
        };
        expect(isRunPipelinePayload(payload)).toBe(true);
    });

    it('returns false for task-generation kind', () => {
        const payload: Record<string, unknown> = {
            kind: 'task-generation',
            workingDirectory: '/tmp',
            prompt: 'x',
        };
        expect(isRunPipelinePayload(payload)).toBe(false);
    });

    it('accepts mcpServers field and still passes type guard', () => {
        const servers: Record<string, MCPServerConfig> = {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        };
        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: '/tmp/pipeline',
            workingDirectory: '/tmp',
            mcpServers: servers,
        };
        expect(isRunPipelinePayload(payload as Record<string, unknown>)).toBe(true);
        expect(payload.mcpServers).toEqual(servers);
    });
});

// ============================================================================
// isRunScriptPayload
// ============================================================================

describe('isRunScriptPayload', () => {
    it('returns true for payload with kind: run-script', () => {
        const payload: Record<string, unknown> = { kind: 'run-script', script: 'echo hello' };
        expect(isRunScriptPayload(payload)).toBe(true);
    });

    it('returns true with optional fields present', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-script',
            script: 'node -e "process.exit(0)"',
            workingDirectory: '/tmp',
            scheduleId: 'sch_abc123',
        };
        expect(isRunScriptPayload(payload)).toBe(true);
    });

    it('returns false for kind: chat', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(isRunScriptPayload(payload)).toBe(false);
    });

    it('returns false for payload with no kind field', () => {
        const payload: Record<string, unknown> = { script: 'echo hello' };
        expect(isRunScriptPayload(payload)).toBe(false);
    });

    it('returns false for kind: run-pipeline', () => {
        const payload: Record<string, unknown> = { kind: 'run-pipeline', pipelinePath: '/p', workingDirectory: '/tmp' };
        expect(isRunScriptPayload(payload)).toBe(false);
    });
});

// ============================================================================
// Type narrowing integration
// ============================================================================

describe('type narrowing', () => {
    it('guards correctly narrow Record<string, unknown> payloads', () => {
        const payloads: Record<string, unknown>[] = [
            { promptFilePath: '/tmp/prompt.md' },
            { documentUri: '/tmp/doc', commentIds: ['c1'] },
            { prompt: 'explain' },
            { kind: 'chat', prompt: 'hi' },
            { data: { x: 1 } },
            { kind: 'task-generation', workingDirectory: '/tmp', prompt: 'Create' },
            { kind: 'run-pipeline', pipelinePath: '/tmp/p', workingDirectory: '/tmp' },
        ];

        expect(isFollowPromptPayload(payloads[0])).toBe(true);
        expect(isResolveCommentsPayload(payloads[1])).toBe(true);
        expect(isAIClarificationPayload(payloads[2])).toBe(true);
        expect(isChatPayload(payloads[3])).toBe(true);
        expect(isCustomTaskPayload(payloads[4])).toBe(true);
        expect(isTaskGenerationPayload(payloads[5])).toBe(true);
        expect(isRunPipelinePayload(payloads[6])).toBe(true);
    });

    it('discriminant-based guards are mutually exclusive', () => {
        const chatPayload: Record<string, unknown> = { kind: 'chat', prompt: 'hi' };
        const taskGenPayload: Record<string, unknown> = { kind: 'task-generation', workingDirectory: '/tmp', prompt: 'x' };
        const runPipePayload: Record<string, unknown> = { kind: 'run-pipeline', pipelinePath: '/p', workingDirectory: '/tmp' };

        // Chat is not task-generation or run-pipeline
        expect(isChatPayload(chatPayload)).toBe(true);
        expect(isTaskGenerationPayload(chatPayload)).toBe(false);
        expect(isRunPipelinePayload(chatPayload)).toBe(false);

        // Task-generation is not chat or run-pipeline
        expect(isTaskGenerationPayload(taskGenPayload)).toBe(true);
        expect(isChatPayload(taskGenPayload)).toBe(false);
        expect(isRunPipelinePayload(taskGenPayload)).toBe(false);

        // Run-pipeline is not chat or task-generation
        expect(isRunPipelinePayload(runPipePayload)).toBe(true);
        expect(isChatPayload(runPipePayload)).toBe(false);
        expect(isTaskGenerationPayload(runPipePayload)).toBe(false);
    });
});

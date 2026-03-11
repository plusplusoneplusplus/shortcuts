/**
 * Task Types Tests
 *
 * Tests for the unified task type guards:
 *   TaskType = 'chat' | 'run-workflow' | 'run-script'
 *   ChatMode = 'ask' | 'plan' | 'autopilot'
 */

import { describe, it, expect } from 'vitest';
import {
    isChatPayload,
    isChatFollowUp,
    isRunWorkflowPayload,
    isRunScriptPayload,
    hasTaskGenerationContext,
    hasResolveCommentsContext,
    hasReplicationContext,
} from '../src/task-types';
import type {
    RunWorkflowPayload,
} from '../src/task-types';
import type { MCPServerConfig } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// isChatPayload
// ============================================================================

describe('isChatPayload', () => {
    it('returns true for payload with kind: chat', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('returns true for payload with kind: chat and context.skills', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello', context: { skills: ['impl'] } };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('returns true for payload with mode: ask', () => {
        const payload: Record<string, unknown> = { kind: 'chat', mode: 'ask', prompt: 'explain' };
        expect(isChatPayload(payload)).toBe(true);
    });

    it('returns false for different kind', () => {
        const payload: Record<string, unknown> = { kind: 'run-workflow', workflowPath: '/p', workingDirectory: '/tmp' };
        expect(isChatPayload(payload)).toBe(false);
    });
});

// ============================================================================
// isChatFollowUp
// ============================================================================

describe('isChatFollowUp', () => {
    it('returns true for chat payload with processId', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'follow up', processId: 'proc-1' };
        expect(isChatFollowUp(payload)).toBe(true);
    });

    it('returns false for chat payload without processId', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(isChatFollowUp(payload)).toBe(false);
    });

    it('returns false for non-chat payload with processId', () => {
        const payload: Record<string, unknown> = { kind: 'run-workflow', processId: 'proc-1', workflowPath: '/p', workingDirectory: '/tmp' };
        expect(isChatFollowUp(payload)).toBe(false);
    });
});

// ============================================================================
// isRunWorkflowPayload
// ============================================================================

describe('isRunWorkflowPayload', () => {
    it('returns true for payload with kind: run-workflow', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/tmp/pipeline',
            workingDirectory: '/tmp',
        };
        expect(isRunWorkflowPayload(payload)).toBe(true);
    });

    it('returns false for chat kind', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'x',
        };
        expect(isRunWorkflowPayload(payload)).toBe(false);
    });

    it('accepts mcpServers field and still passes type guard', () => {
        const servers: Record<string, MCPServerConfig> = {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        };
        const payload: RunWorkflowPayload = {
            kind: 'run-workflow',
            workflowPath: '/tmp/pipeline',
            workingDirectory: '/tmp',
            mcpServers: servers,
        };
        expect(isRunWorkflowPayload(payload as Record<string, unknown>)).toBe(true);
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

    it('returns false for kind: run-workflow', () => {
        const payload: Record<string, unknown> = { kind: 'run-workflow', workflowPath: '/p', workingDirectory: '/tmp' };
        expect(isRunScriptPayload(payload)).toBe(false);
    });
});

// ============================================================================
// hasTaskGenerationContext
// ============================================================================

describe('hasTaskGenerationContext', () => {
    it('returns true for chat payload with context.taskGeneration', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Create feature',
            context: { taskGeneration: { targetFolder: '/tasks', depth: 'normal' } },
        };
        expect(hasTaskGenerationContext(payload)).toBe(true);
    });

    it('returns false for chat payload without taskGeneration', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasTaskGenerationContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload with taskGeneration', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            context: { taskGeneration: { targetFolder: '/tasks' } },
        };
        expect(hasTaskGenerationContext(payload)).toBe(false);
    });
});

// ============================================================================
// hasResolveCommentsContext
// ============================================================================

describe('hasResolveCommentsContext', () => {
    it('returns true for chat payload with context.resolveComments', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Resolve',
            context: { resolveComments: { documentUri: '/doc', commentIds: ['c1'], documentContent: 'x', filePath: '/f' } },
        };
        expect(hasResolveCommentsContext(payload)).toBe(true);
    });

    it('returns false for chat payload without resolveComments', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasResolveCommentsContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-script',
            script: 'echo',
            context: { resolveComments: { documentUri: '/d', commentIds: ['c1'], documentContent: 'x', filePath: '/f' } },
        };
        expect(hasResolveCommentsContext(payload)).toBe(false);
    });
});

// ============================================================================
// hasReplicationContext
// ============================================================================

describe('hasReplicationContext', () => {
    it('returns true for chat payload with context.replication', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Replicate',
            context: { replication: { commitHash: 'abc123', templateName: 'add-endpoint' } },
        };
        expect(hasReplicationContext(payload)).toBe(true);
    });

    it('returns false for chat payload without replication', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasReplicationContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            context: { replication: { commitHash: 'abc', templateName: 'x' } },
        };
        expect(hasReplicationContext(payload)).toBe(false);
    });
});

// ============================================================================
// Type narrowing integration
// ============================================================================

describe('type narrowing', () => {
    it('guards correctly narrow Record<string, unknown> payloads', () => {
        const payloads: Record<string, unknown>[] = [
            { kind: 'chat', prompt: 'hi' },
            { kind: 'chat', prompt: 'follow', processId: 'proc-1' },
            { kind: 'run-workflow', workflowPath: '/tmp/p', workingDirectory: '/tmp' },
            { kind: 'run-script', script: 'echo hi' },
        ];

        expect(isChatPayload(payloads[0])).toBe(true);
        expect(isChatFollowUp(payloads[1])).toBe(true);
        expect(isRunWorkflowPayload(payloads[2])).toBe(true);
        expect(isRunScriptPayload(payloads[3])).toBe(true);
    });

    it('discriminant-based guards are mutually exclusive', () => {
        const chatPayload: Record<string, unknown> = { kind: 'chat', prompt: 'hi' };
        const runWorkflowPayload: Record<string, unknown> = { kind: 'run-workflow', workflowPath: '/p', workingDirectory: '/tmp' };
        const runScriptPayload: Record<string, unknown> = { kind: 'run-script', script: 'echo' };

        // Chat is not run-workflow or run-script
        expect(isChatPayload(chatPayload)).toBe(true);
        expect(isRunWorkflowPayload(chatPayload)).toBe(false);
        expect(isRunScriptPayload(chatPayload)).toBe(false);

        // Run-workflow is not chat or run-script
        expect(isRunWorkflowPayload(runWorkflowPayload)).toBe(true);
        expect(isChatPayload(runWorkflowPayload)).toBe(false);
        expect(isRunScriptPayload(runWorkflowPayload)).toBe(false);

        // Run-script is not chat or run-workflow
        expect(isRunScriptPayload(runScriptPayload)).toBe(true);
        expect(isChatPayload(runScriptPayload)).toBe(false);
        expect(isRunWorkflowPayload(runScriptPayload)).toBe(false);
    });

    it('context helpers are only true for chat payloads with matching context', () => {
        const taskGenPayload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'gen',
            context: { taskGeneration: { targetFolder: '/t' } },
        };
        const resolvePayload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'resolve',
            context: { resolveComments: { documentUri: '/d', commentIds: ['c1'], documentContent: 'x', filePath: '/f' } },
        };
        const replicatePayload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'replicate',
            context: { replication: { commitHash: 'abc', templateName: 'x' } },
        };

        expect(hasTaskGenerationContext(taskGenPayload)).toBe(true);
        expect(hasResolveCommentsContext(taskGenPayload)).toBe(false);
        expect(hasReplicationContext(taskGenPayload)).toBe(false);

        expect(hasResolveCommentsContext(resolvePayload)).toBe(true);
        expect(hasTaskGenerationContext(resolvePayload)).toBe(false);
        expect(hasReplicationContext(resolvePayload)).toBe(false);

        expect(hasReplicationContext(replicatePayload)).toBe(true);
        expect(hasTaskGenerationContext(replicatePayload)).toBe(false);
        expect(hasResolveCommentsContext(replicatePayload)).toBe(false);
    });
});

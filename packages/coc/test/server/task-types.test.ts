/**
 * Task Types Tests
 *
 * Tests for the unified task type guards:
 *   TaskType = 'chat' | 'run-workflow' | 'run-script'
 *   ChatMode = 'ask' | 'autopilot' | 'ralph'
 */

import { describe, it, expect } from 'vitest';
import {
    isChatPayload,
    isChatFollowUp,
    isRunWorkflowPayload,
    isRunScriptPayload,
    hasTaskGenerationContext,
    hasResolveCommentsContext,
    hasResolveDiffCommentsMultiContext,
    hasReplicationContext,
    hasCommitChatContext,
    hasNoteCreateContext,
    hasRalphContext,
    isRalphMode,
    normalizeChatMode,
    normalizeChatModeOrDefault,
    resolveInstructionMode,
    TaskDefs,
    getTaskDef,
    VISIBLE_TASK_TYPE_LABELS,
    VALID_ENQUEUE_TYPES,
} from '../../src/server/tasks/task-types';
import type {
    RunWorkflowPayload,
    CocTaskKind,
} from '../../src/server/tasks/task-types';
import type { MCPServerConfig } from '@plusplusoneplusplus/forge';

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
// hasCommitChatContext
// ============================================================================

describe('hasCommitChatContext', () => {
    it('returns true for chat payload with context.commitChat', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Discuss commit',
            context: { commitChat: { commitHash: 'abc123', commitMessage: 'fix: update validation' } },
        };
        expect(hasCommitChatContext(payload)).toBe(true);
    });

    it('returns false for chat payload without commitChat', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasCommitChatContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            context: { commitChat: { commitHash: 'abc', commitMessage: 'fix: update validation' } },
        };
        expect(hasCommitChatContext(payload)).toBe(false);
    });
});

// ============================================================================
// hasNoteCreateContext
// ============================================================================

describe('hasNoteCreateContext', () => {
    it('returns true for chat payload with context.noteCreate', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Create note',
            context: { noteCreate: { prompt: 'Meeting notes about Q4 roadmap' } },
        };
        expect(hasNoteCreateContext(payload)).toBe(true);
    });

    it('returns true when noteCreate includes chatTaskId', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Create note',
            context: { noteCreate: { prompt: 'Meeting notes', chatTaskId: 'task-123' } },
        };
        expect(hasNoteCreateContext(payload)).toBe(true);
    });

    it('returns false for chat payload without noteCreate', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasNoteCreateContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            context: { noteCreate: { prompt: 'test' } },
        };
        expect(hasNoteCreateContext(payload)).toBe(false);
    });
});

// ============================================================================
// hasResolveDiffCommentsMultiContext
// ============================================================================

describe('hasResolveDiffCommentsMultiContext', () => {
    it('returns true for chat payload with context.resolveDiffCommentsMulti', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'Resolve multi',
            context: {
                resolveDiffCommentsMulti: {
                    files: [{ storageKey: 'k1', commentIds: ['c1'], filePath: '/f' }],
                    wsId: 'ws1',
                    oldRef: 'abc^',
                    newRef: 'abc',
                },
            },
        };
        expect(hasResolveDiffCommentsMultiContext(payload)).toBe(true);
    });

    it('returns false for chat payload without resolveDiffCommentsMulti', () => {
        const payload: Record<string, unknown> = { kind: 'chat', prompt: 'hello' };
        expect(hasResolveDiffCommentsMultiContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-script',
            script: 'echo',
            context: {
                resolveDiffCommentsMulti: {
                    files: [{ storageKey: 'k1', commentIds: ['c1'], filePath: '/f' }],
                    wsId: 'ws1',
                    oldRef: 'abc^',
                    newRef: 'abc',
                },
            },
        };
        expect(hasResolveDiffCommentsMultiContext(payload)).toBe(false);
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
        const commitChatPayload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'discuss commit',
            context: { commitChat: { commitHash: 'abc123', commitMessage: 'fix: update validation' } },
        };

        expect(hasTaskGenerationContext(taskGenPayload)).toBe(true);
        expect(hasResolveCommentsContext(taskGenPayload)).toBe(false);
        expect(hasReplicationContext(taskGenPayload)).toBe(false);
        expect(hasCommitChatContext(taskGenPayload)).toBe(false);

        expect(hasResolveCommentsContext(resolvePayload)).toBe(true);
        expect(hasTaskGenerationContext(resolvePayload)).toBe(false);
        expect(hasReplicationContext(resolvePayload)).toBe(false);
        expect(hasCommitChatContext(resolvePayload)).toBe(false);

        expect(hasReplicationContext(replicatePayload)).toBe(true);
        expect(hasTaskGenerationContext(replicatePayload)).toBe(false);
        expect(hasResolveCommentsContext(replicatePayload)).toBe(false);
        expect(hasCommitChatContext(replicatePayload)).toBe(false);

        expect(hasCommitChatContext(commitChatPayload)).toBe(true);
        expect(hasTaskGenerationContext(commitChatPayload)).toBe(false);
        expect(hasResolveCommentsContext(commitChatPayload)).toBe(false);
        expect(hasReplicationContext(commitChatPayload)).toBe(false);
    });
});

// ============================================================================
// TaskDefs struct
// ============================================================================

describe('TaskDefs', () => {
    it('defines all expected task types', () => {
        expect(TaskDefs.chat.kind).toBe('chat');
        expect(TaskDefs.runWorkflow.kind).toBe('run-workflow');
        expect(TaskDefs.runScript.kind).toBe('run-script');
    });

    it('has correct labels', () => {
        expect(TaskDefs.chat.label).toBe('Chat');
        expect(TaskDefs.runWorkflow.label).toBe('Run Workflow');
        expect(TaskDefs.runScript.label).toBe('Run Script');
    });

    it('has correct exclusivity', () => {
        expect(TaskDefs.chat.exclusive).toBe(false);
        expect(TaskDefs.runWorkflow.exclusive).toBe(true);
        expect(TaskDefs.runScript.exclusive).toBe(true);
    });

    it('has correct visibility', () => {
        expect(TaskDefs.chat.visible).toBe(true);
        expect(TaskDefs.runWorkflow.visible).toBe(true);
        expect(TaskDefs.runScript.visible).toBe(true);
    });

    it('kind values match payload interface literal types', () => {
        expect(TaskDefs.chat.kind).toBe('chat');
        expect(TaskDefs.runWorkflow.kind).toBe('run-workflow');
        expect(TaskDefs.runScript.kind).toBe('run-script');
    });
});

// ============================================================================
// getTaskDef
// ============================================================================

describe('getTaskDef', () => {
    it('returns the correct def for each known kind', () => {
        expect(getTaskDef('chat')).toBe(TaskDefs.chat);
        expect(getTaskDef('run-workflow')).toBe(TaskDefs.runWorkflow);
        expect(getTaskDef('run-script')).toBe(TaskDefs.runScript);
    });

    it('returns undefined for unknown kind', () => {
        expect(getTaskDef('unknown')).toBeUndefined();
        expect(getTaskDef('')).toBeUndefined();
    });
});

// ============================================================================
// VISIBLE_TASK_TYPE_LABELS
// ============================================================================

describe('VISIBLE_TASK_TYPE_LABELS', () => {
    it('contains only visible task types', () => {
        expect(VISIBLE_TASK_TYPE_LABELS).toEqual({
            'chat': 'Chat',
            'run-workflow': 'Run Workflow',
            'run-script': 'Run Script',
        });
    });
});

// ============================================================================
// VALID_ENQUEUE_TYPES
// ============================================================================

describe('VALID_ENQUEUE_TYPES', () => {
    it('contains visible task kinds', () => {
        expect(VALID_ENQUEUE_TYPES.has('chat')).toBe(true);
        expect(VALID_ENQUEUE_TYPES.has('run-workflow')).toBe(true);
        expect(VALID_ENQUEUE_TYPES.has('run-script')).toBe(true);
    });
});

// ============================================================================
// CocTaskKind type
// ============================================================================

describe('CocTaskKind type', () => {
    it('accepts all valid task kind strings at type level', () => {
        const kinds: CocTaskKind[] = ['chat', 'run-workflow', 'run-script'];
        expect(kinds).toHaveLength(3);
    });
});

// ============================================================================
// hasRalphContext
// ============================================================================

describe('hasRalphContext', () => {
    it('returns true for chat payload with context.ralph', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            mode: 'ralph',
            prompt: 'Build a REST API',
            context: { ralph: { originalGoal: 'Build a REST API' } },
        };
        expect(hasRalphContext(payload)).toBe(true);
    });

    it('returns false for chat payload without ralph context', () => {
        const payload: Record<string, unknown> = { kind: 'chat', mode: 'ralph', prompt: 'Build something' };
        expect(hasRalphContext(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            context: { ralph: { originalGoal: 'test' } },
        };
        expect(hasRalphContext(payload)).toBe(false);
    });
});

// ============================================================================
// isRalphMode
// ============================================================================

describe('isRalphMode', () => {
    it('returns true for chat payload with mode: ralph', () => {
        const payload: Record<string, unknown> = { kind: 'chat', mode: 'ralph', prompt: 'Build something' };
        expect(isRalphMode(payload)).toBe(true);
    });

    it('returns false for chat payload with mode: ask', () => {
        const payload: Record<string, unknown> = { kind: 'chat', mode: 'ask', prompt: 'hello' };
        expect(isRalphMode(payload)).toBe(false);
    });

    it('returns false for chat payload with mode: autopilot', () => {
        const payload: Record<string, unknown> = { kind: 'chat', mode: 'autopilot', prompt: 'do it' };
        expect(isRalphMode(payload)).toBe(false);
    });

    it('returns false for non-chat payload', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-workflow',
            workflowPath: '/p',
            workingDirectory: '/tmp',
            mode: 'ralph',
        };
        expect(isRalphMode(payload)).toBe(false);
    });
});

// ============================================================================
// resolveInstructionMode
// ============================================================================

describe('resolveInstructionMode', () => {
    it('maps ask -> ask', () => {
        expect(resolveInstructionMode('ask')).toBe('ask');
    });

    it('maps legacy plan -> ask', () => {
        expect(resolveInstructionMode('plan')).toBe('ask');
    });

    it('maps autopilot -> autopilot', () => {
        expect(resolveInstructionMode('autopilot')).toBe('autopilot');
    });

    it('maps ralph -> autopilot (aliases autopilot instructions)', () => {
        expect(resolveInstructionMode('ralph')).toBe('autopilot');
    });

    it('returns a value for every ChatMode member', () => {
        const modes = ['ask', 'plan', 'autopilot', 'ralph'] as const;
        for (const mode of modes) {
            expect(['ask', 'autopilot']).toContain(resolveInstructionMode(mode));
        }
    });
});

// ============================================================================
// normalizeChatMode
// ============================================================================

describe('normalizeChatMode', () => {
    it('preserves active chat modes', () => {
        expect(normalizeChatMode('ask')).toBe('ask');
        expect(normalizeChatMode('autopilot')).toBe('autopilot');
        expect(normalizeChatMode('ralph')).toBe('ralph');
    });

    it('normalizes legacy plan mode to ask', () => {
        expect(normalizeChatMode('plan')).toBe('ask');
    });

    it('returns undefined for invalid or missing values', () => {
        expect(normalizeChatMode('bogus')).toBeUndefined();
        expect(normalizeChatMode('for-each')).toBeUndefined();
        expect(normalizeChatMode(undefined)).toBeUndefined();
    });

    it('uses the fallback when a value is invalid', () => {
        expect(normalizeChatModeOrDefault('bogus', 'autopilot')).toBe('autopilot');
    });
});

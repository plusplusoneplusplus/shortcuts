/**
 * validateAndParseTask – payload.kind injection regression tests.
 *
 * Regression: run-script and run-workflow tasks submitted without an explicit
 * `payload.kind` were silently no-oped because isRunScriptPayload /
 * isRunWorkflowPayload check `payload.kind` exclusively. validateAndParseTask
 * must inject the correct `kind` value from `taskSpec.type`.
 */

import { describe, it, expect } from 'vitest';
import { validateAndParseTask } from '../../src/server/routes/queue-shared';
import { isRunScriptPayload, isRunWorkflowPayload, isChatPayload } from '../../src/server/tasks/task-types';

// ============================================================================
// run-script
// ============================================================================

describe('validateAndParseTask – run-script kind injection', () => {
    it('injects kind: run-script when payload has no kind', () => {
        const result = validateAndParseTask({
            type: 'run-script',
            payload: { script: 'echo hello', workingDirectory: '/ws' },
        });

        expect(result.valid).toBe(true);
        expect(isRunScriptPayload(result.input!.payload as Record<string, unknown>)).toBe(true);
        expect((result.input!.payload as any).kind).toBe('run-script');
    });

    it('preserves kind: run-script when already present', () => {
        const result = validateAndParseTask({
            type: 'run-script',
            payload: { kind: 'run-script', script: 'echo hello' },
        });

        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).kind).toBe('run-script');
    });

    it('does not overwrite an explicit kind if provided', () => {
        // Explicit kind should be preserved (truthy check in source)
        const result = validateAndParseTask({
            type: 'run-script',
            payload: { kind: 'run-script', script: 'ls' },
        });
        expect((result.input!.payload as any).kind).toBe('run-script');
    });
});

// ============================================================================
// run-workflow
// ============================================================================

describe('validateAndParseTask – run-workflow kind injection', () => {
    it('injects kind: run-workflow when payload has no kind', () => {
        const result = validateAndParseTask({
            type: 'run-workflow',
            payload: { workflowPath: '/ws/.vscode/workflows/my-pipeline', workingDirectory: '/ws' },
        });

        expect(result.valid).toBe(true);
        expect(isRunWorkflowPayload(result.input!.payload as Record<string, unknown>)).toBe(true);
        expect((result.input!.payload as any).kind).toBe('run-workflow');
    });

    it('preserves kind: run-workflow when already present', () => {
        const result = validateAndParseTask({
            type: 'run-workflow',
            payload: { kind: 'run-workflow', workflowPath: '/ws/.vscode/workflows/p', workingDirectory: '/ws' },
        });

        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).kind).toBe('run-workflow');
    });
});

// ============================================================================
// chat (existing behavior unchanged)
// ============================================================================

describe('validateAndParseTask – chat kind injection (existing behavior)', () => {
    it('injects kind: chat for type: chat', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello' },
        });

        expect(result.valid).toBe(true);
        expect(isChatPayload(result.input!.payload as Record<string, unknown>)).toBe(true);
        expect((result.input!.payload as any).kind).toBe('chat');
    });

    it('injects kind: chat for type: custom', () => {
        const result = validateAndParseTask({
            type: 'custom',
            payload: { prompt: 'hello' },
        });

        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).kind).toBe('chat');
    });

    it('defaults payload.mode to autopilot for new chats (no processId)', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).mode).toBe('autopilot');
    });

    it('leaves payload.mode untouched for follow-ups (processId set)', () => {
        // Follow-ups must arrive with mode already resolved by the caller —
        // queue-shared must not silently default to autopilot for them.
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', processId: 'queue_xyz' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).mode).toBeUndefined();
    });

    it('preserves an explicit follow-up payload.mode', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', processId: 'queue_xyz', mode: 'ask' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).mode).toBe('ask');
    });
});

// ============================================================================
// payload.model → config.model promotion
// ============================================================================

describe('validateAndParseTask – payload.model promotion to config.model', () => {
    it('promotes payload.model to config.model when config.model is absent', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', model: 'claude-sonnet-4.6' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.model).toBe('claude-sonnet-4.6');
    });

    it('config.model takes precedence over payload.model', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', model: 'claude-sonnet-4.6' },
            config: { model: 'gpt-4.1' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.model).toBe('gpt-4.1');
    });

    it('config.model is undefined when neither config nor payload supply a model', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.model).toBeUndefined();
    });

    it('ignores non-string payload.model values', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', model: 42 },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.model).toBeUndefined();
    });

    it('works for non-chat task types with payload.model', () => {
        const result = validateAndParseTask({
            type: 'run-script',
            payload: { script: 'echo hi', workingDirectory: '/ws', model: 'claude-sonnet-4.6' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.model).toBe('claude-sonnet-4.6');
    });
});

// ============================================================================
// Dispatch correctness end-to-end guard check
// ============================================================================

describe('validateAndParseTask – kind injection enables correct type guard dispatch', () => {
    it('run-script without explicit kind passes isRunScriptPayload after validation', () => {
        // This is the regression scenario: UI sends run-script task without kind.
        const taskSpec = {
            type: 'run-script',
            priority: 'normal',
            displayName: 'My Script',
            payload: {
                script: 'cmd.exe /c echo hello',
                workingDirectory: 'D:\\projects\\shortcuts',
            },
            config: { retryOnFailure: false },
            repoId: 'ws-kss6a7',
        };

        const result = validateAndParseTask(taskSpec);
        expect(result.valid).toBe(true);

        const payload = result.input!.payload as Record<string, unknown>;
        // Without the fix, this was false → triggered the no-op branch
        expect(isRunScriptPayload(payload)).toBe(true);
        expect(isRunWorkflowPayload(payload)).toBe(false);
        expect(isChatPayload(payload)).toBe(false);
    });

    it('run-workflow without explicit kind passes isRunWorkflowPayload after validation', () => {
        const taskSpec = {
            type: 'run-workflow',
            priority: 'normal',
            payload: {
                workflowPath: '/ws/.vscode/workflows/my-pipeline',
                workingDirectory: '/ws',
            },
            config: { retryOnFailure: false },
        };

        const result = validateAndParseTask(taskSpec);
        expect(result.valid).toBe(true);

        const payload = result.input!.payload as Record<string, unknown>;
        expect(isRunWorkflowPayload(payload)).toBe(true);
        expect(isRunScriptPayload(payload)).toBe(false);
        expect(isChatPayload(payload)).toBe(false);
    });
});

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

    it('normalizes legacy plan payload.mode to ask for new chats', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', mode: 'plan' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).mode).toBe('ask');
    });

    it('normalizes legacy plan payload.mode to ask for follow-ups', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', processId: 'queue_xyz', mode: 'plan' },
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
// payload.reasoningEffort → config.reasoningEffort
// ============================================================================

describe('validateAndParseTask – payload.reasoningEffort mapping', () => {
    it('maps payload.reasoningEffort to config.reasoningEffort for chat tasks', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask', reasoningEffort: 'high' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.reasoningEffort).toBe('high');
    });

    it('keeps reasoningEffort in payload alongside the config copy', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask', reasoningEffort: 'medium' },
        });

        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).reasoningEffort).toBe('medium');
        expect(result.input!.config.reasoningEffort).toBe('medium');
    });

    it('prefers config.reasoningEffort over payload.reasoningEffort when both are set', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask', reasoningEffort: 'low' },
            config: { reasoningEffort: 'high' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.reasoningEffort).toBe('high');
    });

    it('omits config.reasoningEffort when not provided in payload or config', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.reasoningEffort).toBeUndefined();
    });

    it('drops invalid reasoningEffort values silently', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask', reasoningEffort: 'super-duper' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.reasoningEffort).toBeUndefined();
    });

    it('accepts xhigh as a valid per-turn effort', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask', reasoningEffort: 'xhigh' },
        });

        expect(result.valid).toBe(true);
        expect(result.input!.config.reasoningEffort).toBe('xhigh');
    });
});

// ============================================================================
// config.effortTier validation
// ============================================================================

describe('validateAndParseTask – config.effortTier validation', () => {
    it('preserves a valid effortTier for enqueue-time resolution', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask' },
            config: { effortTier: 'high' },
        });

        expect(result.valid).toBe(true);
        expect((result.input!.config as Record<string, unknown>).effortTier).toBe('high');
    });

    it('rejects unknown effortTier values', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask' },
            config: { effortTier: 'ultra' },
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid effortTier');
    });

    it('rejects non-string effortTier values', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'Hello', mode: 'ask' },
            config: { effortTier: 1 },
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid effortTier');
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

// ============================================================================
// ChatPayload.provider validation (AC-03)
// ============================================================================

describe('validateAndParseTask – ChatPayload.provider validation', () => {
    it('accepts provider: copilot', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', provider: 'copilot' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).provider).toBe('copilot');
    });

    it('accepts provider: codex', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', provider: 'codex' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).provider).toBe('codex');
    });

    it('rejects an unknown provider value with a 400-style error', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello', provider: 'openai' },
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/invalid provider/i);
        expect(result.error).toContain('openai');
    });

    it('passes through when provider is omitted (defaults to copilot at execution time)', () => {
        const result = validateAndParseTask({
            type: 'chat',
            payload: { prompt: 'hello' },
        });
        expect(result.valid).toBe(true);
        expect((result.input!.payload as any).provider).toBeUndefined();
    });

    it('does not validate provider for non-chat task types', () => {
        // run-script payloads have no provider concept; an accidentally passed
        // provider field should not cause a validation error at the chat layer.
        const result = validateAndParseTask({
            type: 'run-script',
            payload: { script: 'echo hi', workingDirectory: '/ws', provider: 'unknown' },
        });
        expect(result.valid).toBe(true);
    });
});

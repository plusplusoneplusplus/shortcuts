import { describe, it, expect, vi } from 'vitest';
import { executeAI } from '../../../src/workflow/nodes/ai';
import type { AINodeConfig, WorkflowExecutionOptions, Items } from '../../../src/workflow/types';
import type { AIInvokerResult } from '../../../src/ai/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInvoker(response: string) {
    return vi.fn(async (): Promise<AIInvokerResult> => ({
        success: true,
        response,
    }));
}

function failingInvoker(error = 'AI error') {
    return vi.fn(async (): Promise<AIInvokerResult> => ({ success: false, error }));
}

function throwingInvoker(msg = 'Network error') {
    return vi.fn(async (): Promise<AIInvokerResult> => { throw new Error(msg); });
}

function opts(aiInvoker: WorkflowExecutionOptions['aiInvoker']): WorkflowExecutionOptions {
    return { aiInvoker, workflowDirectory: process.cwd() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeAI', () => {
    it('calls AI with {{ITEMS}} substituted', async () => {
        const invoker = makeInvoker('{"result":"ok"}');
        const config: AINodeConfig = {
            type: 'ai',
            prompt: 'Process: {{ITEMS}}',
            output: ['result'],
        };
        const inputs: Items = [{ id: 1 }, { id: 2 }];
        await executeAI(config, inputs, opts(invoker));

        const callPrompt = invoker.mock.calls[0][0];
        expect(callPrompt).toContain(JSON.stringify(inputs, null, 2));
    });

    it('returns exactly 1 item regardless of input count', async () => {
        const invoker = makeInvoker('{"result":"ok"}');
        const config: AINodeConfig = {
            type: 'ai',
            prompt: 'Summarize: {{ITEMS}}',
            output: ['result'],
        };
        const inputs: Items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
        const result = await executeAI(config, inputs, opts(invoker));
        expect(result).toHaveLength(1);
    });

    it('output fields declared — JSON parsed and merged', async () => {
        const invoker = makeInvoker('{"result":"ok","extra":"ignored"}');
        const config: AINodeConfig = {
            type: 'ai',
            prompt: 'Go: {{ITEMS}}',
            output: ['result'],
        };
        const result = await executeAI(config, [{ id: 1 }], opts(invoker));
        expect(result).toEqual([{ result: 'ok' }]);
    });

    it('text mode (no output fields) — returns [{text: response}]', async () => {
        const invoker = makeInvoker('Some text');
        const config: AINodeConfig = { type: 'ai', prompt: 'Go: {{ITEMS}}' };
        const result = await executeAI(config, [{ id: 1 }], opts(invoker));
        expect(result).toEqual([{ text: 'Some text' }]);
    });

    it('AI failure — returns [{__error}], does not throw', async () => {
        const invoker = failingInvoker('rate limit');
        const config: AINodeConfig = { type: 'ai', prompt: 'Go: {{ITEMS}}' };
        const result = await executeAI(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('rate limit');
    });

    it('AI throws — returns [{__error}], does not throw', async () => {
        const invoker = throwingInvoker('Network error');
        const config: AINodeConfig = { type: 'ai', prompt: 'Go: {{ITEMS}}' };
        const result = await executeAI(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('Network error');
    });
});

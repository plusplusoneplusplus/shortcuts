import { describe, it, expect, vi } from 'vitest';
import { executeReduce } from '../../../src/workflow/nodes/reduce';
import type { ReduceNodeConfig, WorkflowExecutionOptions, Items } from '../../../src/workflow/types';
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

function opts(aiInvoker?: WorkflowExecutionOptions['aiInvoker']): WorkflowExecutionOptions {
    return { aiInvoker, workflowDirectory: process.cwd() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeReduce', () => {
    it('list strategy — markdown list output', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'list' };
        const inputs: Items = [{ text: 'Apple' }, { text: 'Banana' }];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        expect(result[0].output).toBe('- Apple\n- Banana');
    });

    it('list strategy, items without text — falls back to JSON representation', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'list' };
        const inputs: Items = [{ id: 1, score: 5 }];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        const output = result[0].output as string;
        expect(output).toContain('id');
        expect(output).toContain('score');
    });

    it('table strategy — markdown table with correct headers and rows', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'table' };
        const inputs: Items = [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
        ];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        const output = result[0].output as string;
        expect(output).toContain('| name | age |');
        expect(output).toContain('| --- | --- |');
        expect(output).toContain('| Alice | 30 |');
        expect(output).toContain('| Bob | 25 |');
    });

    it('json strategy — serialized JSON string', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'json' };
        const inputs: Items = [{ x: 1 }, { x: 2 }];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        expect(result[0].output).toBe(JSON.stringify([{ x: 1 }, { x: 2 }], null, 2));
    });

    it('csv strategy — CSV with header row', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'csv' };
        const inputs: Items = [
            { a: 'hello', b: 'world' },
            { a: 'foo,bar', b: 'baz' },
        ];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        const output = result[0].output as string;
        const lines = output.split('\n');
        expect(lines[0]).toBe('a,b');
        expect(lines[1]).toBe('hello,world');
        expect(lines[2]).toBe('"foo,bar",baz');
    });

    it('concat strategy — joins text fields with double newline', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'concat' };
        const inputs: Items = [{ text: 'First' }, { text: 'Second' }];
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        expect(result[0].output).toBe('First\n\nSecond');
    });

    it('ai strategy — calls AI with {{RESULTS}} and {{COUNT}} substituted', async () => {
        const invoker = makeInvoker('{"summary":"done"}');
        const config: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'You analyzed {{COUNT}} items:\n{{RESULTS}}\nSummarize.',
            output: ['summary'],
        };
        const inputs: Items = [{ label: 'x' }, { label: 'y' }];
        const result = await executeReduce(config, inputs, opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].summary).toBe('done');
        // Verify prompt substitution
        const callPrompt = invoker.mock.calls[0][0];
        expect(callPrompt).toContain('2');
        expect(callPrompt).toContain(JSON.stringify(inputs, null, 2));
    });

    it('ai strategy — AI failure returns [{__error}], does not throw', async () => {
        const invoker = failingInvoker('rate limit');
        const config: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'Summarize: {{RESULTS}}',
        };
        const result = await executeReduce(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('rate limit');
    });

    it('ai strategy — AI throws returns [{__error}], does not throw', async () => {
        const invoker = throwingInvoker('Network error');
        const config: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'Summarize: {{RESULTS}}',
        };
        const result = await executeReduce(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('Network error');
    });

    it('always returns exactly 1 element — all strategies', async () => {
        const inputs: Items = [{ text: 'a' }, { text: 'b' }];
        const strategies = ['list', 'table', 'json', 'csv', 'concat'] as const;
        for (const strategy of strategies) {
            const config: ReduceNodeConfig = { type: 'reduce', strategy };
            const result = await executeReduce(config, inputs, opts());
            expect(result).toHaveLength(1);
        }
        // AI strategy
        const invoker = makeInvoker('{"summary":"ok"}');
        const aiConfig: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'Go: {{RESULTS}}',
            output: ['summary'],
        };
        const aiResult = await executeReduce(aiConfig, inputs, opts(invoker));
        expect(aiResult).toHaveLength(1);
    });

    it('empty inputs — deterministic strategies handle gracefully', async () => {
        const inputs: Items = [];
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'list' };
        const result = await executeReduce(config, inputs, opts());
        expect(result).toHaveLength(1);
        expect(result[0].output).toBe('');
    });
});

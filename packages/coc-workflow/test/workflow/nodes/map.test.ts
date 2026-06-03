import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { executeMap } from '../../../src/workflow/nodes/map';
import type { MapNodeConfig, WorkflowExecutionOptions, Items } from '../../../src/workflow/types';
import type { AIInvokerResult } from '../../../src/ai/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInvoker(responseOrFn: string | ((prompt: string) => string)) {
    return vi.fn(async (prompt: string): Promise<AIInvokerResult> => ({
        success: true,
        response: typeof responseOrFn === 'function' ? responseOrFn(prompt) : responseOrFn,
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

describe('executeMap', () => {
    it('single item with output fields — structured merge', async () => {
        const invoker = makeInvoker('{"severity":"high","category":"bug"}');
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Classify: {{title}}',
            output: ['severity', 'category'],
        };
        const result = await executeMap(config, [{ id: 1, title: 'Bug' }], opts(invoker));
        expect(result).toEqual([{ id: 1, title: 'Bug', severity: 'high', category: 'bug' }]);
        expect(invoker).toHaveBeenCalledWith('Classify: Bug', expect.any(Object));
    });

    it('multiple items in parallel — all processed', async () => {
        const invoker = makeInvoker('{"label":"x"}');
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            output: ['label'],
        };
        const items: Items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
        const result = await executeMap(config, items, opts(invoker));
        expect(result).toHaveLength(5);
        for (const item of result) {
            expect(item.label).toBe('x');
        }
        expect(invoker).toHaveBeenCalledTimes(5);
    });

    it('text mode (no output fields) — text field added', async () => {
        const invoker = makeInvoker('A narrative response');
        const config: MapNodeConfig = { type: 'map', prompt: 'Tell me about {{id}}' };
        const result = await executeMap(config, [{ id: 1 }], opts(invoker));
        expect(result).toEqual([{ id: 1, text: 'A narrative response' }]);
    });

    it('AI failure (result.success === false) — item annotated, not thrown', async () => {
        const invoker = failingInvoker('rate limit');
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}', output: ['x'] };
        const result = await executeMap(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('rate limit');
        expect(result[0].id).toBe(1);
    });

    it('AI throws — item annotated, not thrown', async () => {
        const invoker = throwingInvoker('Network error');
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}' };
        const result = await executeMap(config, [{ id: 1 }], opts(invoker));
        expect(result).toHaveLength(1);
        expect(result[0].__error).toBe('Network error');
        expect(result[0].id).toBe(1);
    });

    it('JSON response with markdown fences — fences stripped', async () => {
        const invoker = makeInvoker('```json\n{"score":9}\n```');
        const config: MapNodeConfig = { type: 'map', prompt: 'Rate: {{id}}', output: ['score'] };
        const result = await executeMap(config, [{ id: 1 }], opts(invoker));
        expect(result).toEqual([{ id: 1, score: 9 }]);
    });

    it('JSON parse failure — falls back to text mode', async () => {
        const invoker = makeInvoker('Not valid JSON at all');
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}', output: ['field'] };
        const result = await executeMap(config, [{ id: 1 }], opts(invoker));
        expect(result[0].text).toBe('Not valid JSON at all');
        expect(result[0].__parseError).toBe(true);
        expect(result[0].id).toBe(1);
    });

    it('batch mode — prompt uses {{ITEMS}}, response array parsed', async () => {
        const invoker = makeInvoker('[{"label":"a"},{"label":"b"}]');
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process batch: {{ITEMS}}',
            output: ['label'],
            batchSize: 2,
        };
        const items: Items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
        const result = await executeMap(config, items, opts(invoker));
        expect(result).toHaveLength(4);
        expect(invoker).toHaveBeenCalledTimes(2);
        expect(result[0].label).toBe('a');
        expect(result[1].label).toBe('b');
        // Verify the prompt has {{ITEMS}} replaced
        const call0Prompt = invoker.mock.calls[0][0];
        expect(call0Prompt).toContain('"id": 1');
    });

    it('batch mode — array length mismatch → all items in batch get __error', async () => {
        const invoker = makeInvoker('[{"label":"x"},{"label":"y"}]');
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{ITEMS}}',
            output: ['label'],
            batchSize: 3,
        };
        const items: Items = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const result = await executeMap(config, items, opts(invoker));
        expect(result).toHaveLength(3);
        for (const item of result) {
            expect(item.__error).toContain('mismatch');
        }
    });

    it('concurrency respected', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        const invoker = vi.fn(async (): Promise<AIInvokerResult> => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise(r => setTimeout(r, 10));
            concurrent--;
            return { success: true, response: '{"v":1}' };
        });
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Go: {{id}}',
            output: ['v'],
            concurrency: 2,
        };
        const items: Items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
        await executeMap(config, items, opts(invoker));
        expect(maxConcurrent).toBeLessThanOrEqual(2);
        expect(maxConcurrent).toBeGreaterThan(0);
    });

    it('promptFile — reads from file relative to workflowDirectory', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-test-'));
        const promptPath = path.join(tmpDir, 'my-prompt.txt');
        await fs.writeFile(promptPath, 'Analyze: {{name}}', 'utf-8');

        const invoker = makeInvoker('result');
        const config: MapNodeConfig = { type: 'map', promptFile: 'my-prompt.txt' };
        const result = await executeMap(
            config,
            [{ name: 'Alice' }],
            { aiInvoker: invoker, workflowDirectory: tmpDir }
        );
        expect(invoker).toHaveBeenCalledWith('Analyze: Alice', expect.any(Object));
        expect(result[0].text).toBe('result');

        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});

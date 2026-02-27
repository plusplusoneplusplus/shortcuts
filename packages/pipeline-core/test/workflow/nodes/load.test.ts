import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { executeLoad } from '../../../src/workflow/nodes/load';
import type { LoadNodeConfig, WorkflowExecutionOptions } from '../../../src/workflow/types';
import type { AIInvokerResult } from '../../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpFiles: string[] = [];

function tmpPath(ext: string): string {
    const p = path.join(os.tmpdir(), `load-test-${randomUUID()}${ext}`);
    tmpFiles.push(p);
    return p;
}

async function writeTemp(ext: string, content: string): Promise<string> {
    const p = tmpPath(ext);
    await fs.promises.writeFile(p, content, 'utf-8');
    return p;
}

const noopInvoker = async (): Promise<AIInvokerResult> => ({
    success: true,
    response: '[]',
});

const defaultOpts: WorkflowExecutionOptions = {
    workflowDirectory: os.tmpdir(),
    aiInvoker: noopInvoker,
};

function makeInvoker(response: string) {
    return async (_prompt: string, _opts?: { model?: string }): Promise<AIInvokerResult> => ({
        success: true,
        response,
    });
}

afterEach(async () => {
    for (const f of tmpFiles) {
        try { await fs.promises.unlink(f); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
});

// ===========================================================================
// CSV tests
// ===========================================================================

describe('executeLoad — csv', () => {
    it('reads CSV and returns correct Items', async () => {
        const file = await writeTemp('.csv', 'id,title\n1,foo\n2,bar\n3,baz\n');
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'csv', path: file },
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ id: '1', title: 'foo' });
    });

    it('applies limit', async () => {
        const file = await writeTemp('.csv', 'id,title\n1,foo\n2,bar\n3,baz\n');
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'csv', path: file },
            limit: 2,
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(2);
    });

    it('throws on missing file', async () => {
        const missing = path.join(os.tmpdir(), `nonexistent-${randomUUID()}.csv`);
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'csv', path: missing },
        };
        await expect(executeLoad(config, defaultOpts)).rejects.toThrow(missing);
    });

    it('resolves relative path against workflowDirectory', async () => {
        const dir = os.tmpdir();
        const filename = `load-rel-${randomUUID()}.csv`;
        const full = path.join(dir, filename);
        await fs.promises.writeFile(full, 'id\n1\n');
        tmpFiles.push(full);

        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'csv', path: filename },
        };
        const result = await executeLoad(config, { ...defaultOpts, workflowDirectory: dir });
        expect(result).toHaveLength(1);
    });

    it('honours custom delimiter', async () => {
        const file = await writeTemp('.csv', 'id;title\n1;foo\n2;bar\n');
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'csv', path: file, delimiter: ';' },
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ id: '1', title: 'foo' });
    });
});

// ===========================================================================
// JSON tests
// ===========================================================================

describe('executeLoad — json', () => {
    it('reads JSON array file', async () => {
        const file = await writeTemp('.json', JSON.stringify([{ a: '1' }, { a: '2' }]));
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: file },
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ a: '1' });
    });

    it('reads JSON {items:[...]} file', async () => {
        const file = await writeTemp('.json', JSON.stringify({ items: [{ a: '1' }] }));
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: file },
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(1);
    });

    it('applies limit', async () => {
        const file = await writeTemp('.json', JSON.stringify([{ a: '1' }, { a: '2' }, { a: '3' }]));
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: file },
            limit: 1,
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(1);
    });

    it('throws on missing file', async () => {
        const missing = path.join(os.tmpdir(), `nonexistent-${randomUUID()}.json`);
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: missing },
        };
        await expect(executeLoad(config, defaultOpts)).rejects.toThrow(/not found/);
    });

    it('throws on invalid JSON', async () => {
        const file = await writeTemp('.json', 'not-json');
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: file },
        };
        await expect(executeLoad(config, defaultOpts)).rejects.toThrow(/Invalid JSON/);
    });

    it('throws on wrong JSON shape', async () => {
        const file = await writeTemp('.json', JSON.stringify({ foo: 'bar' }));
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'json', path: file },
        };
        await expect(executeLoad(config, defaultOpts)).rejects.toThrow(/"items" array/);
    });
});

// ===========================================================================
// Inline tests
// ===========================================================================

describe('executeLoad — inline', () => {
    it('returns items directly', async () => {
        const items = [{ x: '1' }, { x: '2' }, { x: '3' }];
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'inline', items },
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toEqual(items);
    });

    it('applies limit', async () => {
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'inline', items: [{ a: '1' }, { a: '2' }, { a: '3' }] },
            limit: 2,
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(2);
    });

    it('zero limit returns all items (0 means no limit)', async () => {
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'inline', items: [{ a: '1' }, { a: '2' }, { a: '3' }] },
            limit: 0,
        };
        const result = await executeLoad(config, defaultOpts);
        expect(result).toHaveLength(3);
    });
});

// ===========================================================================
// AI tests
// ===========================================================================

describe('executeLoad — ai', () => {
    const aiConfig = (overrides?: Partial<{ prompt: string; schema: string[]; model: string }>): LoadNodeConfig => ({
        type: 'load',
        source: {
            type: 'ai',
            prompt: 'Generate test users',
            schema: ['name', 'age'],
            ...overrides,
        },
    });

    it('calls aiInvoker and parses bare JSON array', async () => {
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker('[{"name":"Alice","age":"30"},{"name":"Bob","age":"25"}]'),
        };
        const result = await executeLoad(aiConfig(), opts);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ name: 'Alice', age: '30' });
    });

    it('parses fenced JSON (```json ... ```)', async () => {
        const response = '```json\n[{"name":"Alice","age":"30"}]\n```';
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker(response),
        };
        const result = await executeLoad(aiConfig(), opts);
        expect(result).toHaveLength(1);
    });

    it('parses fenced JSON without language tag (``` ... ```)', async () => {
        const response = '```\n[{"name":"Alice","age":"30"}]\n```';
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker(response),
        };
        const result = await executeLoad(aiConfig(), opts);
        expect(result).toHaveLength(1);
    });

    it('applies limit', async () => {
        const response = '[{"name":"A","age":"1"},{"name":"B","age":"2"},{"name":"C","age":"3"}]';
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker(response),
        };
        const result = await executeLoad({ ...aiConfig(), limit: 2 }, opts);
        expect(result).toHaveLength(2);
    });

    it('throws if response contains no JSON array', async () => {
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker('I cannot generate items.'),
        };
        await expect(executeLoad(aiConfig(), opts)).rejects.toThrow(/does not contain a JSON array/);
    });

    it('throws if JSON is malformed', async () => {
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker('[{bad json}]'),
        };
        await expect(executeLoad(aiConfig(), opts)).rejects.toThrow(/malformed JSON/);
    });

    it('throws if item missing required schema field', async () => {
        const response = '[{"name":"Alice"}]'; // missing "age"
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker(response),
        };
        await expect(executeLoad(aiConfig(), opts)).rejects.toThrow(/missing required field "age"/);
    });

    it('passes model to aiInvoker', async () => {
        let capturedModel: string | undefined;
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: async (_prompt, invokeOpts) => {
                capturedModel = invokeOpts?.model;
                return { success: true, response: '[{"name":"A","age":"1"}]' };
            },
        };
        await executeLoad(aiConfig({ model: 'gpt-4' }), opts);
        expect(capturedModel).toBe('gpt-4');
    });

    it('prompt contains schema field names', async () => {
        let capturedPrompt = '';
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: async (prompt) => {
                capturedPrompt = prompt;
                return { success: true, response: '[{"name":"A","age":"1"}]' };
            },
        };
        await executeLoad(aiConfig(), opts);
        expect(capturedPrompt).toContain('name, age');
    });

    it('throws when aiInvoker is not provided', async () => {
        const opts: WorkflowExecutionOptions = { workflowDirectory: os.tmpdir() };
        await expect(executeLoad(aiConfig(), opts)).rejects.toThrow(/aiInvoker is required/);
    });

    it('throws when AI invocation fails', async () => {
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: async () => ({ success: false, error: 'model unavailable' }),
        };
        await expect(executeLoad(aiConfig(), opts)).rejects.toThrow(/AI invocation failed/);
    });

    it('coerces non-string values to strings', async () => {
        const response = '[{"name":"Alice","age":30}]';
        const opts: WorkflowExecutionOptions = {
            ...defaultOpts,
            aiInvoker: makeInvoker(response),
        };
        const result = await executeLoad(aiConfig(), opts);
        expect(result[0].age).toBe('30');
    });
});

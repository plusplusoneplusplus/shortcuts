import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { executeWorkflow } from '../../src/workflow/executor';
import { executeMap } from '../../src/workflow/nodes/map';
import { executeAI } from '../../src/workflow/nodes/ai';
import { executeReduce } from '../../src/workflow/nodes/reduce';
import { setLogger, nullLogger, resetLogger } from '../../src/logger';
import type { WorkflowConfig, WorkflowExecutionOptions, MapNodeConfig, AINodeConfig, ReduceNodeConfig } from '../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions } from '../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureInvoker() {
    const calls: Array<{ prompt: string; opts?: AIInvokerOptions }> = [];
    const fn = vi.fn(async (prompt: string, opts?: AIInvokerOptions): Promise<AIInvokerResult> => {
        calls.push({ prompt, opts });
        return { success: true, response: '{"result":"ok"}' };
    });
    return { fn, calls };
}

function opts(overrides: Partial<WorkflowExecutionOptions> = {}): WorkflowExecutionOptions {
    return {
        aiInvoker: vi.fn(async (): Promise<AIInvokerResult> => ({
            success: true,
            response: '{"result":"ok"}',
        })),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workflow parameter substitution', () => {
    beforeEach(() => setLogger(nullLogger));
    afterEach(() => resetLogger());

    it('{{param}} in inline prompt is substituted from config.parameters', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'param-test',
            parameters: { language: 'TypeScript', framework: 'React' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Analyze {{id}} in {{language}} using {{framework}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: fn });

        expect(calls[0].prompt).toBe('Analyze 1 in TypeScript using React');
    });

    it('runtime options.parameters overrides config.parameters', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'override-test',
            parameters: { language: 'TypeScript', framework: 'React' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Analyze {{id}} in {{language}} using {{framework}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, {
            aiInvoker: fn,
            parameters: { language: 'Python' },
        });

        // language overridden, framework from config
        expect(calls[0].prompt).toBe('Analyze 1 in Python using React');
    });

    it('{{ITEMS}}, {{RESULTS}}, {{COUNT}} special variables are preserved', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'special-vars',
            parameters: { language: 'Go' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                ai: {
                    type: 'ai',
                    from: ['load'],
                    prompt: 'Process {{language}}: {{ITEMS}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: fn });

        // {{language}} should be substituted, but {{ITEMS}} stays until ai node handles it
        expect(calls[0].prompt).toContain('Process Go:');
        // {{ITEMS}} was preserved by parameter substitution, then resolved by ai node
        expect(calls[0].prompt).not.toContain('{{language}}');
    });

    it('{{fieldName}} for item fields is NOT consumed by parameter substitution (preserved for item-level)', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'item-fields-preserved',
            parameters: { style: 'formal' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ title: 'Hello' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Write about {{title}} in {{style}} tone',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: fn });

        // style should be substituted, title should be resolved as item field
        expect(calls[0].prompt).toBe('Write about Hello in formal tone');
    });

    it('parameters work with promptFile', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-params-'));
        const promptPath = path.join(tmpDir, 'prompt.txt');
        await fs.writeFile(promptPath, 'Analyze in {{language}}: {{id}}');

        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'promptfile-params',
            parameters: { language: 'Rust' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '42' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    promptFile: 'prompt.txt',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, {
            aiInvoker: fn,
            workflowDirectory: tmpDir,
        });

        expect(calls[0].prompt).toBe('Analyze in Rust: 42');

        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('empty/missing parameters leaves template unchanged', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'no-params',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'Process {{id}}',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: fn });

        // {{id}} is resolved by item-level substitution, not parameters
        expect(calls[0].prompt).toBe('Process 1');
    });

    it('parameters work with reduce (ai strategy)', async () => {
        const { fn, calls } = captureInvoker();
        const config: WorkflowConfig = {
            name: 'reduce-params',
            parameters: { format: 'markdown' },
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ text: 'item1' }, { text: 'item2' }] },
                },
                reduce: {
                    type: 'reduce',
                    from: ['load'],
                    strategy: 'ai',
                    prompt: 'Summarize {{RESULTS}} in {{format}} format ({{COUNT}} items)',
                    output: ['result'],
                },
            },
        };
        await executeWorkflow(config, { aiInvoker: fn });

        expect(calls[0].prompt).toContain('in markdown format');
        expect(calls[0].prompt).toContain('2 items');
    });
});

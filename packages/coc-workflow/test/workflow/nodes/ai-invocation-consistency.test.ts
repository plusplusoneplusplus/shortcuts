/**
 * Cross-node consistency tests for the shared AI invocation kernel.
 *
 * Pins the normalized behavior the kernel introduces across every AI-capable
 * node: a consistent missing-invoker guard and consistent provider-option
 * propagation (notably `workingDirectory`), which previously varied by node.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeMap } from '../../../src/workflow/nodes/map';
import { executeAI } from '../../../src/workflow/nodes/ai';
import { executeReduce } from '../../../src/workflow/nodes/reduce';
import { executeFilter } from '../../../src/workflow/nodes/filter';
import { executeLoad } from '../../../src/workflow/nodes/load';
import type {
    MapNodeConfig, AINodeConfig, ReduceNodeConfig, FilterNodeConfig, LoadNodeConfig,
    WorkflowExecutionOptions,
} from '../../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions } from '../../../src/ai/types';

function captureInvoker(response: string) {
    const calls: AIInvokerOptions[] = [];
    const fn = vi.fn(async (_prompt: string, o?: AIInvokerOptions): Promise<AIInvokerResult> => {
        calls.push(o ?? {});
        return { success: true, response };
    });
    return { fn, calls };
}

// ---------------------------------------------------------------------------
// Missing invoker — consistent guard across nodes
// ---------------------------------------------------------------------------

describe('missing aiInvoker — normalized guard', () => {
    const noInvoker: WorkflowExecutionOptions = { workflowDirectory: '/wf' };

    it('map throws instead of silently producing __error rows', async () => {
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}' };
        await expect(executeMap(config, [{ id: 1 }], noInvoker)).rejects.toThrow(/aiInvoker is required/);
    });

    it('ai throws', async () => {
        const config: AINodeConfig = { type: 'ai', prompt: 'Go: {{ITEMS}}' };
        await expect(executeAI(config, [{ id: 1 }], noInvoker)).rejects.toThrow(/aiInvoker is required/);
    });

    it('reduce (ai strategy) throws', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'ai', prompt: 'Go: {{RESULTS}}' };
        await expect(executeReduce(config, [{ id: 1 }], noInvoker)).rejects.toThrow(/aiInvoker is required/);
    });

    it('filter (ai rule) throws', async () => {
        const config: FilterNodeConfig = {
            type: 'filter',
            rule: { type: 'ai', prompt: 'Keep {{id}}?' },
        };
        await expect(executeFilter(config, [{ id: 1 }], noInvoker)).rejects.toThrow(/aiInvoker/);
    });

    it('load (ai source) throws', async () => {
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'ai', prompt: 'Generate', schema: ['name'] },
        };
        await expect(executeLoad(config, noInvoker)).rejects.toThrow(/aiInvoker is required/);
    });
});

// ---------------------------------------------------------------------------
// workingDirectory propagation — now consistent everywhere
// ---------------------------------------------------------------------------

describe('workingDirectory propagation — consistent across nodes', () => {
    it('map forwards workingDirectory (falls back to workflowDirectory)', async () => {
        const { fn, calls } = captureInvoker('{"x":1}');
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}', output: ['x'] };
        await executeMap(config, [{ id: 1 }], { aiInvoker: fn, workflowDirectory: '/wf' });
        expect(calls[0].workingDirectory).toBe('/wf');
    });

    it('ai forwards workingDirectory', async () => {
        const { fn, calls } = captureInvoker('{"x":1}');
        const config: AINodeConfig = { type: 'ai', prompt: 'Go: {{ITEMS}}', output: ['x'] };
        await executeAI(config, [{ id: 1 }], { aiInvoker: fn, workflowDirectory: '/wf' });
        expect(calls[0].workingDirectory).toBe('/wf');
    });

    it('reduce forwards workingDirectory', async () => {
        const { fn, calls } = captureInvoker('{"x":1}');
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'ai', prompt: 'Go: {{RESULTS}}', output: ['x'] };
        await executeReduce(config, [{ id: 1 }], { aiInvoker: fn, workflowDirectory: '/wf' });
        expect(calls[0].workingDirectory).toBe('/wf');
    });

    it('filter (ai rule) now forwards workingDirectory', async () => {
        const { fn, calls } = captureInvoker('{"include":true}');
        const config: FilterNodeConfig = {
            type: 'filter',
            rule: { type: 'ai', prompt: 'Keep {{id}}?' },
        };
        await executeFilter(config, [{ id: 1 }], { aiInvoker: fn, workflowDirectory: '/wf' });
        expect(calls[0].workingDirectory).toBe('/wf');
    });

    it('load (ai source) now forwards workingDirectory', async () => {
        const { fn, calls } = captureInvoker('[{"name":"A"}]');
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'ai', prompt: 'Generate', schema: ['name'] },
        };
        await executeLoad(config, { aiInvoker: fn, workflowDirectory: '/wf' });
        expect(calls[0].workingDirectory).toBe('/wf');
    });

    it('explicit workingDirectory overrides workflowDirectory', async () => {
        const { fn, calls } = captureInvoker('{"x":1}');
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}', output: ['x'] };
        await executeMap(config, [{ id: 1 }], {
            aiInvoker: fn, workflowDirectory: '/wf', workingDirectory: '/explicit',
        });
        expect(calls[0].workingDirectory).toBe('/explicit');
    });
});

// ---------------------------------------------------------------------------
// Node-specific failure policies preserved
// ---------------------------------------------------------------------------

describe('failure policies preserved after extraction', () => {
    const failing: WorkflowExecutionOptions = {
        aiInvoker: async () => ({ success: false, error: 'boom' }),
        workflowDirectory: '/wf',
    };
    const throwing: WorkflowExecutionOptions = {
        aiInvoker: async () => { throw new Error('network'); },
        workflowDirectory: '/wf',
    };

    it('map annotates __error (does not throw)', async () => {
        const config: MapNodeConfig = { type: 'map', prompt: 'Go: {{id}}' };
        const result = await executeMap(config, [{ id: 1 }], failing);
        expect(result[0].__error).toBe('boom');
    });

    it('reduce annotates __error (does not throw)', async () => {
        const config: ReduceNodeConfig = { type: 'reduce', strategy: 'ai', prompt: 'Go: {{RESULTS}}' };
        const result = await executeReduce(config, [{ id: 1 }], failing);
        expect(result[0].__error).toBe('boom');
    });

    it('filter conservatively excludes on failure (does not throw)', async () => {
        const config: FilterNodeConfig = { type: 'filter', rule: { type: 'ai', prompt: 'Keep?' } };
        const result = await executeFilter(config, [{ id: 1 }], failing);
        expect(result).toEqual([]);
    });

    it('load rethrows the invoker error verbatim', async () => {
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'ai', prompt: 'Generate', schema: ['name'] },
        };
        await expect(executeLoad(config, throwing)).rejects.toThrow('network');
    });

    it('load wraps a reported (non-thrown) failure', async () => {
        const config: LoadNodeConfig = {
            type: 'load',
            source: { type: 'ai', prompt: 'Generate', schema: ['name'] },
        };
        await expect(executeLoad(config, failing)).rejects.toThrow(/AI invocation failed: boom/);
    });
});

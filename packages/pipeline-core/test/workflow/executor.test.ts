import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWorkflow } from '../../src/workflow/executor';
import { setLogger, nullLogger, resetLogger } from '../../src/logger';
import type {
    WorkflowConfig,
    WorkflowExecutionOptions,
    Items,
} from '../../src/workflow/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<WorkflowExecutionOptions> = {}): WorkflowExecutionOptions {
    return {
        aiInvoker: vi.fn().mockResolvedValue({ success: true, response: '{"result":"ok"}' }),
        ...overrides,
    };
}

/**
 * Build a simple linear config: load → map → reduce
 */
function linearConfig(): WorkflowConfig {
    return {
        name: 'linear',
        nodes: {
            load: {
                type: 'load' as const,
                source: { type: 'inline' as const, items: [{ id: '1' }, { id: '2' }, { id: '3' }] },
            },
            map: {
                type: 'transform' as const,
                from: ['load'],
                ops: [{ op: 'add' as const, field: 'mapped', value: 'true' }],
            },
            reduce: {
                type: 'transform' as const,
                from: ['map'],
                ops: [{ op: 'add' as const, field: 'reduced', value: 'true' }],
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeWorkflow', () => {
    beforeEach(() => setLogger(nullLogger));
    afterEach(() => resetLogger());

    it('linear dag: load → transform → transform — correct output', async () => {
        const config = linearConfig();
        const result = await executeWorkflow(config, makeOptions());

        expect(result.success).toBe(true);
        expect(result.results.size).toBe(3);
        expect(result.leaves.has('reduce')).toBe(true);
        expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

        const reduceResult = result.results.get('reduce')!;
        expect(reduceResult.items).toHaveLength(3);
        expect(reduceResult.items[0]).toHaveProperty('mapped', 'true');
        expect(reduceResult.items[0]).toHaveProperty('reduced', 'true');
    });

    it('fan-out: load → [filterA, filterB] — two branches execute independently', async () => {
        const config: WorkflowConfig = {
            name: 'fan-out',
            nodes: {
                load: {
                    type: 'load',
                    source: {
                        type: 'inline',
                        items: [
                            { kind: 'bug', title: 'b1' },
                            { kind: 'feature', title: 'f1' },
                            { kind: 'bug', title: 'b2' },
                        ],
                    },
                },
                'filter-bugs': {
                    type: 'filter',
                    from: ['load'],
                    rule: { type: 'field', field: 'kind', op: 'eq', value: 'bug' },
                },
                'filter-features': {
                    type: 'filter',
                    from: ['load'],
                    rule: { type: 'field', field: 'kind', op: 'eq', value: 'feature' },
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.success).toBe(true);

        const bugs = result.results.get('filter-bugs')!;
        const features = result.results.get('filter-features')!;
        expect(bugs.items).toHaveLength(2);
        expect(features.items).toHaveLength(1);
    });

    it('fan-in: [transformA, transformB] → merge → transform', async () => {
        const config: WorkflowConfig = {
            name: 'fan-in',
            nodes: {
                loadA: {
                    type: 'load',
                    source: { type: 'inline', items: [{ src: 'A1' }, { src: 'A2' }] },
                },
                loadB: {
                    type: 'load',
                    source: { type: 'inline', items: [{ src: 'B1' }] },
                },
                transformA: {
                    type: 'transform',
                    from: ['loadA'],
                    ops: [{ op: 'add', field: 'branch', value: 'A' }],
                },
                transformB: {
                    type: 'transform',
                    from: ['loadB'],
                    ops: [{ op: 'add', field: 'branch', value: 'B' }],
                },
                merged: {
                    type: 'merge',
                    from: ['transformA', 'transformB'],
                },
                final: {
                    type: 'transform',
                    from: ['merged'],
                    ops: [{ op: 'add', field: 'done', value: 'yes' }],
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.success).toBe(true);

        const mergeResult = result.results.get('merged')!;
        expect(mergeResult.items).toHaveLength(3); // 2 from A + 1 from B

        const finalResult = result.results.get('final')!;
        expect(finalResult.items).toHaveLength(3);
        expect(finalResult.items.every(i => i.done === 'yes')).toBe(true);
    });

    it('onError: warn — failed node produces empty output, workflow succeeds', async () => {
        const config: WorkflowConfig = {
            name: 'warn-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ x: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/path/that/does/not/exist.json' },
                    onError: 'warn',
                },
                downstream: {
                    type: 'transform',
                    from: ['bad'],
                    ops: [{ op: 'add', field: 'ok', value: 'yes' }],
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.success).toBe(true);

        const badResult = result.results.get('bad')!;
        expect(badResult.items).toEqual([]);
        expect(badResult.error).toBeDefined();
        expect(badResult.success).toBe(false);

        // Downstream receives empty input
        const downstreamResult = result.results.get('downstream')!;
        expect(downstreamResult.items).toEqual([]);
    });

    it('onError: abort (default) — failed node throws, workflow rejects', async () => {
        const config: WorkflowConfig = {
            name: 'abort-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ x: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/path/that/does/not/exist.json' },
                    // no onError → defaults to abort
                },
            },
        };

        await expect(executeWorkflow(config, makeOptions())).rejects.toThrow();
    });

    it('signal.aborted returning true before tier 2 aborts workflow', async () => {
        const controller = new AbortController();

        const config: WorkflowConfig = {
            name: 'cancel-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ x: '1' }] },
                },
                next: {
                    type: 'transform',
                    from: ['load'],
                    ops: [{ op: 'add', field: 'y', value: '2' }],
                },
            },
        };

        // Abort after the first tier executes
        const originalOnProgress = vi.fn().mockImplementation((event: { phase: string }) => {
            if (event.phase === 'completed') {
                controller.abort();
            }
        });

        await expect(
            executeWorkflow(config, makeOptions({ signal: controller.signal, onProgress: originalOnProgress })),
        ).rejects.toThrow(/cancelled/i);
    });

    it('onProgress called with running and completed for every node', async () => {
        const config = linearConfig();
        const onProgress = vi.fn();
        await executeWorkflow(config, makeOptions({ onProgress }));

        const nodeIds = Object.keys(config.nodes);
        for (const nodeId of nodeIds) {
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ nodeId, phase: 'running' }));
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ nodeId, phase: 'completed' }));
        }
    });

    it('results map contains every executed node', async () => {
        const config: WorkflowConfig = {
            name: 'four-nodes',
            nodes: {
                a: { type: 'load', source: { type: 'inline', items: [{ v: '1' }] } },
                b: { type: 'transform', from: ['a'], ops: [{ op: 'add', field: 'f', value: 'x' }] },
                c: { type: 'transform', from: ['a'], ops: [{ op: 'add', field: 'g', value: 'y' }] },
                d: {
                    type: 'merge',
                    from: ['b', 'c'],
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.results.size).toBe(4);
    });

    it('leaves contains only terminal nodes, not intermediate nodes', async () => {
        const config: WorkflowConfig = {
            name: 'leaf-test',
            nodes: {
                root: { type: 'load', source: { type: 'inline', items: [{ v: '1' }] } },
                leafA: { type: 'transform', from: ['root'], ops: [{ op: 'add', field: 'a', value: '1' }] },
                leafB: { type: 'transform', from: ['root'], ops: [{ op: 'add', field: 'b', value: '2' }] },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.leaves.size).toBe(2);
        expect(result.leaves.has('leafA')).toBe(true);
        expect(result.leaves.has('leafB')).toBe(true);
        expect(result.leaves.has('root')).toBe(false);
    });

    it('tiers in WorkflowResult match scheduler output', async () => {
        const config = linearConfig();
        const result = await executeWorkflow(config, makeOptions());

        // Linear: tier 0 = [load], tier 1 = [map], tier 2 = [reduce]
        expect(result.tiers).toHaveLength(3);
        expect(result.tiers[0]).toEqual(['load']);
        expect(result.tiers[1]).toEqual(['map']);
        expect(result.tiers[2]).toEqual(['reduce']);
    });
});

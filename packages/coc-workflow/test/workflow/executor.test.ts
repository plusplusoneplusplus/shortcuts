import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWorkflow } from '../../src/workflow/executor';
import { setLogger, nullLogger, resetLogger } from '../../src/logger';
import { WorkflowValidationError } from '../../src/workflow/validator';
import { WorkflowErrorCode } from '../../src/errors/error-codes';
import type {
    WorkflowConfig,
    WorkflowExecutionOptions,
    WorkflowProgressEvent,
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

    it('cancels remaining same-tier AI nodes when the signal aborts during an AI invocation', async () => {
        const controller = new AbortController();
        const config: WorkflowConfig = {
            name: 'cancel-same-tier-ai',
            nodes: {
                first: {
                    type: 'ai',
                    prompt: 'first',
                },
                second: {
                    type: 'ai',
                    prompt: 'second',
                },
            },
        };
        const aiInvoker = vi.fn().mockImplementation((_prompt: string, options?: { signal?: AbortSignal }) => {
            expect(options?.signal).toBe(controller.signal);
            controller.abort();
            return Promise.resolve({ success: true, response: '{"result":"ok"}' });
        });

        await expect(
            executeWorkflow(config, makeOptions({ signal: controller.signal, aiInvoker })),
        ).rejects.toThrow(/cancelled/i);
        expect(aiInvoker).toHaveBeenCalledTimes(1);
    });

    it('does not start queued map AI calls after cancellation', async () => {
        const controller = new AbortController();
        const config: WorkflowConfig = {
            name: 'cancel-map-queue',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }, { id: '2' }, { id: '3' }] },
                },
                map: {
                    type: 'map',
                    from: ['load'],
                    prompt: 'map {{id}}',
                    concurrency: 1,
                    output: ['result'],
                },
            },
        };
        const aiInvoker = vi.fn().mockImplementation((_prompt: string, options?: { signal?: AbortSignal }) => {
            expect(options?.signal).toBe(controller.signal);
            controller.abort();
            return Promise.resolve({ success: true, response: '{"result":"ok"}' });
        });

        await expect(
            executeWorkflow(config, makeOptions({ signal: controller.signal, aiInvoker })),
        ).rejects.toThrow(/cancelled/i);
        expect(aiInvoker).toHaveBeenCalledTimes(1);
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

    // -----------------------------------------------------------------------
    // Concurrent tier — partial failure with onError: warn
    // -----------------------------------------------------------------------

    it('onError:warn — sibling nodes in same tier all run even when one fails', async () => {
        const config: WorkflowConfig = {
            name: 'concurrent-warn',
            nodes: {
                root: {
                    type: 'load',
                    source: { type: 'inline', items: [{ v: '1' }] },
                },
                failNode: {
                    type: 'load',
                    from: ['root'],
                    source: { type: 'json', path: '/nonexistent/concurrent-fail.json' },
                    onError: 'warn',
                },
                successNode: {
                    type: 'transform',
                    from: ['root'],
                    ops: [{ op: 'add', field: 'ok', value: 'yes' }],
                },
            },
        };

        const onProgress = vi.fn();
        const result = await executeWorkflow(config, makeOptions({ onProgress }));

        expect(result.success).toBe(true);

        // Failed node recorded with error
        const fail = result.results.get('failNode')!;
        expect(fail.success).toBe(false);
        expect(fail.items).toEqual([]);
        expect(fail.error).toBeDefined();

        // Sibling node ran to completion despite the concurrent failure
        const success = result.results.get('successNode')!;
        expect(success.success).toBe(true);
        expect(success.items).toHaveLength(1);
        expect(success.items[0]).toHaveProperty('ok', 'yes');
    });

    it('onError:warn — multiple simultaneous failures in a tier all captured', async () => {
        const config: WorkflowConfig = {
            name: 'multi-fail-warn',
            nodes: {
                root: {
                    type: 'load',
                    source: { type: 'inline', items: [{ v: '1' }] },
                },
                fail1: {
                    type: 'load',
                    from: ['root'],
                    source: { type: 'json', path: '/nonexistent/fail-1.json' },
                    onError: 'warn',
                },
                fail2: {
                    type: 'load',
                    from: ['root'],
                    source: { type: 'json', path: '/nonexistent/fail-2.json' },
                    onError: 'warn',
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());

        expect(result.success).toBe(true);

        // Both failures captured
        const r1 = result.results.get('fail1')!;
        const r2 = result.results.get('fail2')!;
        expect(r1.success).toBe(false);
        expect(r1.error).toBeDefined();
        expect(r1.items).toEqual([]);
        expect(r2.success).toBe(false);
        expect(r2.error).toBeDefined();
        expect(r2.items).toEqual([]);
    });

    it('onError:warn — downstream of warned node receives empty input', async () => {
        const config: WorkflowConfig = {
            name: 'concurrent-warn-downstream',
            nodes: {
                root: {
                    type: 'load',
                    source: { type: 'inline', items: [{ v: '1' }] },
                },
                failBranch: {
                    type: 'load',
                    from: ['root'],
                    source: { type: 'json', path: '/nonexistent/missing.json' },
                    onError: 'warn',
                },
                okBranch: {
                    type: 'transform',
                    from: ['root'],
                    ops: [{ op: 'add', field: 'ok', value: 'yes' }],
                },
                afterFail: {
                    type: 'transform',
                    from: ['failBranch'],
                    ops: [{ op: 'add', field: 'tag', value: 'x' }],
                },
                afterOk: {
                    type: 'transform',
                    from: ['okBranch'],
                    ops: [{ op: 'add', field: 'tag', value: 'y' }],
                },
            },
        };

        const result = await executeWorkflow(config, makeOptions());
        expect(result.success).toBe(true);

        // Downstream of warned node gets empty
        expect(result.results.get('afterFail')!.items).toEqual([]);
        // Downstream of ok node gets data
        expect(result.results.get('afterOk')!.items).toHaveLength(1);
        expect(result.results.get('afterOk')!.items[0]).toHaveProperty('tag', 'y');
    });

    // -----------------------------------------------------------------------
    // Validation errors surfaced through executeWorkflow
    // -----------------------------------------------------------------------

    it('empty workflow (0 nodes) rejects with WorkflowValidationError', async () => {
        const config: WorkflowConfig = { name: 'empty', nodes: {} };

        const err = await executeWorkflow(config, makeOptions()).catch(e => e);
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err.code).toBe(WorkflowErrorCode.WORKFLOW_EMPTY);
    });

    it('circular dependency rejects with WorkflowValidationError', async () => {
        const config: WorkflowConfig = {
            name: 'cycle',
            nodes: {
                a: { type: 'map', from: ['c'], prompt: 'p' } as any,
                b: { type: 'map', from: ['a'], prompt: 'p' } as any,
                c: { type: 'map', from: ['b'], prompt: 'p' } as any,
            },
        };

        const err = await executeWorkflow(config, makeOptions()).catch(e => e);
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err.code).toBe(WorkflowErrorCode.CYCLE_DETECTED);
    });

    // -----------------------------------------------------------------------
    // onProgress — warned and failed phases
    // -----------------------------------------------------------------------

    it('onProgress emits warned phase for onError:warn node', async () => {
        const config: WorkflowConfig = {
            name: 'progress-warn',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ x: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/progress-warn.json' },
                    onError: 'warn',
                },
            },
        };

        const events: WorkflowProgressEvent[] = [];
        const onProgress = vi.fn((e: WorkflowProgressEvent) => events.push(e));
        await executeWorkflow(config, makeOptions({ onProgress }));

        // 'bad' node should emit running → warned (not completed)
        const badEvents = events.filter(e => e.nodeId === 'bad');
        expect(badEvents.map(e => e.phase)).toEqual(['running', 'warned']);
        const warned = badEvents.find(e => e.phase === 'warned')!;
        expect(warned.error).toBeDefined();
        expect(warned.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('onProgress emits failed phase for abort-mode node', async () => {
        const config: WorkflowConfig = {
            name: 'progress-fail',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ x: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/progress-fail.json' },
                    // no onError → abort
                },
            },
        };

        const events: WorkflowProgressEvent[] = [];
        const onProgress = vi.fn((e: WorkflowProgressEvent) => events.push(e));

        await expect(executeWorkflow(config, makeOptions({ onProgress }))).rejects.toThrow();

        // 'bad' node should emit running → failed
        const badEvents = events.filter(e => e.nodeId === 'bad');
        expect(badEvents.map(e => e.phase)).toEqual(['running', 'failed']);
        const failed = badEvents.find(e => e.phase === 'failed')!;
        expect(failed.error).toBeDefined();
    });

    it('onProgress events within a tier arrive before next tier starts', async () => {
        const config: WorkflowConfig = {
            name: 'tier-ordering',
            nodes: {
                a: { type: 'load', source: { type: 'inline', items: [{ v: '1' }] } },
                b: { type: 'transform', from: ['a'], ops: [{ op: 'add', field: 'f', value: '1' }] },
                c: { type: 'transform', from: ['a'], ops: [{ op: 'add', field: 'g', value: '2' }] },
                d: { type: 'merge', from: ['b', 'c'] },
            },
        };

        const events: WorkflowProgressEvent[] = [];
        const onProgress = vi.fn((e: WorkflowProgressEvent) => events.push(e));
        await executeWorkflow(config, makeOptions({ onProgress }));

        // b and c are in the same tier (tier 1); d is in tier 2
        // Both b and c must complete before d starts
        const dRunningIdx = events.findIndex(e => e.nodeId === 'd' && e.phase === 'running');
        const bCompletedIdx = events.findIndex(e => e.nodeId === 'b' && e.phase === 'completed');
        const cCompletedIdx = events.findIndex(e => e.nodeId === 'c' && e.phase === 'completed');

        expect(bCompletedIdx).toBeLessThan(dRunningIdx);
        expect(cCompletedIdx).toBeLessThan(dRunningIdx);
    });

    // -----------------------------------------------------------------------
    // Deep DAG — stress test
    // -----------------------------------------------------------------------

    it('very deep linear DAG (60 nodes) completes without stack overflow', async () => {
        const depth = 60;
        const nodes: Record<string, any> = {
            'node-0': {
                type: 'load',
                source: { type: 'inline', items: [{ depth: '0' }] },
            },
        };
        for (let i = 1; i < depth; i++) {
            nodes[`node-${i}`] = {
                type: 'transform',
                from: [`node-${i - 1}`],
                ops: [{ op: 'add', field: `d${i}`, value: String(i) }],
            };
        }

        const config: WorkflowConfig = { name: 'deep-dag', nodes };
        const result = await executeWorkflow(config, makeOptions());

        expect(result.success).toBe(true);
        expect(result.results.size).toBe(depth);
        expect(result.tiers).toHaveLength(depth);

        // Last node has all accumulated fields
        const last = result.results.get(`node-${depth - 1}`)!;
        expect(last.items).toHaveLength(1);
        expect(last.items[0]).toHaveProperty('depth', '0');
        expect(last.items[0]).toHaveProperty(`d${depth - 1}`, String(depth - 1));
    });

    it('wide fan-out DAG (50 parallel branches) completes correctly', async () => {
        const width = 50;
        const nodes: Record<string, any> = {
            root: {
                type: 'load',
                source: { type: 'inline', items: [{ v: '1' }] },
            },
        };
        for (let i = 0; i < width; i++) {
            nodes[`branch-${i}`] = {
                type: 'transform',
                from: ['root'],
                ops: [{ op: 'add', field: 'branch', value: String(i) }],
            };
        }

        const config: WorkflowConfig = { name: 'wide-dag', nodes };
        const result = await executeWorkflow(config, makeOptions());

        expect(result.success).toBe(true);
        expect(result.results.size).toBe(width + 1); // root + branches
        expect(result.leaves.size).toBe(width);
        expect(result.tiers).toHaveLength(2); // root tier + all branches tier
    });
});

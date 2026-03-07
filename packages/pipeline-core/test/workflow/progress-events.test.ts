import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWorkflow } from '../../src/workflow/executor';
import { setLogger, nullLogger, resetLogger } from '../../src/logger';
import type {
    WorkflowConfig, WorkflowExecutionOptions, WorkflowProgressEvent,
} from '../../src/workflow/types';
import type { AIInvokerResult } from '../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<WorkflowExecutionOptions> = {}): WorkflowExecutionOptions {
    return {
        aiInvoker: vi.fn().mockResolvedValue({ success: true, response: '{"result":"ok"}' }),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowProgressEvent', () => {
    beforeEach(() => setLogger(nullLogger));
    afterEach(() => resetLogger());

    it('emits running → completed for each node', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'progress-basic',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                transform: {
                    type: 'transform',
                    from: ['load'],
                    ops: [{ op: 'add', field: 'x', value: 'y' }],
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const loadRunning = events.find(e => e.nodeId === 'load' && e.phase === 'running');
        const loadCompleted = events.find(e => e.nodeId === 'load' && e.phase === 'completed');
        const tfRunning = events.find(e => e.nodeId === 'transform' && e.phase === 'running');
        const tfCompleted = events.find(e => e.nodeId === 'transform' && e.phase === 'completed');

        expect(loadRunning).toBeDefined();
        expect(loadCompleted).toBeDefined();
        expect(tfRunning).toBeDefined();
        expect(tfCompleted).toBeDefined();
    });

    it('completed events have durationMs', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'duration-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const completed = events.find(e => e.phase === 'completed');
        expect(completed).toBeDefined();
        expect(completed!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('inputItemCount and outputItemCount are accurate', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'counts-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }, { id: '2' }, { id: '3' }] },
                },
                filter: {
                    type: 'filter',
                    from: ['load'],
                    rule: { type: 'field', field: 'id', op: 'eq', value: '1' },
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const filterCompleted = events.find(e => e.nodeId === 'filter' && e.phase === 'completed');
        expect(filterCompleted).toBeDefined();
        expect(filterCompleted!.inputItemCount).toBe(3);
        expect(filterCompleted!.outputItemCount).toBe(1);
    });

    it('warned events are emitted when onError: warn', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'warn-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/path/that/does/not/exist.json' },
                    onError: 'warn',
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const warned = events.find(e => e.nodeId === 'bad' && e.phase === 'warned');
        expect(warned).toBeDefined();
        expect(warned!.error).toBeDefined();
        expect(warned!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('failed events are emitted when node throws (onError: abort)', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'fail-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                bad: {
                    type: 'load',
                    from: ['load'],
                    source: { type: 'json', path: '/nonexistent/path/that/does/not/exist.json' },
                },
            },
        };
        await expect(
            executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) })),
        ).rejects.toThrow();

        const failed = events.find(e => e.nodeId === 'bad' && e.phase === 'failed');
        expect(failed).toBeDefined();
        expect(failed!.error).toBeDefined();
        expect(failed!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('all events have ISO timestamps', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'timestamp-test',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        for (const event of events) {
            expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }
    });

    it('multi-tier execution: tier 1 completes before tier 2 starts', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'tier-order',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }] },
                },
                transform: {
                    type: 'transform',
                    from: ['load'],
                    ops: [{ op: 'add', field: 'x', value: 'y' }],
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const loadCompletedIdx = events.findIndex(e => e.nodeId === 'load' && e.phase === 'completed');
        const transformRunningIdx = events.findIndex(e => e.nodeId === 'transform' && e.phase === 'running');
        expect(loadCompletedIdx).toBeLessThan(transformRunningIdx);
    });

    it('running events include inputItemCount', async () => {
        const events: WorkflowProgressEvent[] = [];
        const config: WorkflowConfig = {
            name: 'input-count',
            nodes: {
                load: {
                    type: 'load',
                    source: { type: 'inline', items: [{ id: '1' }, { id: '2' }] },
                },
                transform: {
                    type: 'transform',
                    from: ['load'],
                    ops: [{ op: 'add', field: 'x', value: 'y' }],
                },
            },
        };
        await executeWorkflow(config, makeOptions({ onProgress: e => events.push(e) }));

        const running = events.find(e => e.nodeId === 'transform' && e.phase === 'running');
        expect(running!.inputItemCount).toBe(2);
    });
});

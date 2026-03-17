import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeMap } from '../../../src/workflow/nodes/map';
import { executeAI } from '../../../src/workflow/nodes/ai';
import { setLogger, nullLogger, resetLogger } from '../../../src/logger';
import type {
    MapNodeConfig, AINodeConfig, WorkflowExecutionOptions, WorkflowItemProcessEvent,
} from '../../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions, ProcessTracker } from '../../../src/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoker(response = '{"result":"ok"}') {
    return vi.fn(async (_prompt: string, _opts?: AIInvokerOptions): Promise<AIInvokerResult> => ({
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

function makeTracker(): ProcessTracker {
    let counter = 0;
    return {
        registerProcess: vi.fn((_desc: string) => `proc-${counter++}`),
        updateProcess: vi.fn(),
    };
}

function opts(overrides: Partial<WorkflowExecutionOptions> = {}): WorkflowExecutionOptions {
    return {
        aiInvoker: makeInvoker(),
        currentNodeId: 'test-node',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Item process tracking', () => {
    beforeEach(() => setLogger(nullLogger));
    afterEach(() => resetLogger());

    describe('map node — single-item mode', () => {
        it('onItemProcess called with running then completed for each item', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const invoker = makeInvoker();
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process {{id}}',
                output: ['result'],
            };
            await executeMap(
                config,
                [{ id: '1' }, { id: '2' }],
                opts({ aiInvoker: invoker, onItemProcess: e => events.push(e) }),
            );

            // Each item should have running + completed
            const runningEvents = events.filter(e => e.status === 'running');
            const completedEvents = events.filter(e => e.status === 'completed');
            expect(runningEvents).toHaveLength(2);
            expect(completedEvents).toHaveLength(2);
        });

        it('processTracker.registerProcess is called when tracker is provided', async () => {
            const tracker = makeTracker();
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process {{id}}',
                output: ['result'],
            };
            await executeMap(
                config,
                [{ id: '1' }],
                opts({ processTracker: tracker }),
            );

            expect(tracker.registerProcess).toHaveBeenCalledWith('Map: 1');
        });

        it('itemLabel is populated from the first field value', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process {{title}}',
                output: ['result'],
            };
            await executeMap(
                config,
                [{ title: 'Bug Report' }],
                opts({ onItemProcess: e => events.push(e) }),
            );

            expect(events[0].itemLabel).toBe('Bug Report');
        });

        it('errors produce status: failed with error message', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process {{id}}',
                output: ['result'],
            };
            await executeMap(
                config,
                [{ id: '1' }],
                opts({ aiInvoker: failingInvoker('boom'), onItemProcess: e => events.push(e) }),
            );

            const failed = events.find(e => e.status === 'failed');
            expect(failed).toBeDefined();
            expect(failed!.error).toBe('boom');
        });

        it('thrown errors produce status: failed', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process {{id}}',
                output: ['result'],
            };
            await executeMap(
                config,
                [{ id: '1' }],
                opts({ aiInvoker: throwingInvoker('network fail'), onItemProcess: e => events.push(e) }),
            );

            const failed = events.find(e => e.status === 'failed');
            expect(failed).toBeDefined();
            expect(failed!.error).toBe('network fail');
        });
    });

    describe('map node — batch mode', () => {
        it('one process per batch', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: MapNodeConfig = {
                type: 'map',
                prompt: 'Process: {{ITEMS}}',
                batchSize: 2,
                output: ['result'],
            };
            const invoker = vi.fn(async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '[{"result":"a"},{"result":"b"}]',
            }));
            await executeMap(
                config,
                [{ id: '1' }, { id: '2' }, { id: '3' }],
                opts({ aiInvoker: invoker, onItemProcess: e => events.push(e) }),
            );

            // 2 batches: [1,2] and [3]
            const runningEvents = events.filter(e => e.status === 'running');
            expect(runningEvents).toHaveLength(2);
            expect(runningEvents[0].itemLabel).toBe('batch-0');
            expect(runningEvents[1].itemLabel).toBe('batch-1');
        });
    });

    describe('AI node', () => {
        it('one process per invocation', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: AINodeConfig = {
                type: 'ai',
                prompt: 'Summarize: {{ITEMS}}',
                output: ['result'],
            };
            await executeAI(
                config,
                [{ text: 'hello' }],
                opts({ onItemProcess: e => events.push(e) }),
            );

            expect(events).toHaveLength(2);
            expect(events[0].status).toBe('running');
            expect(events[1].status).toBe('completed');
            expect(events[0].itemIndex).toBe(0);
        });

        it('failed AI node emits failed status', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const config: AINodeConfig = {
                type: 'ai',
                prompt: 'Summarize: {{ITEMS}}',
                output: ['result'],
            };
            await executeAI(
                config,
                [{ text: 'hello' }],
                opts({ aiInvoker: failingInvoker('ai error'), onItemProcess: e => events.push(e) }),
            );

            const failed = events.find(e => e.status === 'failed');
            expect(failed).toBeDefined();
            expect(failed!.error).toBe('ai error');
        });
    });

    it('missing processTracker and onItemProcess do not cause errors', async () => {
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process {{id}}',
            output: ['result'],
        };
        // No processTracker, no onItemProcess — should not throw
        const result = await executeMap(
            config,
            [{ id: '1' }],
            { aiInvoker: makeInvoker() },
        );
        expect(result).toHaveLength(1);
    });
});

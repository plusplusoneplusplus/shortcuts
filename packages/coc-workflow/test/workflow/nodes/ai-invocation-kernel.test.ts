import { describe, it, expect, vi } from 'vitest';
import { invokeWorkflowAI } from '../../../src/workflow/nodes/ai-invocation-kernel';
import { WorkflowCancellationError } from '../../../src/workflow/cancellation';
import type { WorkflowExecutionOptions, WorkflowItemProcessEvent } from '../../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions, ProcessTracker } from '../../../src/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoker(response = 'ok') {
    return vi.fn(async (_prompt: string, _opts?: AIInvokerOptions): Promise<AIInvokerResult> => ({
        success: true,
        response,
    }));
}

function makeTracker(): ProcessTracker {
    return {
        registerProcess: vi.fn(() => 'proc-0'),
        updateProcess: vi.fn(),
        registerGroup: vi.fn(() => 'group-0'),
        completeGroup: vi.fn(),
    };
}

function lifecycle(overrides: Partial<Parameters<typeof invokeWorkflowAI>[0]['lifecycle']> = {}) {
    return {
        processId: 'proc-0',
        nodeId: 'n1',
        itemIndex: 0,
        ...overrides,
    } as NonNullable<Parameters<typeof invokeWorkflowAI>[0]['lifecycle']>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('invokeWorkflowAI', () => {
    it('preflight: throws when aiInvoker is missing', async () => {
        const options: WorkflowExecutionOptions = {};
        await expect(invokeWorkflowAI({ prompt: 'hi', options }))
            .rejects.toThrow(/aiInvoker is required/);
    });

    it('success: returns normalized success result', async () => {
        const options: WorkflowExecutionOptions = { aiInvoker: makeInvoker('answer') };
        const result = await invokeWorkflowAI({ prompt: 'hi', options });
        expect(result).toEqual({ success: true, response: 'answer' });
    });

    it('provider failure (success:false): returns raw error, no default substitution', async () => {
        const invoker = vi.fn(async (): Promise<AIInvokerResult> => ({ success: false, error: 'rate limit' }));
        const options: WorkflowExecutionOptions = { aiInvoker: invoker };
        const result = await invokeWorkflowAI({ prompt: 'hi', options });
        expect(result.success).toBe(false);
        expect(result.error).toBe('rate limit');
        expect(result.thrownError).toBeUndefined();
    });

    it('thrown error: normalized message plus original error preserved', async () => {
        const boom = new Error('network down');
        const invoker = vi.fn(async (): Promise<AIInvokerResult> => { throw boom; });
        const options: WorkflowExecutionOptions = { aiInvoker: invoker };
        const result = await invokeWorkflowAI({ prompt: 'hi', options });
        expect(result.success).toBe(false);
        expect(result.error).toBe('network down');
        expect(result.thrownError).toBe(boom);
    });

    it('requireResponse=false: empty response is still a success', async () => {
        const options: WorkflowExecutionOptions = { aiInvoker: makeInvoker('') };
        const result = await invokeWorkflowAI({ prompt: 'hi', options });
        expect(result).toEqual({ success: true, response: '' });
    });

    it('requireResponse=true: empty response is a failure with undefined error', async () => {
        const options: WorkflowExecutionOptions = { aiInvoker: makeInvoker('') };
        const result = await invokeWorkflowAI({ prompt: 'hi', options, requireResponse: true });
        expect(result.success).toBe(false);
        expect(result.error).toBeUndefined();
    });

    it('provider options: resolves model/timeout/workingDirectory precedence', async () => {
        const invoker = makeInvoker('ok');
        const options: WorkflowExecutionOptions = {
            aiInvoker: invoker,
            model: 'default-model',
            timeoutMs: 1000,
            workflowDirectory: '/wf',
        };
        await invokeWorkflowAI({ prompt: 'p', options });
        expect(invoker).toHaveBeenCalledWith('p', {
            model: 'default-model',
            timeoutMs: 1000,
            workingDirectory: '/wf',
            signal: undefined,
        });
    });

    it('provider options: node overrides win; workingDirectory prefers explicit over workflowDirectory', async () => {
        const invoker = makeInvoker('ok');
        const options: WorkflowExecutionOptions = {
            aiInvoker: invoker,
            model: 'default-model',
            timeoutMs: 1000,
            workingDirectory: '/explicit',
            workflowDirectory: '/wf',
        };
        await invokeWorkflowAI({ prompt: 'p', options, model: 'node-model', timeoutMs: 50 });
        expect(invoker).toHaveBeenCalledWith('p', {
            model: 'node-model',
            timeoutMs: 50,
            workingDirectory: '/explicit',
            signal: undefined,
        });
    });

    it('cancellation before call: throws WorkflowCancellationError, invoker not called', async () => {
        const invoker = makeInvoker('ok');
        const controller = new AbortController();
        controller.abort();
        const options: WorkflowExecutionOptions = { aiInvoker: invoker, signal: controller.signal };
        await expect(invokeWorkflowAI({ prompt: 'p', options }))
            .rejects.toBeInstanceOf(WorkflowCancellationError);
        expect(invoker).not.toHaveBeenCalled();
    });

    it('cancellation after call: aborted signal surfaces as a throw, not a result', async () => {
        const controller = new AbortController();
        const invoker = vi.fn(async (): Promise<AIInvokerResult> => {
            controller.abort();
            return { success: true, response: 'late' };
        });
        const options: WorkflowExecutionOptions = { aiInvoker: invoker, signal: controller.signal };
        await expect(invokeWorkflowAI({ prompt: 'p', options }))
            .rejects.toBeInstanceOf(WorkflowCancellationError);
    });

    describe('lifecycle reporting', () => {
        it('emits running then completed and updates the tracker on success', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const tracker = makeTracker();
            const options: WorkflowExecutionOptions = { aiInvoker: makeInvoker('done') };
            await invokeWorkflowAI({
                prompt: 'p',
                options,
                lifecycle: lifecycle({
                    processTracker: tracker,
                    onItemProcess: e => events.push(e),
                    itemLabel: 'first',
                }),
            });
            expect(events.map(e => e.status)).toEqual(['running', 'completed']);
            expect(events[0].itemLabel).toBe('first');
            expect(tracker.updateProcess).toHaveBeenCalledWith('proc-0', 'completed', 'done');
        });

        it('emits running then failed on provider failure', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const tracker = makeTracker();
            const invoker = vi.fn(async (): Promise<AIInvokerResult> => ({ success: false, error: 'boom' }));
            const options: WorkflowExecutionOptions = { aiInvoker: invoker };
            await invokeWorkflowAI({
                prompt: 'p',
                options,
                lifecycle: lifecycle({ processTracker: tracker, onItemProcess: e => events.push(e) }),
            });
            expect(events.map(e => e.status)).toEqual(['running', 'failed']);
            expect(events[1].error).toBe('boom');
            expect(tracker.updateProcess).toHaveBeenCalledWith('proc-0', 'failed', undefined, 'boom');
        });

        it('empty response with requireResponse reports failed via failureMessage', async () => {
            const events: WorkflowItemProcessEvent[] = [];
            const options: WorkflowExecutionOptions = { aiInvoker: makeInvoker('') };
            await invokeWorkflowAI({
                prompt: 'p',
                options,
                requireResponse: true,
                failureMessage: 'node failed',
                lifecycle: lifecycle({ onItemProcess: e => events.push(e) }),
            });
            const failed = events.find(e => e.status === 'failed');
            expect(failed?.error).toBe('node failed');
        });
    });
});

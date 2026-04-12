import { describe, it, expect, vi } from 'vitest';
import type { WorkItem, MapContext } from '../../../src/map-reduce/types';
import type { AIInvoker } from '../../../src/ai/types';
import type { AIInvokerResult } from '../../../src/ai/types';
import { BaseMapper } from '../../../src/map-reduce/jobs/base-mapper';
import { MissingVariableError } from '../../../src/map-reduce/prompt-template';

// ---------------------------------------------------------------------------
// Concrete test subclass
// ---------------------------------------------------------------------------

interface TestInput {
    text: string;
}

interface TestOutput {
    success: boolean;
    value?: string;
    error?: string;
    rawResponse?: string;
}

class TestMapper extends BaseMapper<TestInput, TestOutput> {
    promptCalls: Array<{ prompt: string; model?: string }> = [];
    parseSuccessCalls: WorkItem<TestInput>[] = [];
    buildFailureCalls: WorkItem<TestInput>[] = [];
    buildExceptionCalls: Array<{ workItem: WorkItem<TestInput>; error: unknown }> = [];

    // Configurable overrides for tests
    promptAndModelOverride?: () => { prompt: string; model?: string };
    parseSuccessOverride?: (result: AIInvokerResult) => TestOutput;
    aiFailureOverride?: (result: AIInvokerResult) => TestOutput;
    exceptionOverride?: (error: unknown) => TestOutput;

    protected buildPromptAndModel(workItem: WorkItem<TestInput>): { prompt: string; model?: string } {
        if (this.promptAndModelOverride) return this.promptAndModelOverride();
        const prompt = workItem.data.text;
        const result = { prompt };
        this.promptCalls.push(result);
        return result;
    }

    protected parseSuccessResponse(workItem: WorkItem<TestInput>, result: AIInvokerResult): TestOutput {
        this.parseSuccessCalls.push(workItem);
        if (this.parseSuccessOverride) return this.parseSuccessOverride(result);
        return { success: true, value: result.response, rawResponse: result.response };
    }

    protected buildAIFailureResult(workItem: WorkItem<TestInput>, result: AIInvokerResult): TestOutput {
        this.buildFailureCalls.push(workItem);
        if (this.aiFailureOverride) return this.aiFailureOverride(result);
        return { success: false, error: result.error || 'Unknown error' };
    }

    protected buildExceptionResult(workItem: WorkItem<TestInput>, error: unknown): TestOutput {
        this.buildExceptionCalls.push({ workItem, error });
        if (this.exceptionOverride) return this.exceptionOverride(error);
        return { success: false, error: this.errorMessage(error) };
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkItem(text: string, id = 'item-0'): WorkItem<TestInput> {
    return { id, data: { text } };
}

const MAP_CONTEXT: MapContext = {
    executionId: 'exec-1',
    totalItems: 1,
    itemIndex: 0
};

function makeInvoker(result: AIInvokerResult): AIInvoker {
    return vi.fn().mockResolvedValue(result);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseMapper', () => {
    describe('happy path', () => {
        it('calls aiInvoker with prompt from buildPromptAndModel', async () => {
            const invoker = makeInvoker({ success: true, response: 'hello' });
            const mapper = new TestMapper(invoker);

            await mapper.map(makeWorkItem('prompt text'), MAP_CONTEXT);

            expect(invoker).toHaveBeenCalledOnce();
            expect(invoker).toHaveBeenCalledWith('prompt text', { model: undefined });
        });

        it('calls aiInvoker with model when buildPromptAndModel returns one', async () => {
            const invoker = makeInvoker({ success: true, response: 'result' });
            const mapper = new TestMapper(invoker);
            mapper.promptAndModelOverride = () => ({ prompt: 'p', model: 'gpt-4' });

            await mapper.map(makeWorkItem('anything'), MAP_CONTEXT);

            expect(invoker).toHaveBeenCalledWith('p', { model: 'gpt-4' });
        });

        it('calls parseSuccessResponse when AI returns success + response', async () => {
            const invoker = makeInvoker({ success: true, response: 'ai text' });
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.parseSuccessCalls).toHaveLength(1);
            expect(output).toEqual({ success: true, value: 'ai text', rawResponse: 'ai text' });
        });

        it('passes the full AIInvokerResult to parseSuccessResponse', async () => {
            const invoker = makeInvoker({ success: true, response: 'response', sessionId: 'sid-1' });
            const mapper = new TestMapper(invoker);
            let capturedResult: AIInvokerResult | undefined;
            mapper.parseSuccessOverride = (result) => {
                capturedResult = result;
                return { success: true };
            };

            await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(capturedResult?.sessionId).toBe('sid-1');
        });
    });

    describe('AI failure path', () => {
        it('calls buildAIFailureResult when result.success is false', async () => {
            const invoker = makeInvoker({ success: false, error: 'quota exceeded' });
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.buildFailureCalls).toHaveLength(1);
            expect(mapper.parseSuccessCalls).toHaveLength(0);
            expect(output).toEqual({ success: false, error: 'quota exceeded' });
        });

        it('calls buildAIFailureResult when result.success is true but response is missing', async () => {
            const invoker = makeInvoker({ success: true, response: undefined });
            const mapper = new TestMapper(invoker);

            await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.buildFailureCalls).toHaveLength(1);
            expect(mapper.parseSuccessCalls).toHaveLength(0);
        });

        it('passes the full AIInvokerResult to buildAIFailureResult', async () => {
            const invoker = makeInvoker({ success: false, error: 'err', sessionId: 'sid-2' });
            const mapper = new TestMapper(invoker);
            let capturedResult: AIInvokerResult | undefined;
            mapper.aiFailureOverride = (result) => {
                capturedResult = result;
                return { success: false };
            };

            await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(capturedResult?.sessionId).toBe('sid-2');
        });
    });

    describe('exception handling', () => {
        it('calls buildExceptionResult when aiInvoker throws', async () => {
            const invoker = vi.fn().mockRejectedValue(new Error('network error'));
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.buildExceptionCalls).toHaveLength(1);
            expect(output).toEqual({ success: false, error: 'network error' });
        });

        it('calls buildExceptionResult when buildPromptAndModel throws', async () => {
            const invoker = makeInvoker({ success: true, response: 'ok' });
            const mapper = new TestMapper(invoker);
            mapper.promptAndModelOverride = () => { throw new Error('template error'); };

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.buildExceptionCalls).toHaveLength(1);
            expect(invoker).not.toHaveBeenCalled();
            expect(output.error).toBe('template error');
        });

        it('forwards MissingVariableError-like objects to buildExceptionResult', async () => {
            const invoker = makeInvoker({ success: true, response: 'ok' });
            const mapper = new TestMapper(invoker);
            const missingVar = new MissingVariableError('myVar');
            mapper.promptAndModelOverride = () => { throw missingVar; };

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(mapper.buildExceptionCalls[0].error).toBe(missingVar);
            expect(output.error).toContain('myVar');
        });

        it('wraps non-Error thrown values via errorMessage', async () => {
            const invoker = vi.fn().mockRejectedValue('string error');
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(output.error).toBe('string error');
        });
    });

    describe('errorMessage helper', () => {
        it('returns error.message for Error instances', async () => {
            const invoker = vi.fn().mockRejectedValue(new Error('boom'));
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(output.error).toBe('boom');
        });

        it('converts non-Error to string', async () => {
            const invoker = vi.fn().mockRejectedValue(42);
            const mapper = new TestMapper(invoker);

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(output.error).toBe('42');
        });
    });

    describe('parseSuccessResponse returning a failure result', () => {
        it('allows parseSuccessResponse to return a failure result (e.g. parse error)', async () => {
            const invoker = makeInvoker({ success: true, response: 'invalid json' });
            const mapper = new TestMapper(invoker);
            mapper.parseSuccessOverride = () => ({
                success: false,
                error: 'Failed to parse AI response: unexpected token'
            });

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(output.success).toBe(false);
            expect(output.error).toContain('parse');
        });
    });

    describe('async parseSuccessResponse', () => {
        it('awaits async parseSuccessResponse', async () => {
            const invoker = makeInvoker({ success: true, response: 'data' });
            const mapper = new TestMapper(invoker);
            mapper.parseSuccessOverride = async (result) => {
                await new Promise(r => setTimeout(r, 5));
                return { success: true, value: `async:${result.response}` };
            };

            const output = await mapper.map(makeWorkItem('q'), MAP_CONTEXT);

            expect(output.value).toBe('async:data');
        });
    });
});

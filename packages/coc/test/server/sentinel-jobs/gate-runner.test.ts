import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CocToolRuntime, defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { runJobGate, JOB_GATE_DEADLINE_MS } from '../../../src/server/sentinel-jobs/job-gate-runner';

describe('runJobGate', () => {
    let runtime: CocToolRuntime;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        runtime = new CocToolRuntime([]);
    });

    afterEach(() => {
        runtime.dispose();
        vi.useRealTimers();
    });

    it('passes the previous result without allowing mutations to escape the worker', async () => {
        const state = { count: 2 };
        await expect(runJobGate({ code: 'state.count++; return state;', state, runtime }))
            .resolves.toEqual({ count: 3 });
        expect(state).toEqual({ count: 2 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('exposes null state on the first run and invokes supplied runtime tools', async () => {
        const handler = vi.fn(async (_args: unknown) => JSON.stringify({ state: 'open' }));
        runtime.dispose();
        runtime = new CocToolRuntime([defineTool('query_pull_request', { handler })]);
        await expect(runJobGate({
            code: 'return { previous: state, current: await tools.query_pull_request({ number: 42 }) };',
            state: null, runtime,
        })).resolves.toEqual({ previous: null, current: { state: 'open' } });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0]).toEqual({ number: 42 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([undefined, false])('denies nested scripts without explicit owner admission (%s)', async allowNestedScripts => {
        const handler = vi.fn(async () => 'should not run');
        runtime.dispose();
        runtime = new CocToolRuntime([
            defineTool('run_tool_script', { handler }),
            defineTool('effect', { handler }),
        ]);
        await expect(runJobGate({
            code: `return await tools.run_tool_script({ code: 'return await tools.effect({});' });`,
            state: null, runtime, allowNestedScripts,
        })).rejects.toMatchObject({ name: 'ToolCallError', message: expect.stringContaining('denied') });
        expect(handler).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('lets a script catch the nesting denial as ToolCallError', async () => {
        await expect(runJobGate({
            code: `try { await tools.run_tool_script({ code: 'return 1;' }); }
                catch (e) { return { name: e.name, code: e.code }; }`,
            state: null, runtime,
        })).resolves.toEqual({ name: 'ToolCallError', code: 'TOOL_ERROR' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('permits admitted nesting through depth three', async () => {
        const child = `return await tools.run_tool_script({ code: 'return 3;' });`;
        await expect(runJobGate({
            code: `return await tools.run_tool_script({ code: ${JSON.stringify(child)} });`,
            state: null, runtime, allowNestedScripts: true,
        })).resolves.toMatchObject({ result: { result: 3 } });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['return undefined;', 'return NaN;', 'return { value: undefined };', 'return new Date();'])
        ('rejects a non-JSON result: %s', async code => {
            await expect(runJobGate({ code, state: null, runtime })).rejects.toThrow();
            expect(vi.getTimerCount()).toBe(0);
        });

    it('propagates script errors and clears the deadline', async () => {
        await expect(runJobGate({ code: 'throw new Error("provider unavailable");', state: null, runtime }))
            .rejects.toThrow('provider unavailable');
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['await new Promise(() => {});', 'while (true) {}'])
        ('aborts a stalled worker at the fixed deadline: %s', async code => {
            let settled = false;
            const run = runJobGate({ code, state: null, runtime });
            const assertion = expect(run).rejects.toThrow('60-second deadline');
            void run.then(() => { settled = true; }, () => { settled = true; });
            await vi.advanceTimersByTimeAsync(JOB_GATE_DEADLINE_MS - 1);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await assertion;
            expect(vi.getTimerCount()).toBe(0);
        });

    it('cancels in-flight tool work when the deadline expires', async () => {
        let toolSignal: AbortSignal | undefined;
        let started!: () => void;
        const toolStarted = new Promise<void>(resolve => { started = resolve; });
        runtime.dispose();
        runtime = new CocToolRuntime([defineTool('slow', {
            handler: async (_args, invocation) => {
                toolSignal = invocation.signal;
                started();
                return new Promise<string>(resolve => invocation.signal!.addEventListener('abort', () => resolve('cancelled'), { once: true }));
            },
        })]);
        const run = runJobGate({ code: 'return await tools.slow({});', state: null, runtime });
        const assertion = expect(run).rejects.toThrow('60-second deadline');
        await toolStarted;
        expect(toolSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(JOB_GATE_DEADLINE_MS);
        await assertion;
        expect(toolSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([true, false])('preserves caller cancellation (pre-aborted=%s)', async preAborted => {
        const controller = new AbortController();
        const reason = new Error('Job edited');
        if (preAborted) controller.abort(reason);
        const run = runJobGate({ code: 'await new Promise(() => {});', state: null, runtime, signal: controller.signal });
        const assertion = expect(run).rejects.toBe(reason);
        controller.abort(reason);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });
});

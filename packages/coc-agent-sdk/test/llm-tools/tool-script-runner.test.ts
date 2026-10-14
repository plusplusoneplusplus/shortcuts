import { describe, expect, it } from 'vitest';
import { CocToolRuntime } from '../../src/llm-tools/coc-tool-runtime';
import {
    MAX_CALLS_PER_SCRIPT,
    MAX_IN_FLIGHT_PER_SCRIPT,
    runToolScript,
    toModelPayload,
    type ToolScriptRunOptions,
} from '../../src/llm-tools/tool-script-runner';
import type { Tool, ToolEvent, ToolInvocation } from '../../src/types';

function tool(name: string, handler: (args: any, inv: ToolInvocation) => unknown): Tool<any> {
    return { name, description: name, parameters: { type: 'object', properties: {} }, handler } as Tool<any>;
}

function run(code: string, tools: Tool<any>[] = [], extra: Partial<ToolScriptRunOptions> = {}) {
    return runToolScript({
        code,
        runtime: new CocToolRuntime(tools),
        scriptToolCallId: 'script-1',
        depth: 1,
        ...extra,
    });
}

const echo = tool('echo', async (args) => ({ textResultForLlm: JSON.stringify({ got: args }), resultType: 'success' }));
const text = tool('text', async () => 'plain words');
const fails = tool('fails', async () => ({ textResultForLlm: 'nope', resultType: 'failure' }));

describe('runToolScript', () => {
    it('returns the script value, logs, and call records', async () => {
        const result = await run(`
            console.log('start', { n: 1 });
            const a = await tools.echo({ x: 2 });
            const b = await tools.text({});
            console.warn('done');
            return { a, b, isArray: Array.isArray([1]) };
        `, [echo, text]);
        expect(result.ok).toBe(true);
        expect(result.result).toEqual({ a: { got: { x: 2 } }, b: 'plain words', isArray: true });
        expect(result.logs).toEqual([
            { level: 'log', text: 'start {"n":1}' },
            { level: 'warn', text: 'done' },
        ]);
        expect(result.calls).toEqual([{ name: 'echo', ok: true }, { name: 'text', ok: true }]);
        expect(result.callCount).toBe(2);
    });

    it('returns null when the script returns nothing', async () => {
        const result = await run(`await tools.text({});`, [text]);
        expect(result).toMatchObject({ ok: true, result: null, callCount: 1 });
    });

    it('turns a tool error into a catchable ToolCallError', async () => {
        const result = await run(`
            try { await tools.fails({}); } catch (e) {
                return { isTce: e instanceof ToolCallError, isError: e instanceof Error, code: e.code, tool: e.toolName, msg: e.message };
            }
        `, [fails]);
        expect(result.result).toEqual({ isTce: true, isError: true, code: 'TOOL_ERROR', tool: 'fails', msg: 'nope' });
        expect(result.calls).toEqual([{ name: 'fails', ok: false, error: 'nope' }]);
    });

    it('rejects unknown tools locally with UNKNOWN_TOOL', async () => {
        const result = await run(`try { await tools.missing({}); } catch (e) { return e.code; }`, [echo]);
        expect(result.result).toBe('UNKNOWN_TOOL');
        expect(result.callCount).toBe(0);
    });

    it('reports an uncaught script error with its name and code', async () => {
        const result = await run(`await tools.fails({});`, [fails]);
        expect(result.ok).toBe(false);
        expect(result.error).toEqual({ name: 'ToolCallError', message: 'nope', code: 'TOOL_ERROR' });
        expect(toModelPayload(result)).toMatchObject({ error: { code: 'TOOL_ERROR' }, callCount: 1 });
    });

    it('reports a syntax error', async () => {
        const result = await run(`return {`, []);
        expect(result.ok).toBe(false);
        expect(result.error?.name).toBe('SyntaxError');
    });

    it('rejects an unserializable return value', async () => {
        const cyclic = await run(`const a = {}; a.self = a; return a;`);
        expect(cyclic.error?.code).toBe('UNSERIALIZABLE_RESULT');
        const fn = await run(`return () => 1;`);
        expect(fn.error?.code).toBe('UNSERIALIZABLE_RESULT');
    });

    it('hides require, process, fetch and timers', async () => {
        const result = await run(`return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof module];`);
        expect(result.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    });

    it('stops at the per-script call cap with CALL_LIMIT', async () => {
        let handled = 0;
        const counter = tool('count', async () => { handled++; return 'ok'; });
        const result = await run(`
            for (let i = 0; i < ${MAX_CALLS_PER_SCRIPT}; i++) await tools.count({});
            try { await tools.count({}); } catch (e) { return e.code; }
        `, [counter]);
        expect(result.result).toBe('CALL_LIMIT');
        expect(handled).toBe(MAX_CALLS_PER_SCRIPT);
        expect(result.callCount).toBe(MAX_CALLS_PER_SCRIPT);
    });

    it('gives a nested script its own budget and counts it as one parent call', async () => {
        let handled = 0;
        const counter = tool('count', async () => { handled++; return 'ok'; });
        const result = await run(`
            for (let i = 0; i < ${MAX_CALLS_PER_SCRIPT - 1}; i++) await tools.count({});
            const child = await tools.run_tool_script({ code: 'for (let i = 0; i < ${MAX_CALLS_PER_SCRIPT}; i++) await tools.count({}); return "child";' });
            return child;
        `, [counter]);
        expect(result.ok).toBe(true);
        expect(result.callCount).toBe(MAX_CALLS_PER_SCRIPT);
        expect(handled).toBe(MAX_CALLS_PER_SCRIPT * 2 - 1);
        expect(result.result).toMatchObject({ result: 'child', callCount: MAX_CALLS_PER_SCRIPT });
    });

    it('allows nesting to depth 3 and rejects depth 4 with DEPTH_LIMIT', async () => {
        const depth3 = `return await tools.run_tool_script({ code: 'return 3;' });`;
        const depth2 = `return await tools.run_tool_script({ code: ${JSON.stringify(depth3)} });`;
        const ok = await run(depth2);
        expect(ok.ok).toBe(true);
        expect(ok.result).toMatchObject({ result: { result: 3 } });

        const tooDeep = await run(depth2, [], { depth: 2 });
        expect(tooDeep.ok).toBe(false);
        expect(tooDeep.error?.code).toBe('TOOL_ERROR');
        expect(tooDeep.error?.message).toContain('at most 3 levels');

        const direct = await run(`try { await tools.run_tool_script({ code: 'return 1;' }); } catch (e) { return e.code; }`, [], { depth: 3 });
        expect(direct.result).toBe('DEPTH_LIMIT');
    });

    it('never runs more than the in-flight limit at once', async () => {
        let active = 0;
        let peak = 0;
        const slow = tool('slow', async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
            return 'ok';
        });
        const result = await run(`
            const all = await Promise.all(Array.from({ length: 12 }, () => tools.slow({})));
            return all.length;
        `, [slow]);
        expect(result.result).toBe(12);
        expect(peak).toBe(MAX_IN_FLIGHT_PER_SCRIPT);
    });

    it('emits nested events with the right parent id at each depth', async () => {
        const events: ToolEvent[] = [];
        const result = await run(`
            await tools.echo({ a: 1 });
            try { await tools.fails({}); } catch {}
            await tools.run_tool_script({ code: 'return await tools.echo({ b: 2 });' });
        `, [echo, fails], { onToolEvent: e => events.push(e) });
        expect(result.ok).toBe(true);

        const top = events.filter(e => e.parentToolCallId === 'script-1');
        expect(top.map(e => `${e.type}:${e.toolName}`)).toEqual([
            'tool-start:echo', 'tool-complete:echo',
            'tool-start:fails', 'tool-failed:fails',
            'tool-start:run_tool_script',
            'tool-complete:run_tool_script',
        ]);
        expect(top[0].parameters).toEqual({ a: 1 });
        const nestedId = top[4].toolCallId;
        const nested = events.filter(e => e.parentToolCallId === nestedId);
        expect(nested.map(e => `${e.type}:${e.toolName}`)).toEqual(['tool-start:echo', 'tool-complete:echo']);
        expect(events).toHaveLength(8);
    });

    it('passes its toolCallId and an abortable signal into inner tool invocations', async () => {
        const events: ToolEvent[] = [];
        let invocation: ToolInvocation | undefined;
        const spy = tool('spy', async (_args, inv) => { invocation = inv; return 'ok'; });
        await run(`await tools.spy({});`, [spy], { onToolEvent: e => events.push(e) });
        expect(invocation?.toolCallId).toBe(events[0].toolCallId);
        // The run settled, so its inner signal is aborted.
        expect(invocation?.signal?.aborted).toBe(true);
    });

    it('aborts a busy script, its in-flight calls, and nested scripts', async () => {
        const controller = new AbortController();
        const signals: AbortSignal[] = [];
        const events: ToolEvent[] = [];
        const hang = tool('hang', (_args, inv) => {
            signals.push(inv.signal!);
            if (signals.length === 2) controller.abort();
            return new Promise(() => {});
        });
        const result = await run(`
            await Promise.all([
                tools.hang({}),
                tools.run_tool_script({ code: 'await tools.hang({});' }),
            ]);
        `, [hang], { signal: controller.signal, onToolEvent: e => events.push(e) });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('ABORTED');
        expect(signals).toHaveLength(2);
        expect(signals.every(s => s.aborted)).toBe(true);
        const failed = events.filter(e => e.type === 'tool-failed');
        expect(failed.map(e => e.toolName).sort()).toEqual(['hang', 'hang', 'run_tool_script']);
        expect(failed.every(e => e.error === 'aborted')).toBe(true);
    });

    it('ends a synchronous infinite loop on abort', async () => {
        const controller = new AbortController();
        const pending = run(`while (true) {}`, [], { signal: controller.signal });
        setTimeout(() => controller.abort(), 50);
        const result = await pending;
        expect(result.error?.code).toBe('ABORTED');
    });

    it('returns ABORTED without starting when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await run(`return 1;`, [], { signal: controller.signal });
        expect(result).toMatchObject({ ok: false, error: { code: 'ABORTED' }, callCount: 0 });
    });

    it('notes image results without passing them into the script', async () => {
        const shot = tool('shot', async () => ({
            textResultForLlm: 'see image', resultType: 'success',
            binaryResultsForLlm: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
        }));
        const result = await run(`return await tools.shot({});`, [shot]);
        expect(result.result).toBe('see image');
        expect(result.calls).toEqual([{ name: 'shot', ok: true, images: 1 }]);
    });

    it('rejects arguments that cannot be cloned', async () => {
        const result = await run(`try { await tools.echo({ f: () => 1 }); } catch (e) { return e.code; }`, [echo]);
        expect(result.result).toBe('TOOL_ERROR');
        expect(result.callCount).toBe(0);
    });
});

import { describe, expect, it, vi } from 'vitest';
import {
    CocToolRuntime,
    resolveInputSchema,
    normalizeToolResult,
    errorResult,
} from '../../src/llm-tools/coc-tool-runtime';
import type { Tool, ToolInvocation } from '../../src/types';

function tool(name: string, overrides: Partial<Tool<any>> = {}): Tool<any> {
    return {
        name,
        description: `desc for ${name}`,
        parameters: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] },
        handler: vi.fn(async () => `handled ${name}`),
        ...overrides,
    } as Tool<any>;
}

describe('CocToolRuntime', () => {
    describe('listTools', () => {
        it('exposes exactly the (already-filtered) tools it was constructed with', () => {
            const runtime = new CocToolRuntime([tool('ask_user'), tool('search_conversations')]);
            const names = runtime.listTools().map(d => d.name).sort();
            expect(names).toEqual(['ask_user', 'search_conversations']);
            expect(runtime.size).toBe(2);
            expect(runtime.hasTool('ask_user')).toBe(true);
            expect(runtime.hasTool('not_enabled')).toBe(false);
        });

        it('does not expose a tool that was filtered out upstream', () => {
            // Only the enabled tool is passed in (preference filtering happens in coc).
            const runtime = new CocToolRuntime([tool('ask_user')]);
            expect(runtime.hasTool('tavily_web_search')).toBe(false);
            expect(runtime.listTools()).toHaveLength(1);
        });

        it('carries name, description and JSON-schema inputSchema', () => {
            const runtime = new CocToolRuntime([tool('ask_user')]);
            const [descriptor] = runtime.listTools();
            expect(descriptor.name).toBe('ask_user');
            expect(descriptor.description).toBe('desc for ask_user');
            expect(descriptor.inputSchema).toMatchObject({
                type: 'object',
                properties: { foo: { type: 'string' } },
                required: ['foo'],
            });
        });

        it('returns an empty list after disposal', () => {
            const runtime = new CocToolRuntime([tool('ask_user')]);
            runtime.dispose();
            expect(runtime.listTools()).toEqual([]);
            expect(runtime.size).toBe(0);
        });
    });

    describe('callTool', () => {
        it('invokes the original handler with a synthesized invocation envelope', async () => {
            const handler = vi.fn(async () => 'ok');
            const runtime = new CocToolRuntime(
                [tool('create_work_item', { handler })],
                { sessionId: 'sess-1', workspaceId: 'ws-1', processId: 'proc-1' },
            );

            const result = await runtime.callTool('create_work_item', { title: 'x' });

            expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
            expect(handler).toHaveBeenCalledTimes(1);
            const [args, invocation] = handler.mock.calls[0] as [unknown, ToolInvocation];
            expect(args).toEqual({ title: 'x' });
            expect(invocation.sessionId).toBe('sess-1');
            expect(invocation.toolName).toBe('create_work_item');
            expect(typeof invocation.toolCallId).toBe('string');
            expect(invocation.arguments).toEqual({ title: 'x' });
        });

        it('preserves the pre-bound workspace/process context closure', async () => {
            // CoC factories bake context into the closure; the runtime must call
            // that exact closure rather than re-binding context.
            const captured: string[] = [];
            const boundWorkspace = 'ws-pre-bound';
            const factory = () => tool('add_diff_comment', {
                handler: async () => { captured.push(boundWorkspace); return 'done'; },
            });
            const runtime = new CocToolRuntime([factory()]);

            await runtime.callTool('add_diff_comment', {});
            expect(captured).toEqual(['ws-pre-bound']);
        });

        it('returns an error result for an unknown tool without throwing', async () => {
            const runtime = new CocToolRuntime([tool('ask_user')]);
            const result = await runtime.callTool('nope', {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Unknown tool: nope');
        });

        it('captures handler exceptions as an error result', async () => {
            const runtime = new CocToolRuntime([
                tool('boom', { handler: async () => { throw new Error('kaboom'); } }),
            ]);
            const result = await runtime.callTool('boom', {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('kaboom');
        });

        it('JSON-stringifies structured handler results (e.g. ask_user responses)', async () => {
            const responses = [{ questionId: 'q1', answer: 'yes', skipped: false }];
            const runtime = new CocToolRuntime([
                tool('ask_user', { handler: async () => responses }),
            ]);
            const result = await runtime.callTool('ask_user', { questions: [] });
            expect(result.isError).toBe(false);
            expect(JSON.parse(result.content[0].text)).toEqual(responses);
        });

        it('blocks until a deferred (ask_user-style) handler resolves, then returns the answer', async () => {
            // Mirror ask_user: the handler returns a Promise resolved externally.
            let resolveAnswer!: (value: unknown) => void;
            const pending = new Promise(resolve => { resolveAnswer = resolve; });
            const runtime = new CocToolRuntime([
                tool('ask_user', { handler: async () => pending }),
            ]);

            const callPromise = runtime.callTool('ask_user', { questions: [{ q: 'go?' }] });

            let settled = false;
            void callPromise.then(() => { settled = true; });
            await Promise.resolve();
            expect(settled).toBe(false); // still blocked, no answer yet

            resolveAnswer([{ questionId: 'q1', answer: true, skipped: false }]);
            const result = await callPromise;
            expect(result.isError).toBe(false);
            expect(JSON.parse(result.content[0].text)).toEqual([
                { questionId: 'q1', answer: true, skipped: false },
            ]);
        });

        it('returns an error result after disposal', async () => {
            const runtime = new CocToolRuntime([tool('ask_user')]);
            runtime.dispose();
            const result = await runtime.callTool('ask_user', {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('disposed');
        });
    });

    describe('resolveInputSchema', () => {
        it('passes through a raw JSON-schema object and normalizes to an object schema', () => {
            const schema = resolveInputSchema({ parameters: { type: 'object', properties: { a: { type: 'number' } } } });
            expect(schema).toEqual({ type: 'object', properties: { a: { type: 'number' } } });
        });

        it('forces type:object and properties for a non-object schema', () => {
            const schema = resolveInputSchema({ parameters: { description: 'no type' } as Record<string, unknown> });
            expect(schema.type).toBe('object');
            expect(schema.properties).toEqual({});
        });

        it('defaults to an empty object schema when parameters are omitted', () => {
            const schema = resolveInputSchema({ parameters: undefined });
            expect(schema).toEqual({ type: 'object', properties: {} });
        });

        it('calls toJSONSchema() for Zod-like schemas', () => {
            const zodLike = {
                _output: undefined,
                toJSONSchema: () => ({ type: 'object', properties: { z: { type: 'boolean' } } }),
            };
            const schema = resolveInputSchema({ parameters: zodLike as never });
            expect(schema).toEqual({ type: 'object', properties: { z: { type: 'boolean' } } });
        });
    });

    describe('normalizeToolResult', () => {
        it('wraps strings', () => {
            expect(normalizeToolResult('hi')).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false });
        });

        it('maps a ToolResultObject success', () => {
            expect(normalizeToolResult({ textResultForLlm: 'done', resultType: 'success' }))
                .toEqual({ content: [{ type: 'text', text: 'done' }], isError: false });
        });

        it('maps a ToolResultObject failure to isError', () => {
            const r = normalizeToolResult({ textResultForLlm: 'bad', resultType: 'failure', error: 'nope' });
            expect(r.isError).toBe(true);
            expect(r.content[0].text).toBe('bad');
        });

        it('treats null/undefined as empty success', () => {
            expect(normalizeToolResult(null)).toEqual({ content: [{ type: 'text', text: '' }], isError: false });
            expect(normalizeToolResult(undefined)).toEqual({ content: [{ type: 'text', text: '' }], isError: false });
        });

        it('builds an error result via errorResult()', () => {
            expect(errorResult('x')).toEqual({ content: [{ type: 'text', text: 'x' }], isError: true });
        });
    });
});

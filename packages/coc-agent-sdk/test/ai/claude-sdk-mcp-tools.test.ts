/**
 * Covers exposing CoC LLM tools to Claude Code through the stdio MCP bridge:
 * - query() receives a mcpServers map with the coc_llm_tools bridge entry
 * - caller-provided mcpServers are forwarded (normalized to Claude's shape)
 * - no tools / no servers → no mcpServers passed
 * - the bridge registration is torn down after the turn
 * - bridged tool-use events are de-namespaced (mcp__coc_llm_tools__X -> X)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import {
    COC_LLM_TOOLS_MCP_SERVER_NAME,
    COC_LLM_TOOLS_ENDPOINT_ENV,
    COC_LLM_TOOLS_TOKEN_ENV,
} from '../../src/llm-tools/mcp-config';
import type { Tool } from '../../src/types';
import { captureClaudeToolInventory } from '../../src/claude-tool-inventory';

const mockDynamicImport = vi.mocked(dynamicImportModule);

function makeHandle(messages: object[]) {
    return {
        [Symbol.asyncIterator]() {
            return (async function* () { for (const m of messages) yield m; })();
        },
        accountInfo: vi.fn(async () => ({})),
        return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
}

function tool(name: string): Tool<any> {
    return {
        name,
        description: `desc ${name}`,
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => 'ok'),
    } as Tool<any>;
}

const SUCCESS = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' };

describe('ClaudeSDKService MCP tool wiring', () => {
    let svc: ClaudeSDKService;
    const queryFn = vi.fn();

    beforeEach(() => {
        queryFn.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        svc = new ClaudeSDKService();
    });

    afterEach(() => {
        svc.dispose();
        cocToolBridgeServer.closeAll();
    });

    it('captures unused initialized tools once, awaiting persistence before response delivery', async () => {
        const init = {
            type: 'system', subtype: 'init', session_id: 's1',
            tools: ['Read', 'mcp__coc_llm_tools__ask_user', 'mcp__external__lookup'],
            mcp_servers: [{ name: 'coc_llm_tools', status: 'connected' }, { name: 'external', status: 'connected' }],
            env: { SECRET: 'never persist' },
        };
        queryFn.mockReturnValue(makeHandle([init, { ...init, tools: ['LaterTool'] }, SUCCESS]));
        const order: string[] = [];
        const onToolInventory = vi.fn(async (_inventory: any) => { await Promise.resolve(); order.push('inventory'); });
        const result = await svc.sendMessage({
            prompt: 'hi', tools: [tool('ask_user'), tool('not_advertised')], onToolInventory,
            onStreamingChunk: () => { order.push('response'); },
        });
        expect(result.success).toBe(true);
        expect(onToolInventory).toHaveBeenCalledTimes(1);
        const inventory = onToolInventory.mock.calls[0][0];
        expect(inventory.provider).toBe('claude');
        expect(inventory.tools).toEqual([
            { name: 'Read', source: 'builtin' },
            { name: 'ask_user', source: 'coc', description: 'desc ask_user', inputSchema: { type: 'object', properties: {} } },
            { name: 'mcp__external__lookup', source: 'mcp', serverName: 'external' },
        ]);
        expect(inventory.categories.every((category: any) => category.status === 'partial')).toBe(true);
        expect(JSON.stringify(inventory)).not.toContain('SECRET');
        expect(JSON.stringify(inventory)).not.toContain('handler');
        expect(order[0]).toBe('inventory');
    });

    it('does not infer a catalog from configured tools when startup metadata is absent', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        const onToolInventory = vi.fn();
        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user')], onToolInventory });
        expect(onToolInventory).toHaveBeenCalledTimes(1);
        expect(onToolInventory.mock.calls[0][0].tools).toEqual([]);
        expect(onToolInventory.mock.calls[0][0].categories.every((c: any) => c.status === 'unavailable')).toBe(true);
    });

    it('captures independent catalogs on resumed turns', async () => {
        const init = (name: string) => ({ type: 'system', subtype: 'init', tools: [name], mcp_servers: [] });
        queryFn.mockReturnValueOnce(makeHandle([init('Read'), SUCCESS]))
            .mockReturnValueOnce(makeHandle([init('Grep'), SUCCESS]));
        const onToolInventory = vi.fn();
        await svc.sendMessage({ prompt: 'first', onToolInventory });
        await svc.sendMessage({ prompt: 'next', sessionId: 's1', onToolInventory });
        expect(onToolInventory.mock.calls.map(call => call[0].tools.map((t: any) => t.name))).toEqual([['Read'], ['Grep']]);
    });

    it('stops response delivery when aborted during inventory persistence', async () => {
        queryFn.mockReturnValue(makeHandle([
            { type: 'system', subtype: 'init', tools: ['Read'], mcp_servers: [] }, SUCCESS,
        ]));
        const controller = new AbortController();
        const onStreamingChunk = vi.fn();
        await svc.sendMessage({
            prompt: 'hi', signal: controller.signal, onStreamingChunk,
            onToolInventory: async () => { controller.abort(); },
        });
        // The existing completion callback may signal end-of-stream, but no result content is delivered.
        expect(onStreamingChunk.mock.calls.flat().every(chunk => chunk === '')).toBe(true);
    });

    it('propagates persistence failure and releases the bridge', async () => {
        queryFn.mockReturnValue(makeHandle([
            { type: 'system', subtype: 'init', tools: [], mcp_servers: [] }, SUCCESS,
        ]));
        const result = await svc.sendMessage({
            prompt: 'hi', tools: [tool('ask_user')],
            onToolInventory: async () => { throw new Error('inventory write failed'); },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('inventory write failed');
        expect((svc as any).sessions.size).toBe(0);
        expect(cocToolBridgeServer.activeCount).toBe(0);
    });

    it('passes a mcpServers map with the coc bridge entry when tools are present', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));

        const result = await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user'), tool('create_update_work_item')] });
        expect(result.success).toBe(true);

        const callOptions = queryFn.mock.calls[0][0] as { options?: { mcpServers?: Record<string, any> } };
        const servers = callOptions.options?.mcpServers;
        expect(servers).toBeDefined();
        const entry = servers![COC_LLM_TOOLS_MCP_SERVER_NAME];
        expect(entry.type).toBe('stdio');
        expect(entry.command).toBe(process.execPath);
        expect(Array.isArray(entry.args)).toBe(true);
        expect(entry.alwaysLoad).toBe(true);
        expect(entry.env[COC_LLM_TOOLS_ENDPOINT_ENV]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(typeof entry.env[COC_LLM_TOOLS_TOKEN_ENV]).toBe('string');
        expect(entry.env[COC_LLM_TOOLS_TOKEN_ENV].length).toBeGreaterThan(0);
    });

    it('pre-approves the bridged CoC tools via allowedTools (no permission prompt)', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user'), tool('search_conversations')] });

        const opts = (queryFn.mock.calls[0][0] as any).options;
        expect(opts.allowedTools).toEqual(
            expect.arrayContaining([
                `mcp__${COC_LLM_TOOLS_MCP_SERVER_NAME}__ask_user`,
                `mcp__${COC_LLM_TOOLS_MCP_SERVER_NAME}__search_conversations`,
            ]),
        );
        // Names match the namespaced form Claude Code blocks by default.
        expect(opts.allowedTools).toContain('mcp__coc_llm_tools__ask_user');
    });

    it('sets only ask-mode auto-approved tools when there are no CoC tools', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi' });
        const opts = (queryFn.mock.calls[0][0] as any).options;
        expect(opts.allowedTools).toEqual(['Bash', 'WebFetch', 'WebSearch']);
    });

    // Regression: the native built-in `AskUserQuestion` shares no name with CoC's
    // `ask_user`, so `overridesBuiltInTool` cannot suppress it. CoC services
    // `ask_user` but not the built-in, so when the model called the built-in the
    // SDK auto-failed the call before the user could answer. We block the built-in
    // whenever `ask_user` is present so the model is steered to the serviceable tool.
    it('disallows the native AskUserQuestion built-in when ask_user is present', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user'), tool('search_conversations')] });

        const opts = (queryFn.mock.calls[0][0] as any).options;
        expect(opts.disallowedTools).toEqual(['AskUserQuestion']);
        // The replacement stays auto-approved.
        expect(opts.allowedTools).toContain('mcp__coc_llm_tools__ask_user');
    });

    it('does not disallow AskUserQuestion when ask_user is not registered', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi', tools: [tool('search_conversations')] });
        const opts = (queryFn.mock.calls[0][0] as any).options;
        expect(opts.disallowedTools).toBeUndefined();
    });

    it('does not set disallowedTools when there are no CoC tools', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi' });
        const opts = (queryFn.mock.calls[0][0] as any).options;
        expect(opts.disallowedTools).toBeUndefined();
    });

    it('tears down the bridge registration after the turn', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        expect(cocToolBridgeServer.activeCount).toBe(0);
        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user')] });
        expect(cocToolBridgeServer.activeCount).toBe(0);
        expect(cocToolBridgeServer.endpoint).toBeNull();
    });

    it('does not pass mcpServers when there are no tools and no caller servers', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({ prompt: 'hi' });
        const callOptions = queryFn.mock.calls[0][0] as { options?: { mcpServers?: unknown } };
        expect(callOptions.options?.mcpServers).toBeUndefined();
    });

    it('forwards caller-provided mcpServers, normalized to Claude shape', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({
            prompt: 'hi',
            mcpServers: {
                myhttp: { type: 'http', url: 'https://example.com/mcp', headers: { 'x-key': '1' } },
                mylocal: { command: 'node', args: ['server.js'], env: { A: 'b' } },
            },
        });
        const servers = (queryFn.mock.calls[0][0] as any).options.mcpServers;
        expect(servers.myhttp).toEqual({ type: 'http', url: 'https://example.com/mcp', headers: { 'x-key': '1' } });
        expect(servers.mylocal).toEqual({ type: 'stdio', command: 'node', args: ['server.js'], env: { A: 'b' } });
        // No coc entry since no tools were passed.
        expect(servers[COC_LLM_TOOLS_MCP_SERVER_NAME]).toBeUndefined();
    });

    it('combines caller servers with the coc bridge entry when both are present', async () => {
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        await svc.sendMessage({
            prompt: 'hi',
            tools: [tool('ask_user')],
            mcpServers: { myhttp: { type: 'sse', url: 'https://example.com/sse' } },
        });
        const servers = (queryFn.mock.calls[0][0] as any).options.mcpServers;
        expect(servers.myhttp).toEqual({ type: 'sse', url: 'https://example.com/sse' });
        expect(servers[COC_LLM_TOOLS_MCP_SERVER_NAME].type).toBe('stdio');
    });

    it('de-namespaces bridged tool-use events to bare CoC tool names', async () => {
        const onToolEvent = vi.fn();
        queryFn.mockReturnValue(makeHandle([
            {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 't1', name: `mcp__${COC_LLM_TOOLS_MCP_SERVER_NAME}__ask_user`, input: { questions: [] } },
                        { type: 'tool_use', id: 't2', name: 'mcp__other_server__some_tool', input: {} },
                    ],
                },
                session_id: 's1',
            },
            SUCCESS,
        ]));

        await svc.sendMessage({ prompt: 'x', tools: [tool('ask_user')], onToolEvent });

        const startEvents = onToolEvent.mock.calls.map(c => c[0]).filter((e: any) => e.type === 'tool-start');
        const cocEvent = startEvents.find((e: any) => e.toolCallId === 't1');
        const otherEvent = startEvents.find((e: any) => e.toolCallId === 't2');
        expect(cocEvent.toolName).toBe('ask_user'); // stripped
        expect(otherEvent.toolName).toBe('mcp__other_server__some_tool'); // untouched
    });
});

describe('Claude startup inventory classification', () => {
    it('marks malformed metadata unavailable and never falls back to bridge descriptors', () => {
        const result = captureClaudeToolInventory({ tools: null }, [{ name: 'ask_user', description: 'desc', inputSchema: {} }]);
        expect(result.tools).toEqual([]);
        expect(result.categories.every(c => c.status === 'unavailable')).toBe(true);
    });

    it('matches actual MCP server labels, including underscores, without treating unknown MCP names as built-ins', () => {
        const result = captureClaudeToolInventory({
            tools: ['mcp__a__b__lookup', 'mcp__unknown__read', null, 'Read', 'Read'],
            mcp_servers: [{ name: 'a', status: 'connected' }, { name: 'a__b', status: 'connected' }],
        }, []);
        expect(result.tools).toEqual([
            { name: 'mcp__a__b__lookup', source: 'mcp', serverName: 'a__b' }, { name: 'Read', source: 'builtin' },
        ]);
        expect(result.categories.every(c => c.status === 'partial')).toBe(true);
    });

    it('does not classify an external reserved-name server as CoC without the active bridge', () => {
        const result = captureClaudeToolInventory({
            tools: ['mcp__coc_llm_tools__lookup'], mcp_servers: [{ name: 'coc_llm_tools', status: 'connected' }],
        }, []);
        expect(result.tools[0]).toEqual({ name: 'mcp__coc_llm_tools__lookup', source: 'mcp', serverName: 'coc_llm_tools' });
    });

    it('reports all confirmed CoC descriptors complete but missing native metadata partial', () => {
        const result = captureClaudeToolInventory({
            tools: ['mcp__coc_llm_tools__ask_user'], mcp_servers: [{ name: 'coc_llm_tools', status: 'connected' }],
        }, [{ name: 'ask_user', description: 'desc', inputSchema: {} }]);
        expect(result.categories.find(c => c.source === 'coc')?.status).toBe('complete');
        expect(result.categories.find(c => c.source === 'mcp')?.status).toBe('partial');
    });
});

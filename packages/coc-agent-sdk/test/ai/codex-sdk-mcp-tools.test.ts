import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import {
    COC_LLM_TOOLS_MCP_SERVER_NAME,
    COC_LLM_TOOLS_ENDPOINT_ENV,
    COC_LLM_TOOLS_TOKEN_ENV,
} from '../../src/llm-tools/mcp-config';
import type { Tool } from '../../src/types';

function makeThread(threadId = 'thread-1', itemEvents: Array<{ type: 'item.started' | 'item.completed'; item: Record<string, unknown> }> = []) {
    return {
        id: threadId,
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: threadId };
                for (const event of itemEvents) {
                    yield event;
                }
                yield { type: 'item.completed' as const, item: { id: 'i1', type: 'agent_message', text: 'ok' } };
            })(),
        })),
    };
}

/** A Codex client constructor mock that records the options it was built with. */
function makeCodexCtor() {
    const instances: Array<{ options: unknown; client: { startThread: ReturnType<typeof vi.fn>; resumeThread: ReturnType<typeof vi.fn> } }> = [];
    const ctor = vi.fn(function (this: unknown, options?: unknown) {
        const client = {
            startThread: vi.fn(() => makeThread()),
            resumeThread: vi.fn(() => makeThread()),
        };
        instances.push({ options, client });
        return client;
    }) as unknown as new (options?: unknown) => unknown;
    return { ctor, instances };
}

function tool(name: string): Tool<any> {
    return {
        name,
        description: `desc ${name}`,
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => 'ok'),
    } as Tool<any>;
}

describe('CodexSDKService MCP tool wiring', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
    });

    it('builds a per-request Codex client with generated mcp_servers config when tools are present', async () => {
        svc = new CodexSDKService();
        const { ctor, instances } = makeCodexCtor();
        // Default (no-MCP) client used when no tools.
        const defaultClient = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        (svc as unknown as { sdk: unknown }).sdk = defaultClient;
        (svc as unknown as { codexCtor: unknown }).codexCtor = ctor;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        const result = await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user'), tool('create_update_work_item')] });
        expect(result.success).toBe(true);

        // A fresh client was constructed for this request (not the default one).
        expect(ctor).toHaveBeenCalledTimes(1);
        expect(instances).toHaveLength(1);
        const built = instances[0].options as { config?: { mcp_servers?: Record<string, any> } };
        const servers = built.config?.mcp_servers;
        expect(servers).toBeDefined();
        const entry = servers![COC_LLM_TOOLS_MCP_SERVER_NAME];
        expect(entry).toBeDefined();
        expect(entry.command).toBe(process.execPath);
        expect(Array.isArray(entry.args)).toBe(true);
        expect(entry.enabled_tools).toEqual(['ask_user', 'create_update_work_item']);
        // Blocking tools (e.g. ask_user) must not be aborted by Codex's default MCP
        // tool timeout: the server entry pins an effectively-unbounded tool_timeout_sec.
        expect(entry.tool_timeout_sec).toBe(31_536_000);
        expect(entry.env[COC_LLM_TOOLS_ENDPOINT_ENV]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(typeof entry.env[COC_LLM_TOOLS_TOKEN_ENV]).toBe('string');
        expect(entry.env[COC_LLM_TOOLS_TOKEN_ENV].length).toBeGreaterThan(0);

        // The per-request client (not the default) ran the thread.
        expect(instances[0].client.startThread).toHaveBeenCalledTimes(1);
        expect(defaultClient.startThread).not.toHaveBeenCalled();
    });

    it('deduplicates the Codex MCP enabled_tools allow-list', async () => {
        svc = new CodexSDKService();
        const { ctor, instances } = makeCodexCtor();
        (svc as unknown as { sdk: unknown }).sdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        (svc as unknown as { codexCtor: unknown }).codexCtor = ctor;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user'), tool('ask_user'), tool('search_conversations')] });

        const built = instances[0].options as { config?: { mcp_servers?: Record<string, any> } };
        const entry = built.config?.mcp_servers?.[COC_LLM_TOOLS_MCP_SERVER_NAME];
        expect(entry.enabled_tools).toEqual(['ask_user', 'search_conversations']);
    });

    it('tears down the bridge registration after the turn completes', async () => {
        svc = new CodexSDKService();
        const { ctor } = makeCodexCtor();
        (svc as unknown as { sdk: unknown }).sdk = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        (svc as unknown as { codexCtor: unknown }).codexCtor = ctor;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        expect(cocToolBridgeServer.activeCount).toBe(0);
        await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user')] });
        // Registration is disposed in finally → server torn down.
        expect(cocToolBridgeServer.activeCount).toBe(0);
        expect(cocToolBridgeServer.endpoint).toBeNull();
    });

    it('reuses the shared client and skips MCP wiring when no tools are passed', async () => {
        svc = new CodexSDKService();
        const { ctor } = makeCodexCtor();
        const defaultClient = { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn() };
        (svc as unknown as { sdk: unknown }).sdk = defaultClient;
        (svc as unknown as { codexCtor: unknown }).codexCtor = ctor;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        await svc.sendMessage({ prompt: 'hi' });
        expect(ctor).not.toHaveBeenCalled();
        expect(defaultClient.startThread).toHaveBeenCalledTimes(1);
        expect(cocToolBridgeServer.activeCount).toBe(0);
    });

    it('stores first-party CoC MCP tool arguments directly on captured tool calls', async () => {
        svc = new CodexSDKService();
        const questionArgs = {
            questions: [
                {
                    question: 'Which provider should handle this?',
                    type: 'select',
                    options: [{ value: 'auto', label: 'Auto' }],
                },
            ],
        };
        const toolItem = {
            id: 'ask-1',
            type: 'mcp_tool_call',
            server: COC_LLM_TOOLS_MCP_SERVER_NAME,
            tool: 'ask_user',
            arguments: questionArgs,
            result: { content: [{ type: 'text', text: JSON.stringify([{ questionId: 'q1', answer: 'auto', skipped: false }]) }] },
        };
        const defaultClient = {
            startThread: vi.fn(() => makeThread('thread-ask', [
                { type: 'item.started', item: toolItem },
                { type: 'item.completed', item: toolItem },
            ])),
            resumeThread: vi.fn(),
        };
        (svc as unknown as { sdk: unknown }).sdk = defaultClient;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        const result = await svc.sendMessage({ prompt: 'hi' });

        expect(result.success).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'ask-1',
            name: 'ask_user',
            status: 'completed',
            args: questionArgs,
        });
        expect(result.toolCalls?.[0].args).not.toHaveProperty('arguments');
        expect(result.toolCalls?.[0].args).not.toHaveProperty('server');
    });

    it('keeps external MCP tool arguments nested with server metadata', async () => {
        svc = new CodexSDKService();
        const toolArguments = { query: 'open issues' };
        const toolItem = {
            id: 'external-1',
            type: 'mcp_tool_call',
            server: 'external_search',
            tool: 'search',
            arguments: toolArguments,
            result: { content: [{ type: 'text', text: 'done' }] },
        };
        const defaultClient = {
            startThread: vi.fn(() => makeThread('thread-external', [
                { type: 'item.started', item: toolItem },
                { type: 'item.completed', item: toolItem },
            ])),
            resumeThread: vi.fn(),
        };
        (svc as unknown as { sdk: unknown }).sdk = defaultClient;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        const result = await svc.sendMessage({ prompt: 'hi' });

        expect(result.success).toBe(true);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'external-1',
            name: 'search',
            status: 'completed',
            args: {
                server: 'external_search',
                arguments: toolArguments,
            },
        });
    });
});

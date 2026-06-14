import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';

type CodexItemTestEvent = {
    type: 'item.started' | 'item.updated' | 'item.completed';
    item: Record<string, unknown>;
};

function makeThread(threadId = 'thread-1', itemEvents: CodexItemTestEvent[] = []) {
    return {
        id: threadId,
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: threadId };
                for (const event of itemEvents) {
                    yield event;
                }
                yield { type: 'item.completed' as const, item: { id: 'msg-1', type: 'agent_message', text: 'ok' } };
            })(),
        })),
    };
}

async function sendWithEvents(itemEvents: CodexItemTestEvent[], onToolEvent?: (event: any) => void) {
    const svc = new CodexSDKService();
    const client = {
        startThread: vi.fn(() => makeThread('thread-collab', itemEvents)),
        resumeThread: vi.fn(),
    };
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        return await svc.sendMessage({ prompt: 'run sub agents', onToolEvent });
    } finally {
        svc.dispose();
    }
}

describe('CodexSDKService collaboration tool capture', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('maps Codex collabAgentToolCall spawnAgent and wait into task/read_agent calls', async () => {
        const toolEvents: any[] = [];
        const result = await sendWithEvents([
            {
                type: 'item.started',
                item: {
                    id: 'collab-spawn-1',
                    type: 'collabAgentToolCall',
                    tool: 'spawnAgent',
                    status: 'inProgress',
                    senderThreadId: 'parent-thread',
                    receiverThreadIds: ['agent-0'],
                    prompt: 'Report the current time',
                    model: 'gpt-5.4-codex',
                    reasoningEffort: 'medium',
                    agentsStates: { 'agent-0': { status: 'pendingInit', message: null } },
                },
            },
            {
                type: 'item.completed',
                item: {
                    id: 'collab-spawn-1',
                    type: 'collabAgentToolCall',
                    tool: 'spawnAgent',
                    status: 'completed',
                    senderThreadId: 'parent-thread',
                    receiverThreadIds: ['agent-0'],
                    prompt: 'Report the current time',
                    model: 'gpt-5.4-codex',
                    reasoningEffort: 'medium',
                    agentsStates: { 'agent-0': { status: 'running', message: 'Checking clock' } },
                },
            },
            {
                type: 'item.started',
                item: {
                    id: 'collab-wait-1',
                    type: 'collabAgentToolCall',
                    tool: 'wait',
                    status: 'inProgress',
                    senderThreadId: 'parent-thread',
                    receiverThreadIds: ['agent-0'],
                    agentsStates: { 'agent-0': { status: 'running', message: 'Checking clock' } },
                },
            },
            {
                type: 'item.updated',
                item: {
                    id: 'collab-wait-1',
                    type: 'collabAgentToolCall',
                    tool: 'wait',
                    status: 'completed',
                    senderThreadId: 'parent-thread',
                    receiverThreadIds: ['agent-0'],
                    agentsStates: { 'agent-0': { status: 'completed', message: 'It is 23:15 UTC' } },
                },
            },
        ], event => toolEvents.push(event));

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(result.response).toBe('ok');
        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'collab-spawn-1',
            name: 'task',
            status: 'completed',
            args: {
                agent_type: 'codex',
                agent_id: 'agent-0',
                agent_ids: ['agent-0'],
                description: 'Report the current time',
                prompt: 'Report the current time',
                sender_thread_id: 'parent-thread',
                model: 'gpt-5.4-codex',
                reasoning_effort: 'medium',
                agent_status: 'running',
                agent_message: 'Checking clock',
            },
            result: 'agent-0 running: Checking clock',
        });
        expect(result.toolCalls?.[1]).toMatchObject({
            id: 'collab-wait-1',
            name: 'read_agent',
            status: 'completed',
            args: {
                agent_id: 'agent-0',
                agent_ids: ['agent-0'],
                sender_thread_id: 'parent-thread',
                wait: true,
                agent_status: 'completed',
                agent_message: 'It is 23:15 UTC',
            },
            result: 'agent-0 completed: It is 23:15 UTC',
        });
        expect(toolEvents.map(event => `${event.type}:${event.toolName}`)).toEqual([
            'tool-start:task',
            'tool-complete:task',
            'tool-start:read_agent',
            'tool-complete:read_agent',
        ]);
    });

    it('maps dynamic spawn_agent and wait_agent host tools into task/read_agent calls', async () => {
        const result = await sendWithEvents([
            {
                type: 'item.completed',
                item: {
                    id: 'dynamic-spawn-1',
                    type: 'dynamicToolCall',
                    tool: 'spawn_agent',
                    status: 'completed',
                    arguments: {
                        agentId: 'agent-d',
                        prompt: 'Summarize the file',
                        description: 'Summarize the file',
                    },
                    contentItems: [{ type: 'inputText', text: 'Agent started with agent_id: agent-d' }],
                    success: true,
                },
            },
            {
                type: 'item.completed',
                item: {
                    id: 'dynamic-wait-1',
                    type: 'dynamicToolCall',
                    tool: 'wait_agent',
                    status: 'completed',
                    arguments: {
                        agentId: 'agent-d',
                        timeout: 30,
                    },
                    contentItems: [{ type: 'inputText', text: 'agent-d completed: done' }],
                    success: true,
                },
            },
        ]);

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'dynamic-spawn-1',
            name: 'task',
            status: 'completed',
            args: {
                agent_type: 'codex',
                agentId: 'agent-d',
                agent_id: 'agent-d',
                prompt: 'Summarize the file',
                description: 'Summarize the file',
            },
            result: 'Agent started with agent_id: agent-d',
        });
        expect(result.toolCalls?.[1]).toMatchObject({
            id: 'dynamic-wait-1',
            name: 'read_agent',
            status: 'completed',
            args: {
                agentId: 'agent-d',
                agent_id: 'agent-d',
                timeout: 30,
                wait: true,
            },
            result: 'agent-d completed: done',
        });
    });

    it('keeps non-agent dynamic tool calls visible with namespace metadata and failures', async () => {
        const result = await sendWithEvents([
            {
                type: 'item.completed',
                item: {
                    id: 'dynamic-generic-1',
                    type: 'dynamicToolCall',
                    namespace: 'host',
                    tool: 'lookup',
                    status: 'failed',
                    arguments: { query: 'open issues' },
                    contentItems: [{ type: 'inputText', text: 'lookup failed' }],
                    success: false,
                },
            },
        ]);

        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls?.[0]).toMatchObject({
            id: 'dynamic-generic-1',
            name: 'lookup',
            status: 'failed',
            args: {
                namespace: 'host',
                arguments: { query: 'open issues' },
            },
            error: 'lookup failed',
        });
    });
});

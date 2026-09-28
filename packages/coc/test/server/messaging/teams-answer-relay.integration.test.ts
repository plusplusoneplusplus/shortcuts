import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, RepoQueueRegistry, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { McpTransport } from '@plusplusoneplusplus/coc-connector/teams';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';

const teamId = 'test-team';
const channelId = 'test-channel';
const endpoint = 'http://127.0.0.1/teams-mcp';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for queue or relay');
}

describe('Teams answer relay through the real multi-repo queues', () => {
    let dataDir: string;
    let queue: MultiRepoQueueRouter;
    let manager: TeamsMessagingManager;

    afterEach(() => {
        manager?.dispose();
        queue?.dispose();
        vi.unstubAllGlobals();
        if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('ACKs before AI finishes and correlates queued, running, explicit, and selected-topic follow-ups across workspaces', { timeout: 20_000 }, async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-answer-relay-integration-'));
        const store = new FileProcessStore({ dataDir });
        for (const [id, name] of [['ws-a', 'Alpha'], ['ws-b', 'Beta']]) {
            await store.registerWorkspace({ id, name, rootPath: path.join(dataDir, id) });
        }

        const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
            // Every MCP call is intercepted here. A leaked external request fails the test.
            if (String(url) !== endpoint) throw new Error(`Unexpected external URL: ${String(url)}`);
            const body = JSON.parse(String(init?.body)) as {
                id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> };
            };
            let result: unknown = {};
            if (body.method === 'initialize') result = { protocolVersion: '2025-03-26' };
            else if (body.method === 'tools/list') result = { tools: [
                { name: 'ReplyToChannelMessage' }, { name: 'ListChannelMessageReplies' },
            ] };
            else if (body.method === 'tools/call' && body.params?.name === 'ReplyToChannelMessage') {
                calls.push({ name: body.params.name, arguments: body.params.arguments });
                result = { content: [{ text: JSON.stringify({ id: `sent-${calls.length}` }) }] };
            } else if (body.method === 'tools/call' && body.params?.name === 'ListChannelMessages') {
                result = { content: [{ text: JSON.stringify([
                    { id: 'root-b', body: { content: 'beta prompt' } },
                ]) }] };
            } else if (body.method === 'tools/call' && body.params?.name === 'ListChannelMessageReplies') {
                if (body.params.arguments.messageId !== 'root-b') throw new Error('Unexpected thread root');
                result = { content: [{ text: JSON.stringify([
                    { id: 'thread-follow', body: { content: 'thread follow-up' },
                        from: { user: { id: 'synthetic-user' } } },
                ]) }] };
            } else if (body.method !== 'notifications/initialized') {
                throw new Error(`Unexpected MCP method: ${body.method}`);
            }
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
                headers: { 'content-type': 'application/json' },
            });
        }));
        const transport = new McpTransport(endpoint, () => true);
        await transport.initialize('synthetic-token', { teamId, channelId });

        const ai = createMockSDKService();
        const gates = new Map<string, ReturnType<typeof deferred<void>>>();
        const entered: string[] = [];
        ai.mockSendMessage.mockImplementation(async (options: { prompt: string }) => {
            const prompt = options.prompt.trimEnd().split('\n').at(-1)!;
            entered.push(prompt);
            const gate = deferred<void>();
            gates.set(prompt, gate);
            await gate.promise;
            return { success: true, response: `Answer for ${prompt}`, sessionId: 'synthetic-session' };
        });
        const registry = new RepoQueueRegistry();
        queue = new MultiRepoQueueRouter(registry, store, {
            aiService: ai.service, dataDir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        for (const ws of await store.getWorkspaces()) {
            queue.registerRepoId(ws.id, ws.rootPath!);
        }
        manager = new TeamsMessagingManager(dataDir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId, channelId,
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'sendMessage').mockImplementation(
            (text, rootId) => transport.send(channelId, text, { replyToId: rootId }));
        let handle!: (msg: InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => {
            handle = msg => handler(msg, () => {});
        });
        registerTeamsMessagingRoutes([], {
            dataDir, store,
            enqueueChat: async () => { throw new Error('Expected relay admission'); },
            executeFollowUp: async () => { throw new Error('Expected correlated follow-up admission'); },
            manager,
            relayQueue: queue.createAggregateQueueFacade(),
            getAnswerRelayEnabled: () => true,
            enqueueRelayChat: (wsId, prompt, id) => queue.enqueue({
                id, processId: toQueueProcessId(id), type: 'chat', repoId: wsId,
                payload: { kind: 'chat', mode: 'ask', prompt, workspaceId: wsId },
                config: {}, priority: 'normal',
            }),
            admitRelayFollowUp: async (process, text, requestId) => {
                return { taskId: await queue.enqueue({
                    type: 'chat', repoId: process.metadata.workspaceId as string,
                    processId: process.id, priority: 'normal',
                    payload: { kind: 'chat', mode: 'ask', processId: process.id,
                        prompt: text, workspaceId: process.metadata.workspaceId, relayRequestId: requestId },
                    config: {},
                }) };
            },
            enqueuePendingRelayFollowUp: (wsId, processId, text, requestId) => queue.enqueue({
                    type: 'chat', repoId: wsId, processId, priority: 'normal',
                    payload: { kind: 'chat', mode: 'ask', processId, prompt: text,
                        workspaceId: wsId, relayRequestId: requestId },
                    config: {},
                }),
        });
        const inbound = (messageId: string, text: string, replyToMessageId?: string): InboundTeamsMessage =>
            ({ messageId, channelId, text, senderAadId: 'synthetic-user', ...(replyToMessageId ? { replyToMessageId } : {}) });
        const repliesFor = (root: string) => calls.filter(call => call.arguments.messageId === root)
            .map(call => String(call.arguments.content));

        await handle(inbound('choose-a', '/select repo Alpha'));
        await handle(inbound('root-a', 'alpha prompt'));
        const taskA = registry.getQueueForRepo(path.join(dataDir, 'ws-a')).getAll()[0];
        expect(taskA.repoId).toBe('ws-a');
        expect(repliesFor('root-a')).toEqual([expect.stringContaining('New topic created')]);
        expect(repliesFor('root-a')[0]).toContain('New topic created');

        await handle(inbound('choose-b', '/select repo Beta'));
        await handle(inbound('new-b', '/create topic'));
        await handle(inbound('root-b', 'beta prompt'));
        const taskB = registry.getQueueForRepo(path.join(dataDir, 'ws-b')).getAll()[0];
        expect(taskB.repoId).toBe('ws-b');
        expect(repliesFor('root-b')).toHaveLength(1);
        await handle(inbound('queued-follow', 'queued follow-up'));
        expect(repliesFor('queued-follow')).toEqual([expect.stringContaining('Message sent')]);

        queue.activateQueueProcessing();
        await until(() => entered.includes('alpha prompt') && entered.includes('beta prompt'));
        await handle(inbound('running-follow', 'running follow-up'));
        expect(repliesFor('running-follow')).toEqual([expect.stringContaining('Message sent')]);
        expect(repliesFor('root-a')).toHaveLength(1);
        expect(repliesFor('root-b')).toHaveLength(1);
        gates.get('beta prompt')!.resolve();
        gates.get('alpha prompt')!.resolve();
        await until(() => repliesFor('root-a').length === 2 && repliesFor('root-b').length === 2);
        expect(repliesFor('root-a')[1]).toContain('Answer for alpha prompt');
        expect(repliesFor('root-b')[1]).toContain('Answer for beta prompt');
        expect((await store.getProcess(toQueueProcessId(taskA.id)))?.metadata?.workspaceId).toBe('ws-a');
        expect((await store.getProcess(toQueueProcessId(taskB.id)))?.metadata?.workspaceId).toBe('ws-b');
        await until(() => entered.includes('queued follow-up'));
        gates.get('queued follow-up')!.resolve();
        await until(() => repliesFor('queued-follow').length === 2);
        await until(() => entered.includes('running follow-up'));
        gates.get('running follow-up')!.resolve();
        await until(() => repliesFor('running-follow').length === 2);
        expect(repliesFor('queued-follow')[1]).toContain('Answer for queued follow-up');
        expect(repliesFor('running-follow')[1]).toContain('Answer for running follow-up');

        // An explicit chat ID and then the selected last-active topic address the same conversation.
        await handle(inbound('follow-b-1', `[${toQueueProcessId(taskB.id)}] first follow-up`));
        await handle(inbound('follow-b-2', 'second follow-up'));
        await until(() => entered.includes('first follow-up'));
        expect(repliesFor('follow-b-1')).toEqual([expect.stringContaining('Message sent')]);
        expect(repliesFor('follow-b-2')).toEqual([expect.stringContaining('Message sent')]);
        gates.get('first follow-up')!.resolve();
        await until(() => entered.includes('second follow-up'));
        expect(repliesFor('follow-b-2')).toHaveLength(1);
        gates.get('second follow-up')!.resolve();
        await until(() => repliesFor('follow-b-1').length === 2 && repliesFor('follow-b-2').length === 2);
        expect(repliesFor('follow-b-1')[1]).toContain('Answer for first follow-up');
        expect(repliesFor('follow-b-2')[1]).toContain('Answer for second follow-up');
        await handle(inbound('select-topic-b', `/select topic ${toQueueProcessId(taskB.id)}`));
        await handle(inbound('selected-follow', 'selected follow-up'));
        expect(repliesFor('selected-follow')).toEqual([expect.stringContaining('Message sent')]);
        await until(() => entered.includes('selected follow-up'));
        gates.get('selected follow-up')!.resolve();
        await until(() => repliesFor('selected-follow').length === 2);
        expect(repliesFor('selected-follow')[1]).toContain('Answer for selected follow-up');
        expect(repliesFor('root-b')).toHaveLength(2);
        expect(repliesFor('root-a')).toHaveLength(2);
        const turns = (await store.getProcess(toQueueProcessId(taskB.id)))?.conversationTurns ?? [];
        const userTurns = turns.filter(turn => turn.role === 'user');
        expect(userTurns).toHaveLength(6);
        expect(userTurns[0].content).toMatch(/beta prompt$/);
        expect(userTurns.slice(1).map(turn => turn.content)).toEqual([
            'queued follow-up', 'running follow-up', 'first follow-up', 'second follow-up', 'selected follow-up',
        ]);
        expect(userTurns[1].relayRequestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(userTurns[2].relayRequestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(userTurns[1].relayRequestId).not.toBe(userTurns[2].relayRequestId);
        expect(turns.filter(turn => turn.role === 'assistant').map(turn => turn.content))
            .toEqual([
                'Answer for beta prompt', 'Answer for queued follow-up',
                'Answer for running follow-up', 'Answer for first follow-up',
                'Answer for second follow-up', 'Answer for selected follow-up',
            ]);
        const polled = await transport.poll(channelId);
        expect(polled.messages).toEqual([
            expect.objectContaining({ messageId: 'root-b', replyToMessageId: undefined }),
            expect.objectContaining({ messageId: 'thread-follow', replyToMessageId: 'root-b',
                senderAadId: 'synthetic-user' }),
        ]);
        await handle(polled.messages[1]);
        expect(repliesFor('root-b')).toHaveLength(3);
        expect(repliesFor('root-b')[2]).toContain('Message sent');
        await until(() => entered.includes('thread follow-up'));
        gates.get('thread follow-up')!.resolve();
        await until(() => repliesFor('root-b').length === 4);
        expect(repliesFor('root-b')[3]).toContain('Answer for thread follow-up');
        expect(repliesFor('thread-follow')).toHaveLength(0);
        expect((await store.getProcess(toQueueProcessId(taskB.id)))?.conversationTurns
            ?.filter(turn => turn.role === 'user').at(-1)?.relayRequestId).toMatch(/^[a-f0-9-]{36}$/);

        // The sender still has Beta selected; threaded replies must follow their root, not that selection.
        await handle(inbound('thread-a-1', '/select topic ignored', 'root-a'));
        await handle(inbound('thread-b-1', 'beta threaded reply', 'root-b'));
        await handle(inbound('thread-a-2', 'alpha again', 'root-a'));
        expect(repliesFor('root-a').at(-2)).toContain('Message sent');
        expect(repliesFor('root-b').at(-1)).toContain('Message sent');
        await until(() => entered.includes('/select topic ignored') && entered.includes('beta threaded reply'));
        gates.get('/select topic ignored')!.resolve();
        gates.get('beta threaded reply')!.resolve();
        await until(() => entered.includes('alpha again'));
        gates.get('alpha again')!.resolve();
        await until(async () => (await store.getProcess(toQueueProcessId(taskA.id)))?.conversationTurns
            ?.filter(turn => turn.role === 'user').length === 3);
        expect((await store.getProcess(toQueueProcessId(taskA.id)))?.conversationTurns
            ?.filter(turn => turn.role === 'user').map(turn => turn.content).slice(-2))
            .toEqual(['/select topic ignored', 'alpha again']);
        expect((await store.getProcess(toQueueProcessId(taskB.id)))?.conversationTurns
            ?.filter(turn => turn.role === 'user').at(-1)?.content).toBe('beta threaded reply');
        await until(() => repliesFor('root-a').length === 6 && repliesFor('root-b').length === 6);
        const taskCount = registry.getQueueForRepo(path.join(dataDir, 'ws-a')).getAll().length
            + registry.getQueueForRepo(path.join(dataDir, 'ws-b')).getAll().length;
        await handle(inbound('unknown-reply', 'must not become a new topic', 'unknown-root'));
        expect(repliesFor('unknown-root')).toEqual([expect.stringContaining('unavailable')]);
        expect(registry.getQueueForRepo(path.join(dataDir, 'ws-a')).getAll().length
            + registry.getQueueForRepo(path.join(dataDir, 'ws-b')).getAll().length).toBe(taskCount);
        const sentCount = calls.length;
        await handle(inbound('thread-a-1', '/select topic ignored', 'root-a'));
        expect(calls).toHaveLength(sentCount);
        await handle(inbound('thread-a-3', 'another turn after the answer', 'root-a'));
        await until(() => entered.includes('another turn after the answer'));
        gates.get('another turn after the answer')!.resolve();
        await until(() => repliesFor('root-a').length === 8);
        expect(repliesFor('root-a').at(-1)).toContain('Answer for another turn after the answer');
        expect(repliesFor('thread-a-3')).toHaveLength(0);
        expect((await store.getProcess(toQueueProcessId(taskA.id)))?.conversationTurns
            ?.filter(turn => turn.role === 'user').at(-1)?.content).toBe('another turn after the answer');

        expect(calls.every(call => call.name === 'ReplyToChannelMessage'
            && call.arguments.teamId === teamId && call.arguments.channelId === channelId)).toBe(true);
        const terminalListeners = registry.listenerCount('taskCompleted');
        manager.dispose();
        expect(registry.listenerCount('taskCompleted')).toBe(terminalListeners - 1);
    });
});

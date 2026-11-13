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
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { TeamsChannelBindings } from '../../../src/server/messaging/teams-channel-binding';

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

    it.each(['mcp', 'graph'] as const)('keeps admitted answers bound across channel rebinding (%s reads)', { timeout: 20_000 }, async channelReadBackend => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-answer-relay-integration-'));
        const store = new FileProcessStore({ dataDir });
        for (const [id, name] of [['ws-a', 'Alpha'], ['ws-b', 'Beta']]) {
            fs.mkdirSync(path.join(dataDir, id));
            await store.registerWorkspace({ id, name, rootPath: path.join(dataDir, id) });
            await store.addProcess({ id: `sentinel-${id}`, type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: '', fullPrompt: '', sdkSessionId: 'synthetic-session',
                metadata: { workspaceId: id, mode: 'sentinel', provider: 'copilot' } });
        }

        const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
        let selectionThread = false;
        vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
            const graphRoots = `https://graph.microsoft.com/beta/teams/${teamId}/channels/${channelId}/messages`;
            if (channelReadBackend === 'graph' && new URL(url).origin === 'https://graph.microsoft.com') {
                expect(init?.method).toBe('GET');
                if (new URL(url).pathname === new URL(graphRoots).pathname) {
                    return new Response(JSON.stringify({ value: [
                        selectionThread
                            ? { id: 'selection-root', body: { content: '/select repo 1' },
                                createdDateTime: '2026-01-01T00:00:00Z', from: { user: { id: 'synthetic-user' } } }
                            : { id: 'root-b', body: { content: 'beta prompt' }, createdDateTime: '2026-01-01T00:00:00Z' },
                    ] }));
                }
                expect(new URL(url).pathname).toBe(new URL(`${graphRoots}/${selectionThread ? 'selection-root' : 'root-b'}/replies`).pathname);
                return new Response(JSON.stringify({ value: [
                    { id: selectionThread ? 'thread-first' : 'thread-follow',
                        body: { content: selectionThread ? 'first thread question' : 'thread follow-up' },
                        createdDateTime: '2026-01-01T00:00:01Z', from: { user: { id: 'synthetic-user' } } },
                ] }));
            }
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
                    selectionThread
                        ? { id: 'selection-root', body: { content: '/select repo 1' }, from: { user: { id: 'synthetic-user' } } }
                        : { id: 'root-b', body: { content: 'beta prompt' } },
                ]) }] };
            } else if (body.method === 'tools/call' && body.params?.name === 'ListChannelMessageReplies') {
                if (body.params.arguments.messageId !== (selectionThread ? 'selection-root' : 'root-b')) throw new Error('Unexpected thread root');
                result = { content: [{ text: JSON.stringify([
                    { id: selectionThread ? 'thread-first' : 'thread-follow',
                        body: { content: selectionThread ? 'first thread question' : 'thread follow-up' },
                        from: { user: { id: 'synthetic-user' } } },
                ]) }] };
            } else if (body.method !== 'notifications/initialized') {
                throw new Error(`Unexpected MCP method: ${body.method}`);
            }
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
                headers: { 'content-type': 'application/json' },
            });
        }));
        const readerToken = 'header.' + Buffer.from(JSON.stringify({
            tid: '11111111-1111-4111-8111-111111111111', oid: '22222222-2222-4222-8222-222222222222',
            aud: 'https://graph.microsoft.com', scp: 'ChannelMessage.Read.All',
            exp: Math.floor(Date.now() / 1000) + 3600,
        })).toString('base64url') + '.signature';
        const transport = new McpTransport(endpoint, () => true, undefined, undefined, undefined, {
            channelReadBackend, graphReadOptions: { acquireToken: async () => readerToken },
        });
        await transport.initialize(readerToken, { teamId, channelId });

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
            outboundBackend: 'mcp', channelReadBackend: 'graph', enableTrouter: false,
            notificationStatus: { state: 'disabled', error: null },
            enabled: true, status: 'connected', teamId, channelId,
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account');
        const bindings = new TeamsChannelBindings(dataDir, store);
        const identity = { accountKey: 'account', teamId, channelId };
        await bindings.bind(identity, 'ws-a', 'sentinel-ws-a');
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
            getBotManagedConversationsEnabled: () => true,
            enqueueRelayChat: (wsId, prompt, id, _mode, botControl) => queue.enqueue({
                id, processId: toQueueProcessId(id), type: 'chat', repoId: wsId,
                botControl,
                payload: { kind: 'chat', mode: 'ask', prompt, workspaceId: wsId },
                config: {}, priority: 'normal',
            }),
            admitRelayFollowUp: async (process, text, requestId, _mode, id, _images, admissionHeld) => {
                return { taskId: await (admissionHeld ? queue.enqueueAdmitted : queue.enqueue).call(queue, {
                    id, type: 'chat', repoId: process.metadata.workspaceId as string,
                    processId: process.id, priority: 'normal',
                    payload: { kind: 'chat', mode: 'sentinel', processId: process.id,
                        prompt: text, workspaceId: process.metadata.workspaceId, relayRequestId: requestId },
                    config: {},
                }) };
            },
            enqueuePendingRelayFollowUp: (wsId, processId, text, requestId, _mode, id) => queue.enqueue({
                    id, type: 'chat', repoId: wsId, processId, priority: 'normal',
                    payload: { kind: 'chat', mode: 'ask', processId, prompt: text,
                        workspaceId: wsId, relayRequestId: requestId },
                    config: {},
                }),
        });
        const inbound = (messageId: string, text: string, replyToMessageId?: string): InboundTeamsMessage =>
            ({ messageId, channelId, text, senderAadId: 'synthetic-user', ...(replyToMessageId ? { replyToMessageId } : {}) });
        const repliesFor = (root: string) => calls.filter(call => call.arguments.messageId === root)
            .map(call => String(call.arguments.content));

        await handle(inbound('removed-command', '/select repo Beta'));
        expect(repliesFor('removed-command')).toEqual([expect.stringContaining('Unknown command')]);
        await handle(inbound('root-a', 'alpha prompt'));
        const taskA = registry.getQueueForRepo(path.join(dataDir, 'ws-a')).getAll()[0];
        expect(taskA).toMatchObject({ repoId: 'ws-a', processId: 'sentinel-ws-a' });
        queue.activateQueueProcessing();
        await until(() => entered.includes('alpha prompt'));

        await bindings.bind(identity, 'ws-b', 'sentinel-ws-b');
        await handle(inbound('root-b', 'beta prompt'));
        const taskB = registry.getQueueForRepo(path.join(dataDir, 'ws-b')).getAll()[0];
        expect(taskB).toMatchObject({ repoId: 'ws-b', processId: 'sentinel-ws-b' });
        await until(() => entered.includes('beta prompt'));
        gates.get('alpha prompt')!.resolve();
        gates.get('beta prompt')!.resolve();
        await until(() => repliesFor('root-a').some(reply => reply.includes('Answer for alpha prompt'))
            && repliesFor('root-b').some(reply => reply.includes('Answer for beta prompt')));
        expect((await store.getProcess('sentinel-ws-a'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        expect((await store.getProcess('sentinel-ws-b'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));

        const polled = await transport.poll(channelId);
        expect(polled.messages).toEqual([
            expect.objectContaining({ messageId: 'root-b' }),
            expect.objectContaining({ messageId: 'thread-follow', replyToMessageId: 'root-b' }),
        ]);
        await handle(polled.messages[1]);
        await until(() => entered.includes('thread follow-up'));
        gates.get('thread follow-up')!.resolve();
        await until(() => repliesFor('root-b').some(reply => reply.includes('Answer for thread follow-up')));
        expect((await store.getProcess('sentinel-ws-b'))?.conversationTurns
            ?.filter(turn => turn.role === 'user').at(-1)?.content).toBe('thread follow-up');
        expect(repliesFor('thread-follow')).toHaveLength(0);

        expect(calls.every(call => call.name === 'ReplyToChannelMessage'
            && call.arguments.teamId === teamId && call.arguments.channelId === channelId)).toBe(true);
        const terminalListeners = registry.listenerCount('taskCompleted');
        manager.dispose();
        transport.stop();
        expect(registry.listenerCount('taskCompleted')).toBe(terminalListeners - 1);
    });
});

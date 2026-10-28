import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { MicrosoftTokenProvider } from '@plusplusoneplusplus/coc-native';
import { DEFAULT_CONFIG, mergeConfig } from '../../../src/config';
import * as configModule from '../../../src/config';
import { createTeamsIc3OwnCommandsRuntime } from '../../../src/server/messaging/teams-ic3-own-commands-runtime';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { createTeamsIc3OwnCommandLaunch } from '../../../src/server/messaging/teams-ic3-own-command-launch';
import type { QueueRouteContext } from '../../../src/server/routes/queue-shared';
import * as queueShared from '../../../src/server/routes/queue-shared';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';

describe('IC3 Ask queue admission', () => {
    let directory: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let queue: QueueRouteContext & { store: SqliteProcessStore };
    let launch: ReturnType<typeof createTeamsIc3OwnCommandLaunch>;
    let sdk: ReturnType<typeof createMockSDKService>;
    const workspaceId = 'workspace-alpha';
    const id = 'ic3-command-fixture';
    const root = () => path.join(directory, 'alpha');
    const tasks = () => bridge.createAggregateQueueFacade().getAll();
    beforeEach(async () => {
        vi.spyOn(configModule, 'loadConfigFile').mockReturnValue({});
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ic3-launch-'));
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        sdk = createMockSDKService({
            listModelsResult: [{
                id: 'gpt-6.1-sol', name: 'Fixture Medium Model',
                supportedReasoningEfforts: ['medium'],
            }],
        });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            autoStart: false, aiService: sdk.service, dataDir: directory,
        });
        for (const [key, name] of [[workspaceId, 'alpha'], ['workspace-beta', 'beta']]) {
            const rootPath = path.join(directory, name);
            fs.mkdirSync(rootPath);
            bridge.registerRepoId(key, rootPath);
            await store.registerWorkspace({ id: key, name, rootPath });
        }
        queue = {
            bridge, store, globalWorkspaceRootPath: path.join(directory, 'beta'),
            state: { globalPaused: true, globalAutopilotPaused: false, resumeInProgress: new Set() },
        };
        launch = createTeamsIc3OwnCommandLaunch(queue);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        bridge.dispose();
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('forces Ask in the configured workspace, preserving normal pause and provider policy', async () => {
        queue.state.globalTaskDelayMinutes = 5;
        queue.isAutoProviderRoutingActive = () => true;
        await launch(workspaceId, id, '/autopilot workspace-beta edit files', new AbortController().signal, id);
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0]).toMatchObject({
            id, type: 'chat', repoId: workspaceId,
            payload: {
                kind: 'chat', workspaceId, workingDirectory: root(), mode: 'ask',
                prompt: '/autopilot workspace-beta edit files',
                context: { autoProviderRouting: { requested: true } },
            },
        });
        expect(tasks()[0].payload.provider).toBeUndefined();
        expect(tasks()[0].config).toMatchObject({ afterEffortTier: 'medium' });
        expect(tasks()[0].config.model).toBeUndefined();
        expect(tasks()[0].config.reasoningEffort).toBeUndefined();
        expect(tasks()[0].payload.processId).toBeUndefined();
        expect(bridge.registry.getQueueForRepo(root()).getStats()).toMatchObject({ isPaused: true, taskDelayMinutes: 5 });
        expect(bridge.registry.getQueueForRepo(path.join(directory, 'beta')).getAll()).toHaveLength(0);
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'] as const)(
        'resolves the medium tier using the selected %s provider settings', async provider => {
            queue.getDefaultProvider = () => provider;
            queue.getEffortTiersForProvider = selected => selected === provider
                ? { medium: { model: 'configured-medium-model', reasoningEffort: 'low' } }
                : undefined;
            await launch(workspaceId, id, 'explain', new AbortController().signal, id);
            expect(tasks()[0].config).toMatchObject({
                afterEffortTier: 'medium', model: 'configured-medium-model', reasoningEffort: 'low',
            });
            expect(tasks()[0].config).not.toHaveProperty('effortTier');
        },
    );

    it('does not duplicate queued command identities', async () => {
        const signal = new AbortController().signal;
        await launch(workspaceId, id, 'explain', signal, id);
        await launch(workspaceId, id, 'explain', signal, id);
        expect(tasks()).toHaveLength(1);
    });

    it.each([{ members: [] }, { members: [workspaceId, 'workspace-beta'] }])(
        'admits repo-group commands and ordered follow-ups with $members', async ({ members }) => {
        const group = await createRepoGroup(directory, store, { name: 'Team', members });
        bridge.registerRepoId(group.id, group.rootPath);
        const signal = new AbortController().signal;
        await launch(group.id, id, 'first', signal, 'ic3-chat-group');
        await launch(group.id, 'next', 'follow-up', signal, 'ic3-chat-group');
        await launch(group.id, id, 'first', signal, 'ic3-chat-group');
        expect(tasks()).toHaveLength(2);
        expect(tasks()[0]).toMatchObject({
            id: 'ic3-chat-group', repoId: group.id,
            payload: { workspaceId: group.id, workingDirectory: group.rootPath, mode: 'ask' },
        });
        expect(tasks()[1]).toMatchObject({
            id: 'next', repoId: group.id, processId: toQueueProcessId('ic3-chat-group'),
            payload: { workspaceId: group.id, workingDirectory: group.rootPath, mode: 'ask' },
        });
        expect(bridge.registry.getQueueForRepo(root()).getAll()).toHaveLength(0);
        expect(bridge.registry.getQueueForRepo(path.join(directory, 'beta')).getAll()).toHaveLength(0);
    });

    it('serializes rapid mentions behind one first turn, including concurrent admission and replay', async () => {
        const signal = new AbortController().signal;
        const conversation = 'ic3-chat-fixture';
        await Promise.all([
            launch(workspaceId, id, 'first', signal, conversation),
            launch(workspaceId, 'second', 'next', signal, conversation),
            launch(workspaceId, id, 'first', signal, conversation),
        ]);
        expect(tasks()).toHaveLength(2);
        expect(tasks()[0]).toMatchObject({ id: conversation, payload: { relayRequestId: id } });
        expect(tasks()[1]).toMatchObject({
            id: 'second', processId: toQueueProcessId(conversation),
            payload: { processId: toQueueProcessId(conversation), relayRequestId: 'second', mode: 'ask' },
            config: { processPredecessorId: conversation },
        });
        expect(tasks()[1].config).not.toHaveProperty('afterEffortTier');
    });

    it('reuses a saved conversation after launcher recreation and deduplicates saved request turns', async () => {
        const conversation = 'ic3-chat-fixture';
        await store.addProcess({
            id: toQueueProcessId(conversation), type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'first', metadata: { workspaceId, queueTaskId: conversation, mode: 'ask' },
            conversationTurns: [{ role: 'user', content: 'first', relayRequestId: id,
                timestamp: new Date(), turnIndex: 0, timeline: [] }],
        });
        launch = createTeamsIc3OwnCommandLaunch(queue);
        const signal = new AbortController().signal;
        await launch(workspaceId, id, 'first', signal, conversation);
        expect(tasks()).toHaveLength(0);
        await launch(workspaceId, 'second', 'next', signal, conversation);
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0].payload.processId).toBe(toQueueProcessId(conversation));
    });

    it.each(['queued', 'saved'])('rejects a %s conversation owned by another workspace', async evidence => {
        const signal = new AbortController().signal;
        const conversation = 'ic3-chat-fixture';
        if (evidence === 'queued') await launch(workspaceId, id, 'first', signal, conversation);
        else await store.addProcess({
            id: toQueueProcessId(conversation), type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'first', metadata: { workspaceId, queueTaskId: conversation },
        });
        await expect(launch('workspace-beta', 'second', 'next', signal, conversation))
            .rejects.toThrow('ownership mismatch');
        expect(tasks()).toHaveLength(evidence === 'queued' ? 1 : 0);
    });

    it('rejects missing and virtual workspaces without global fallback', async () => {
        await expect(launch('missing', id, 'explain', new AbortController().signal, id)).rejects.toThrow();
        await expect(launch('group-missing', id, 'explain', new AbortController().signal, id)).rejects.toThrow();
        await store.registerWorkspace({ id: 'virtual', name: 'Virtual', rootPath: root(), virtual: true });
        await expect(launch('virtual', id, 'explain', new AbortController().signal, id)).rejects.toThrow();
        await store.registerWorkspace({ id: 'group-INVALID', name: 'Invalid group', rootPath: root(), virtual: true });
        await expect(launch('group-INVALID', id, 'explain', new AbortController().signal, id)).rejects.toThrow();
        expect(tasks()).toHaveLength(0);
    });

    it('rejects cancellation during asynchronous preparation before queue mutation', async () => {
        const controller = new AbortController();
        const get = store.getWorkspaces.bind(store);
        vi.spyOn(store, 'getWorkspaces').mockImplementationOnce(async () => {
            controller.abort();
            return get();
        });
        await expect(launch(workspaceId, id, 'explain', controller.signal, id)).rejects.toThrow();
        expect(tasks()).toHaveLength(0);
    });

    it('allows enqueue to finish when cancelled after the final caller check', async () => {
        const controller = new AbortController();
        const enqueue = queueShared.enqueueViaBridge;
        vi.spyOn(queueShared, 'enqueueViaBridge').mockImplementationOnce((...args) => {
            controller.abort();
            return enqueue(...args);
        });
        await launch(workspaceId, id, 'explain', controller.signal, id);
        expect(tasks()).toHaveLength(1);
    });

    it.each(['repo', 'repo-group'])('returns real queued %s Ask results and follow-ups to the original Teams chat', async target => {
        const group = target === 'repo-group'
            ? await createRepoGroup(directory, store, { name: 'Team', members: [workspaceId, 'workspace-beta'] })
            : undefined;
        if (group) bridge.registerRepoId(group.id, group.rootPath);
        const commandWorkspaceId = group?.id ?? workspaceId;
        const account = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
        const chatId = '19:source-group@thread.v2';
        const createdAt = new Date(Date.now() + 1000).toISOString();
        let messageId = 'source-command';
        let wake!: () => void;
        const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            if (init?.method === 'PUT') return new Response(null, { status: 200 });
            if (init?.method === 'POST') return new Response(JSON.stringify({ OriginalArrivalTime: '12345' }), { status: 201 });
            throw new Error('Acknowledgements must not read message history');
        });
        vi.stubGlobal('fetch', fetch);
        const accessToken = 'header.' + Buffer.from(JSON.stringify({
            aud: 'https://ic3.teams.office.com', tid: account.tenantId, oid: account.userId,
            exp: Math.floor(Date.now() / 1000) + 3600, name: 'Fixture User',
        })).toString('base64url') + '.signature';
        vi.spyOn(MicrosoftTokenProvider.prototype, 'getToken').mockResolvedValue({
            accessToken, tokenType: 'Bearer', expiresAt: Math.floor(Date.now() / 1000) + 3600,
            source: 'azure-cli', target: 'https://ic3.teams.office.com',
            account: { id: 'fixture-account', tenant: account.tenantId },
        });
        queue.state.globalPaused = false;
        const runtime = createTeamsIc3OwnCommandsRuntime({
            teams: { getIc3Region: () => 'amer', onIc3RegionChange: () => () => {} },
            config: {
                config: mergeConfig(DEFAULT_CONFIG, { features: { teamsIc3OwnCommands: true },
                    teamsIc3OwnCommands: { workspaceId: commandWorkspaceId } }),
                onChange: () => () => {},
            },
            store, queue: bridge.createAggregateQueueFacade(), launch, routes: [],
            createTrouter: options => {
                wake = () => options.onWake({ cause: 'message', conversationId: chatId });
                return { start: () => {}, stop: async () => {}, getStatus: () => ({ state: 'registered', error: null }) };
            },
            createSession: () => ({
                connect: async () => account,
                readChats: async () => ({ items: [{ chatId, kind: 'group' }], rawCount: 1 }),
                readHistory: async source => ({ items: source === chatId ? [{
                    chatId, messageId, createdAt, modifiedAt: createdAt,
                    authorKind: 'user', authorId: account.userId, text: '@coc explain this',
                    deleted: false, textTruncated: false, htmlTruncated: false,
                }] : [], rawCount: source === chatId ? 1 : 0 }),
                dispose: () => {},
            }),
        });
        try {
            await vi.waitFor(() => expect(tasks()).toHaveLength(1));
            const task = tasks()[0];
            expect(task.repoId).toBe(commandWorkspaceId);
            expect(task.payload.workingDirectory).toBe(group?.rootPath ?? root());
            expect(task.payload.mode).toBe('ask');
            expect(task.config).toMatchObject({ afterEffortTier: 'medium' });
            bridge.activateQueueProcessing();
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 10_000 });
            expect(fetch.mock.calls[0][1]?.method).toBe('PUT');
            expect(String(fetch.mock.calls[0][0])).toContain('/messages/source-command/properties?name=emotions');
            expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).emotions.key).toBe('1f440_eyes');
            const [url, init] = vi.mocked(globalThis.fetch).mock.calls[1];
            expect(url).toBe('https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/19%3Asource-group%40thread.v2/messages');
            expect(JSON.parse(String(init?.body)).content).toContain('AI response text');
            const proc = await store.getProcess(toQueueProcessId(task.id), commandWorkspaceId);
            expect(proc?.metadata?.workspaceId).toBe(commandWorkspaceId);
            if (group) {
                expect(sdk.mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    workingDirectory: group.rootPath,
                    additionalDirectories: [root(), path.join(directory, 'beta')],
                    prompt: expect.stringContaining('repo_group_context'),
                }));
            }
            expect(proc?.metadata?.mode).toBe('ask');
            expect(proc?.metadata?.afterEffortTier).toBe('medium');
            expect(proc?.metadata?.queueTaskId).toBe(task.id);
            expect(proc?.conversationTurns?.[0].relayRequestId).toBe(task.payload.relayRequestId);
            messageId = 'follow-up-command';
            wake();
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4), { timeout: 10_000 });
            expect(fetch.mock.calls[2][1]?.method).toBe('PUT');
            expect(String(fetch.mock.calls[2][0])).toContain('/messages/follow-up-command/properties?name=emotions');
            const followUp = tasks().find(item => item.id !== task.id)!;
            expect(followUp.payload.processId).toBe(proc?.id);
            const continued = await store.getProcess(proc!.id, commandWorkspaceId);
            expect(continued?.conversationTurns?.filter(turn => turn.role === 'user')).toHaveLength(2);
            expect(continued?.conversationTurns?.find(turn => turn.relayRequestId === followUp.id)?.role).toBe('user');
            expect(tasks().filter(item => !item.payload.processId)).toHaveLength(1);
            expect(sdk.mockSendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionId: 'session-123' }));
            if (group) {
                expect(sdk.mockSendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
                    workingDirectory: group.rootPath, additionalDirectories: [root(), path.join(directory, 'beta')],
                }));
            }
            expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[3][1]?.body)).content).toContain('AI response text');
        } finally { await runtime.dispose(); }
    });
});

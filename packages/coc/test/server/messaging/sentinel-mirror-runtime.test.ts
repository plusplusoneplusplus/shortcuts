import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, toQueueProcessId, type AIProcess, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import { decodeGraphHtmlEntities, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { ProcessOperationAdmission } from '../../../src/server/processes/process-operation-admission';
import { SentinelMirrorService } from '../../../src/server/messaging/sentinel-mirror-service';
import { SentinelMirrorOutbox } from '../../../src/server/messaging/sentinel-mirror-outbox';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { TeamsCommandRouter } from '../../../src/server/messaging/teams-command-router';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { formatTeamsOutbound } from '../../../src/server/messaging/teams-outbound-format';
import { createTeamsMirrorAdapter, createWhatsAppMirrorAdapter, mirrorRetryAfterMs } from '../../../src/server/messaging/sentinel-mirror-adapters';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppMessagingManager, WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';
import { RELAY_ANSWER_TEXT } from '../../../src/server/messaging/relay-answer';
import { formatWhatsAppAnswer } from '../../../src/server/messaging/whatsapp-answer-format';
import { AskUserQuestionRelayHub } from '../../../src/server/messaging/ask-user-relay';
import { MessagingJobNotices } from '../../../src/server/messaging/job-notices';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobReviews, delegatedReviewReceipt } from '../../../src/server/delegation/delegated-job-reviews';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { createWhatsAppNoticeTransport } from '../../../src/server/messaging/whatsapp-answer-relay';
import { getRepoDataPath } from '../../../src/server/paths';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { registerQueueEnqueueRoutes } from '../../../src/server/routes/queue-enqueue';
import type { Route } from '../../../src/server/types';
import type { QueueRouteContext } from '../../../src/server/routes/queue-shared';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

async function invoke(route: Route, url: string, body: unknown): Promise<number> {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
        url, method: route.method ?? 'POST', headers: {},
    }) as IncomingMessage;
    let status = 0;
    const res = { writeHead: (code: number) => { status = code; }, end: () => {}, setHeader: () => {} } as unknown as ServerResponse;
    await route.handler(req, res, typeof route.pattern === 'string' ? undefined : url.split('?')[0].match(route.pattern)!);
    return status;
}

const fixtures: Array<{ mirror: SentinelMirrorService; relay?: TeamsAnswerRelay; directory: string }> = [];
afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
        fixture.mirror.dispose();
        fixture.relay?.dispose();
        fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
});

describe('Sentinel mirror typed retry hints', () => {
    it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])('defaults invalid typed hints to zero (%s)', delay => {
        expect(mirrorRetryAfterMs(new TeamsOperationError('safe test error', 'graph', 'unavailable', 'not-attempted', delay))).toBe(0);
    });

    it('honors typed provider hints but ignores arbitrary error properties', () => {
        expect(mirrorRetryAfterMs(new TeamsOperationError('safe test error', 'graph', 'rate-limited', 'rejected', 5000))).toBe(5000);
        expect(mirrorRetryAfterMs({ retryAfterMs: 5000 })).toBe(0);
        expect(mirrorRetryAfterMs(new WhatsAppNotConnectedError())).toBe(0);
    });
});

async function fixture(connector: 'whatsapp' | 'teams') {
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.sentinel-mirror-test-'));
    const store = new FileProcessStore({ dataDir: directory });
    await store.registerWorkspace({ id: 'workspace-a', rootPath: directory, name: 'Workspace A' });
    await store.registerWorkspace({ id: 'workspace-b', rootPath: path.join(directory, 'b'), name: 'Workspace B' });
    const tasks = new Map<string, QueuedTask>();
    const queue = Object.assign(new EventEmitter(), {
        getTask: (id: string) => tasks.get(id),
        getAll: () => [...tasks.values()],
    });
    let enabled = true;
    let connected = true;
    let account = 'account-pin';
    let bindingActive = true;
    let failure: unknown;
    const sends: Array<{ text: string; threadId?: string; chatKey: string }> = [];
    const outbound = new Set<string>();
    const send = vi.fn(async (text: string, threadId?: string) => {
        if (failure) throw failure;
        sends.push({ text, threadId, chatKey: connector === 'whatsapp' ? 'bound@g.us' : 'team\0channel' });
        return `sent-${sends.length}`;
    });
    let processId = toQueueProcessId('origin-task');
    let relay: TeamsAnswerRelay | undefined;
    const bindings = new WhatsAppBindings(directory, { store, queue: { getTask: queue.getTask, replaceBotControl: () => {} } });
    await bindings.restore(store);
    let adapter;
    if (connector === 'whatsapp') {
        bindings.add({
            workspaceId: 'workspace-a', processId, taskId: 'origin-task',
            groupJid: 'bound@g.us', inboundId: 'root', outboundIds: [], nextPart: 0, status: 'delivered',
        });
        const manager = new WhatsAppMessagingManager(directory);
        vi.spyOn(manager, 'getStatus').mockImplementation(() => ({
            enabled: true, status: connected ? 'connected' : 'disconnected', groupJid: 'bound@g.us',
            groupName: 'Group', deviceName: 'CoC', qr: null, error: null,
        }));
        vi.spyOn(manager, 'getMirrorAccountKey').mockImplementation(() => account);
        vi.spyOn(manager, 'sendTo').mockImplementation((_chatKey, text, threadId) => send(text, threadId));
        vi.spyOn(bindings, 'recordOutbound').mockImplementation(id => outbound.add(id));
        adapter = createWhatsAppMirrorAdapter(manager, bindings);
    } else {
        relay = new TeamsAnswerRelay({
            dataDir: directory, store, queue, isEnabled: () => true,
            target: () => ({ connected: true, teamId: 'team', channelId: 'channel' }), send,
        });
        const origin = await relay.admitNew({ messageId: 'root', channelId: 'channel', text: 'connector initial' },
            'workspace-a', async id => {
                tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), type: 'chat',
                    payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a', prompt: 'connector initial' },
                    status: 'queued' } as QueuedTask);
                return id;
            });
        processId = toQueueProcessId(origin.taskId);
        const manager = new TeamsMessagingManager(directory);
        manager.setAnswerRelay(relay);
        vi.spyOn(manager, 'getStatus').mockImplementation(() => ({
            connectionId: null, enabled: true, status: connected ? 'connected' : 'disconnected',
            teamId: 'team', channelId: 'channel', botName: 'CoC', error: null, serverUrl: null, authStatus: null,
            channelReadBackend: 'graph', outboundBackend: 'graph', enableTrouter: false,
            notificationStatus: { state: 'disabled', error: null },
        }));
        vi.spyOn(manager, 'getMirrorAccountKey').mockImplementation(() => account);
        vi.spyOn(manager, 'sendMessage').mockImplementation((text, threadId) => send(text, threadId));
        vi.spyOn(manager, 'recordMirrorOutbound').mockImplementation((_chat, _thread, id) => outbound.add(id));
        await relay.acknowledged(origin.taskId);
        tasks.get(origin.taskId)!.status = 'completed';
        adapter = createTeamsMirrorAdapter(manager);
    }
    const originalAvailability = adapter.availability;
    adapter.availability = entry => bindingActive ? originalAvailability(entry) : 'unbound';
    const originalDestinations = adapter.destinations;
    adapter.destinations = owner => bindingActive ? originalDestinations(owner) : [];
    await store.addProcess({
        id: processId, type: 'clarification', status: 'completed', startTime: new Date(),
        promptPreview: 'connector initial', fullPrompt: 'connector initial', workingDirectory: directory,
        metadata: { type: 'chat', mode: 'sentinel', provider: 'copilot', workspaceId: 'workspace-a' },
        conversationTurns: [
            { role: 'user', content: 'connector initial', turnIndex: 0, timestamp: new Date(), timeline: [] },
            { role: 'assistant', content: 'connector answer', turnIndex: 1, timestamp: new Date(), timeline: [] },
        ],
    } as AIProcess);
    const bridge = {
        getTask: queue.getTask,
        findTaskByProcessId: (id: string) => [...tasks.values()].find(task => task.processId === id && task.status === 'running'),
        enqueueAdmitted: vi.fn(async (input: CreateTaskInput) => {
            const id = input.id ?? `task-${tasks.size}`;
            tasks.set(id, { ...input, id, repoId: input.payload.workspaceId, status: 'queued', createdAt: new Date() } as QueuedTask);
            return id;
        }),
        steerProcess: vi.fn(async () => true),
    };
    Object.assign(bridge, { enqueue: bridge.enqueueAdmitted });
    let onSourceSettled: (() => Promise<void>) | undefined;
    const sourceSettled = () => onSourceSettled?.() ?? Promise.resolve();
    let mirror = new SentinelMirrorService({ dataDir: directory, store, queue, enabled: () => enabled,
        adapters: [adapter], onSourceSettled: sourceSettled });
    fixtures.push({ mirror, relay, directory });
    const deliver = async (content: string, input = {}) => {
        const delivery = new ProcessMessageDeliveryService({
            store, bridge: bridge as unknown as QueueExecutorBridge, sentinelMirror: mirror,
            admission: new ProcessOperationAdmission(),
        });
        return delivery.deliver((await store.getProcess(processId, 'workspace-a'))!, {
            origin: 'desktop', content, displayContent: content, deliveryMode: 'enqueue',
            pasteExternalized: false, mode: 'sentinel', provider: 'copilot', ...input,
        });
    };
    const finish = async (content: string) => {
        const proc = (await store.getProcess(processId, 'workspace-a'))!;
        for (const task of tasks.values()) if (task.payload.relayRequestId) task.status = 'completed';
        await store.appendConversationTurn(processId, turnIndex => ({
            role: 'assistant', content, turnIndex, timestamp: new Date(), timeline: [],
        }));
        await store.updateProcess(processId, { status: 'completed' });
        await mirror.flush();
        await mirror.flush();
        return proc;
    };
    return {
        directory, store, queue, tasks, bridge, adapter, bindings, relay, processId, send, sends, outbound, deliver, finish,
        get mirror() { return mirror; },
        setEnabled: (value: boolean) => { enabled = value; },
        setConnected: (value: boolean) => { connected = value; },
        setAccount: (value: string) => { account = value; },
        setBinding: (value: boolean) => { bindingActive = value; },
        setFailure: (value: unknown) => { failure = value; },
        setSourceSettled: (callback: () => Promise<void>) => { onSourceSettled = callback; },
        restart: async () => {
            mirror.dispose();
            mirror = new SentinelMirrorService({ dataDir: directory, store, queue, enabled: () => enabled,
                adapters: [adapter], onSourceSettled: sourceSettled });
            fixtures.push({ mirror, directory });
            mirror.start();
            await mirror.flush();
        },
    };
}

function pendingRoutes(f: Awaited<ReturnType<typeof fixture>>) {
    const routes: Route[] = [];
    const cancelQueuedTask = vi.fn((id: string) => {
        const task = f.tasks.get(id);
        if (task?.status !== 'queued') return false;
        task.status = 'cancelled';
        return true;
    });
    registerApiProcessRoutes({
        routes, store: f.store,
        bridge: Object.assign(f.bridge, { cancelQueuedTask }) as unknown as QueueExecutorBridge,
        gitOpsStore: {} as never, getSentinelMirror: () => f.mirror,
    });
    return {
        post: routes.find(route => route.method === 'POST'
            && String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/pending-messages$/))!,
        delete: routes.find(route => route.method === 'DELETE'
            && String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/pending-messages\/([^/]+)$/))!,
        url: `/api/processes/${f.processId}/pending-messages`,
        cancelQueuedTask,
    };
}

async function pausedResumeAdmission(f: Awaited<ReturnType<typeof fixture>>) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let requestId = '';
    const append = f.store.appendConversationTurn.bind(f.store);
    const spy = vi.spyOn(f.store, 'appendConversationTurn').mockImplementation(async (...args) => {
        const turn = args[1](0);
        if (turn.role === 'user' && turn.relayRequestId === requestId) {
            enter();
            await gate;
        }
        return append(...args);
    });
    const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
    f.bridge.enqueueAdmitted.mockImplementation(async input => {
        const id = await enqueue(input);
        requestId = input.payload.relayRequestId as string;
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === requestId))
            .toMatchObject({ state: 'admitting', cancelRequested: false });
        return id;
    });
    const completion = f.deliver('resumed desktop request', { resumeSessionId: 'synthetic-resume-session' });
    try {
        await Promise.race([entered, completion.then(() => { throw new Error('Expected paused user append'); })]);
    } catch (error) {
        release();
        await completion.catch(() => {});
        spy.mockRestore();
        throw error;
    }
    return { requestId, release, completion, spy };
}

async function queuedOwnerWithoutProcess(f: Awaited<ReturnType<typeof fixture>>): Promise<QueuedTask> {
    const id = f.processId.slice('queue_'.length);
    const original = {
        id, repoId: 'workspace-a', processId: f.processId, type: 'chat', status: 'queued',
        payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a', prompt: 'bound queued initial' },
    } as QueuedTask;
    f.tasks.set(id, original);
    await f.store.removeProcess(f.processId);
    return original;
}

function desktopQueueRoutes(
    f: Awaited<ReturnType<typeof fixture>>, globalWorkspaceRootPath = f.directory,
): Route[] {
    const routes: Route[] = [];
    const manager = { enqueue: f.bridge.enqueueAdmitted, getTask: f.queue.getTask, getStats: () => ({}) };
    const bridge = Object.assign(f.bridge, {
        getOrCreateBridge: () => {}, registry: { getQueueForRepo: () => manager },
        getRepoIdForPath: (root: string) => root === f.directory ? 'workspace-a' : 'workspace-b',
        findManagerForTask: () => manager,
    });
    registerQueueEnqueueRoutes(routes, {
        bridge, store: f.store, globalWorkspaceRootPath,
        state: { globalPaused: false, globalAutopilotPaused: false, resumeInProgress: new Set() },
        getSentinelMirror: () => f.mirror,
    } as unknown as QueueRouteContext);
    return routes;
}

describe('desktop upload admission wiring', () => {
    const upload = {
        name: 'notes.txt', mimeType: 'text/plain', size: 240,
        dataUrl: `data:text/plain;base64,${Buffer.from('x'.repeat(240)).toString('base64')}`,
    };

    it.each(['single', 'bulk'] as const)('snapshots %s queue uploads before SDK decoding and temporary cleanup', async kind => {
        const f = await fixture('whatsapp');
        f.setConnected(false);
        const route = desktopQueueRoutes(f).find(route => route.pattern === (kind === 'single' ? '/api/queue' : '/api/queue/bulk'))!;
        const task = {
            type: 'chat', repoId: 'workspace-a', config: {},
            payload: { kind: 'chat', mode: 'sentinel', processId: f.processId, prompt: 'caption', attachments: [upload] },
        };
        expect(await invoke(route, kind === 'single' ? '/api/queue' : '/api/queue/bulk',
            kind === 'single' ? task : { tasks: [task] })).toBe(201);
        const receipt = f.mirror.outbox.list('workspace-a')[0];
        expect(receipt.content).toBe('caption');
        expect(receipt.attachments?.[0]).toMatchObject({ name: 'notes.txt', size: 240, data: upload.dataUrl.split(',')[1] });
        const queued = f.tasks.get(receipt.requestId)!;
        expect(queued.payload.prompt).toContain('<attached_file');
        const tempDir = queued.payload.imageTempDir;
        expect(typeof tempDir).toBe('string');
        fs.rmSync(String(tempDir), { recursive: true, force: true });
        await f.restart();
        expect(f.mirror.outbox.list('workspace-a')[0].attachments).toEqual(receipt.attachments);
        expect(f.sends).toEqual([]);
    });

    it('captures upload bytes on the owning follow-up route and rejects malformed uploads explicitly', async () => {
        const f = await fixture('whatsapp');
        f.setConnected(false);
        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes, store: f.store,
            bridge: Object.assign(f.bridge, { isSessionAlive: async () => true }) as unknown as QueueExecutorBridge,
            gitOpsStore: {} as never, getSentinelMirror: () => f.mirror,
        });
        const route = routes.find(route => String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/message$/))!;
        const url = `/api/processes/${f.processId}/message?workspace=workspace-a`;
        expect(await invoke(route, url, { content: 'caption', attachments: [upload] })).toBe(202);
        const receipt = f.mirror.outbox.list('workspace-a')[0];
        expect(receipt.content).toBe('caption');
        expect(receipt.attachments?.[0].data).toBe(upload.dataUrl.split(',')[1]);
        const queued = f.tasks.get(receipt.requestId)!;
        fs.rmSync(String(queued.payload.imageTempDir), { recursive: true, force: true });
        await f.store.updateProcess(f.processId, { status: 'completed' });
        f.tasks.clear();
        expect(await invoke(route, url, { content: 'must not forward', attachments: [{ ...upload, dataUrl: 'missing' }] })).toBe(400);
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(1);
        expect(f.sends).toEqual([]);
    });
});

describe.each(['whatsapp', 'teams'] as const)('durable Sentinel mirror runtime (%s)', connector => {
    it('holds a new accepted explicit resume through old cancelled-parent state without reviving source tombstones', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const old = await f.deliver('old cancelled desktop request');
        const oldId = f.tasks.get(old.taskId!)!.payload.relayRequestId as string;
        f.tasks.get(old.taskId!)!.status = 'cancelled';
        await f.store.updateProcess(f.processId, { status: 'cancelled' });
        await f.mirror.flush();
        f.setConnected(true);
        const paused = await pausedResumeAdmission(f);
        try {
            const task = [...f.tasks.values()].find(task => task.payload.relayRequestId === paused.requestId)!;
            expect(task.payload.resumeSessionId).toBe('synthetic-resume-session');
            expect((await f.store.getProcess(f.processId))?.status).toBe('cancelled');
            await f.mirror.flush();
            expect(f.sends).toEqual([]);
            expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === paused.requestId))
                .toMatchObject({ state: 'pending', cancelRequested: false });
            await f.restart();
            expect(f.sends).toEqual([]);
            paused.release();
            await paused.completion;
            await f.mirror.flush();
            expect(f.sends).toHaveLength(1);
            expect(f.sends[0].text).toContain('resumed desktop request');
            task.status = 'completed';
            await f.store.appendConversationTurn(f.processId, turnIndex => ({
                role: 'assistant', content: 'Resumed final answer.', turnIndex, timestamp: new Date(), timeline: [],
            }));
            await f.store.updateProcess(f.processId, { status: 'completed' });
            await f.mirror.flush();
            expect(f.sends).toHaveLength(2);
            expect(f.sends[1].text).toContain('Resumed final answer.');
            expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === oldId))
                .toMatchObject({ state: 'cancelled', cancelRequested: true });
            expect(f.sends.some(row => row.text.includes('old cancelled desktop request'))).toBe(false);
        } finally { paused.release(); await paused.completion; paused.spy.mockRestore(); }
    });

    it.each(['task', 'parent'] as const)('cancels a newly stopped %s during accepted resume admission and retains the tombstone after activation', async stopped => {
        const f = await fixture(connector);
        await f.store.updateProcess(f.processId, { status: 'cancelled' });
        const paused = await pausedResumeAdmission(f);
        try {
            const task = [...f.tasks.values()].find(task => task.payload.relayRequestId === paused.requestId)!;
            if (stopped === 'task') task.status = 'cancelled';
            else await f.store.updateProcess(f.processId, { status: 'cancelling' });
            await f.mirror.flush();
            expect(f.sends).toEqual([]);
            expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === paused.requestId))
                .toMatchObject({ state: 'cancelled', cancelRequested: true });
            paused.release();
            await paused.completion;
            await f.mirror.flush();
            expect(f.sends).toEqual([]);
        } finally { paused.release(); await paused.completion; paused.spy.mockRestore(); }
    });

    it('inherits only exact admitted desktop origins with their still-active pinned binding across reconnect/restart', async () => {
        const f = await fixture(connector);
        const staged = (await f.mirror.capture('workspace-a', f.processId, 'not admitted'))!;
        const stagedRequest = { workspaceId: staged.workspaceId, processId: staged.processId, requestId: staged.requestId };
        expect(f.mirror.locateCapturedOrigin(stagedRequest)).toBeUndefined();
        await f.mirror.rejected(staged);
        await f.deliver('accepted desktop delegation');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user' && row.state !== 'cancelled')!;
        const request = { workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId };
        const origin = { connector, chatKey: user.destination.chatKey, threadId: user.destination.threadId,
            desktopMirror: { workspaceId: user.workspaceId, processId: user.processId,
                requestId: user.requestId, bindingId: user.destination.bindingId } };
        expect(f.mirror.locateCapturedOrigin(request)).toEqual(origin);
        expect(f.mirror.locateCapturedOrigin({ ...request, workspaceId: undefined })).toBeUndefined();
        expect(f.mirror.locateCapturedOrigin({ ...request, workspaceId: 'workspace-b' })).toBeUndefined();
        expect(f.mirror.locateCapturedOrigin({ ...request, processId: 'another-parent' })).toBeUndefined();
        expect(f.mirror.locateCapturedOrigin({ ...request, requestId: 'another-request' })).toBeUndefined();
        f.setConnected(false);
        await f.restart();
        expect(f.mirror.locateCapturedOrigin(request)).toEqual(origin);
        f.setAccount('different-account');
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
        f.setAccount('account-pin');
        f.setBinding(false);
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
        f.setBinding(true);
        const originalDestinations = f.adapter.destinations;
        f.adapter.destinations = owner => [...originalDestinations(owner),
            { ...user.destination, bindingId: 'replacement-binding' }];
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
        f.adapter.destinations = originalDestinations;
        f.setEnabled(false);
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
        f.setEnabled(true);
        const task = [...f.tasks.values()].find(task => task.payload.relayRequestId === user.requestId)!;
        task.status = 'cancelled';
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
        task.status = 'running';
        await f.mirror.cancelRequest(user.workspaceId, user.processId, user.requestId);
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
    });

    it('preserves delegation admission during the canonical enqueue/receipt-accept observer window', async () => {
        const f = await fixture(connector);
        const user = (await f.mirror.capture('workspace-a', f.processId, 'delegation before observer returns'))!;
        const request = { workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId };
        f.tasks.set(user.requestId, { id: user.requestId, type: 'chat', processId: user.processId,
            repoId: user.workspaceId, status: 'running',
            payload: { kind: 'chat', workspaceId: user.workspaceId, relayRequestId: user.requestId } } as QueuedTask);
        expect(f.mirror.locateCapturedOrigin(request)).toEqual({
            connector, chatKey: user.destination.chatKey, threadId: user.destination.threadId,
            desktopMirror: { workspaceId: user.workspaceId, processId: user.processId,
                requestId: user.requestId, bindingId: user.destination.bindingId },
        });
        expect(await f.mirror.authorizeCapturedOrigin(f.mirror.locateCapturedOrigin(request)!)).toBe('ready');
        expect(await f.mirror.authorizeCapturedOrigin(f.mirror.locateCapturedOrigin(request)!, {
            workspaceId: user.workspaceId, processId: user.processId,
        })).toBe('wait');
        f.tasks.get(user.requestId)!.repoId = 'workspace-b';
        expect(f.mirror.locateCapturedOrigin(request)).toBeUndefined();
    });

    it('resolves buffered captured origins independently and cancellation suppresses only the matching handoff', async () => {
        const f = await fixture(connector);
        await f.deliver('first desktop request');
        expect((await f.deliver('buffered desktop request')).path).toBe('buffered');
        await f.mirror.flush();
        const users = f.mirror.outbox.list('workspace-a').filter(row => row.role === 'user');
        const request = (row: typeof users[number]) => ({
            workspaceId: row.workspaceId, processId: row.processId, requestId: row.requestId,
        });
        expect(f.mirror.locateCapturedOrigin(request(users[0]))).toBeDefined();
        expect(f.mirror.locateCapturedOrigin(request(users[1]))).toBeDefined();
        await f.mirror.cancelRequest('workspace-a', f.processId, users[1].requestId);
        expect(f.mirror.locateCapturedOrigin(request(users[1]))).toBeUndefined();
        expect(f.mirror.locateCapturedOrigin(request(users[0]))).toBeDefined();
    });

    it('pauses captured handoff admission until restart hydration and on unreadable receipt storage without raw errors', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop handoff');
        await f.mirror.flush();
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const request = { workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId };
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        f.mirror.dispose();
        const restarted = new SentinelMirrorService({
            dataDir: f.directory, store: f.store, queue: f.queue, adapters: [f.adapter], enabled: () => true,
        });
        fixtures.push({ mirror: restarted, directory: f.directory });
        expect(() => restarted.locateCapturedOrigin(request)).toThrow('Delegation admission is paused');
        await restarted.flush();
        expect(restarted.locateCapturedOrigin(request)).toBeDefined();
        const list = vi.spyOn(restarted.outbox, 'list').mockImplementation(() => { throw new Error('private storage contents'); });
        expect(() => restarted.locateCapturedOrigin(request)).toThrow('Delegation admission is paused');
        expect(JSON.stringify(log.mock.calls)).not.toContain('private storage contents');
        list.mockRestore();
    });

    it('delegates from the captured desktop origin and returns the parent review once through the existing result outbox only', async () => {
        const f = await fixture(connector);
        await f.deliver('delegate a helper from desktop');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const hub = new AskUserQuestionRelayHub({ store: f.store,
            capturedOrigin: request => f.mirror.locateCapturedOrigin(request) });
        const jobs = new DelegatedJobStore(f.directory);
        const authorizeDesktopOrigin = f.mirror.authorizeCapturedOrigin.bind(f.mirror);
        let notices = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue, delegatedJobs: jobs, authorizeDesktopOrigin,
        });
        const posted: Array<{ text: string; chatKey: string; threadId?: string }> = [];
        const transport = { platform: connector, connected: () => true,
            post: async (chatKey: string, notice: { body?: string; threadId?: string }) => {
                posted.push({ text: notice.body ?? '', chatKey, threadId: notice.threadId });
                return `result-${posted.length}`;
            } };
        notices.register(transport);
        const enqueue = createSentinelDelegationEnqueue({
            store: f.store, jobs, getTask: f.queue.getTask, hasTask: id => !!f.queue.getTask(id),
        });
        const { tool } = createSendToConversationTool({
            store: f.store, workspaceId: 'workspace-a', parentProcessId: f.processId,
            enqueueChat: input => enqueue(input, f.bridge.enqueueAdmitted),
            runtime: {
                messagingOrigin: () => hub.locateOrigin({
                    workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
                }),
                trackMessagingJob: job => notices.track(job),
            },
        });
        const delivery = new ProcessMessageDeliveryService({ store: f.store,
            bridge: f.bridge as unknown as QueueExecutorBridge, sentinelMirror: f.mirror });
        const reviews = new DelegatedJobReviews({
            jobs, store: f.store, queue: f.queue, delivery,
            queueMessagingResult: result => notices.queueResult(result),
        });
        try {
            const result = await tool.handler({ content: 'complete the helper', workspaceId: 'workspace-b', mode: 'autopilot' });
            if ('error' in result) throw new Error(result.error);
            const job = jobs.list('workspace-a')[0];
            expect(job.messagingOrigin).toEqual({
                connector, chatKey: user.destination.chatKey, threadId: user.destination.threadId,
                desktopMirror: { workspaceId: user.workspaceId, processId: user.processId,
                    requestId: user.requestId, bindingId: user.destination.bindingId },
            });
            expect(f.tasks.get(result.processId.slice('queue_'.length))!.payload.context)
                .not.toHaveProperty('messagingOrigin.desktopMirror');
            expect((await f.store.getProcess(f.processId))?.metadata?.messagingOrigin).toBeUndefined();
            await f.finish('Helper delegated.');
            expect(f.sends).toHaveLength(2);
            const child = f.tasks.get(result.processId.slice('queue_'.length))!;
            child.status = 'completed';
            await f.store.addProcess({ id: result.processId, type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'Helper', metadata: { workspaceId: 'workspace-b', mode: 'autopilot' } });
            jobs.recordResult('workspace-a', job.id, {
                terminalEventId: 'helper-completed', outcome: 'completed', summary: 'Helper finished.', links: [],
            });
            await notices.reconcile();
            expect(posted).toEqual([]);
            const completed = jobs.list('workspace-a')[0];
            await reviews.schedule(completed);
            const receipt = delegatedReviewReceipt(completed);
            const reviewTask = f.tasks.get(receipt)!;
            expect(reviewTask.payload.relayRequestId).toBe(receipt);
            expect(f.mirror.locateCapturedOrigin({
                workspaceId: 'workspace-a', processId: f.processId, requestId: receipt,
            })).toBeUndefined();
            await f.store.appendConversationTurn(f.processId, turnIndex => ({
                role: 'assistant', content: 'Reviewed helper result.', turnIndex, timestamp: new Date(), timeline: [],
            }));
            await f.store.updateProcess(f.processId, { status: 'completed' });
            reviewTask.status = 'completed';
            await reviews.schedule(jobs.list('workspace-a')[0]);
            await notices.reconcile();
            f.queue.emit('taskCompleted', reviewTask);
            f.queue.emit('taskCompleted', reviewTask);
            await f.mirror.flush();
            await notices.reconcile();
            notices.dispose();
            notices = new MessagingJobNotices({
                dataDir: f.directory, store: f.store, queue: f.queue, delegatedJobs: jobs, authorizeDesktopOrigin,
            });
            notices.register(transport);
            await notices.restore();
            await notices.reconcile();
            expect(posted).toEqual([{
                text: 'Reviewed helper result.', chatKey: user.destination.chatKey, threadId: user.destination.threadId,
            }]);
            expect(f.sends).toHaveLength(2);
            expect(f.mirror.outbox.list('workspace-a')).toHaveLength(2);
        } finally {
            reviews.dispose();
            notices.dispose();
        }
    });

    it.each(['user', 'assistant'] as const)(
        'holds early desktop review results behind delayed %s mirrors and wakes only their existing outbox', async role => {
            const f = await fixture(connector);
            let now = Date.now();
            vi.spyOn(Date, 'now').mockImplementation(() => now);
            if (role === 'user') f.setFailure(new WhatsAppNotConnectedError());
            await f.deliver('desktop delegation source');
            await f.mirror.flush();
            const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
            const origin = f.mirror.locateCapturedOrigin({
                workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
            })!;
            if (role === 'assistant') f.setFailure(new WhatsAppNotConnectedError());
            await f.finish('Original initial final response.');
            const source = () => f.mirror.outbox.list(user.workspaceId).filter(row =>
                row.processId === user.processId && row.requestId === user.requestId);
            expect(source().find(row => row.role === role)?.state).toBe('retryable');
            let connected = false;
            const post = vi.fn(async (_chatKey: string, notice: { body?: string }) => {
                expect(source()).toHaveLength(2);
                expect(source().every(row => row.state === 'delivered')).toBe(true);
                return `review-${notice.body}`;
            });
            const notices = new MessagingJobNotices({
                dataDir: f.directory, store: f.store, queue: f.queue,
                authorizeDesktopOrigin: (captured, parent) => f.mirror.authorizeCapturedOrigin(captured, parent),
            });
            notices.register({ platform: connector, connected: () => connected, post });
            const settled = vi.fn(() => notices.reconcile(undefined, true));
            f.setSourceSettled(settled);
            try {
                notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                    receiptId: 'early-parent-result', repo: 'Helper', title: 'Helper',
                    body: 'Early parent review.', status: 'completed' });
                notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId,
                    origin: { connector, chatKey: origin.chatKey, threadId: origin.threadId },
                    receiptId: 'legacy-parent-result', repo: 'Helper', title: 'Helper',
                    body: 'Legacy parent review.', status: 'completed' });
                await notices.reconcile();
                connected = true;
                await notices.reconcile(undefined, true);
                await f.mirror.flush();
                expect(post).not.toHaveBeenCalled();
                expect(settled).not.toHaveBeenCalled();
                f.setFailure(undefined);
                now = Math.max(now, ...source().map(row => row.nextAttemptAt ?? 0)) + 1;
                await f.mirror.flush();
                await f.mirror.flush();
                expect(post).toHaveBeenCalledTimes(1);
                expect(post.mock.calls[0][1].body).toBe('Early parent review.');
                expect(f.sends).toHaveLength(2);
                expect(settled).toHaveBeenCalled();
                await notices.reconcile();
                expect(post).toHaveBeenCalledTimes(2);
                expect(post.mock.calls[1][1].body).toBe('Legacy parent review.');
                await f.mirror.flush();
                await notices.reconcile();
                expect(post).toHaveBeenCalledTimes(2);
            } finally { notices.dispose(); }
        });

    it('rechecks a stale in-flight result readiness decision when the source final settles', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop delegation source');
        await f.mirror.flush();
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        let entered!: () => void;
        const checked = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let first = true;
        const post = vi.fn().mockResolvedValue('review-result');
        const authority = vi.fn(async (captured: Parameters<typeof f.mirror.authorizeCapturedOrigin>[0],
            parent?: { workspaceId: string; processId: string }) => {
            const decision = await f.mirror.authorizeCapturedOrigin(captured, parent);
            if (first) {
                first = false;
                expect(decision).toBe('wait');
                entered();
                await gate;
            }
            return decision;
        });
        const notices = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
        });
        notices.register({ platform: connector, connected: () => true, post });
        f.setSourceSettled(async () => {
            release();
            await notices.reconcile(undefined, true);
        });
        try {
            notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                receiptId: 'early-parent-result', repo: 'Helper', title: 'Helper',
                body: 'Early parent review.', status: 'completed' });
            await checked;
            expect(post).not.toHaveBeenCalled();
            await f.finish('Original initial final response.');
            expect(authority).toHaveBeenCalledTimes(2);
            expect(post).toHaveBeenCalledTimes(1);
            expect(f.sends).toHaveLength(2);
        } finally { release(); notices.dispose(); }
    });

    it.each(['offline', 'unknown-user', 'unknown-assistant-part'] as const)(
        'retains an early desktop review result through %s, restart and disabled mirroring', async delay => {
            const f = await fixture(connector);
            if (delay === 'offline') f.setConnected(false);
            if (delay === 'unknown-user') f.setFailure(new Error('Private unknown-send detail'));
            await f.deliver('desktop source request');
            await f.mirror.flush();
            const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
            const origin = f.mirror.locateCapturedOrigin({
                workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
            })!;
            if (delay === 'unknown-assistant-part') {
                f.send.mockImplementation(async (text, threadId) => {
                    f.sends.push({ text, threadId, chatKey: user.destination.chatKey });
                    if (f.sends.length === 3) throw new Error('Private second-part receipt loss');
                    return `source-${f.sends.length}`;
                });
            }
            await f.finish('Original initial final response.\n'.repeat(delay === 'unknown-assistant-part' ? 2000 : 1));
            const post = vi.fn().mockResolvedValue('review-result');
            const deps = { dataDir: f.directory, store: f.store, queue: f.queue,
                authorizeDesktopOrigin: (captured: Parameters<typeof f.mirror.authorizeCapturedOrigin>[0],
                    parent?: { workspaceId: string; processId: string }) => f.mirror.authorizeCapturedOrigin(captured, parent) };
            let notices = new MessagingJobNotices(deps);
            notices.register({ platform: connector, connected: () => true, post });
            f.setSourceSettled(() => notices.reconcile(undefined, true));
            try {
                notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                    receiptId: 'early-parent-result', repo: 'Helper', title: 'Helper',
                    body: 'Early parent review.', status: 'completed' });
                await notices.reconcile();
                expect(post).not.toHaveBeenCalled();
                if (delay === 'unknown-assistant-part') {
                    const assistant = f.mirror.outbox.list(user.workspaceId).find(row => row.role === 'assistant')!;
                    expect(assistant.state).toBe('ambiguous');
                    expect(assistant.nextPart).toBe(1);
                    expect(assistant.attemptedPartCount).toBe(2);
                    expect(assistant.chunks.length).toBeGreaterThan(2);
                }
                const sent = f.sends.length;
                notices.dispose();
                f.setEnabled(false);
                f.setFailure(undefined);
                f.setConnected(true);
                await f.restart();
                notices = new MessagingJobNotices(deps);
                notices.register({ platform: connector, connected: () => true, post });
                await notices.restore();
                await notices.reconcile();
                expect(post).not.toHaveBeenCalled();
                expect(f.sends).toHaveLength(sent);
                f.setEnabled(true);
                await f.mirror.flush();
                await f.mirror.flush();
                if (delay === 'offline') {
                    expect(post).toHaveBeenCalledTimes(1);
                    expect(f.sends).toHaveLength(2);
                } else {
                    expect(post).not.toHaveBeenCalled();
                    expect(f.sends).toHaveLength(sent);
                    const pending = JSON.parse(fs.readFileSync(
                        getRepoDataPath(f.directory, user.workspaceId, 'messaging-job-notices.json'), 'utf8'));
                    expect(pending[0].pending).toHaveLength(1);
                    expect(pending[0].resultAttemptedPartCount ?? 0).toBe(0);
                }
            } finally { notices.dispose(); }
        });

    it.each(['account', 'binding', 'replacement', 'deleted-parent', 'foreign-parent', 'cancelled-parent',
        'cancelled-request', 'foreign-result-workspace', 'foreign-result-process', 'forged-binding'] as const)(
        'suppresses captured desktop parent results after %s even across notice restart', async change => {
            const f = await fixture(connector);
            await f.deliver('desktop handoff');
            const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
            const origin = f.mirror.locateCapturedOrigin({
                workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
            })!;
            await f.finish('Delegated helper.');
            f.setConnected(false);
            const authority = f.mirror.authorizeCapturedOrigin.bind(f.mirror);
            const post = vi.fn().mockResolvedValue('result-message');
            let notices = new MessagingJobNotices({
                dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
            });
            notices.register({ platform: connector, connected: () => true, post });
            const result = {
                workspaceId: change === 'foreign-result-workspace' ? 'workspace-b' : user.workspaceId,
                processId: change === 'foreign-result-process' ? 'other-parent' : user.processId,
                origin, receiptId: 'parent-result', repo: 'Helper', title: 'Helper',
                body: 'Private parent review.', status: 'completed' as const,
            };
            if (change === 'forged-binding') origin.desktopMirror!.bindingId = 'foreign-pin';
            notices.queueResult(result);
            await notices.reconcile();
            notices.dispose();
            f.setEnabled(false); // Existing pinned results cannot bypass authority when mirroring is disabled.
            if (change === 'account') f.setAccount('replacement-account');
            if (change === 'binding') f.setBinding(false);
            if (change === 'replacement') f.adapter.destinations = () => [{ ...user.destination, bindingId: 'new-binding' }];
            if (change === 'deleted-parent') await f.store.removeProcess(user.processId, user.workspaceId);
            if (change === 'foreign-parent') await f.store.updateProcess(user.processId, { metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } });
            if (change === 'cancelled-parent') await f.store.updateProcess(user.processId, { status: 'cancelled' });
            if (change === 'cancelled-request') {
                [...f.tasks.values()].find(task => task.payload.relayRequestId === user.requestId)!.status = 'cancelled';
            }
            f.setConnected(true);
            notices = new MessagingJobNotices({
                dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
            });
            notices.register({ platform: connector, connected: () => true, post });
            try {
                await notices.restore();
                await notices.reconcile();
                expect(post).not.toHaveBeenCalled();
                expect(f.sends).toHaveLength(2);
            } finally { notices.dispose(); }
        });

    it('retains the private pin across result outbox restart and retry reconnect without requiring the feature to remain enabled', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop handoff');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        await f.finish('Delegated helper.');
        f.setConnected(false);
        const authority = f.mirror.authorizeCapturedOrigin.bind(f.mirror);
        const post = vi.fn().mockResolvedValue('parent-result-message');
        let notices = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
        });
        notices.register({ platform: connector, connected: () => true, post });
        notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
            receiptId: 'parent-result', repo: 'Helper', title: 'Helper', body: 'Parent review.', status: 'completed' });
        await notices.reconcile();
        expect(post).not.toHaveBeenCalled();
        notices.dispose();
        f.setEnabled(false);
        f.setConnected(true);
        notices = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
        });
        notices.register({ platform: connector, connected: () => true, post });
        try {
            await notices.restore();
            await notices.reconcile();
            expect(post).toHaveBeenCalledTimes(1);
            expect(post.mock.calls[0][1]).not.toHaveProperty('desktopMirror');
            expect(post.mock.calls[0][1]).not.toHaveProperty('origin');
            expect(post.mock.calls[0][1].beforeSend).toBeTypeOf('function');
        } finally { notices.dispose(); }
    });

    it.each(['account', 'binding', 'deleted-parent', 'foreign-parent'] as const)(
        'rechecks captured %s authority before every real connector result part', async change => {
        const f = await fixture(connector);
        await f.deliver('desktop handoff');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        await f.finish('Delegated helper.');
        f.sends.splice(0);
        const send = f.send.getMockImplementation()!;
        f.send.mockImplementationOnce(async (text, threadId) => {
            const id = await send(text, threadId);
            if (change === 'account') f.setAccount('replacement-account');
            if (change === 'binding') f.setBinding(false);
            if (change === 'deleted-parent') await f.store.removeProcess(user.processId, user.workspaceId);
            if (change === 'foreign-parent') await f.store.updateProcess(user.processId, { metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } });
            return id;
        });

        const transport = connector === 'teams' ? f.relay!.noticeTransport()
            : createWhatsAppNoticeTransport({
                bindings: f.bindings, connected: () => true, groupJid: () => user.destination.chatKey,
                send: text => f.send(text),
            });
        const notices = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue,
            authorizeDesktopOrigin: f.mirror.authorizeCapturedOrigin.bind(f.mirror),
        });
        notices.register(transport);
        try {
            notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                receiptId: 'multipart-result', repo: 'Helper', title: 'Helper',
                body: 'Large parent result.\n'.repeat(2000), status: 'completed' });
            await notices.reconcile();
            await notices.reconcile();
            expect(f.sends).toHaveLength(1);
            expect(f.sends[0].text).not.toContain(user.destination.bindingId);
        } finally { notices.dispose(); }
    });

    it('does not dispatch a desktop result before durable part evidence can be stored and retries safely after repair', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop result delegation');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        await f.finish('Delegated helper.');
        f.sends.splice(0);
        const transport = connector === 'teams' ? f.relay!.noticeTransport()
            : createWhatsAppNoticeTransport({
                bindings: f.bindings, connected: () => true, groupJid: () => user.destination.chatKey,
                send: (text, root) => f.send(text, root),
            });
        const notices = new MessagingJobNotices({ dataDir: f.directory, store: f.store, queue: f.queue,
            authorizeDesktopOrigin: f.mirror.authorizeCapturedOrigin.bind(f.mirror) });
        notices.register(transport);
        const write = vi.mocked(fs.writeFileSync);
        const originalWrite = write.getMockImplementation()!;
        let fail = true;
        write.mockImplementation((file, data, options) => {
            if (fail && String(file).includes('messaging-job-notices')
                && /"resultAttemptedPartCount"\s*:\s*1/.test(String(data))) throw new Error('Private disk diagnostic');
            return originalWrite(file, data, options);
        });
        try {
            notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                receiptId: 'parent-result', repo: 'Helper', title: 'Helper',
                body: 'Durable parent review.', status: 'completed' });
            await notices.reconcile();
            expect(f.sends).toEqual([]);
            const result = JSON.parse(fs.readFileSync(
                getRepoDataPath(f.directory, user.workspaceId, 'messaging-job-notices.json'), 'utf8'))[0];
            expect(result.pending).toHaveLength(1);
            expect(result.resultAttemptedPartCount ?? 0).toBe(0);
            fail = false;
            await notices.reconcile();
            await notices.reconcile();
            expect(f.sends).toHaveLength(1);
        } finally { write.mockImplementation(originalWrite); notices.dispose(); }
    });

    it.each([1, 2])('rejects a lost-receipt desktop result part %s as an own echo across restart without filtering unknown/future markers', async lostPart => {
        const f = await fixture(connector);
        await f.deliver('desktop result delegation');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        await f.finish('Delegated helper.');
        f.sends.splice(0);
        f.send.mockImplementation(async (text, threadId) => {
            f.sends.push({ text, threadId, chatKey: user.destination.chatKey });
            if (f.sends.length === lostPart) throw new Error('Result posted but its receipt was lost');
            return `result-${f.sends.length}`;
        });
        const transport = connector === 'teams' ? f.relay!.noticeTransport()
            : createWhatsAppNoticeTransport({
                bindings: f.bindings, connected: () => true, groupJid: () => user.destination.chatKey,
                send: (text, root) => f.send(text, root),
            });
        const deps = { dataDir: f.directory, store: f.store, queue: f.queue,
            authorizeDesktopOrigin: f.mirror.authorizeCapturedOrigin.bind(f.mirror) };
        let notices = new MessagingJobNotices(deps);
        notices.register(transport);
        const receiptId = `delegated-review-${'a'.repeat(64)}`;
        try {
            notices.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
                receiptId, repo: 'Helper', title: 'Helper', status: 'completed',
                body: `\`\`\`text\n${'<&> 😀\n'.repeat(3000)}` });
            await notices.reconcile();
            expect(f.sends).toHaveLength(lostPart);
            const ledger = JSON.parse(fs.readFileSync(
                getRepoDataPath(f.directory, user.workspaceId, 'messaging-job-notices.json'), 'utf8'));
            const result = ledger.find((row: { taskId: string }) => row.taskId === receiptId);
            expect(result.resultAttemptedPartCount).toBe(lostPart);
            expect(result.resultChunks.length).toBeGreaterThan(lostPart);
            expect(result.resultChunks.every((chunk: string) => chunk.includes(receiptId)
                && chunk.includes('Desktop result'))).toBe(true);
            const project = (text: string) => connector === 'teams' ? decodeGraphHtmlEntities(formatTeamsOutbound(text, 'html')
                .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')) : text;
            const echo = { connector, workspaceId: user.workspaceId, processId: user.processId,
                chatKey: user.destination.chatKey, threadId: user.destination.threadId,
                text: project(f.sends[lostPart - 1].text), accountKey: 'account-pin', isSelf: true };
            expect(await notices.isOwnDesktopResultMessage(echo)).toBe(true);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, workspaceId: 'workspace-b' })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, processId: 'foreign-parent' })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, chatKey: 'foreign-destination' })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, threadId: 'foreign-thread' })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, accountKey: 'foreign-account' })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, isSelf: false })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, text: echo.text.replace(receiptId, 'unrecognized-receipt') })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, text: `${echo.text} Human amendment` })).toBe(false);
            expect(await notices.isOwnDesktopResultMessage({ ...echo, text: project(result.resultChunks[lostPart]) })).toBe(false);
            await expect(notices.isOwnDesktopResultMessage({ ...echo, accountKey: undefined })).rejects.toThrow('Message admission is paused');
            notices.dispose();
            f.setBinding(false);
            f.setEnabled(false);
            notices = new MessagingJobNotices(deps);
            notices.register(transport);
            await notices.restore();
            expect(await notices.isOwnDesktopResultMessage(echo)).toBe(true);
            expect(f.sends).toHaveLength(lostPart);
            const enqueue = vi.fn(async () => 'inbound-task');
            const send = vi.fn(async () => 'inbound-reply');
            const react = vi.fn(async () => {});
            const observe = vi.fn();
            if (connector === 'whatsapp') {
                const router = new WhatsAppCommandRouter({
                    store: f.store, bindings: f.bindings, groupJid: () => user.destination.chatKey,
                    enqueue, getTask: f.queue.getTask, send, react,
                    isOwnMirrorMessage: message => message.fromMe && notices.isOwnDesktopResultMessage({
                        ...echo, chatKey: message.chatJid, threadId: message.quotedMessageId, text: message.text,
                    }),
                });
                try {
                    await router.handle({ messageId: 'lost-result-echo', chatJid: user.destination.chatKey,
                        senderJid: 'paired-account', fromMe: true, text: echo.text, quotedMessageId: echo.threadId });
                } finally { router.dispose(); }
            } else {
                const manager = new TeamsMessagingManager(f.directory);
                let inbound!: Parameters<TeamsMessagingManager['setMessageHandler']>[0];
                vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { inbound = handler; });
                vi.spyOn(manager, 'getStatus').mockReturnValue({
                    ...manager.getStatus(), enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
                });
                vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account-pin');
                vi.spyOn(manager, 'isMirrorSender').mockReturnValue(true);
                vi.spyOn(manager, 'reactToChannelMessage').mockImplementation(react);
                registerTeamsMessagingRoutes([], {
                    dataDir: f.directory, store: f.store, manager, enqueueChat: enqueue,
                    executeFollowUp: vi.fn(),
                    getMessageReactionEnabled: () => true,
                    isOwnMirrorMessage: (message, teamId, accountKey, isSelf) => notices.isOwnDesktopResultMessage({
                        connector, chatKey: `${teamId}\0${message.channelId}`, threadId: message.replyToMessageId,
                        text: message.text, accountKey, isSelf,
                    }),
                });
                try {
                    await inbound({ messageId: 'lost-result-echo', channelId: 'channel',
                        replyToMessageId: echo.threadId, senderAadId: 'synthetic-sender', text: echo.text }, observe);
                } finally { manager.dispose(); }
            }
            expect(enqueue).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            expect(react).not.toHaveBeenCalled();
            expect(observe).not.toHaveBeenCalled();
        } finally { notices.dispose(); }
    });

    it('stops a disposed notice worker waiting on authority without racing the restored result outbox', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop handoff');
        const user = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
        const origin = f.mirror.locateCapturedOrigin({
            workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
        })!;
        await f.finish('Delegated helper.');
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const authority = vi.fn(async () => { await gate; return 'ready' as const; });
        const post = vi.fn().mockResolvedValue('result-message');
        const old = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue, authorizeDesktopOrigin: authority,
        });
        old.register({ platform: connector, connected: () => true, post });
        old.queueResult({ workspaceId: user.workspaceId, processId: user.processId, origin,
            receiptId: 'parent-result', repo: 'Helper', title: 'Helper', body: 'Reviewed result.', status: 'completed' });
        const pending = old.reconcile();
        await vi.waitFor(() => expect(authority).toHaveBeenCalled());
        old.dispose();
        const restarted = new MessagingJobNotices({
            dataDir: f.directory, store: f.store, queue: f.queue,
            authorizeDesktopOrigin: f.mirror.authorizeCapturedOrigin.bind(f.mirror),
        });
        restarted.register({ platform: connector, connected: () => true, post });
        try {
            await restarted.restore();
            release();
            await pending;
            await restarted.reconcile();
            expect(post).toHaveBeenCalledTimes(1);
        } finally { release(); old.dispose(); restarted.dispose(); }
    });

    it('uses the same full logical request label on buffered users and their corresponding final answers', async () => {
        const f = await fixture(connector);
        await f.deliver('first labeled desktop request');
        const second = await f.deliver('second labeled buffered request');
        expect(second.path).toBe('buffered');
        await f.mirror.flush();
        await f.mirror.flush();
        const users = f.mirror.outbox.list('workspace-a').filter(row => row.role === 'user');
        expect(users).toHaveLength(2);
        await f.finish('first labeled final answer');
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages!
            .find(message => message.relayRequestId === users[1].requestId)!;
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.store.removePendingMessage(f.processId, pending.id!);
        await f.finish('second labeled final answer');
        expect(f.sends).toHaveLength(4);
        for (const user of users) {
            const answer = f.mirror.outbox.list('workspace-a').find(row =>
                row.role === 'assistant' && row.processId === user.processId && row.requestId === user.requestId)!;
            expect(answer.eventId).not.toBe(user.eventId);
            for (const row of [user, answer]) {
                expect(row.chunks.every(chunk => chunk.includes(`Request ${user.requestId}`))).toBe(true);
                expect(row.chunks.every(chunk => chunk.includes(`Desktop ${row.role}`))).toBe(true);
                expect(row.chunks.some(chunk => chunk.includes(row.eventId))).toBe(false);
            }
        }
    });

    it('matches logical request, role, part and exact captured owner/destination rather than a truncated or bare marker', async () => {
        const f = await fixture(connector);
        const requestId = 'shared-prefix-full-server-request-one';
        const entry = (await f.mirror.capture('workspace-a', f.processId, 'owned body', 0, requestId))!;
        f.mirror.outbox.accept(entry.workspaceId, entry.eventId);
        const chunks = f.adapter.format(entry);
        f.mirror.outbox.prepare(entry.workspaceId, entry.eventId, chunks);
        const attempt = f.mirror.outbox.beginPart(entry.workspaceId, entry.eventId)!;
        f.mirror.outbox.failPart(entry.workspaceId, entry.eventId, attempt, 'unknown', 0);
        const text = connector === 'teams' ? formatTeamsOutbound(chunks[0], 'html') : chunks[0];
        const echo = { connector, workspaceId: entry.workspaceId, processId: entry.processId,
            chatKey: entry.destination.chatKey, threadId: entry.destination.threadId,
            accountKey: 'account-pin', isSelf: true, text };
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, processId: 'queue_other-process' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, workspaceId: 'workspace-b' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: text.replace(requestId, requestId.slice(0, 10)) })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo,
            text: text.replace(requestId, 'shared-prefix-full-server-request-two') })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: text.replace('Desktop user', 'Desktop assistant') })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: text.replace('Part 1/1', 'Part 2/2') })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: text.replace('Part 1/1', 'Part 2/1') })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo,
            text: text.replace('Part 1/1', 'Part 999999999999999999999/999999999999999999999') })).toBe(false);
        if (connector === 'teams') {
            const flat = decodeGraphHtmlEntities(text.replace(/<[^>]*>/g, ''));
            expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: flat })).toBe(true);
        }
    });

    it('wires the real adapter/manager binding readiness gate into capture', async () => {
        const f = await fixture(connector);
        let entered!: () => void;
        let release!: () => void;
        const begun = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const ready = async () => { entered(); await gate; };
        let adapter;
        const manager = connector === 'whatsapp' ? new WhatsAppMessagingManager(f.directory) : new TeamsMessagingManager(f.directory);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            ...manager.getStatus(), enabled: true, status: 'connected',
            ...(connector === 'whatsapp' ? { groupJid: 'bound@g.us' } : { teamId: 'team', channelId: 'channel' }),
        } as ReturnType<typeof manager.getStatus>);
        vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account-pin');
        if (manager instanceof TeamsMessagingManager) {
            manager.setAnswerRelay(f.relay!, undefined, () => true, ready);
            adapter = createTeamsMirrorAdapter(manager);
        } else {
            adapter = createWhatsAppMirrorAdapter(manager, f.bindings, ready);
        }
        const mirror = new SentinelMirrorService({
            dataDir: f.directory, store: f.store, queue: f.queue, enabled: () => true, adapters: [adapter],
        });
        let completed = false;
        const capture = mirror.capture('workspace-a', f.processId, 'adapter readiness before admission')
            .then(entry => { completed = true; return entry; });
        try {
            await begun;
            expect(completed).toBe(false);
            expect(mirror.outbox.list('workspace-a')).toHaveLength(0);
            release();
            const entry = await capture;
            expect(entry).toBeDefined();
            await mirror.rejected(entry!);
        } finally {
            release();
            mirror.dispose();
            manager.dispose();
        }
    });

    it('awaits authoritative receipt hydration before the first connected admission rather than treating empty maps as unbound', async () => {
        const f = await fixture(connector);
        let release!: () => void;
        let entered!: () => void;
        let hydrated = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const begun = new Promise<void>(resolve => { entered = resolve; });
        const destinations = f.adapter.destinations;
        const lookup = vi.spyOn(f.adapter, 'destinations').mockImplementation(owner => hydrated ? destinations(owner) : []);
        f.adapter.ready = async () => {
            entered();
            await gate;
            hydrated = true;
        };
        const delivery = f.deliver('first desktop request during binding hydration');
        await begun;
        expect(lookup).not.toHaveBeenCalled();
        expect(f.bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        release();
        await delivery;
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('first desktop request during binding hydration');
    });

    it('fails binding readiness visibly before admission, retries after repair, and preserves flag-off behavior', async () => {
        const f = await fixture(connector);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ready = vi.fn().mockRejectedValue(new Error('private binding restore diagnostic'));
        f.adapter.ready = ready;
        await expect(f.deliver('bound request cannot silently lose mirroring')).rejects.toThrow('The submission was not accepted.');
        expect(f.bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        expect(log.mock.calls.flat().join(' ')).not.toContain('private');
        f.setEnabled(false);
        await f.deliver('disabled request still admits without binding hydration');
        expect(ready).toHaveBeenCalledTimes(1);
        ready.mockResolvedValue(undefined);
        f.setEnabled(true);
        await f.deliver('new request after binding restore repair');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('new request after binding restore repair');
        expect(f.sends[0].text).not.toContain('disabled request');
    });

    it('rechecks ownership after delayed binding readiness rather than using an earlier process snapshot', async () => {
        const f = await fixture(connector);
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const begun = new Promise<void>(resolve => { entered = resolve; });
        f.adapter.ready = async () => { entered(); await gate; };
        const capture = f.mirror.capture('workspace-a', f.processId, 'owner removed during receipt hydration');
        await begun;
        await f.store.removeProcess(f.processId);
        release();
        expect(await capture).toBeUndefined();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
    });

    it.each(['prepare', 'begin', 'acknowledge', 'acknowledge-and-quarantine', 'fail'] as const)('visibly pauses accepted work on %s receipt write failure without unsafe dispatch or replay', async phase => {
        const f = await fixture(connector);
        f.setConnected(false);
        await f.deliver('accepted durable request before write failure');
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        const write = vi.mocked(fs.writeFileSync).getMockImplementation()!;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        let failing = true;
        vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
            if (failing && String(file).includes('sentinel-mirror-outbox.json')) {
                const rows = JSON.parse(String(data)) as Array<typeof row>;
                const candidate = rows.find(entry => entry.eventId === row.eventId)!;
                const selected = phase === 'prepare' ? candidate.state === 'pending' && candidate.chunks.length > 0
                    : phase === 'begin' ? candidate.state === 'sending'
                        : phase === 'acknowledge' ? candidate.nextPart === 1
                            : phase === 'acknowledge-and-quarantine' ? candidate.nextPart === 1 || candidate.state === 'ambiguous'
                                : candidate.state === 'ambiguous';
                if (selected) throw new Error('private durable receipt storage diagnostic');
            }
            return write(file, data, options);
        });
        if (phase === 'fail') f.send.mockImplementation(async (text, threadId) => {
            f.sends.push({ text, threadId, chatKey: row.destination.chatKey });
            throw new Error('private unknown transport diagnostic');
        });
        try {
            f.setConnected(true);
            await f.mirror.flush();
            await f.mirror.flush();
            const notices = (await f.store.getProcess(f.processId))!.conversationTurns!.filter(turn =>
                turn.relayRequestId === `sentinel-mirror-storage:${row.eventId}`);
            expect(notices).toHaveLength(1);
            expect(notices[0]).toMatchObject({
                displayOnly: true,
                content: 'Sentinel mirror: durable receipt storage is unavailable. Accepted work is retained for reconciliation; delivery is paused.',
            });
            expect(log.mock.calls.flat().join(' ')).not.toContain('private');
            const attempted = phase === 'acknowledge' || phase === 'acknowledge-and-quarantine' || phase === 'fail';
            expect(f.send).toHaveBeenCalledTimes(attempted ? 1 : 0);
            expect(f.sends).toHaveLength(attempted ? 1 : 0);
            await f.deliver('later same destination must not overtake');
            await f.mirror.flush();
            expect(f.send).toHaveBeenCalledTimes(attempted ? 1 : 0);
            failing = false;
            await f.mirror.flush();
            if (attempted) {
                expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('ambiguous');
                await f.restart();
                await f.mirror.flush();
                expect(f.send).toHaveBeenCalledTimes(1);
                expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('ambiguous');
                expect(f.mirror.outbox.list('workspace-a')[1].state).toBe('pending');
                expect(await f.mirror.isOwnMirrorMessage({
                    connector, chatKey: row.destination.chatKey, threadId: row.destination.threadId,
                    accountKey: 'account-pin', isSelf: true,
                    text: connector === 'teams' ? formatTeamsOutbound(f.sends[0].text, 'html') : f.sends[0].text,
                })).toBe(true);
            } else {
                await f.mirror.flush();
                expect(f.sends).toHaveLength(2);
                expect(f.sends[0].text).toContain('accepted durable request before write failure');
                expect(f.sends[1].text).toContain('later same destination must not overtake');
                await f.restart();
                expect(f.sends).toHaveLength(2);
            }
            expect((await f.store.getProcess(f.processId))!.conversationTurns!.filter(turn =>
                turn.relayRequestId === `sentinel-mirror-storage:${row.eventId}`)).toHaveLength(1);
        } finally {
            vi.mocked(fs.writeFileSync).mockImplementation(write);
        }
    });

    it('visibly reports known-owner receipt registration failure during restart without replaying delivered output', async () => {
        const f = await fixture(connector);
        await f.deliver('already delivered before receipt restore failure');
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        const record = vi.spyOn(f.adapter, 'record').mockImplementation(() => {
            throw new Error('private restored receipt diagnostic');
        });
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await f.restart();
        await f.mirror.flush();
        expect((await f.store.getProcess(f.processId))!.conversationTurns!.filter(turn =>
            turn.relayRequestId === `sentinel-mirror-storage:${row.eventId}`)).toHaveLength(1);
        expect(f.sends).toHaveLength(1);
        expect(log.mock.calls.flat().join(' ')).not.toContain('private');
        record.mockRestore();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
    });

    it('reports recover-write failure for its trusted sending row while preserving uncertainty and blocking admission', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        await f.deliver('accepted before recover-write failure');
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        f.mirror.outbox.prepare(row.workspaceId, row.eventId, f.adapter.format(row));
        f.mirror.outbox.beginPart(row.workspaceId, row.eventId);
        const write = vi.mocked(fs.writeFileSync).getMockImplementation()!;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        let failing = true;
        vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
            if (failing && String(file).includes('sentinel-mirror-outbox.json')
                && (JSON.parse(String(data)) as Array<typeof row>).some(entry =>
                    entry.eventId === row.eventId && entry.state === 'ambiguous')) {
                throw new Error('private recovered state write diagnostic');
            }
            return write(file, data, options);
        });
        try {
            f.setConnected(true);
            await f.restart();
            expect((await f.store.getProcess(f.processId))!.conversationTurns!.filter(turn =>
                turn.relayRequestId === `sentinel-mirror-storage:${row.eventId}`)).toHaveLength(1);
            await expect(f.deliver('unseeded admission must remain blocked')).rejects.toThrow('The submission was not accepted.');
            expect(f.sends).toHaveLength(0);
            expect(log.mock.calls.flat().join(' ')).not.toContain('private');
            failing = false;
            await f.mirror.flush();
            expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('ambiguous');
            expect(f.sends).toHaveLength(0);
        } finally {
            vi.mocked(fs.writeFileSync).mockImplementation(write);
        }
    });

    it.each(['queued', 'running', 'completed'] as const)('never sends to a deleted owner using stale receipts and %s request history', async status => {
        const f = await fixture(connector);
        f.setConnected(false);
        const result = await f.deliver('deleted owner must not send');
        await f.mirror.flush();
        f.tasks.get(result.taskId!)!.status = status;
        await f.store.removeProcess(f.processId);
        f.setConnected(true);
        await f.mirror.flush();
        await f.restart();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('unbound');
    });

    it('rechecks deleted ownership after the final awaited read before sending', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        await f.deliver('removed during worker read');
        await f.mirror.flush();
        const read = f.store.getProcess.bind(f.store);
        let reads = 0;
        vi.spyOn(f.store, 'getProcess').mockImplementation(async (...args) => {
            if (++reads === 2) await f.store.removeProcess(f.processId);
            return read(...args);
        });
        f.setConnected(true);
        await f.mirror.flush();
        expect(reads).toBeGreaterThanOrEqual(2);
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('unbound');
    });

    it('never sends a captured assistant answer after its owning process is deleted', async () => {
        const f = await fixture(connector);
        await f.deliver('user before owner deletion');
        await f.mirror.flush();
        f.setConnected(false);
        await f.finish('deleted owner final answer');
        expect(f.mirror.outbox.list('workspace-a').find(row => row.role === 'assistant')?.state).toBe('pending');
        await f.store.removeProcess(f.processId);
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a').find(row => row.role === 'assistant')?.failure).toBe('unbound');
    });

    it.each(['queued', 'running'] as const)('preserves a bound queued initial owner with an admitted %s mirror request', async status => {
        const f = await fixture(connector);
        await queuedOwnerWithoutProcess(f);
        const input: CreateTaskInput = {
            type: 'chat', repoId: 'workspace-a', processId: f.processId,
            payload: { kind: 'chat', mode: 'sentinel', processId: f.processId,
                workspaceId: 'workspace-a', prompt: 'desktop accepted before initial execution' },
        };
        const entry = (await f.mirror.captureTask(input))!;
        expect(entry).toBeDefined();
        const id = await f.bridge.enqueueAdmitted(input);
        f.tasks.get(id)!.status = status;
        f.mirror.accepted(entry);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('desktop accepted before initial execution');
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
    });

    it.each(['unadmitted', 'running-owner', 'completed-owner', 'foreign-owner'] as const)('rejects missing process send authority from %s', async reason => {
        const f = await fixture(connector);
        f.setConnected(false);
        const original = await queuedOwnerWithoutProcess(f);
        const input: CreateTaskInput = {
            type: 'chat', repoId: 'workspace-a', processId: f.processId,
            payload: { kind: 'chat', mode: 'sentinel', processId: f.processId,
                workspaceId: 'workspace-a', prompt: 'unconfirmed missing process authority' },
        };
        const entry = (await f.mirror.captureTask(input))!;
        if (reason !== 'unadmitted') await f.bridge.enqueueAdmitted(input);
        if (reason === 'running-owner') original.status = 'running';
        if (reason === 'completed-owner') original.status = 'completed';
        if (reason === 'foreign-owner') original.payload.workspaceId = 'workspace-b';
        f.mirror.accepted(entry);
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('unbound');
        if (reason !== 'unadmitted') expect(await f.mirror.captureTask(input)).toBeUndefined();
    });

    it('filters an exact posted mirror echo without a returned ID before routing and across restart', async () => {
        const f = await fixture(connector);
        f.send.mockImplementationOnce(async (text, threadId) => {
            f.sends.push({ text, threadId, chatKey: connector === 'whatsapp' ? 'bound@g.us' : 'team\0channel' });
            throw new Error('send posted but receipt was lost');
        });
        await f.deliver('mirror body with <literal> & entities');
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        expect(row.state).toBe('ambiguous');
        expect(row.outboundIds).toHaveLength(0);
        expect(f.outbound.size).toBe(0);
        const posted = f.sends[0].text;
        const text = connector === 'teams'
            ? decodeGraphHtmlEntities(formatTeamsOutbound(posted, 'html')
                .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, ''))
            : posted;
        const echo = { connector, chatKey: row.destination.chatKey, threadId: row.destination.threadId,
            text, accountKey: 'account-pin', isSelf: true };
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        await f.restart();
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, workspaceId: 'workspace-b' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, isSelf: false })).toBe(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(f.mirror.isOwnMirrorMessage({ ...echo, isSelf: undefined })).rejects.toThrow('Message admission is paused.');
        await expect(f.mirror.isOwnMirrorMessage({ ...echo, accountKey: undefined })).rejects.toThrow('Message admission is paused.');
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, chatKey: 'another-destination' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, threadId: 'another-thread' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, accountKey: 'another-account' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: text.replace(row.requestId, 'unrecognized-request') })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: `${text}\nHuman amendment` })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, text: 'CoC · Desktop user · arbitrary human text' })).toBe(false);
        const enqueue = vi.fn(async () => 'inbound-task');
        const send = vi.fn(async () => 'inbound-reply');
        const react = vi.fn(async () => {});
        const followUp = vi.fn(async () => {});
        const observe = vi.fn();
        if (connector === 'whatsapp') {
            const router = new WhatsAppCommandRouter({
                store: f.store, bindings: f.bindings, groupJid: () => 'bound@g.us',
                enqueue, getTask: f.queue.getTask, send, react,
                isOwnMirrorMessage: message => message.fromMe && f.mirror.isOwnMirrorMessage({
                    ...echo, chatKey: message.chatJid, threadId: message.quotedMessageId, text: message.text,
                }),
            });
            try {
                await router.handle({ messageId: 'lost-receipt-echo', chatJid: 'bound@g.us',
                    senderJid: 'paired-account', fromMe: true, text, quotedMessageId: row.destination.threadId });
            } finally { router.dispose(); }
        } else {
            const router = new TeamsCommandRouter({
                store: f.store, dataDir: f.directory, enqueueChat: enqueue, executeFollowUp: followUp,
                sendReply: async () => { await send(); },
                isOwnMirrorMessage: message => f.mirror.isOwnMirrorMessage({
                    ...echo, chatKey: `team\0${message.channelId}`, threadId: message.replyToMessageId, text: message.text,
                }),
            });
            try {
                await router.handle({ messageId: 'lost-receipt-echo', channelId: 'channel',
                    replyToMessageId: row.destination.threadId, senderAadId: 'synthetic-sender', text }, observe);
            } finally { router.stop(); }
            const manager = new TeamsMessagingManager(f.directory);
            let inbound!: Parameters<TeamsMessagingManager['setMessageHandler']>[0];
            vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { inbound = handler; });
            vi.spyOn(manager, 'getStatus').mockReturnValue({
                ...manager.getStatus(), enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            });
            vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account-pin');
            vi.spyOn(manager, 'isMirrorSender').mockReturnValue(true);
            vi.spyOn(manager, 'reactToChannelMessage').mockImplementation(react);
            registerTeamsMessagingRoutes([], {
                dataDir: f.directory, store: f.store, manager, enqueueChat: enqueue, executeFollowUp: followUp,
                getMessageReactionEnabled: () => true,
                isOwnMirrorMessage: (message, teamId, accountKey, isSelf) => f.mirror.isOwnMirrorMessage({
                    connector, chatKey: `${teamId}\0${message.channelId}`, threadId: message.replyToMessageId,
                    text: message.text, accountKey, isSelf,
                }),
            });
            try {
                await inbound({ messageId: 'lost-receipt-echo', channelId: 'channel',
                    replyToMessageId: row.destination.threadId, senderAadId: 'synthetic-sender', text }, observe);
            } finally { manager.dispose(); }
        }
        expect(enqueue).not.toHaveBeenCalled();
        expect(followUp).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(react).not.toHaveBeenCalled();
        expect(observe).not.toHaveBeenCalled();
    });

    it.each(['request', 'disconnect'] as const)('retains lost-receipt echo authority after %s cancellation and restart', async reason => {
        const f = await fixture(connector);
        f.send.mockImplementationOnce(async (text, threadId) => {
            f.sends.push({ text, threadId, chatKey: connector === 'whatsapp' ? 'bound@g.us' : 'team\0channel' });
            throw new Error('posted without a returned receipt');
        });
        await f.deliver('posted mirror must not reenter admission');
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        expect(row.state).toBe('ambiguous');
        if (reason === 'request') await f.mirror.cancelRequest(row.workspaceId, row.processId, row.requestId);
        else await f.mirror.cancelConnector(connector);
        await f.mirror.flush();
        expect(f.mirror.outbox.list(row.workspaceId)[0].state).toBe('cancelled');
        const echo = {
            connector, chatKey: row.destination.chatKey, threadId: row.destination.threadId,
            accountKey: 'account-pin', isSelf: true,
            text: connector === 'teams' ? formatTeamsOutbound(f.sends[0].text, 'html') : f.sends[0].text,
        };
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        await f.restart();
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, workspaceId: 'workspace-b' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, threadId: 'another-root' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, isSelf: false })).toBe(false);
        expect(f.sends).toHaveLength(1);
        expect(f.outbound.size).toBe(0);
    });

    it('marks every immutable part and does not treat merely prepared or future unattempted parts as own echoes', async () => {
        const f = await fixture(connector);
        const entry = (await f.mirror.capture('workspace-a', f.processId, 'large outbound body '.repeat(2500)))!;
        f.mirror.outbox.accept(entry.workspaceId, entry.eventId);
        const chunks = f.adapter.format(entry);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every(chunk => chunk.includes(entry.requestId))).toBe(true);
        if (connector === 'whatsapp') expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true);
        f.mirror.outbox.prepare(entry.workspaceId, entry.eventId, chunks);
        const echo = (chunk: string) => ({ connector, chatKey: entry.destination.chatKey,
            threadId: entry.destination.threadId, accountKey: 'account-pin', isSelf: true,
            text: connector === 'teams' ? formatTeamsOutbound(chunk, 'html') : chunk });
        expect(await f.mirror.isOwnMirrorMessage(echo(chunks[0]))).toBe(false);
        for (let retry = 0; retry < 3; retry++) {
            const rejected = f.mirror.outbox.beginPart(entry.workspaceId, entry.eventId)!;
            expect(await f.mirror.isOwnMirrorMessage(echo(chunks[0]))).toBe(true);
            expect(await f.mirror.isOwnMirrorMessage(echo(chunks[1]))).toBe(false);
            f.mirror.outbox.failPart(entry.workspaceId, entry.eventId, rejected, 'rejected');
        }
        const attempt = f.mirror.outbox.beginPart(entry.workspaceId, entry.eventId)!;
        expect(await f.mirror.isOwnMirrorMessage(echo(chunks[1]))).toBe(false);
        f.mirror.outbox.failPart(entry.workspaceId, entry.eventId, attempt, 'unknown', 0);
        await f.restart();
        expect(await f.mirror.isOwnMirrorMessage(echo(chunks[0]))).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage(echo(chunks[1]))).toBe(false);
    });

    it.each(['user', 'assistant'] as const)('filters an unknown second multipart %s part across restart without losing formatted body', async role => {
        const f = await fixture(connector);
        const body = '| Key | Value |\n| --- | --- |\n| unicode | 🙂 & <literal> |\n\n'
            + '**Formatted body** 🙂 trailing space \n'.repeat(1500);
        if (role === 'assistant') {
            await f.deliver('short desktop request before multipart answer');
            await f.mirror.flush();
        }
        const previousSends = f.sends.length;
        let part = 0;
        f.send.mockImplementation(async (text, threadId) => {
            part++;
            f.sends.push({ text, threadId, chatKey: connector === 'whatsapp' ? 'bound@g.us' : 'team\0channel' });
            if (part === 2) throw new Error('second part posted without a receipt');
            return `multipart-${part}`;
        });
        if (role === 'user') await f.deliver(body);
        else await f.finish(body);
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a').find(row => row.role === role)!;
        expect(row.chunks.length).toBeGreaterThan(2);
        expect(row.state).toBe('ambiguous');
        expect(row.nextPart).toBe(1);
        expect(row.outboundIds).toEqual(['multipart-1']);
        expect(f.outbound.has('multipart-2')).toBe(false);
        expect(row.content).toBe(role === 'assistant' ? body.trim() : body);
        if (connector === 'whatsapp') {
            expect(row.chunks.map((chunk, index) => {
                const header = `CoC · Desktop ${role} · Request ${row.requestId} · Part ${index + 1}/${row.chunks.length}\n\n`;
                expect(chunk.startsWith(header)).toBe(true);
                expect(chunk.length).toBeLessThanOrEqual(4096);
                return chunk.slice(header.length);
            }).join('')).toBe(formatWhatsAppAnswer(row.content));
        } else {
            expect(row.chunks.every(chunk => chunk.includes(row.requestId))).toBe(true);
        }
        const echo = {
            connector, chatKey: row.destination.chatKey, threadId: row.destination.threadId,
            accountKey: 'account-pin', isSelf: true,
            text: connector === 'teams' ? formatTeamsOutbound(row.chunks[1], 'html') : row.chunks[1],
        };
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage({
            ...echo, text: connector === 'teams' ? formatTeamsOutbound(row.chunks[2], 'html') : row.chunks[2],
        })).toBe(false);
        await f.restart();
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(f.sends).toHaveLength(previousSends + 2);
        const enqueue = vi.fn(async () => 'inbound-task');
        const send = vi.fn(async () => 'inbound-reply');
        const followUp = vi.fn(async () => {});
        if (connector === 'whatsapp') {
            const router = new WhatsAppCommandRouter({
                store: f.store, bindings: f.bindings, groupJid: () => 'bound@g.us',
                enqueue, getTask: f.queue.getTask, send, react: async () => {},
                isOwnMirrorMessage: message => message.fromMe && f.mirror.isOwnMirrorMessage({
                    ...echo, chatKey: message.chatJid, threadId: message.quotedMessageId, text: message.text,
                }),
            });
            try {
                await router.handle({ messageId: 'unknown-multipart-echo', chatJid: 'bound@g.us',
                    senderJid: 'paired-account', fromMe: true, text: echo.text, quotedMessageId: row.destination.threadId });
            } finally { router.dispose(); }
        } else {
            const router = new TeamsCommandRouter({
                store: f.store, dataDir: f.directory, enqueueChat: enqueue, executeFollowUp: followUp,
                sendReply: async () => { await send(); },
                isOwnMirrorMessage: message => f.mirror.isOwnMirrorMessage({
                    ...echo, chatKey: `team\0${message.channelId}`, threadId: message.replyToMessageId, text: message.text,
                }),
            });
            try {
                await router.handle({ messageId: 'unknown-multipart-echo', channelId: 'channel',
                    replyToMessageId: row.destination.threadId, senderAadId: 'synthetic-sender', text: echo.text });
            } finally { router.stop(); }
        }
        expect(enqueue).not.toHaveBeenCalled();
        expect(followUp).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('does not revive a stale inbound command when reconnect wins during asynchronous echo verification', async () => {
        const f = await fixture(connector);
        let release!: (value: boolean) => void;
        const verification = new Promise<boolean>(resolve => { release = resolve; });
        const send = vi.fn(async () => 'reply');
        const enqueue = vi.fn(async () => 'inbound-task');
        if (connector === 'whatsapp') {
            const router = new WhatsAppCommandRouter({
                store: f.store, bindings: f.bindings, groupJid: () => 'bound@g.us',
                enqueue, getTask: f.queue.getTask, send, react: async () => {},
                isOwnMirrorMessage: () => verification,
            });
            try {
                const handling = router.handle({ messageId: 'stale', chatJid: 'bound@g.us',
                    senderJid: 'bound@g.us', fromMe: true, text: 'help' });
                router.resetPendingImages();
                release(false);
                await handling;
            } finally { router.dispose(); }
        } else {
            const router = new TeamsCommandRouter({
                store: f.store, dataDir: f.directory, enqueueChat: enqueue, executeFollowUp: async () => {},
                sendReply: async () => { await send(); }, isOwnMirrorMessage: () => verification,
            });
            try {
                const handling = router.handle({ messageId: 'stale', channelId: 'channel',
                    senderAadId: 'synthetic-sender', text: 'help' });
                router.stop();
                router.start();
                release(false);
                await handling;
            } finally { router.stop(); }
        }
        expect(send).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('cancels one queued request while a parent runs without suppressing another request on the same binding', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const first = await f.deliver('cancelled queued desktop request');
        const second = await f.deliver('surviving queued desktop request');
        f.tasks.get(first.taskId!)!.status = 'cancelled';
        await f.store.updateProcess(f.processId, { status: 'running' });
        f.setConnected(true);
        await f.mirror.flush();
        await f.mirror.flush();
        const receipts = f.mirror.outbox.list('workspace-a');
        expect(receipts.find(row => row.content === 'cancelled queued desktop request')?.failure).toBe('cancelled');
        expect(receipts.find(row => row.content === 'surviving queued desktop request')?.state).toBe('delivered');
        expect(f.sends).toHaveLength(1);
        if (second.pendingMessageId) {
            const pending = (await f.store.getProcess(f.processId))!.pendingMessages!.find(message => message.id === second.pendingMessageId)!;
            await f.store.appendConversationTurn(f.processId, turnIndex => ({
                role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
                timestamp: new Date(), turnIndex, timeline: [],
            }));
            await f.store.removePendingMessage(f.processId, pending.id!);
        } else {
            f.tasks.get(second.taskId!)!.status = 'completed';
        }
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'surviving final answer', timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.store.updateProcess(f.processId, { status: 'completed' });
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('surviving final answer');
        expect(f.sends.some(send => send.text.includes('cancelled queued desktop request'))).toBe(false);
    });

    it('durably suppresses only the final answer of a cancelled request whose user mirror was delivered', async () => {
        const f = await fixture(connector);
        const first = await f.deliver('already mirrored request');
        await f.mirror.flush();
        f.tasks.get(first.taskId!)!.status = 'cancelled';
        await f.store.updateProcess(f.processId, { status: 'running' });
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'cancelled request final must not relay',
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.mirror.flush();
        const placeholder = f.mirror.outbox.list('workspace-a').find(row => row.role === 'assistant'
            && row.requestId === first.taskId);
        expect(placeholder?.state).toBe('cancelled');
        await f.store.updateProcess(f.processId, { status: 'completed' });
        const second = await f.deliver('new independent desktop request');
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'independent final answer', timestamp: new Date(), turnIndex, timeline: [],
        }));
        f.tasks.get(second.taskId!)!.status = 'completed';
        await f.restart();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(3);
        expect(f.sends.some(send => send.text.includes('cancelled request final must not relay'))).toBe(false);
        expect(f.sends[2].text).toContain('independent final answer');
    });

    it('does not borrow cancelled status from a foreign workspace/process/payload correlation', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const admitted = await f.deliver('correct owning request');
        const task = f.tasks.get(admitted.taskId!)!;
        f.tasks.delete(task.id);
        f.tasks.set('foreign-repo', { ...task, id: 'foreign-repo', repoId: 'workspace-b', status: 'cancelled' });
        f.tasks.set('foreign-process', { ...task, id: 'foreign-process', processId: 'queue_foreign', status: 'cancelled' });
        f.tasks.set('foreign-payload', { ...task, id: 'foreign-payload', status: 'cancelled',
            payload: { ...task.payload, workspaceId: 'workspace-b' } });
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
    });

    it('stages legacy pending POST before append and accepts exact-owner pending admission immediately', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const routes = pendingRoutes(f);
        const append = f.store.appendPendingMessage.bind(f.store);
        vi.spyOn(f.store, 'appendPendingMessage').mockImplementation(async (id, pending) => {
            expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === pending.id)?.state).toBe('admitting');
            return append(id, pending);
        });
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`, {
            content: 'qualified legacy pending', mode: 'sentinel', relayRequestId: 'forged-request',
        })).toBe(201);
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        expect(pending.id).toBe(pending.relayRequestId);
        expect(pending.id).not.toBe('forged-request');
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('pending');
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('qualified legacy pending');
    });

    it('keeps flag-off and unqualified legacy pending POSTs unmarked and rejects foreign workspace authority', async () => {
        const f = await fixture(connector);
        const routes = pendingRoutes(f);
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-b`,
            { content: 'foreign legacy pending', origin: 'desktop' })).toBe(404);
        expect(await invoke(routes.post, routes.url,
            { content: 'unqualified legacy pending', origin: 'desktop' })).toBe(201);
        f.setEnabled(false);
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`,
            { content: 'disabled legacy pending' })).toBe(201);
        f.setEnabled(true);
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        expect(f.sends).toHaveLength(0);
        expect((await f.store.getProcess(f.processId))!.pendingMessages?.every(message => !message.relayRequestId)).toBe(true);
    });

    it('deleting one accepted unsent pending request preserves other pending mirrors across restart', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const routes = pendingRoutes(f);
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'deleted unsent pending' });
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'retained pending request' });
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages!;
        expect(await invoke(routes.delete, `${routes.url}/${pending[0].id}?workspace=workspace-a`, {})).toBe(204);
        expect(f.mirror.outbox.list('workspace-a').find(row => row.requestId === pending[0].relayRequestId)?.state).toBe('cancelled');
        await f.restart();
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('retained pending request');
        expect(f.sends[0].text).not.toContain('deleted unsent pending');
    });

    it('old pending removal does not suppress an already consumed request final answer', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const routes = pendingRoutes(f);
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'consumed pending request' });
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(204);
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(204);
        f.setConnected(true);
        await f.finish('consumed pending final answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('consumed pending final answer');
    });

    it('old pending removal does not cancel an already running correlated task', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const routes = pendingRoutes(f);
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'already running pending' });
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        f.tasks.set(pending.relayRequestId!, {
            id: pending.relayRequestId!, processId: f.processId, repoId: 'workspace-a', type: 'chat', status: 'running',
            payload: { workspaceId: 'workspace-a', processId: f.processId, relayRequestId: pending.relayRequestId },
        } as QueuedTask);
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(204);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('pending');
        expect(f.tasks.get(pending.relayRequestId!)?.status).toBe('running');
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        f.setConnected(true);
        await f.finish('running pending final answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('running pending final answer');
    });

    it('rechecks a queued-to-running race before cancelling a pending request mirror', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        const routes = pendingRoutes(f);
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'pending starts during removal' });
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        const task = { id: pending.relayRequestId!, processId: f.processId, repoId: 'workspace-a',
            type: 'chat', status: 'queued', payload: { workspaceId: 'workspace-a', relayRequestId: pending.relayRequestId } } as QueuedTask;
        f.tasks.set(task.id, task);
        const cancel = f.mirror.cancelRequest.bind(f.mirror);
        vi.spyOn(f.mirror, 'cancelRequest').mockImplementation(async (...args) => {
            task.status = 'running';
            return cancel(...args);
        });
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(204);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('pending');
        expect(routes.cancelQueuedTask).not.toHaveBeenCalledWith(task.id);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        f.setConnected(true);
        await f.finish('started during removal final answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('started during removal final answer');
    });

    it('persists legacy compaction queue correlation and preserves accepted pending work after an enqueue observer throws', async () => {
        const f = await fixture(connector);
        const routes = pendingRoutes(f);
        Object.assign(f.bridge, { findCompactionTask: () => ({ id: 'compaction-task', status: 'queued' }) });
        const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
        f.bridge.enqueueAdmitted.mockImplementationOnce(async input => {
            await enqueue(input);
            throw new Error('post-enqueue observer failed');
        });
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`,
            { content: 'accepted pending behind compaction', mode: 'sentinel' })).toBe(201);
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        const task = f.tasks.get(`pending-${f.processId}-${pending.id}`)!;
        expect(task.payload.relayRequestId).toBe(pending.relayRequestId);
        expect(pending.id).toBe(pending.relayRequestId);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('accepted pending behind compaction');
    });

    it('reconciles legacy pending acceptance after an append observer throws and rejects definite append failure', async () => {
        const f = await fixture(connector);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const routes = pendingRoutes(f);
        const append = f.store.appendPendingMessage.bind(f.store);
        vi.spyOn(f.store, 'appendPendingMessage').mockImplementationOnce(async (id, message) => {
            await append(id, message);
            throw new Error('post-write pending observer failed');
        });
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`,
            { content: 'accepted despite pending observer' })).toBe(201);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        vi.spyOn(f.store, 'appendPendingMessage').mockRejectedValueOnce(new Error('private storage details'));
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`,
            { content: 'definite pending append failure' })).toBe(500);
        expect(f.mirror.outbox.list('workspace-a').find(row => row.content === 'definite pending append failure')?.failure)
            .toBe('admission-rejected');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
    });

    it('preserves canonical pending acceptance when its realtime notification observer fails', async () => {
        const f = await fixture(connector);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const routes = pendingRoutes(f);
        const emit = f.store.emitProcessEvent.bind(f.store);
        vi.spyOn(f.store, 'emitProcessEvent').mockImplementation((id, event) => {
            if (event.type === 'pending-message-added') throw new Error('private observer diagnostic');
            return emit(id, event);
        });
        expect(await invoke(routes.post, `${routes.url}?workspace=workspace-a`,
            { content: 'accepted without realtime observer' })).toBe(201);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('private observer'));
    });

    it('reports removal storage failure safely while retaining durable request cancellation for a retry', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const routes = pendingRoutes(f);
        await invoke(routes.post, `${routes.url}?workspace=workspace-a`, { content: 'pending removal storage failure' });
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        vi.spyOn(f.store, 'removePendingMessage').mockRejectedValueOnce(new Error('private removal storage details'));
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(500);
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('cancelled');
        expect((await f.store.getProcess(f.processId))!.pendingMessages).toHaveLength(1);
        expect(await invoke(routes.delete, `${routes.url}/${pending.id}?workspace=workspace-a`, {})).toBe(204);
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('private removal'));
    });

    it('recovers every known owner ledger before the first admission without requiring start', async () => {
        const f = await fixture(connector);
        const recover = vi.spyOn(f.mirror.outbox, 'recover');
        const stage = vi.spyOn(f.mirror.outbox, 'stage');
        const entry = await f.mirror.capture('workspace-a', f.processId, 'after all owner recovery');
        expect(entry).toBeDefined();
        expect(recover.mock.calls).toEqual([['workspace-a'], ['workspace-b']]);
        expect(Math.max(...recover.mock.invocationCallOrder)).toBeLessThan(stage.mock.invocationCallOrder[0]);
        f.mirror.start();
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('admitting');
        expect(recover).toHaveBeenCalledTimes(2);
    });

    it('hydrates a workspace registered during initial recovery before staging its admission', async () => {
        const f = await fixture(connector);
        const workspaces = await f.store.getWorkspaces();
        vi.spyOn(f.store, 'getWorkspaces').mockResolvedValueOnce(
            workspaces.filter(workspace => workspace.id !== 'workspace-a'),
        );
        const recover = vi.spyOn(f.mirror.outbox, 'recover');
        const stage = vi.spyOn(f.mirror.outbox, 'stage');
        const row = await f.mirror.capture('workspace-a', f.processId, 'newly registered owner');
        expect(row).toBeDefined();
        const ownerRecovery = recover.mock.calls.findIndex(([workspaceId]) => workspaceId === 'workspace-a');
        expect(ownerRecovery).toBeGreaterThanOrEqual(0);
        expect(recover.mock.invocationCallOrder[ownerRecovery]).toBeLessThan(stage.mock.invocationCallOrder[0]);
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('admitting');
    });

    it('seeds admission ordering from another persisted owner ledger during clock regression', async () => {
        const f = await fixture(connector);
        const destination = f.adapter.destinations({ workspaceId: 'workspace-a', processId: f.processId })[0];
        const clock = vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
        const priorOutbox = new SentinelMirrorOutbox(f.directory);
        const prior = priorOutbox.stage({
            workspaceId: 'workspace-b', processId: 'queue_prior-owner', requestId: 'prior-admission',
            role: 'user', destination, content: 'previous owning workspace',
        });
        priorOutbox.accept(prior.workspaceId, prior.eventId);
        clock.mockReturnValue(1_900_000_000_000);
        const entry = (await f.mirror.capture('workspace-a', f.processId, 'accepted under regressed clock'))!;
        expect(Date.parse(entry.createdAt)).toBeGreaterThan(Date.parse(prior.createdAt));
    });

    it('recovers a newly registered owner before later admissions without recovering live ledgers again', async () => {
        const f = await fixture(connector);
        await f.mirror.capture('workspace-a', f.processId, 'first live admission');
        const recover = vi.spyOn(f.mirror.outbox, 'recover');
        await f.store.registerWorkspace({ id: 'workspace-c', rootPath: path.join(f.directory, 'c'), name: 'Workspace C' });
        const destination = f.adapter.destinations({ workspaceId: 'workspace-a', processId: f.processId })[0];
        const clock = vi.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
        const priorOutbox = new SentinelMirrorOutbox(f.directory);
        const prior = priorOutbox.stage({ workspaceId: 'workspace-c', processId: 'queue_prior-c',
            requestId: 'prior-c-admission', role: 'user', destination, content: 'new owner prior admission' });
        priorOutbox.accept(prior.workspaceId, prior.eventId);
        clock.mockReturnValue(1_900_000_000_000);
        const later = (await f.mirror.capture('workspace-a', f.processId, 'after new owner recovery'))!;
        expect(recover.mock.calls).toEqual([['workspace-c']]);
        expect(Date.parse(later.createdAt)).toBeGreaterThan(Date.parse(prior.createdAt));
    });

    it('refuses new admission while any owner ledger cannot recover and safely retries recovery', async () => {
        const f = await fixture(connector);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const original = f.mirror.outbox.recover.bind(f.mirror.outbox);
        const recover = vi.spyOn(f.mirror.outbox, 'recover').mockImplementation(workspaceId => {
            if (workspaceId === 'workspace-b') throw new Error('private storage details');
            return original(workspaceId);
        });
        await expect(f.deliver('unsafe unseeded order')).rejects.toThrow('The submission was not accepted.');
        expect(f.bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        recover.mockRestore();
        await f.deliver('after successful recovery');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
    });

    it('rejects bound desktop admission safely when account authority or durable staging is unavailable', async () => {
        const f = await fixture(connector);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        f.setAccount('');
        await expect(f.deliver('unverified account')).rejects.toThrow('The submission was not accepted.');
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        f.setAccount('account-pin');
        const stage = vi.spyOn(f.mirror.outbox, 'stage').mockImplementation(() => {
            throw new Error('private credential storage failure');
        });
        await expect(f.deliver('unpersisted prompt')).rejects.toThrow('The submission was not accepted.');
        expect(f.bridge.enqueueAdmitted).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('private credential'));
        stage.mockRestore();
        await f.deliver('verified durable prompt');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
    });

    it('permits an exact workspace-owned fork ID but never grants authority to a bare lookup alone', async () => {
        const f = await fixture(connector);
        const proc = (await f.store.getProcess(f.processId, 'workspace-a'))!;
        await f.store.addProcess({ ...proc, id: 'bound-fork', conversationTurns: [] });
        const destinations = f.adapter.destinations({ workspaceId: 'workspace-a', processId: f.processId });
        vi.spyOn(f.adapter, 'destinations').mockImplementation(owner =>
            owner.workspaceId === 'workspace-a' && owner.processId === 'bound-fork' ? destinations : []);
        const input: CreateTaskInput = {
            type: 'chat', repoId: 'workspace-a', processId: 'bound-fork',
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a',
                processId: 'bound-fork', prompt: 'qualified fork submission' },
        };
        expect((await f.mirror.captureTask(input))?.processId).toBe('bound-fork');
        expect(await f.mirror.capture('workspace-b', 'bound-fork', 'wrong owner')).toBeUndefined();
        expect(await f.mirror.capture('', 'bound-fork', 'unqualified owner')).toBeUndefined();
    });

    it('never writes a failure notice into a different workspace with the same bare process ID', async () => {
        const f = await fixture(connector);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const proc = (await f.store.getProcess(f.processId, 'workspace-a'))!;
        await f.store.addProcess({ ...proc, metadata: { ...proc.metadata, workspaceId: 'workspace-b' } });
        const destinations = f.adapter.destinations({ workspaceId: 'workspace-a', processId: f.processId });
        vi.spyOn(f.adapter, 'destinations').mockReturnValue(destinations);
        vi.spyOn(f.adapter, 'availability').mockReturnValue('ready');
        const entry = (await f.mirror.capture('workspace-b', f.processId, 'scoped second workspace'))!;
        f.setFailure(new Error('unknown outcome'));
        f.mirror.accepted(entry);
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-b')[0].failure).toBe('unknown');
        expect((await f.store.getProcess(f.processId, 'workspace-a'))?.conversationTurns).toHaveLength(2);
    });

    it('rechecks captured account authority after the last awaited read before a send', async () => {
        const f = await fixture(connector);
        const entry = (await f.mirror.capture('workspace-a', f.processId, 'pinned before asynchronous read'))!;
        const read = f.store.getProcess.bind(f.store);
        let reads = 0;
        vi.spyOn(f.store, 'getProcess').mockImplementation(async (...args) => {
            const proc = await read(...args);
            if (++reads === 2) f.setAccount('rebound-account');
            return proc;
        });
        f.mirror.accepted(entry);
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('unbound');
    });

    it('retains offline restart work while connector binding receipts are still being restored', async () => {
        const f = await fixture(connector);
        const entry = (await f.mirror.capture('workspace-a', f.processId, 'accepted before restart'))!;
        f.setConnected(false);
        const authority = connector === 'teams'
            ? vi.spyOn(f.relay!, 'sentinelMirrorBindings').mockReturnValue([])
            : vi.spyOn(f.bindings, 'sentinelMirrorBindings').mockReturnValue([]);
        f.mirror.accepted(entry);
        await f.restart();
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('pending');
        expect(f.sends).toHaveLength(0);
        authority.mockRestore();
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
    });

    it('distinguishes explicit manager disconnect from graceful shutdown and retry reconnect', async () => {
        const f = await fixture(connector);
        const manager = connector === 'teams' ? new TeamsMessagingManager(f.directory) : new WhatsAppMessagingManager(f.directory);
        const cancelled = vi.fn();
        manager.setMirrorDisconnectHandler(cancelled);
        await manager.disconnectForShutdown();
        expect(cancelled).not.toHaveBeenCalled();
        if (manager instanceof TeamsMessagingManager) {
            await manager.disconnect('superseded');
            await manager.disconnect('failed');
            expect(cancelled).not.toHaveBeenCalled();
        }
        await manager.disconnect();
        expect(cancelled).toHaveBeenCalledTimes(1);
        manager.dispose();
        expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('does not report explicit disconnect complete before durable cancellation completes', async () => {
        const f = await fixture(connector);
        const manager = connector === 'teams' ? new TeamsMessagingManager(f.directory) : new WhatsAppMessagingManager(f.directory);
        let release!: () => void;
        manager.setMirrorDisconnectHandler(() => new Promise<void>(resolve => { release = resolve; }));
        let completed = false;
        const disconnected = manager.disconnect().then(() => { completed = true; });
        await Promise.resolve();
        expect(completed).toBe(false);
        release();
        await disconnected;
        expect(completed).toBe(true);
        manager.dispose();
    });

    it('admits an explicit desktop follow-up, mirrors user then final answer, and deduplicates terminal events', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('desktop prompt');
        await f.mirror.flush();
        expect(result.path).toBe('enqueued');
        expect(f.sends.map(row => row.text)).toEqual([expect.stringContaining('desktop prompt')]);
        await f.finish('final desktop answer');
        f.queue.emit('taskCompleted', f.tasks.get(result.taskId!)!);
        f.queue.emit('taskCompleted', f.tasks.get(result.taskId!)!);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('final desktop answer');
        expect(f.sends.every(row => row.threadId === 'root')).toBe(true);
        expect(f.outbound.size).toBe(2);
        expect(f.sends.some(row => row.text.includes('connector answer'))).toBe(false);
    });

    it('mirrors a fixed empty completion only after the exact tool-only request completes', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('tool-only desktop request');
        const task = f.tasks.get(result.taskId!)!;
        task.status = 'running';
        await f.store.updateProcess(f.processId, { status: 'running' });
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'internal tool diagnostic', displayOnly: true,
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a').every(row => row.role === 'user')).toBe(true);
        task.status = 'completed';
        await f.store.updateProcess(f.processId, { status: 'completed' });
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain(RELAY_ANSWER_TEXT.empty);
        expect(f.sends[1].text).not.toContain('connector answer');
        expect(f.sends[1].text).not.toContain('internal tool diagnostic');
        await f.restart();
        expect(f.sends).toHaveLength(2);
    });

    it('never borrows a later request completion or answer for an uncompleted closed request', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('earlier unanswered desktop request');
        f.tasks.delete(result.taskId!);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'another request', relayRequestId: 'another-request',
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.finish('another request answer');
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a').every(row => row.role === 'user')).toBe(true);
    });

    it('excludes still-pending requests before any stale-parent or exact-task final inference', async () => {
        const f = await fixture(connector);
        await f.deliver('first desktop request');
        const buffered = await f.deliver('buffered pending request');
        expect(buffered.path).toBe('buffered');
        const pending = (await f.store.getProcess(f.processId))!.pendingMessages![0];
        const old = new Date('2020-01-01T00:00:00.000Z');
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            timestamp: old, turnIndex, timeline: [],
        }));
        await f.store.updateProcess(f.processId, { status: 'failed', endTime: new Date('2020-01-02T00:00:00.000Z'),
            error: 'Unrelated previous failure' });
        await f.mirror.flush();
        const answers = () => f.mirror.outbox.list('workspace-a').filter(row => row.role === 'assistant'
            && row.requestId === pending.relayRequestId);
        expect(answers()).toEqual([]);
        f.tasks.set(pending.relayRequestId!, {
            id: pending.relayRequestId!, repoId: 'workspace-a', processId: f.processId, type: 'chat',
            status: 'completed', payload: { kind: 'chat', processId: f.processId,
                workspaceId: 'workspace-a', relayRequestId: pending.relayRequestId },
        } as QueuedTask);
        await f.store.updateProcess(f.processId, { status: 'completed' });
        await f.mirror.flush();
        expect(answers()).toEqual([]);
        await f.store.removePendingMessage(f.processId, pending.id!);
        await f.mirror.flush();
        expect(answers()).toHaveLength(1);
        expect(answers()[0].content).toBe(RELAY_ANSWER_TEXT.empty);
    });

    it('requires the exact task to settle even when a later user closes an apparently settled answer', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('desktop request still executing');
        const task = f.tasks.get(result.taskId!)!;
        task.status = 'running';
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'apparently settled answer', turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'another request', relayRequestId: 'another-request',
            turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.updateProcess(f.processId, { status: 'completed' });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        task.status = 'completed';
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('apparently settled answer');
    });

    it('never borrows stale failed-parent status/error after a buffered user is consumed without an exact task', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('new taskless desktop request');
        f.tasks.delete(result.taskId!);
        await f.store.updateProcess(f.processId, {
            status: 'failed', endTime: new Date(),
            error: 'Usage limit resets at 09:00 (UTC). Private previous request diagnostic.',
        });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a').every(row => row.role === 'user')).toBe(true);
        await f.restart();
        expect(f.sends).toHaveLength(1);
    });

    it('uses an exact failed task error rather than the previous failed-parent error', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('failed desktop request');
        const task = f.tasks.get(result.taskId!)!;
        task.status = 'failed';
        task.error = 'Usage limit resets at 10:00 (UTC). Private task diagnostic.';
        await f.store.updateProcess(f.processId, {
            status: 'failed', error: 'Usage limit resets at 09:00 (UTC). Private previous request diagnostic.',
        });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('10:00');
        expect(f.sends[1].text).not.toContain('09:00');
        expect(f.sends[1].text).not.toContain('Private');
    });

    it.each(['interrupted', 'error'] as const)('accepts taskless request-local settled %s evidence without stale process details', async kind => {
        const f = await fixture(connector);
        const result = await f.deliver('request with local failure evidence');
        f.tasks.delete(result.taskId!);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: kind === 'error'
                ? 'Error: Usage limit resets at 10:00 (UTC). Private request diagnostic.'
                : 'Private partial output',
            ...(kind === 'interrupted' ? {
                interrupted: true, interruptionReason: 'Usage limit resets at 10:00 (UTC). Private request diagnostic.',
            } : {}),
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'later request', relayRequestId: 'later-request',
            timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.store.updateProcess(f.processId, {
            status: 'failed', error: 'Usage limit resets at 09:00 (UTC). Private previous request diagnostic.',
        });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('10:00');
        expect(f.sends[1].text).not.toContain('09:00');
        expect(f.sends[1].text).not.toContain('Private');
    });

    it.each(['streaming', 'displayOnly'] as const)('rejects taskless %s failure diagnostics as completion evidence', async flag => {
        const f = await fixture(connector);
        const result = await f.deliver('request without settled local failure evidence');
        f.tasks.delete(result.taskId!);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'Error: Usage limit resets at 10:00 (UTC). Private diagnostic.',
            [flag]: true, timestamp: new Date(), turnIndex, timeline: [],
        }));
        await f.store.updateProcess(f.processId, {
            status: 'failed', error: 'Usage limit resets at 09:00 (UTC). Private previous request diagnostic.',
        });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
    });

    it('requires an exact completed task for empty replies rather than a stale parent or foreign task', async () => {
        const f = await fixture(connector);
        const result = await f.deliver('taskless request without text');
        const task = f.tasks.get(result.taskId!)!;
        f.tasks.delete(result.taskId!);
        await f.store.updateProcess(f.processId, { status: 'completed' });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        f.tasks.set('foreign-task', { ...task, id: 'foreign-task', processId: 'queue_other-process', status: 'completed' });
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        task.status = 'completed';
        f.tasks.set(task.id, task);
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain(RELAY_ANSWER_TEXT.empty);
    });

    it('does not let another process with the same request ID suppress its final answer', async () => {
        const f = await fixture(connector);
        await f.deliver('process-scoped desktop request');
        await f.mirror.flush();
        const user = f.mirror.outbox.list('workspace-a')[0];
        const foreign = f.mirror.outbox.stage({
            workspaceId: user.workspaceId, processId: 'queue_other-process', requestId: user.requestId,
            role: 'assistant', destination: user.destination, content: 'other process answer',
        });
        f.mirror.outbox.reject(foreign.workspaceId, foreign.eventId);
        await f.finish('exact process answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('exact process answer');
        expect(f.sends[1].text).not.toContain('other process answer');
    });

    it('persists its own cancellation placeholder despite another process sharing the request ID', async () => {
        const f = await fixture(connector);
        await f.deliver('cancel exact process request');
        await f.mirror.flush();
        const user = f.mirror.outbox.list('workspace-a')[0];
        const foreign = f.mirror.outbox.stage({
            workspaceId: user.workspaceId, processId: 'queue_other-process', requestId: user.requestId,
            role: 'assistant', destination: user.destination, content: 'other cancelled process answer',
        });
        f.mirror.outbox.reject(foreign.workspaceId, foreign.eventId);
        expect(await f.mirror.cancelRequest(user.workspaceId, user.processId, user.requestId)).toBe(true);
        const placeholder = f.mirror.outbox.list(user.workspaceId).find(row =>
            row.role === 'assistant' && row.processId === user.processId && row.requestId === user.requestId);
        expect(placeholder?.state).toBe('cancelled');
        expect(placeholder?.content).toBe(RELAY_ANSWER_TEXT.cancelled);
        await f.finish('cancelled process answer must not relay');
        await f.restart();
        expect(f.sends).toHaveLength(1);
    });

    it('mirrors buffered admission before execution and persists a stable pending/turn/queue correlation', async () => {
        const f = await fixture(connector);
        f.tasks.set('active', { id: 'active', processId: f.processId, repoId: 'workspace-a',
            status: 'running', type: 'chat', payload: { workspaceId: 'workspace-a' } } as QueuedTask);
        await f.store.updateProcess(f.processId, { status: 'running' });
        const result = await f.deliver('buffered desktop prompt');
        await f.mirror.flush();
        expect(result.path).toBe('buffered');
        const proc = (await f.store.getProcess(f.processId))!;
        const pending = proc.pendingMessages![0];
        expect(pending.id).toBe(pending.relayRequestId);
        expect(proc.conversationTurns).toHaveLength(2);
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('buffered desktop prompt');
        expect(f.bridge.enqueueAdmitted).not.toHaveBeenCalled();
        await f.restart();
        expect(f.sends).toHaveLength(1);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: pending.content, relayRequestId: pending.relayRequestId,
            turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.removePendingMessage(f.processId, pending.id!);
        await f.finish('buffered final answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('buffered final answer');
    });

    it('correlates immediate steering without echoing in-flight partial assistant output', async () => {
        const f = await fixture(connector);
        f.tasks.set('active', { id: 'active', processId: f.processId, repoId: 'workspace-a',
            status: 'running', type: 'chat', payload: { workspaceId: 'workspace-a' } } as QueuedTask);
        await f.store.updateProcess(f.processId, { status: 'running' });
        const result = await f.deliver('steered desktop prompt', { deliveryMode: 'immediate' });
        expect(result.path).toBe('steered');
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'partial secret', streaming: true,
            turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        await f.finish('settled steered answer');
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('settled steered answer');
        expect(f.sends[1].text).not.toContain('partial secret');
    });

    it('does not mirror delegated result notices overlapping a settled assistant answer', async () => {
        const f = await fixture(connector);
        await f.deliver('desktop request with delegated work');
        await f.mirror.flush();
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'canonical settled answer', turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'delegated result already relayed', displayOnly: true,
            relayRequestId: 'job-result-notice', turnIndex, timestamp: new Date(), timeline: [],
        }));
        for (const task of f.tasks.values()) if (task.payload.relayRequestId) task.status = 'completed';
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[1].text).toContain('canonical settled answer');
        expect(f.sends[1].text).not.toContain('delegated result already relayed');
    });

    it('does not infer desktop origin from connector turns, reviews, passive notices, or historical transcript', async () => {
        const f = await fixture(connector);
        await f.deliver('connector follow-up', { origin: undefined, relayRequestId: 'connector-receipt' });
        await f.finish('connector reply');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
        f.setEnabled(false);
        await f.deliver('flag off desktop');
        await f.finish('flag off answer');
        f.setEnabled(true);
        await f.restart();
        expect(f.sends).toHaveLength(0);
    });

    it('rejects foreign workspace, non-Sentinel mode, released ownership and ambiguous destinations', async () => {
        const f = await fixture(connector);
        expect(await f.mirror.capture('workspace-b', f.processId, 'foreign')).toBeUndefined();
        expect(await f.mirror.capture('remote:server:workspace-a', f.processId, 'remote')).toBeUndefined();
        const proc = (await f.store.getProcess(f.processId))!;
        await f.store.updateProcess(f.processId, { metadata: { ...proc.metadata, mode: 'ask' } });
        expect(await f.mirror.capture('workspace-a', f.processId, 'ask')).toBeUndefined();
        await f.store.updateProcess(f.processId, { metadata: proc.metadata });
        f.setBinding(false);
        expect(await f.mirror.capture('workspace-a', f.processId, 'released')).toBeUndefined();
        f.setBinding(true);
        const dest = f.adapter.destinations({ workspaceId: 'workspace-a', processId: f.processId })[0];
        vi.spyOn(f.adapter, 'destinations').mockReturnValue([dest, { ...dest, bindingId: 'other', threadId: 'other-root' }]);
        expect(await f.mirror.capture('workspace-a', f.processId, 'ambiguous')).toBeUndefined();
    });

    it('retains immutable destination across topic selection and cancels a captured account rebind', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        await f.deliver('captured old account');
        await f.mirror.flush();
        const original = f.mirror.outbox.list('workspace-a')[0].destination;
        f.setAccount('different-account');
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[0]).toMatchObject({ destination: original, state: 'cancelled', failure: 'unbound' });
    });

    it('retries definite non-attempts after reconnect but quarantines unknown send outcomes visibly', async () => {
        const f = await fixture(connector);
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        f.setFailure(connector === 'teams'
            ? new TeamsOperationError('private detail', 'graph', 'unavailable', 'not-attempted')
            : new WhatsAppNotConnectedError());
        await f.deliver('safe retry');
        await f.mirror.flush();
        const failed = f.mirror.outbox.list('workspace-a')[0];
        expect(failed.state).toBe('retryable');
        expect(failed.retryCount).toBe(1);
        expect(Date.parse(failed.nextAttemptAt!)).toBe(now + 1000);
        f.setFailure(undefined);
        await f.restart();
        expect(f.sends).toHaveLength(0);
        now = Date.parse(failed.nextAttemptAt!) - 1;
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        now++;
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        await f.store.updateProcess(f.processId, { status: 'completed' });
        f.tasks.clear();
        f.setFailure(new Error('sensitive provider body'));
        await f.deliver('uncertain delivery');
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a').find(row => row.content === 'uncertain delivery')?.state).toBe('ambiguous');
        const proc = (await f.store.getProcess(f.processId))!;
        const notice = proc.conversationTurns?.find(turn => turn.displayOnly && turn.content.includes('uncertain'));
        expect(notice?.content).toContain('Automatic replay is paused');
        expect(notice?.content).not.toContain('sensitive provider body');
        f.setFailure(undefined);
        now += 100_000;
        await f.restart();
        expect(f.sends).toHaveLength(1);
    });

    it('honors typed Retry-After and persists increasing retry delays without polling duplicate sends', async () => {
        const f = await fixture(connector);
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const hint = connector === 'teams' ? 5000 : 0;
        f.setFailure(connector === 'teams'
            ? new TeamsOperationError('private rejection details', 'graph', 'rate-limited', 'rejected', hint)
            : new WhatsAppNotConnectedError());
        await f.deliver('durably delayed desktop mirror');
        await f.mirror.flush();
        const first = f.mirror.outbox.list('workspace-a')[0];
        expect(first.retryCount).toBe(1);
        expect(Date.parse(first.nextAttemptAt!)).toBe(now + Math.max(hint, 1000));
        expect(f.send).toHaveBeenCalledTimes(1);
        now = Date.parse(first.nextAttemptAt!) - 1;
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.send).toHaveBeenCalledTimes(1);
        now++;
        await f.mirror.flush();
        const second = f.mirror.outbox.list('workspace-a')[0];
        expect(second.retryCount).toBe(2);
        expect(Date.parse(second.nextAttemptAt!)).toBe(now + Math.max(hint, 2000));
        expect(second.chunks).toEqual(first.chunks);
        expect(f.send).toHaveBeenCalledTimes(2);
        await f.restart();
        expect(f.send).toHaveBeenCalledTimes(2);
        f.setFailure(undefined);
        now = Date.parse(second.nextAttemptAt!);
        await f.mirror.flush();
        expect(f.send).toHaveBeenCalledTimes(3);
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
        const proc = (await f.store.getProcess(f.processId))!;
        expect(proc.conversationTurns?.some(turn => turn.displayOnly && turn.content.includes('bounded backoff'))).toBe(true);
        expect(proc.conversationTurns?.some(turn => turn.content.includes('private rejection details'))).toBe(false);
    });

    it('preserves accepted admission when a queue observer throws and rejects a definite admission failure', async () => {
        const f = await fixture(connector);
        const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
        f.bridge.enqueueAdmitted.mockImplementationOnce(async input => {
            await enqueue(input);
            throw new Error('observer failed');
        });
        await f.deliver('accepted despite observer');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        await f.store.updateProcess(f.processId, { status: 'completed' });
        f.tasks.clear();
        f.bridge.enqueueAdmitted.mockRejectedValueOnce(new Error('definite reject'));
        await expect(f.deliver('rejected prompt')).rejects.toThrow('Failed to enqueue follow-up');
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a').find(row => row.content === 'rejected prompt')?.failure).toBe('admission-rejected');
        expect(f.sends).toHaveLength(1);
    });

    it('recovers staged intents only from exact canonical acceptance and never scans unmarked historical turns', async () => {
        const f = await fixture(connector);
        const accepted = await f.mirror.capture('workspace-a', f.processId, 'accepted staged');
        await f.store.appendPendingMessage(f.processId, {
            id: accepted!.requestId, relayRequestId: accepted!.requestId,
            content: 'accepted staged', createdAt: new Date().toISOString(),
        });
        await f.mirror.capture('workspace-a', f.processId, 'never accepted');
        await f.restart();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('accepted staged');
        expect(f.mirror.outbox.list('workspace-a').find(row => row.content === 'never accepted')?.failure).toBe('admission-rejected');
    });

    it('serializes a shared physical destination across workspace ledgers while independent destinations remain live', async () => {
        const f = await fixture(connector);
        f.setFailure(new Error('unknown send'));
        await f.deliver('uncertain workspace-a head');
        await f.mirror.flush();
        const destination = f.mirror.outbox.list('workspace-a')[0].destination;
        const processId = 'queue_other-origin';
        await f.store.addProcess({
            id: processId, type: 'clarification', status: 'completed', startTime: new Date(),
            promptPreview: '', fullPrompt: '', conversationTurns: [],
            metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-b' },
        } as AIProcess);
        vi.spyOn(f.adapter, 'destinations').mockReturnValue([destination]);
        vi.spyOn(f.adapter, 'availability').mockReturnValue('ready');
        const second = await f.mirror.capture('workspace-b', processId, 'later shared destination');
        await f.store.appendPendingMessage(processId, {
            id: second!.requestId, relayRequestId: second!.requestId, content: second!.content, createdAt: new Date().toISOString(),
        });
        f.mirror.accepted(second!);
        f.setFailure(undefined);
        await Promise.all([f.mirror.flush(), f.mirror.flush()]);
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-b')[0].state).toBe('pending');
        vi.spyOn(f.adapter, 'destinations').mockReturnValue([{ ...destination, chatKey: 'independent-destination' }]);
        const third = await f.mirror.capture('workspace-b', processId, 'independent destination');
        await f.store.appendPendingMessage(processId, {
            id: third!.requestId, relayRequestId: third!.requestId, content: third!.content, createdAt: new Date().toISOString(),
        });
        f.mirror.accepted(third!);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('independent destination');
    });

    it('does not let an unregistered workspace cached head block a current owner sharing the physical destination', async () => {
        const f = await fixture(connector);
        f.setFailure(new Error('unknown send'));
        await f.deliver('uncertain removed workspace head');
        await f.mirror.flush();
        const first = f.mirror.outbox.list('workspace-a')[0];
        const processId = 'queue_current-owner';
        await f.store.addProcess({
            id: processId, type: 'clarification', status: 'completed', startTime: new Date(),
            promptPreview: '', fullPrompt: '', conversationTurns: [],
            metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-b' },
        } as AIProcess);
        vi.spyOn(f.adapter, 'destinations').mockReturnValue([first.destination]);
        vi.spyOn(f.adapter, 'availability').mockReturnValue('ready');
        const current = (await f.mirror.capture('workspace-b', processId, 'registered owner prompt'))!;
        await f.store.appendPendingMessage(processId, {
            id: current.requestId, relayRequestId: current.requestId, content: current.content,
            createdAt: new Date().toISOString(),
        });
        f.mirror.accepted(current);
        f.setFailure(undefined);
        await f.mirror.flush();
        expect(f.sends).toEqual([]);
        expect(await f.store.removeWorkspace('workspace-a')).toBe(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('registered owner prompt');
        expect(f.mirror.outbox.list('workspace-b')[0].state).toBe('delivered');
        expect(f.mirror.outbox.list('workspace-a')[0]).toMatchObject({
            eventId: first.eventId, state: 'ambiguous', failure: 'unknown',
        });
    });

    it('cancels queued mirroring on process cancellation, release and explicit disconnect', async () => {
        const f = await fixture(connector);
        f.setConnected(false);
        await f.deliver('pending cancelled');
        await f.store.updateProcess(f.processId, { status: 'cancelled' });
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a')[0].failure).toBe('cancelled');
        await f.store.updateProcess(f.processId, { status: 'completed' });
        f.tasks.clear();
        await f.deliver('pending disconnected');
        await f.mirror.cancelConnector(connector);
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
        expect(f.mirror.outbox.list('workspace-a')[1].failure).toBe('unbound');
    });

    it.each(['disconnect', 'cancel', 'release'] as const)('durably suppresses a future final reply after its user mirror is delivered (%s)', async reason => {
        const f = await fixture(connector);
        await f.deliver('delivered user before stop');
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        if (reason === 'disconnect') await f.mirror.cancelConnector(connector);
        else if (reason === 'release') f.setBinding(false);
        else await f.store.updateProcess(f.processId, { status: 'cancelled' });
        await f.mirror.flush();
        f.setBinding(true);
        await f.restart();
        await f.finish('answer after reconnect or resume');
        expect(f.sends).toHaveLength(1);
        expect(f.mirror.outbox.list('workspace-a').find(row => row.role === 'assistant')?.state).toBe('cancelled');
    });

    it('stops multipart dispatch between confirmed parts when cancellation wins', async () => {
        const f = await fixture(connector);
        const send = f.send.getMockImplementation()!;
        f.send.mockImplementationOnce(async (text, threadId) => {
            const id = await send(text, threadId);
            await f.store.updateProcess(f.processId, { status: 'cancelled' });
            return id;
        });
        await f.deliver('long prompt '.repeat(6000));
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        const entry = f.mirror.outbox.list('workspace-a')[0];
        expect(entry.chunks.length).toBeGreaterThan(1);
        expect(entry.nextPart).toBe(1);
        expect(entry.state).toBe('cancelled');
    });

    it('does not replay a confirmed part when own-message receipt persistence fails', async () => {
        const f = await fixture(connector);
        vi.spyOn(f.adapter, 'record').mockImplementationOnce(() => { throw new Error('private disk detail'); });
        await f.deliver('confirmed once');
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.outbound.size).toBe(1);
        expect(f.mirror.outbox.list('workspace-a')[0].state).toBe('delivered');
        const notice = (await f.store.getProcess(f.processId))?.conversationTurns?.find(turn => turn.displayOnly);
        expect(notice?.content).toContain('storage is unavailable');
        expect(notice?.content).not.toContain('private disk detail');
    });

    it('stores a path-free explicit unsupported marker for attachments and never sends attachment context', async () => {
        const f = await fixture(connector);
        await f.deliver('caption', {
            contentWithContext: 'caption\nprivate attachment contents and path',
            attachments: [{ type: 'file', path: 'private/file.bin' }],
            fileAttachmentMeta: [{ filename: 'file.bin', type: 'file' }],
        });
        await f.mirror.flush();
        expect(f.sends[0].text).toContain('attachment(s) cannot be mirrored');
        expect(f.sends[0].text).not.toContain('private');
    });

    it('captures trusted initial queue submissions with server-owned correlation, without trusting wire relay IDs', async () => {
        const f = await fixture(connector);
        const input: CreateTaskInput = {
            type: 'chat', priority: 'normal', config: {}, processId: f.processId,
            payload: { kind: 'chat', mode: 'sentinel', processId: f.processId, workspaceId: 'workspace-a',
                prompt: 'desktop initial', relayRequestId: 'forged-id' },
        };
        const entry = await f.mirror.captureTask(input);
        expect(entry).toBeDefined();
        expect(input.payload.relayRequestId).toBe(entry!.requestId);
        expect(input.payload.relayRequestId).not.toBe('forged-id');
        await f.bridge.enqueueAdmitted(input);
        f.mirror.accepted(entry!);
        await f.mirror.flush();
        expect(f.sends[0].text).toContain('desktop initial');
    });

    it('wires the actual follow-up REST route only for exact owning workspace/process submissions', async () => {
        const f = await fixture(connector);
        const routes: Route[] = [];
        const bridge = Object.assign(f.bridge, { isSessionAlive: async () => true });
        registerApiProcessRoutes({
            routes, store: f.store, bridge: bridge as unknown as QueueExecutorBridge,
            gitOpsStore: {} as never, getSentinelMirror: () => f.mirror,
        });
        const route = routes.find(route => String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/message$/))!;
        expect(await invoke(route, `/api/processes/${f.processId}/message?workspace=workspace-b`,
            { content: 'foreign', origin: 'desktop' })).toBe(404);
        expect(await invoke(route, `/api/processes/${f.processId}/message`, { content: 'unqualified', origin: 'desktop' })).toBe(202);
        await f.store.updateProcess(f.processId, { status: 'completed' });
        f.tasks.clear();
        expect(await invoke(route, `/api/processes/${f.processId}/message?workspace=workspace-a`, { content: 'qualified desktop' })).toBe(202);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('qualified desktop');
        expect(f.sends[0].text).not.toContain('unqualified');
    });

    it.each(['normal', 'observer', 'accept-write'] as const)(
        'canonicalizes repo-only mirrored REST admission and exact recovery after %s failure', async phase => {
            const f = await fixture(connector);
            if (phase === 'observer') {
                const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
                f.bridge.enqueueAdmitted.mockImplementationOnce(async input => {
                    await enqueue(input);
                    throw new Error('Post-admission observer failed');
                });
            }
            if (phase === 'accept-write') {
                vi.spyOn(f.mirror.outbox, 'accept').mockImplementationOnce(() => {
                    throw new Error('Private receipt write diagnostic');
                });
            }
            const route = desktopQueueRoutes(f, path.join(f.directory, 'b')).find(route => route.pattern === '/api/queue')!;
            expect(await invoke(route, '/api/queue', {
                type: 'chat', repoId: 'workspace-a', priority: 'normal', config: {},
                payload: { kind: 'chat', mode: 'sentinel', processId: f.processId,
                    prompt: 'Repo-only desktop prompt', provider: 'copilot' },
            })).toBe(201);
            const receipt = f.mirror.outbox.list('workspace-a').find(row => row.role === 'user')!;
            const task = f.tasks.get(receipt.requestId)!;
            expect(task).toMatchObject({
                repoId: 'workspace-a', processId: f.processId,
                payload: { workspaceId: 'workspace-a', processId: f.processId,
                    relayRequestId: receipt.requestId, workingDirectory: f.directory },
            });
            expect(await f.mirror.rejected(receipt)).toBe(false);
            await f.mirror.flush();
            await f.restart();
            expect(f.sends).toHaveLength(1);
            expect(f.sends[0].text).toContain('Repo-only desktop prompt');
            expect(f.mirror.outbox.list('workspace-a').find(row => row.eventId === receipt.eventId)?.state).toBe('delivered');
        });

    it('leaves repo-only task input untouched when mirroring is disabled', async () => {
        const f = await fixture(connector);
        f.setEnabled(false);
        const task: CreateTaskInput = { id: 'original-id', repoId: 'workspace-a', processId: f.processId,
            type: 'chat', priority: 'normal', payload: { kind: 'chat', mode: 'sentinel',
                processId: f.processId, prompt: 'Unmirrored repo-only input' } };
        const original = structuredClone(task);
        expect(await f.mirror.captureTask(task)).toBeUndefined();
        expect(task).toEqual(original);
    });

    it('wires actual queue REST admission and retains a receipt after a task-added observer fails', async () => {
        const f = await fixture(connector);
        const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
        f.bridge.enqueueAdmitted.mockImplementationOnce(async input => {
            await enqueue(input);
            throw new Error('post-admission observer');
        });
        const routes = desktopQueueRoutes(f);
        const route = routes.find(route => route.pattern === '/api/queue')!;
        expect(await invoke(route, '/api/queue', {
            type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a',
                processId: f.processId, prompt: 'REST queue desktop', provider: 'copilot' },
        })).toBe(201);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('REST queue desktop');
    });

    it('stages every exact-owner bulk prompt before queue admission, without mirroring foreign or disabled submissions', async () => {
        const f = await fixture(connector);
        const routes = desktopQueueRoutes(f);
        const route = routes.find(route => route.pattern === '/api/queue/bulk')!;
        const task = (prompt: string, workspaceId = 'workspace-a') => ({
            type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', mode: 'sentinel', workspaceId,
                processId: f.processId, prompt, provider: 'copilot', relayRequestId: 'forged-correlation' },
        });
        const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
        f.bridge.enqueueAdmitted.mockImplementation(async input => {
            if (input.payload.workspaceId === 'workspace-a') {
                const row = f.mirror.outbox.list('workspace-a').find(row => row.requestId === input.payload.relayRequestId);
                expect(row?.state).toBe('admitting');
                expect(input.payload.relayRequestId).not.toBe('forged-correlation');
            }
            return enqueue(input);
        });
        expect(await invoke(route, '/api/queue/bulk', {
            tasks: [task('bulk first desktop'), task('bulk second desktop'), task('foreign bulk prompt', 'workspace-b')],
        })).toBe(201);
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
        expect(f.sends[0].text).toContain('bulk first desktop');
        expect(f.sends[1].text).toContain('bulk second desktop');
        expect(f.mirror.outbox.list('workspace-b')).toHaveLength(0);
        f.bridge.enqueueAdmitted.mockImplementation(enqueue);
        f.setEnabled(false);
        expect(await invoke(route, '/api/queue/bulk', { tasks: [task('disabled bulk prompt')] })).toBe(201);
        f.setEnabled(true);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(2);
    });

    it('preserves bulk admission after an observer failure and rejects definite failure without replay', async () => {
        const f = await fixture(connector);
        const routes = desktopQueueRoutes(f);
        const route = routes.find(route => route.pattern === '/api/queue/bulk')!;
        const enqueue = f.bridge.enqueueAdmitted.getMockImplementation()!;
        f.bridge.enqueueAdmitted.mockImplementationOnce(async input => {
            await enqueue(input);
            throw new Error('private accepted observer diagnostic');
        }).mockRejectedValueOnce(new Error('private definite rejection diagnostic'));
        expect(await invoke(route, '/api/queue/bulk', {
            tasks: ['accepted bulk prompt', 'rejected bulk prompt'].map(prompt => ({
                type: 'chat', priority: 'normal', config: {},
                payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a',
                    processId: f.processId, prompt, provider: 'copilot' },
            })),
        })).toBe(207);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(1);
        expect(f.sends[0].text).toContain('accepted bulk prompt');
        expect(f.mirror.outbox.list('workspace-a').find(row => row.content === 'rejected bulk prompt')?.failure)
            .toBe('admission-rejected');
        await f.restart();
        expect(f.sends).toHaveLength(1);
    });

    it('never retroactively mirrors the preserved prompt replayed by retry', async () => {
        const f = await fixture(connector);
        const sourceId = f.processId.slice('queue_'.length);
        f.tasks.set(sourceId, {
            id: sourceId, repoId: 'workspace-a', processId: f.processId, type: 'chat',
            status: 'failed', config: {},
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a',
                prompt: 'stored historical prompt', provider: 'copilot', relayRequestId: 'old-request' },
        } as QueuedTask);
        await f.store.updateProcess(f.processId, { status: 'failed' });
        const capture = vi.spyOn(f.mirror, 'captureTask');
        const routes = desktopQueueRoutes(f);
        const retry = routes.find(route => route.method === 'POST'
            && String(route.pattern) === String(/^\/api\/queue\/([^/]+)\/retry$/))!;
        expect(await invoke(retry, `/api/queue/${sourceId}/retry`, {})).toBe(201);
        expect(capture).not.toHaveBeenCalled();
        expect(f.mirror.outbox.list('workspace-a')).toHaveLength(0);
        await f.mirror.flush();
        expect(f.sends).toHaveLength(0);
    });
});

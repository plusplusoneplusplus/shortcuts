import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { GitOpsStore, RepoQueueRegistry, SqliteProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import type { BotControlSource } from '@plusplusoneplusplus/forge/ai';
import type { ConversationSnapshotPayload } from '@plusplusoneplusplus/coc-client';
import { createWebSocketInfrastructure } from '../../src/server/infrastructure/websocket-infrastructure';
import { toProcessSummary, type ProcessWebSocketServer, type ServerMessage } from '../../src/server/streaming/websocket';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import type { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { createBotControlMetadata } from '../../src/server/messaging/bot-control-metadata';
import { registerApiProcessRoutes } from '../../src/server/routes/api-process-routes';
import { createRouter } from '../../src/server/shared/router';
import { getServerLogger } from '../../src/server/logging/server-logger';
import { parseSSEFrames } from '../helpers/sse-test-utils';
import type { Route } from '../../src/server/types';

describe('bot control realtime read boundary', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let enabled: boolean;
    let baseUrl: string;
    let ws: ProcessWebSocketServer;
    const servers: http.Server[] = [];
    const sockets: ProcessWebSocketServer[] = [];
    let events: ServerMessage[];

    async function serve(getEnabled?: () => boolean) {
        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes, store, dataDir: dir, gitOpsStore: new GitOpsStore({ dataDir: dir }),
            getLiveFeatureFlags: getEnabled && (() => ({
                excalidrawEnabled: false, canvasEnabled: false, kustoEnabled: false,
                chatStyleSelectorEnabled: false, chatProviderSwitchingEnabled: false,
                defaultChatStyle: 'default', botManagedConversationsEnabled: getEnabled(),
            })),
        });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        const socket = createWebSocketInfrastructure(server, store, bridge, bridge.registry,
            new EventEmitter() as ScheduleManager, undefined, undefined, getEnabled);
        servers.push(server);
        sockets.push(socket);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        return { url: `http://127.0.0.1:${address.port}`, socket };
    }

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-bot-realtime-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
        for (const id of ['ws-first', 'ws-second']) {
            const rootPath = path.join(dir, id);
            await store.registerWorkspace({ id, name: id, rootPath });
            bridge.registerRepoId(id, rootPath);
            bridge.registry.getQueueForRepo(rootPath).pause();
        }
        enabled = true;
        events = [];
        const owner = await serve(() => enabled);
        baseUrl = owner.url;
        ws = owner.socket;
        ws.onBroadcast(text => {
            events.push(JSON.parse(text));
        });
    });

    afterEach(async () => {
        sockets.splice(0).forEach(socket => socket.closeAll());
        await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()))));
        bridge.dispose();
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
        expect(JSON.stringify(events)).not.toMatch(/controllerKey|externalThreadUrl|private-value/);
    });

    function presentation(source: BotControlSource) {
        return { state: 'active', source, controllerLabel: createBotControlMetadata(source).controllerLabel };
    }

    async function add(source?: BotControlSource, extras: Partial<AIProcess> = {}) {
        const process: AIProcess = {
            id: 'topic', type: 'chat', promptPreview: 'A conversation', status: 'completed',
            startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex',
                ...(source ? { botControl: createBotControlMetadata(source) } : {}) },
            conversationTurns: [{ role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0 }],
            ...extras,
        };
        await store.addProcess(process);
        return process;
    }

    function enqueue(source?: BotControlSource, workspaceId = 'ws-first', processId?: string) {
        const manager = bridge.registry.getQueueForRepo(path.join(dir, workspaceId));
        const id = manager.enqueue({
            type: 'chat', priority: 'normal', repoId: workspaceId, config: {},
            payload: { kind: 'chat', mode: 'ask', prompt: 'A conversation', workspaceId, processId, provider: 'codex' },
            ...(source ? { botControl: createBotControlMetadata(source) } : {}),
        });
        const task = manager.getTask(id);
        if (!task) throw new Error('Missing admitted task');
        return task;
    }

    async function snapshot(url = baseUrl, workspaceId = 'ws-first') {
        const response = await fetch(`${url}/api/processes/topic/stream?workspace=${workspaceId}`);
        const text = await response.text();
        expect(text).not.toMatch(/controllerKey|externalThreadUrl|private-value/);
        return { status: response.status, frames: parseSSEFrames([text]) };
    }

    function queueEvents() {
        return events.filter((event): event is Extract<ServerMessage, { type: 'queue-updated' }> =>
            event.type === 'queue-updated');
    }

    async function waitForQueues(count = 2) {
        await vi.waitFor(() => expect(queueEvents()).toHaveLength(count));
        return queueEvents();
    }

    it.each(['teams', 'whatsapp'] as const)('projects %s process changes and reconnect snapshots without private authority', async source => {
        const proc = await add(source);
        const added = events.find(event => event.type === 'process-added');
        expect(added).toMatchObject({ process: { id: 'topic', workspaceId: 'ws-first', botControl: presentation(source) } });
        for (let i = 0; i < 2; i++) {
            const result = await snapshot();
            expect(result.status).toBe(200);
            const payload = result.frames.find(frame => frame.event === 'conversation-snapshot')?.data as ConversationSnapshotPayload;
            expect(payload.botControl).toEqual(presentation(source));
            expect(payload.turns[0].content).toBe('Hello');
        }
        await store.updateProcess('topic', { metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex' } });
        expect(events.at(-1)).toMatchObject({ type: 'process-updated', process: { id: 'topic' } });
        expect(events.at(-1)).not.toHaveProperty('process.botControl');
        expect((await snapshot()).frames[0].data).toMatchObject({ botControl: null });
        expect(proc.metadata?.botControl).toEqual(createBotControlMetadata(source));
    });

    it('uses the live owning-server gate, including default-off streams and independent sockets', async () => {
        const proc = await add('teams');
        const ownerObserver = store.onProcessChange;
        const other = await serve();
        const otherObserver = store.onProcessChange;
        store.onProcessChange = event => { ownerObserver?.(event); otherObserver?.(event); };
        const otherEvents: ServerMessage[] = [];
        other.socket.onBroadcast(text => otherEvents.push(JSON.parse(text)));
        for (const gate of [false, true, false]) {
            enabled = gate;
            await store.updateProcess('topic', { title: `Gate ${gate}` });
            const ownerUpdate = events.filter(event => event.type === 'process-updated').at(-1);
            expect(Boolean(ownerUpdate?.process.botControl)).toBe(gate);
            bridge.emit('queueChange', { repoPath: path.join(dir, 'ws-first'), repoId: 'ws-first', type: 'refresh' });
            const payload = (await snapshot()).frames[0].data as ConversationSnapshotPayload;
            expect(Boolean(payload.botControl)).toBe(gate);
            expect(toProcessSummary(proc, gate).botControl).toEqual(gate ? presentation('teams') : undefined);
        }
        expect((await snapshot(other.url)).frames[0].data).not.toHaveProperty('botControl');
        expect(otherEvents.every(event => !JSON.stringify(event).includes('botControl'))).toBe(true);
        expect((await store.getProcess('topic'))?.metadata?.botControl).toBeDefined();
    });

    it.each(['teams', 'whatsapp'] as const)('projects an unmarked fork of a %s-controlled conversation', async source => {
        await add(source);
        await store.forkProcess('topic', 'fork');
        const added = events.filter(event => event.type === 'process-added');
        expect(added.at(-1)).toMatchObject({ process: { id: 'fork', workspaceId: 'ws-first' } });
        expect(added.at(-1)).not.toHaveProperty('process.botControl');
        const response = await fetch(`${baseUrl}/api/processes/fork/stream?workspace=ws-first`);
        const frames = parseSSEFrames([await response.text()]);
        expect(frames[0].data).toMatchObject({ botControl: null });
        expect((await snapshot()).frames[0].data).toMatchObject({ botControl: presentation(source) });
    });

    it.each(['removed', 'moved'] as const)('does not replay stale ownership when a running process is %s during flush', async change => {
        await add('teams', { status: 'running' });
        vi.spyOn(store, 'requestFlush').mockImplementationOnce(async id => {
            if (change === 'removed') await store.removeProcess(id);
            else await store.updateProcess(id, { metadata: { type: 'chat', workspaceId: 'ws-second',
                botControl: createBotControlMetadata('teams') } });
        });
        const result = await snapshot();
        expect(result.frames).toHaveLength(0);
    });

    it('samples the SSE gate after flush and keeps warm-only streams free of control metadata', async () => {
        await add('teams', { status: 'running' });
        vi.spyOn(store, 'requestFlush').mockImplementationOnce(async id => {
            enabled = false;
            await store.updateProcess(id, { status: 'completed' });
        });
        expect((await snapshot()).frames[0].data).not.toHaveProperty('botControl');
        enabled = true;
        const controller = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/api/processes/topic/stream?workspace=ws-first&warm=1`,
                { signal: controller.signal });
            const reader = response.body!.getReader();
            const chunk = await reader.read();
            const text = new TextDecoder().decode(chunk.value);
            expect(text).toContain('event: warm_status');
            expect(text).not.toMatch(/botControl|controllerKey|conversation-snapshot/);
            await reader.cancel();
        } finally {
            controller.abort();
        }
    });

    it('rejects SSE workspace mismatch before sending conversation or ownership', async () => {
        await add('whatsapp');
        const result = await snapshot(baseUrl, 'ws-second');
        expect(result.status).toBe(404);
        expect(result.frames).toHaveLength(0);
    });

    it('includes safe control for an admitted process with no persisted turns', async () => {
        await add('teams', { conversationTurns: [] });
        expect((await snapshot()).frames[0].data).toMatchObject({ turns: [], botControl: presentation('teams') });
        enabled = false;
        expect((await snapshot()).frames.some(frame => frame.event === 'conversation-snapshot')).toBe(false);
    });

    it.each([
        undefined, null, 'private-value', { state: 'active', source: 'teams' },
        { ...createBotControlMetadata('teams'), account: 'private-value' },
        { ...createBotControlMetadata('teams'), controllerLabel: 'private-value' },
    ])('omits invalid or missing control from all realtime projections: %j', async value => {
        const proc = await add();
        proc.metadata = { type: 'chat', workspaceId: 'ws-first', botControl: value };
        await store.updateProcess('topic', { metadata: proc.metadata });
        expect(toProcessSummary(proc, true)).not.toHaveProperty('botControl');
        expect((await snapshot()).frames[0].data).toMatchObject({ botControl: null });
        const task = enqueue(undefined, 'ws-first', 'topic');
        const messages = await waitForQueues();
        expect(messages[0].queue.queued.find(row => row.id === task.id)).not.toHaveProperty('botControl');
    });

    it.each(['https://teams.microsoft.com/l/message/thread/item?token=private-value', 'javascript:private-value'])(
        'omits unsupported or unauthorized saved links without erasing valid control: %s', async url => {
            await add(undefined, { metadata: { type: 'chat', workspaceId: 'ws-first',
                botControl: { ...createBotControlMetadata('teams'), externalThreadUrl: url } } });
            expect((await snapshot()).frames[0].data).toMatchObject({ botControl: presentation('teams') });
            expect(events[0]).toMatchObject({ process: { botControl: presentation('teams') } });
        });

    it.each(['teams', 'whatsapp'] as const)('projects %s queued admission on scoped and aggregate snapshots', async source => {
        const task = enqueue(source);
        const messages = await waitForQueues();
        expect(messages[0].queue.repoId).toBe('ws-first');
        expect(messages[1].queue.repoId).toBeUndefined();
        for (const message of messages) {
            expect(message.queue.queued[0]).toMatchObject({ id: task.id, repoId: 'ws-first', botControl: presentation(source) });
        }
        expect(task.botControl).toEqual(createBotControlMetadata(source));
    });

    it('preserves queued/running control while current ownership supersedes stale provenance', async () => {
        const task = enqueue('teams');
        await waitForQueues();
        events.length = 0;
        await add('whatsapp', { id: `queue_${task.id}`, status: 'running' });
        await waitForQueues();
        expect(queueEvents()[0].queue.queued[0].botControl).toEqual(presentation('whatsapp'));
        events.length = 0;
        bridge.registry.getQueueForRepo(path.join(dir, 'ws-first')).markStarted(task.id);
        await waitForQueues();
        expect(queueEvents()[0].queue.running[0].botControl).toEqual(presentation('whatsapp'));
        events.length = 0;
        await store.updateProcess(`queue_${task.id}`, { metadata: { type: 'chat', workspaceId: 'ws-first' } });
        await waitForQueues();
        expect(queueEvents()[0].queue.running[0]).not.toHaveProperty('botControl');
    });

    it('keeps human/automated follow-ups controlled without claiming ordinary automation', async () => {
        await add('teams');
        enqueue(undefined, 'ws-first', 'topic');
        const automated = enqueue('whatsapp', 'ws-first', 'topic');
        const ordinary = enqueue();
        await vi.waitFor(() => expect(queueEvents().at(-1)?.queue.queued).toHaveLength(3));
        const rows = queueEvents().at(-1)!.queue.queued;
        expect(rows.find(row => row.id === automated.id)?.botControl).toEqual(presentation('teams'));
        expect(rows.find(row => row.id === ordinary.id)).not.toHaveProperty('botControl');
    });

    it('does not reread every queued target on unrelated streaming process updates', async () => {
        await add('teams');
        enqueue(undefined, 'ws-first', 'topic');
        await waitForQueues();
        events.length = 0;
        const read = vi.spyOn(store, 'getProcess');
        await store.updateProcess('topic', { title: 'Updated title' });
        // updateProcess rereads its saved record for the process event itself.
        expect(read).toHaveBeenCalledTimes(1);
        expect(queueEvents()).toHaveLength(0);
        expect(events[0]).toMatchObject({ type: 'process-updated', process: { botControl: presentation('teams') } });
    });

    it('isolates workspaces and suppresses forged cross-workspace follow-up provenance', async () => {
        await add('teams');
        const other = enqueue('whatsapp', 'ws-second');
        const mismatch = enqueue('whatsapp', 'ws-second', 'topic');
        await vi.waitFor(() => expect(queueEvents().at(-1)?.queue.queued).toHaveLength(2));
        const rows = queueEvents().at(-1)!.queue.queued;
        expect(rows.find(row => row.id === other.id)?.botControl).toEqual(presentation('whatsapp'));
        expect(rows.find(row => row.id === mismatch.id)).not.toHaveProperty('botControl');
    });

    it('refreshes the original queue when its controlled target moves to another workspace', async () => {
        await add('teams');
        enqueue('whatsapp', 'ws-first', 'topic');
        await waitForQueues();
        events.length = 0;
        await store.updateProcess('topic', { metadata: { type: 'chat', workspaceId: 'ws-second',
            botControl: createBotControlMetadata('teams') } });
        const messages = await waitForQueues();
        expect(messages[0].queue.repoId).toBe('ws-first');
        expect(messages[0].queue.queued[0]).not.toHaveProperty('botControl');
        expect(messages[1].queue.queued[0]).not.toHaveProperty('botControl');
    });

    it('does no ownership reads when disabled and retains synchronous default behavior', () => {
        enabled = false;
        const read = vi.spyOn(store, 'getProcess');
        enqueue('teams');
        expect(queueEvents()).toHaveLength(2);
        expect(queueEvents()[0].queue.queued[0]).not.toHaveProperty('botControl');
        expect(read).not.toHaveBeenCalled();
    });

    it('prevents a slow old queue snapshot from reviving cancelled work', async () => {
        let resolveRead!: (process: AIProcess | undefined) => void;
        vi.spyOn(store, 'getProcess').mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
        const task = enqueue('teams');
        bridge.registry.getQueueForRepo(path.join(dir, 'ws-first')).cancelTask(task.id);
        await waitForQueues();
        expect(queueEvents()[0].queue.queued).toHaveLength(0);
        resolveRead(undefined);
        await new Promise(resolve => setImmediate(resolve));
        expect(queueEvents()).toHaveLength(2);
    });

    it('prevents an in-flight ownership read from reviving released process control', async () => {
        const proc = await add('teams');
        let resolveRead!: (process: AIProcess | undefined) => void;
        vi.spyOn(store, 'getProcess').mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
        enqueue('whatsapp', 'ws-first', 'topic');
        await store.updateProcess('topic', { metadata: { type: 'chat', workspaceId: 'ws-first' } });
        await waitForQueues();
        expect(queueEvents()[0].queue.queued[0]).not.toHaveProperty('botControl');
        resolveRead(proc);
        await new Promise(resolve => setImmediate(resolve));
        expect(queueEvents()).toHaveLength(2);
    });

    it('preserves independent per-workspace snapshots when another workspace supersedes the aggregate', async () => {
        let resolveRead!: (process: AIProcess | undefined) => void;
        vi.spyOn(store, 'getProcess').mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
        enqueue('teams');
        enqueue('whatsapp', 'ws-second');
        await waitForQueues();
        resolveRead(undefined);
        const messages = await waitForQueues(3);
        expect(messages.filter(message => !message.queue.repoId)).toHaveLength(1);
        expect(messages.find(message => message.queue.repoId === 'ws-first')?.queue.queued[0].botControl).toEqual(presentation('teams'));
        expect(messages.find(message => message.queue.repoId === 'ws-second')?.queue.queued[0].botControl).toEqual(presentation('whatsapp'));
    });

    it('rechecks the gate before broadcasting an asynchronously projected queue snapshot', async () => {
        let resolveRead!: (process: AIProcess | undefined) => void;
        vi.spyOn(store, 'getProcess').mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
        enqueue('teams');
        enabled = false;
        resolveRead(undefined);
        const messages = await waitForQueues();
        expect(messages[0].queue.queued[0]).not.toHaveProperty('botControl');
    });

    it('logs failed ownership reads without broadcasting false control or leaking store errors; retry succeeds', async () => {
        const error = vi.spyOn(getServerLogger(), 'error');
        vi.spyOn(store, 'getProcess').mockRejectedValueOnce(new Error('private-value'));
        enqueue('teams');
        await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Unable to project bot control for queue WebSocket snapshot'));
        expect(queueEvents()).toHaveLength(0);
        bridge.emit('queueChange', { repoPath: path.join(dir, 'ws-first'), repoId: 'ws-first', type: 'refresh' });
        expect((await waitForQueues())[0].queue.queued[0].botControl).toEqual(presentation('teams'));
    });

    it('sends safe managed process summaries over an actual workspace-scoped WebSocket', async () => {
        const socket = new WebSocket(baseUrl.replace('http:', 'ws:') + '/ws?workspaceId=ws-first');
        const messages: ServerMessage[] = [];
        socket.on('message', data => messages.push(JSON.parse(data.toString())));
        try {
            await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
            socket.send(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-first' }));
            socket.send(JSON.stringify({ type: 'ping' }));
            await vi.waitFor(() => expect(messages.some(message => message.type === 'pong')).toBe(true));
            await add('teams');
            await add('whatsapp', { id: 'other', metadata: { type: 'chat', workspaceId: 'ws-second',
                botControl: createBotControlMetadata('whatsapp') } });
            await vi.waitFor(() => expect(messages.some(message => message.type === 'process-added')).toBe(true));
            expect(messages.filter(message => message.type === 'process-added')).toEqual([
                expect.objectContaining({ process: expect.objectContaining({ id: 'topic', botControl: presentation('teams') }) }),
            ]);
            expect(JSON.stringify(messages)).not.toMatch(/controllerKey|externalThreadUrl/);
        } finally {
            socket.close();
            await new Promise<void>(resolve => socket.once('close', resolve));
        }
    });
});

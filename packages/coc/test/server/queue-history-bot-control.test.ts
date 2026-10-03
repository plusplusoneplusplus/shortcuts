import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RepoQueueRegistry, SqliteProcessStore, type AIProcess, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { BotControlSource } from '@plusplusoneplusplus/forge/ai';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { registerQueueRoutes } from '../../src/server/queue/queue-handler';
import { registerProcessHistoryRoutes } from '../../src/server/processes/process-history-handler';
import { createRouter } from '../../src/server/shared/router';
import { createBotControlMetadata } from '../../src/server/messaging/bot-control-metadata';
import { projectQueueTaskBotControl } from '../../src/server/processes/bot-control-read-model';
import { processToQueuedTask, processToTaskDetail } from '../../src/server/shared/process-history-mapper';
import type { Route } from '../../src/server/types';

describe('queue and history bot control read boundary', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let enabled: boolean;
    let baseUrl: string;
    const servers: http.Server[] = [];

    async function serve(getEnabled?: () => boolean): Promise<string> {
        const routes: Route[] = [];
        registerQueueRoutes(routes, bridge, store, undefined, { botManagedConversationsEnabled: getEnabled });
        registerProcessHistoryRoutes(routes, store, getEnabled);
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        return `http://127.0.0.1:${address.port}`;
    }

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-queue-bot-reads-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
        for (const id of ['ws-first', 'ws-second']) {
            const rootPath = path.join(dir, id);
            await store.registerWorkspace({ id, name: id, rootPath });
            bridge.registerRepoId(id, rootPath);
            bridge.registry.getQueueForRepo(rootPath).pause();
        }
        enabled = true;
        baseUrl = await serve(() => enabled);
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()))));
        bridge.dispose();
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function manager(workspaceId = 'ws-first') {
        return bridge.registry.getQueueForRepo(path.join(dir, workspaceId));
    }

    function enqueue(source?: BotControlSource, workspaceId = 'ws-first', processId?: string): QueuedTask {
        const id = manager(workspaceId).enqueue({
            type: 'chat', repoId: workspaceId, priority: 'normal',
            payload: { kind: 'chat', mode: 'ask', prompt: 'A conversation', workspaceId, provider: 'codex', processId },
            config: {},
            ...(source ? { botControl: createBotControlMetadata(source) } : {}),
        });
        const task = manager(workspaceId).getTask(id);
        if (!task) throw new Error('Missing admitted task');
        return task;
    }

    async function addProcess(id: string, source?: BotControlSource, workspaceId = 'ws-first', extras: Partial<AIProcess> = {}) {
        const process: AIProcess = {
            id, type: 'chat', status: 'completed', startTime: new Date('2026-01-01T00:00:00Z'),
            endTime: new Date('2026-01-01T00:01:00Z'), promptPreview: 'A conversation', title: 'Topic',
            metadata: { type: 'chat', workspaceId, provider: 'codex', ...(source ? { botControl: createBotControlMetadata(source) } : {}) },
            ...extras,
        };
        await store.addProcess(process);
        return process;
    }

    function presentation(source: BotControlSource) {
        return { state: 'active', source, controllerLabel: createBotControlMetadata(source).controllerLabel };
    }

    async function read(route: string, origin = baseUrl) {
        const response = await fetch(origin + route);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain('controllerKey');
        expect(text).not.toContain('externalThreadUrl');
        expect(text).not.toContain('private-value');
        return JSON.parse(text);
    }

    it.each(['teams', 'whatsapp'] as const)('projects trusted queued %s control on list and detail before execution', async source => {
        const task = enqueue(source);
        manager().insertPauseMarker(0, 1);
        const queued = (await read('/api/queue?repoId=ws-first')).queued;
        expect(queued.find((row: { id: string }) => row.id === task.id).botControl).toEqual(presentation(source));
        expect(queued.find((row: { kind?: string }) => row.kind === 'pause-marker')).not.toHaveProperty('botControl');
        expect((await read(`/api/queue/${task.id}`)).task.botControl).toEqual(presentation(source));
        expect((await read('/api/queue')).queued[0].botControl).toEqual(presentation(source));
        expect(task.botControl).toEqual(createBotControlMetadata(source));
        expect(task.payload.provider).toBe('codex');
    });

    it.each(['teams', 'whatsapp'] as const)('projects current %s control on durable queue detail and both histories', async source => {
        await addProcess('queue_saved', source);
        expect((await read('/api/queue/saved')).task.botControl).toEqual(presentation(source));
        expect((await read('/api/queue/history')).history[0].botControl).toEqual(presentation(source));
        expect((await read('/api/workspaces/ws-first/history')).history[0].botControl).toEqual(presentation(source));
        expect((await store.getProcess('queue_saved'))?.metadata?.botControl).toEqual(createBotControlMetadata(source));
    });

    it('samples the live gate on every read without clearing persisted or queued authority', async () => {
        const task = enqueue('teams');
        await addProcess('queue_saved', 'whatsapp');
        for (const gate of [false, true, false]) {
            enabled = gate;
            for (const route of ['/api/queue', `/api/queue/${task.id}`, '/api/queue/saved', '/api/queue/history', '/api/workspaces/ws-first/history']) {
                const body = await read(route);
                const row = body.task ?? body.history?.[0] ?? body.queued[0];
                expect(Boolean(row.botControl)).toBe(gate);
            }
        }
        expect(task.botControl).toBeDefined();
        expect((await store.getProcess('queue_saved'))?.metadata?.botControl).toBeDefined();
    });

    it('keeps owning-server gates independent through clone-qualified clients', async () => {
        enqueue('teams');
        await addProcess('queue_saved', 'whatsapp');
        const other = await serve();
        const ownerClient = new CocClient({ baseUrl });
        const otherClient = new CocClient({ baseUrl: other });
        expect((await ownerClient.queue.list()).queued[0].botControl).toEqual(presentation('teams'));
        expect((await otherClient.queue.list()).queued[0]).not.toHaveProperty('botControl');
        expect((await ownerClient.workspaces.history('ws-first')).history[0].botControl).toEqual(presentation('whatsapp'));
        expect((await otherClient.workspaces.history('ws-first')).history[0]).not.toHaveProperty('botControl');
    });

    it('uses current process ownership for running tasks and never revives released queued provenance', async () => {
        const task = enqueue('teams');
        manager().markStarted(task.id);
        await addProcess(`queue_${task.id}`, 'teams', 'ws-first', { status: 'running' });
        expect((await read('/api/queue')).running[0].botControl).toEqual(presentation('teams'));
        const proc = await store.getProcess(`queue_${task.id}`);
        await store.updateProcess(proc!.id, { metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex' } });
        expect((await read('/api/queue')).running[0]).not.toHaveProperty('botControl');
        expect((await read(`/api/queue/${task.id}`)).task).not.toHaveProperty('botControl');
        expect(task.botControl).toBeDefined();
    });

    it('preserves existing control for human and automated follow-ups without accepting competing queue claims', async () => {
        await addProcess('topic', 'teams');
        const human = enqueue(undefined, 'ws-first', 'topic');
        const automated = enqueue('whatsapp', 'ws-first', 'topic');
        for (const task of [human, automated]) {
            expect((await read(`/api/queue/${task.id}`)).task.botControl).toEqual(presentation('teams'));
        }
        const proc = await store.getProcess('topic');
        await store.updateProcess('topic', { metadata: { type: 'chat', workspaceId: 'ws-first' } });
        expect((await read(`/api/queue/${automated.id}`)).task).not.toHaveProperty('botControl');
        expect(proc?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('reads current control rather than stale admission data on merged in-memory history', async () => {
        const task = enqueue('teams');
        manager().cancelTask(task.id);
        await addProcess(`queue_${task.id}`, 'whatsapp');
        expect((await read('/api/queue/history')).history).toHaveLength(1);
        expect((await read('/api/queue/history')).history[0].botControl).toEqual(presentation('whatsapp'));
        await store.updateProcess(`queue_${task.id}`, { metadata: { type: 'chat', workspaceId: 'ws-first' } });
        expect((await read('/api/queue/history')).history[0]).not.toHaveProperty('botControl');
    });

    it('does not attribute cancelled-before-creation origins or orphaned follow-ups', async () => {
        const task = enqueue('teams');
        manager().cancelTask(task.id);
        expect((await read('/api/queue/history')).history[0]).not.toHaveProperty('botControl');
        expect((await read(`/api/queue/${task.id}`)).task).not.toHaveProperty('botControl');
        const followUp = enqueue('whatsapp', 'ws-first', 'missing');
        expect((await read(`/api/queue/${followUp.id}`)).task).not.toHaveProperty('botControl');
    });

    it('rejects persisted and payload workspace drift without leaking another workspace control', async () => {
        await addProcess('other-topic', 'teams', 'ws-second');
        const task = enqueue('whatsapp', 'ws-first', 'other-topic');
        expect((await read(`/api/queue/${task.id}`)).task).not.toHaveProperty('botControl');
        expect((await read('/api/workspaces/ws-first/history')).history).toEqual([]);
        expect((await read('/api/workspaces/ws-second/history')).history[0].botControl).toEqual(presentation('teams'));
        task.payload.workspaceId = 'ws-second';
        expect(await projectQueueTaskBotControl(task, store, true)).toBeUndefined();
    });

    it('keeps scoped queue and history results separate across workspaces', async () => {
        enqueue('teams');
        enqueue('whatsapp', 'ws-second');
        await addProcess('first', 'teams');
        await addProcess('second', 'whatsapp', 'ws-second');
        for (const [workspaceId, source] of [['ws-first', 'teams'], ['ws-second', 'whatsapp']] as const) {
            expect((await read(`/api/queue?repoId=${workspaceId}`)).queued.map((row: { botControl: unknown }) => row.botControl))
                .toEqual([presentation(source)]);
            expect((await read(`/api/queue/history?repoId=${workspaceId}`)).history.map((row: { botControl: unknown }) => row.botControl))
                .toEqual([presentation(source)]);
        }
    });

    it('omits unauthorized links on every stored read surface while preserving safe core control', async () => {
        await addProcess('queue_saved', undefined, 'ws-first', {
            metadata: { type: 'chat', workspaceId: 'ws-first', botControl: {
                ...createBotControlMetadata('teams'), externalThreadUrl: 'https://teams.microsoft.com/l/message/thread/message?token=private-value',
            } },
        });
        for (const route of ['/api/queue/saved', '/api/queue/history', '/api/workspaces/ws-first/history']) {
            const body = await read(route);
            expect((body.task ?? body.history[0]).botControl).toEqual(presentation('teams'));
        }
    });

    it.each([null, [], 'teams', { ...createBotControlMetadata('teams'), credentials: 'private-value' }])(
        'omits malformed persisted control on every stored read surface %#', async botControl => {
            await addProcess('queue_saved');
            store.getDatabase().prepare('UPDATE processes SET metadata = ? WHERE id = ?').run(
                JSON.stringify({ type: 'chat', workspaceId: 'ws-first', botControl }), 'queue_saved',
            );
            for (const route of ['/api/queue/saved', '/api/queue/history', '/api/workspaces/ws-first/history']) {
                const body = await read(route);
                expect(body.task ?? body.history[0]).not.toHaveProperty('botControl');
            }
        },
    );

    it('does not infer control for ordinary prompts, providers, or automated-turn metadata', async () => {
        enqueue();
        await addProcess('queue_ordinary', undefined, 'ws-first', {
            fullPrompt: 'Teams bridge automated conversation',
            metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex', automated: true },
        });
        expect((await read('/api/queue')).queued[0]).not.toHaveProperty('botControl');
        expect((await read('/api/queue/history')).history[0]).not.toHaveProperty('botControl');
        expect((await read('/api/workspaces/ws-first/history')).history[0]).not.toHaveProperty('botControl');
    });

    it.each([
        { repoId: undefined },
        { payload: { kind: 'chat', workspaceId: 'ws-second' } },
        { payload: { kind: 'run-script', workspaceId: 'ws-first' } },
        { type: 'run-script' },
        { status: 'running' },
        { botControl: null },
        { botControl: { ...createBotControlMetadata('teams'), controllerLabel: 'private-value' } },
        { botControl: { ...createBotControlMetadata('teams'), credentials: 'private-value' } },
    ])('rejects invalid or inapplicable queued provenance %#', async changes => {
        const task = Object.assign(enqueue('teams'), changes);
        expect(await projectQueueTaskBotControl(task, store, true)).toBeUndefined();
    });

    it('does not accept payload/config control claims as queue authority', async () => {
        const task = enqueue();
        task.payload.botControl = createBotControlMetadata('teams');
        Object.assign(task.config, { botControl: createBotControlMetadata('whatsapp') });
        expect(await projectQueueTaskBotControl(task, store, true)).toBeUndefined();
    });

    it('omits an unauthorized queued link without changing immutable admission metadata', async () => {
        const task = enqueue('teams');
        const control = { ...createBotControlMetadata('teams'), externalThreadUrl: 'javascript:private-value' };
        task.botControl = control;
        expect((await read(`/api/queue/${task.id}`)).task.botControl).toEqual(presentation('teams'));
        expect((await read('/api/queue')).queued[0].botControl).toEqual(presentation('teams'));
        expect(task.botControl).toEqual(control);
    });

    it('preserves safe history across reload, release, and fork without copying authority into retry reconstruction', async () => {
        const original = await addProcess('queue_saved', 'teams');
        expect(processToQueuedTask(original)).not.toHaveProperty('botControl');
        expect(processToTaskDetail(original)).not.toHaveProperty('botControl');
        const fork = await store.forkProcess('queue_saved', 'queue_fork', 0);
        expect(fork.metadata).not.toHaveProperty('botControl');
        const reopened = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        try {
            expect((await projectQueueTaskBotControl(enqueue(undefined, 'ws-first', 'queue_saved'), reopened, true)))
                .toEqual(presentation('teams'));
        } finally {
            reopened.close();
        }
        expect((await read('/api/queue/fork')).task).not.toHaveProperty('botControl');
        const history = (await read('/api/workspaces/ws-first/history')).history;
        expect(history.find((row: { id: string }) => row.id === 'queue_saved').botControl).toEqual(presentation('teams'));
        expect(history.find((row: { id: string }) => row.id === 'queue_fork')).not.toHaveProperty('botControl');
    });

    it('does not read process records when disabled and propagates enabled lookup failures', async () => {
        const task = enqueue('teams');
        const lookup = vi.spyOn(store, 'getProcess').mockRejectedValue(new Error('Store unavailable'));
        expect(await projectQueueTaskBotControl(task, store, false)).toBeUndefined();
        expect(lookup).not.toHaveBeenCalled();
        await expect(projectQueueTaskBotControl(task, store, true)).rejects.toThrow('Store unavailable');
        const response = await fetch(baseUrl + '/api/queue');
        expect(response.status).toBe(500);
    });
});

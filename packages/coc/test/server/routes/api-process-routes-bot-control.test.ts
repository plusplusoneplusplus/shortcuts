import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitOpsStore, SqliteProcessStore, type AIProcess, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { BotControlSource } from '@plusplusoneplusplus/forge/ai';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { ApiRouteContext } from '../../../src/server/routes/api-shared';
import type { Route } from '../../../src/server/types';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { processOperationAdmission } from '../../../src/server/processes/process-operation-admission';
import { registerPinArchiveRoutes } from '../../../src/server/processes/pin-archive-handler';

describe('process REST bot control boundary', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let enabled: boolean;
    let baseUrl: string;
    const servers: http.Server[] = [];
    const tasks = new Map<string, QueuedTask>();

    async function serve(getEnabled?: () => boolean): Promise<string> {
        const routes: Route[] = [];
        const getLiveFeatureFlags: ApiRouteContext['getLiveFeatureFlags'] = getEnabled && (() => ({
            excalidrawEnabled: false, canvasEnabled: false, kustoEnabled: false,
            chatStyleSelectorEnabled: false, chatProviderSwitchingEnabled: false,
            defaultChatStyle: 'default', botManagedConversationsEnabled: getEnabled(),
        }));
        registerApiProcessRoutes({
            routes, store, dataDir: dir, gitOpsStore: new GitOpsStore({ dataDir: dir }),
            bridge: {
                executeFollowUp: vi.fn(async () => {}),
                isSessionAlive: vi.fn(async () => false),
                getTask: id => tasks.get(id),
                cancelProcess: vi.fn(async () => {}),
            },
            getLiveFeatureFlags,
        });
        registerPinArchiveRoutes(routes, store, getEnabled);
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        return `http://127.0.0.1:${address.port}`;
    }

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-bot-reads-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        enabled = true;
        tasks.clear();
        baseUrl = await serve(() => enabled);
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()))));
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function add(source?: BotControlSource, extras: Partial<AIProcess> = {}): Promise<AIProcess> {
        const process: AIProcess = {
            id: 'managed', type: 'chat', status: 'completed', promptPreview: 'A conversation',
            fullPrompt: 'A conversation', startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: {
                type: 'chat', workspaceId: 'ws-first', provider: 'codex',
                ...(source ? { botControl: createBotControlMetadata(source) } : {}),
            },
            ...extras,
        };
        await store.addProcess(process);
        return process;
    }

    function request(route: string, method = 'GET', body?: unknown, origin = baseUrl) {
        return fetch(origin + route, {
            method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    it.each(['teams', 'whatsapp'] as const)('projects persisted %s detail and both list modes', async source => {
        await add(source);
        const expected = { state: 'active', source, controllerLabel: createBotControlMetadata(source).controllerLabel };
        for (const suffix of ['', '?exclude=conversation,toolCalls']) {
            const detail = await (await request('/api/processes/managed' + suffix)).json();
            expect(detail.process.botControl).toEqual(expected);
            expect(detail.process.metadata.botControl).toBeUndefined();
            expect(detail.process.metadata.provider).toBe('codex');
            const list = await (await request('/api/processes' + suffix)).json();
            expect(list.processes[0].botControl).toEqual(expected);
            expect(JSON.stringify(list)).not.toContain('controllerKey');
        }
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata(source));
    });

    it('omits saved links when no owning-binding authorization exists', async () => {
        const control = {
            ...createBotControlMetadata('teams'),
            externalThreadUrl: 'https://teams.microsoft.com/l/message/private-thread/message?token=private-value',
        };
        await add(undefined, { metadata: { type: 'chat', workspaceId: 'ws-first', botControl: control } });
        const response = await request('/api/processes/managed');
        const text = await response.text();
        expect(JSON.parse(text).process.botControl.controllerLabel).toBe('Teams bridge');
        expect(text).not.toContain('private-thread');
        expect(text).not.toContain('private-value');
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(control);
    });

    it('samples the live gate without clearing durable ownership', async () => {
        await add('teams');
        for (const gate of [false, true, false]) {
            enabled = gate;
            const detail = await (await request('/api/processes/managed')).json();
            expect(Boolean(detail.process.botControl)).toBe(gate);
            expect(detail.process.metadata).not.toHaveProperty('botControl');
        }
        expect((await store.getProcess('managed'))?.metadata?.botControl).toBeDefined();
    });

    it('keeps server gates independent, including the missing/default-off getter', async () => {
        await add('whatsapp');
        const other = await serve();
        expect((await (await request('/api/processes/managed')).json()).process.botControl.source).toBe('whatsapp');
        const response = await (await request('/api/processes/managed', 'GET', undefined, other)).json();
        expect(response.process).not.toHaveProperty('botControl');
        expect(response.process.metadata).not.toHaveProperty('botControl');
    });

    it('carries the safe contract through the clone-qualified client without the local gate', async () => {
        await add('teams');
        const other = await serve(() => false);
        const ownerClient = new CocClient({ baseUrl });
        const localClient = new CocClient({ baseUrl: other });
        const owner = await ownerClient.processes.get('managed', { workspace: 'ws-first' });
        const local = await localClient.processes.get('managed', { workspace: 'ws-first' });
        expect(owner.process.botControl).toEqual({
            state: 'active', source: 'teams', controllerLabel: 'Teams bridge',
        });
        expect(owner.process.metadata).not.toHaveProperty('botControl');
        expect(local.process).not.toHaveProperty('botControl');
        expect((await ownerClient.processes.list({ workspace: 'ws-first' })).processes[0].botControl)
            .toEqual(owner.process.botControl);
    });

    it('round-trips safe presentation after reopening the store', async () => {
        await add('whatsapp');
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        baseUrl = await serve(() => enabled);
        const response = await (await request('/api/processes/managed?workspace=ws-first')).json();
        expect(response.process.botControl.source).toBe('whatsapp');
        expect(response.process.metadata.workspaceId).toBe('ws-first');
    });

    it.each(['teams', 'whatsapp'] as const)('projects index-only %s summaries and pinned reads', async source => {
        const control = {
            ...createBotControlMetadata(source), externalThreadUrl: 'https://example.com/private-thread?token=private-value',
        };
        await add(undefined, { metadata: { type: 'chat', workspaceId: 'ws-first', provider: 'codex', botControl: control } });
        await add('teams', { id: 'other', metadata: {
            type: 'chat', workspaceId: 'ws-other', botControl: createBotControlMetadata('teams'),
        } });
        store.pinProcess('managed', '2026-02-01T00:00:00Z');
        store.pinProcess('other', '2026-02-01T00:00:00Z');
        const fullRead = vi.spyOn(store, 'getProcess');
        const allRead = vi.spyOn(store, 'getAllProcesses');
        for (const route of ['/api/processes/summaries?workspace=ws-first', '/api/workspaces/ws-first/pinned']) {
            const response = await request(route);
            expect(response.status).toBe(200);
            const text = await response.text();
            const body = JSON.parse(text);
            const entries = body.summaries ?? body.entries;
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatchObject({
                id: 'managed', workspaceId: 'ws-first', botControl: {
                    state: 'active', source, controllerLabel: control.controllerLabel,
                },
            });
            expect(text).not.toMatch(/controllerKey|externalThreadUrl|private-thread|private-value/);
        }
        expect(fullRead).not.toHaveBeenCalled();
        expect(allRead).not.toHaveBeenCalled();
    });

    it('samples summary and pinned gates independently through clone-qualified clients', async () => {
        await add('whatsapp');
        store.pinProcess('managed', '2026-02-01T00:00:00Z');
        const defaultOff = await serve();
        const ownerClient = new CocClient({ baseUrl });
        const otherClient = new CocClient({ baseUrl: defaultOff });
        for (const gate of [true, false, true]) {
            enabled = gate;
            const summaries = await ownerClient.processes.summaries({ workspace: 'ws-first' });
            expect(Boolean(summaries.summaries[0].botControl)).toBe(gate);
            const pinned = await (await request('/api/workspaces/ws-first/pinned')).json();
            expect(Boolean(pinned.entries[0].botControl)).toBe(gate);
            expect((await otherClient.processes.summaries()).summaries[0]).not.toHaveProperty('botControl');
            const otherPinned = await (await request('/api/workspaces/ws-first/pinned', 'GET', undefined, defaultOff)).json();
            expect(otherPinned.entries[0]).not.toHaveProperty('botControl');
        }
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata('whatsapp'));
    });

    it.each(['invalid', 42, null, [], { ...createBotControlMetadata('teams'), token: 'private-value' }])(
        'omits malformed summary and pinned control (%j)', async value => {
            await add();
            store.getDatabase().prepare("UPDATE processes SET metadata = json_set(metadata, '$.botControl', json(?)) WHERE id = ?")
                .run(JSON.stringify(value), 'managed');
            store.pinProcess('managed', '2026-02-01T00:00:00Z');
            for (const route of ['/api/processes/summaries', '/api/workspaces/ws-first/pinned']) {
                const response = await request(route);
                const text = await response.text();
                const body = JSON.parse(text);
                expect((body.summaries ?? body.entries)[0]).not.toHaveProperty('botControl');
                expect(text).not.toContain('private-value');
            }
        },
    );

    it('keeps summaries current across claim, release, fork and store reload without inference', async () => {
        const original = await add(undefined, {
            fullPrompt: 'Managed by a Teams bot', metadata: { type: 'chat', workspaceId: 'ws-first', cronId: 'cron-fixture' },
        });
        const list = async () => (await (await request('/api/processes/summaries?workspace=ws-first')).json()).summaries;
        expect((await list())[0]).not.toHaveProperty('botControl');
        await store.updateProcess('managed', { metadata: {
            ...original.metadata!, botControl: createBotControlMetadata('teams'),
        } });
        store.pinProcess('managed', '2026-02-01T00:00:00Z');
        expect((await list())[0].botControl.source).toBe('teams');
        await store.appendConversationTurn('managed', turnIndex => ({
            role: 'user', content: 'Hello', timestamp: new Date(), turnIndex,
        }));
        const fork = await store.forkProcess('managed', 'fork', 0);
        expect((await list()).find((entry: { id: string }) => entry.id === fork.id)).not.toHaveProperty('botControl');
        expect((await list()).find((entry: { id: string }) => entry.id === 'managed').botControl.source).toBe('teams');
        await store.updateProcess('managed', { metadata: original.metadata });
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        baseUrl = await serve(() => enabled);
        expect((await list()).every((entry: { botControl?: unknown }) => !entry.botControl)).toBe(true);
        expect((await (await request('/api/workspaces/ws-first/pinned')).json()).entries[0]).not.toHaveProperty('botControl');
    });

    it('keeps summary and pinned control unchanged after rejected metadata writes, then permits retry', async () => {
        const original = await add('teams');
        store.pinProcess('managed', '2026-02-01T00:00:00Z');
        store.getDatabase().exec(`CREATE TRIGGER reject_control_write BEFORE UPDATE OF metadata ON processes
            BEGIN SELECT RAISE(ABORT, 'rejected control write'); END`);
        await expect(store.updateProcess('managed', { metadata: {
            ...original.metadata!, botControl: createBotControlMetadata('whatsapp'),
        } })).rejects.toThrow('rejected control write');
        for (const route of ['/api/processes/summaries', '/api/workspaces/ws-first/pinned']) {
            const body = await (await request(route)).json();
            expect((body.summaries ?? body.entries)[0].botControl.source).toBe('teams');
        }
        store.getDatabase().exec('DROP TRIGGER reject_control_write');
        await store.updateProcess('managed', { metadata: { type: 'chat', workspaceId: 'ws-first' } });
        expect((await (await request('/api/processes/summaries')).json()).summaries[0]).not.toHaveProperty('botControl');
    });

    it('projects embedded children individually', async () => {
        await add('teams');
        await add('whatsapp', { id: 'child', parentProcessId: 'managed' });
        const response = await (await request('/api/processes/managed?include=children')).json();
        expect(response.process.botControl.source).toBe('teams');
        expect(response.children[0].botControl.source).toBe('whatsapp');
        expect(JSON.stringify(response)).not.toContain('controllerKey');
    });

    it('does not mark an ordinary or automated-only conversation', async () => {
        await add(undefined, {
            id: 'queue_teams-looking',
            fullPrompt: 'Bot-managed Teams automated conversation',
            metadata: { type: 'chat', workspaceId: 'ws-first', source: 'cron' },
        });
        const response = await (await request('/api/processes/queue_teams-looking')).json();
        expect(response.process).not.toHaveProperty('botControl');
    });

    it('omits malformed private metadata and never echoes it', async () => {
        await add(undefined, {
            metadata: Object.assign({ type: 'chat', workspaceId: 'ws-first' }, {
                botControl: { ...createBotControlMetadata('teams'), account: 'private-account' },
            }),
        });
        const text = await (await request('/api/processes/managed')).text();
        expect(JSON.parse(text).process).not.toHaveProperty('botControl');
        expect(text).not.toContain('private-account');
        expect(text).not.toContain('controllerKey');
    });

    it('checks workspace even when native getProcess ignores the filter and on prefix fallback', async () => {
        await add('teams');
        for (const id of ['managed', 'queue_managed']) {
            expect((await request(`/api/processes/${id}?workspace=ws-second`)).status).toBe(404);
            expect((await request(`/api/processes/${id}?workspace=ws-first`)).status).toBe(200);
        }
    });

    it('projects SDK session lookup and rejects a mismatched workspace', async () => {
        await add('teams', { sdkSessionId: 'test-session' });
        const response = await (await request('/api/processes?sdkSessionId=test-session&workspace=ws-first')).json();
        expect(response.process.botControl.source).toBe('teams');
        expect(response.process.metadata).not.toHaveProperty('botControl');
        expect((await request('/api/processes?sdkSessionId=test-session&workspace=ws-second')).status).toBe(404);
    });

    function queued(source: BotControlSource): QueuedTask {
        return {
            id: 'pending', type: 'chat', status: 'queued', priority: 'normal',
            createdAt: Date.now(), repoId: 'ws-first', botControl: createBotControlMetadata(source),
            payload: { kind: 'chat', prompt: 'Pending conversation', workspaceId: 'ws-first', mode: 'ask' },
        };
    }

    it.each(['teams', 'whatsapp'] as const)('projects trusted %s queued control before execution', async source => {
        const task = queued(source);
        tasks.set(task.id, task);
        for (const status of ['queued', 'running'] as const) {
            task.status = status;
            const response = await (await request('/api/processes/queue_pending?workspace=ws-first&exclude=conversation')).json();
            expect(response.process.botControl.source).toBe(source);
            expect(response.process.metadata).not.toHaveProperty('botControl');
        }
        expect(task.botControl).toEqual(createBotControlMetadata(source));
        expect((await request('/api/processes/queue_pending?workspace=ws-second')).status).toBe(404);
        enabled = false;
        expect((await (await request('/api/processes/queue_pending')).json()).process).not.toHaveProperty('botControl');
    });

    it.each(['payload-claim', 'workspace-drift', 'follow-up'] as const)('omits queued control for %s', async scenario => {
        const task = queued('teams');
        if (scenario === 'payload-claim') {
            delete task.botControl;
            task.payload = { ...task.payload, botControl: createBotControlMetadata('teams') };
        } else if (scenario === 'workspace-drift') {
            task.repoId = 'ws-second';
        } else {
            task.payload = { ...task.payload, processId: 'existing' };
        }
        tasks.set(task.id, task);
        const response = await (await request('/api/processes/queue_pending')).json();
        expect(response.process).not.toHaveProperty('botControl');
    });

    it.each([
        { botControl: createBotControlMetadata('teams') },
        { metadata: { type: 'chat', botControl: createBotControlMetadata('teams') } },
    ])('rejects public creation claims %# without persistence', async claim => {
        enabled = false;
        const response = await request('/api/processes', 'POST', {
            id: 'forged', promptPreview: 'A conversation', status: 'completed',
            startTime: '2026-01-01T00:00:00Z', ...claim,
        });
        expect(response.status).toBe(400);
        expect(await store.getProcess('forged')).toBeUndefined();
    });

    it.each([
        { botControl: createBotControlMetadata('whatsapp') },
        { metadata: { type: 'chat', botControl: createBotControlMetadata('whatsapp') } },
        { metadataPatch: { set: { botControl: createBotControlMetadata('whatsapp') } } },
        { metadataPatch: { unset: ['botControl'] } },
    ])('rejects public mutation or release %# without changing ownership', async body => {
        await add('teams');
        enabled = false;
        const response = await request('/api/processes/managed', 'PATCH', body);
        expect(response.status).toBe(400);
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('preserves control and workspace on full metadata replacement and ordinary patching', async () => {
        await add('teams');
        for (const body of [
            { metadata: { type: 'chat', provider: 'codex', model: 'test-model' } },
            { metadataPatch: { set: { customField: 'safe-value' }, unset: ['workspaceId'] } },
            { customTitle: 'Renamed conversation' },
        ]) {
            const response = await request('/api/processes/managed', 'PATCH', body);
            expect(response.status).toBe(200);
            const result = await response.json();
            expect(result.process.botControl.source).toBe('teams');
            expect(result.process.metadata).not.toHaveProperty('botControl');
            const saved = await store.getProcess('managed');
            expect(saved?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
            expect(saved?.metadata?.workspaceId).toBe('ws-first');
        }
    });

    it.each([
        { metadata: { type: 'chat', workspaceId: 'ws-second' } },
        { metadataPatch: { set: { workspaceId: 'ws-second' } } },
        { metadata: null },
    ])('rejects managed workspace changes %#', async body => {
        await add('teams');
        expect((await request('/api/processes/managed', 'PATCH', body)).status).toBe(400);
        expect((await store.getProcess('managed'))?.metadata?.workspaceId).toBe('ws-first');
    });

    it('rereads ownership under admission after a concurrent authoritative claim', async () => {
        await add();
        let release!: () => void;
        let entered!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const claim = processOperationAdmission.runExclusive('managed', async () => {
            entered();
            await wait;
            const current = await store.getProcess('managed');
            await store.updateProcess('managed', {
                metadata: { ...current!.metadata!, botControl: createBotControlMetadata('teams') },
            });
        });
        await ready;
        const observed = new Promise<void>(resolve => {
            const original = store.getProcess.bind(store);
            vi.spyOn(store, 'getProcess').mockImplementation(async (...args) => {
                const result = await original(...args);
                resolve();
                return result;
            });
        });
        const patch = request('/api/processes/queue_managed', 'PATCH', { metadata: { type: 'chat', model: 'test-model' } });
        await observed;
        release();
        await claim;
        expect((await patch).status).toBe(200);
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('projects cancellation without releasing control and keeps forks unattributed', async () => {
        await add('teams', { status: 'running' });
        const cancelled = await (await request('/api/processes/managed/cancel', 'POST')).json();
        expect(cancelled.process.botControl.source).toBe('teams');
        expect(cancelled.process.metadata).not.toHaveProperty('botControl');
        const fork = await (await request('/api/processes/managed/fork', 'POST')).json();
        expect(fork.process).not.toHaveProperty('botControl');
        expect(fork.process.metadata).not.toHaveProperty('botControl');
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('propagates failed metadata persistence without losing ownership', async () => {
        await add('teams');
        store.getDatabase().exec(`
            CREATE TRIGGER reject_public_patch BEFORE UPDATE ON processes
            WHEN NEW.id = 'managed'
            BEGIN SELECT RAISE(ABORT, 'test write failure'); END;
        `);
        const response = await request('/api/processes/managed', 'PATCH', { metadata: { type: 'chat', model: 'test-model' } });
        expect(response.status).toBe(500);
        expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        store.getDatabase().exec('DROP TRIGGER reject_public_patch');
        expect((await request('/api/processes/managed', 'PATCH', { customTitle: 'Retry' })).status).toBe(200);
    });
});

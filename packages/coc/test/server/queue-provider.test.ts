import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, RepoQueueRegistry, SqliteQueueStore } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';
const sdk = createMockSDKService();
vi.mock('@plusplusoneplusplus/forge', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    sdkServiceRegistry: { getOrThrow: () => sdk.service },
}));
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../src/server/queue/sqlite-queue-persistence';
import { registerQueueRoutes } from '../../src/server/queue/queue-handler';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';

describe('queued job provider', () => {
    let bridge: MultiRepoQueueRouter;
    let server: http.Server;
    let db: NativeDatabase;
    let persistence: SqliteQueuePersistence;
    let baseUrl: string;
    let auto: boolean;
    let validate: ReturnType<typeof vi.fn>;
    let manager: ReturnType<MultiRepoQueueRouter['getManagerByRepoId']>;

    beforeEach(async () => {
        auto = true;
        validate = vi.fn(async (provider: string) => {
            if (provider === 'claude') throw new Error('Claude is disabled');
        });
        const registry = new RepoQueueRegistry();
        bridge = new MultiRepoQueueRouter(registry, createMockProcessStore(), { autoStart: false });
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        persistence = new SqliteQueuePersistence(bridge, db);
        for (const workspace of ['owner', 'other']) {
            const root = path.join(os.tmpdir(), 'queue-provider-test', workspace);
            bridge.registerRepoId(workspace, root);
            bridge.getOrCreateBridge(root);
        }
        manager = bridge.getManagerByRepoId('owner');
        manager!.enqueue({ id: 'job', repoId: 'owner', type: 'chat', priority: 'normal',
            payload: { kind: 'chat', mode: 'ask', prompt: 'Do the task', provider: 'copilot',
                model: 'old-model', reasoningEffort: 'high', context: { files: ['plan.md'] } },
            config: { model: 'old-model', reasoningEffort: 'high', timeoutMs: 1234, afterEffortTier: 'medium' },
        });
        const routes: Route[] = [];
        registerQueueRoutes(routes, bridge, undefined, undefined, {
            getDefaultProvider: () => 'copilot', isAutoProviderRoutingActive: () => auto,
            validateProvider: provider => validate(provider),
            getEffortTiersForProvider: () => ({ medium: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } }) as any,
        });
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
    });
    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        persistence.dispose();
        bridge.dispose();
        db.close();
    });
    async function request(provider?: unknown, workspace = 'owner', id = 'job') {
        const response = await fetch(`${baseUrl}/api/queue/${id}/provider?workspace=${workspace}`, {
            ...(provider !== undefined ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) } : {}),
        });
        return { status: response.status, body: await response.json() as any };
    }

    it('offers enabled, available providers and Auto from the owning server', async () => {
        expect(await request()).toEqual({ status: 200, body: { providers: ['auto', 'copilot', 'codex', 'opencode'] } });
        auto = false;
        expect((await request()).body.providers).not.toContain('auto');
    });
    it('persists provider and remapped tier, preserves payload, and executes the updated task', async () => {
        const changed = vi.fn();
        bridge.on('queueChange', changed);
        const result = await request('codex', 'owner', 'queue_job');
        expect(result.status).toBe(200);
        expect(result.body.task).toMatchObject({ provider: 'codex', config: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', afterEffortTier: 'medium', timeoutMs: 1234 }, payload: { prompt: 'Do the task', context: { files: ['plan.md'] } } });
        expect(result.body.task.payload.model).toBeUndefined();
        expect(changed).toHaveBeenCalled();
        expect(new SqliteQueueStore(db).getQueueTasks('owner')[0].payload.provider).toBe('codex');
        expect(manager!.dequeue()).toMatchObject({ payload: { provider: 'codex' }, config: { model: 'gpt-6.1-sol' } });
    });
    it('clears concrete model/effort for Auto and resets routing evidence', async () => {
        (manager!.getTask('job')!.payload.context as any).autoProviderRouting = { requested: true, provider: 'copilot', selectedByAuto: true };
        expect((await request('auto')).body.task).toMatchObject({ config: { afterEffortTier: 'medium' }, payload: { context: { files: ['plan.md'], autoProviderRouting: { requested: true } } } });
        const saved = new SqliteQueueStore(db).getQueueTasks('owner')[0];
        expect(saved.payload.provider).toBeUndefined();
        expect(saved.config.model).toBeUndefined();
        expect(saved.config.reasoningEffort).toBeUndefined();
        expect((await request('codex')).body.task.payload.context.autoProviderRouting).toBeUndefined();
    });
    it('uses execution defaults when the job has no tier', async () => {
        delete manager!.getTask('job')!.config.afterEffortTier;
        const result = await request('codex');
        expect(result.body.task.config.model).toBeUndefined();
        expect(result.body.task.config.reasoningEffort).toBeUndefined();
    });
    it('pins an explicit choice even when it matches the current default', async () => {
        delete manager!.getTask('job')!.payload.provider;
        expect((await request('copilot')).body.task.provider).toBe('copilot');
    });
    it('restores the saved provider/config for execution after restart', async () => {
        await request('auto');
        persistence.dispose();
        const restored = new MultiRepoQueueRouter(new RepoQueueRegistry(), createMockProcessStore(), { autoStart: false });
        const restoredPersistence = new SqliteQueuePersistence(restored, db);
        try {
            restoredPersistence.restore();
            const saved = restored.getManagerByRepoId('owner')!.dequeue() as any;
            expect(saved.payload.provider).toBeUndefined();
            expect(saved.payload.context.autoProviderRouting).toEqual({ requested: true });
            expect(saved.config.model).toBeUndefined();
            expect(saved.config.afterEffortTier).toBe('medium');
        } finally { restoredPersistence.dispose(); restored.dispose(); }
    });
    it('preserves an explicit model when reselecting the same provider', async () => {
        expect((await request('copilot')).body.task.config.model).toBe('old-model');
    });
    it.each(['claude', 'invalid', null])('rejects unavailable or invalid provider %s without mutation', async provider => {
        expect((await request(provider)).status).toBe(400);
        expect(manager!.getTask('job')!.payload.provider).toBe('copilot');
    });
    it('rejects Auto when disabled', async () => {
        auto = false;
        expect((await request('auto')).status).toBe(400);
    });
    it('requires the exact workspace and never searches other queues', async () => {
        expect((await request('codex', 'other')).status).toBe(404);
        expect((await request('codex', 'missing')).status).toBe(404);
        expect((await fetch(`${baseUrl}/api/queue/job/provider`, { method: 'PATCH' })).status).toBe(400);
    });
    it.each(['running', 'completed', 'cancelled'])('rejects %s jobs', async status => {
        manager!.updateTask('job', { status: status as any });
        expect((await request('codex')).status).toBe(409);
        expect(manager!.getTask('job')!.payload.provider).toBe('copilot');
    });
    it.each([{ processId: 'existing' }, { resumedFrom: 'existing' }, { context: { ralph: {} } }, { mode: 'sentinel' }])('rejects bound/orchestrated jobs %j', async payload => {
        Object.assign(manager!.getTask('job')!.payload, payload);
        expect((await request('codex')).status).toBe(409);
    });
    it('rejects a choices read if the job starts while availability is checked', async () => {
        validate.mockImplementationOnce(async () => { manager!.updateTask('job', { status: 'running' }); });
        expect((await request()).status).toBe(409);
    });
    it('rechecks job status after asynchronous provider validation', async () => {
        validate.mockImplementationOnce(async () => { manager!.updateTask('job', { status: 'running' }); });
        expect((await request('codex')).status).toBe(409);
        expect(manager!.getTask('job')!.payload.provider).toBe('copilot');
        expect(manager!.getTask('job')!.config.model).toBe('old-model');
    });
});

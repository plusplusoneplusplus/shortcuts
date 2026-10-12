import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { RepoQueueRegistry, SqliteProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import { projectQueueJobModes } from '../../src/server/shared/queue-job-mode';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { readRepoQueueSnapshot } from '../../src/server/routes/queue-stats';
import { createWebSocketInfrastructure } from '../../src/server/infrastructure/websocket-infrastructure';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';

describe('sidebar job execution-mode projection', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    const workspaceId = 'ws-alpha';
    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-job-mode-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
        await store.registerWorkspace({ id: workspaceId, name: 'Alpha', rootPath: dir });
        bridge.registerRepoId(workspaceId, dir);
        bridge.registry.getQueueForRepo(dir).pause();
    });
    afterEach(() => {
        bridge.dispose();
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });
    async function process(id: string, mode: unknown, extras: Record<string, unknown> = {}) {
        const value: AIProcess = {
            id, type: 'chat', status: 'running', startTime: new Date(),
            metadata: { type: 'chat', workspaceId, mode, ...extras },
        };
        await store.addProcess(value);
        return value;
    }
    const job = (id: string, mode?: string) => ({ id, type: 'chat', repoId: workspaceId, payload: { mode } });

    it('reads all current modes in one transcript-free batch, with first-turn fallback only for absent processes', async () => {
        await process('queue_ask', 'ask');
        await process('queue_auto', 'autopilot');
        await process('queue_sentinel', 'sentinel');
        await process('queue_unknown', 'future-mode');
        await process('queue_missing', undefined);
        const jobs = [job('ask', 'autopilot'), job('auto', 'ask'), job('sentinel', 'ask'),
            job('unknown', 'autopilot'), job('missing', 'autopilot'), job('new', 'ask'), job('blank')];
        const prepare = vi.spyOn(store.getDatabase(), 'prepare');
        const getProcess = vi.spyOn(store, 'getProcess');
        const modes = projectQueueJobModes(store, jobs);
        expect([...modes.values()]).toEqual(['ask', 'autopilot', 'sentinel', null, null, 'ask', null]);
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(prepare.mock.calls[0][0]).not.toMatch(/conversation|full_prompt|tool_calls/);
        expect(getProcess).not.toHaveBeenCalled();
    });

    it('preserves Ralph session identity through Ask grilling and rejects wrong workspace/type owners', async () => {
        await process('queue_grill', 'ask', { ralph: { sessionId: 'session-one', phase: 'grilling' } });
        await process('queue_other', 'sentinel', { workspaceId: 'ws-other' });
        await process('queue_script', 'autopilot');
        await store.updateProcess('queue_script', { type: 'run-script' });
        const jobs = [job('grill', 'ask'), job('other', 'ask'), job('script', 'ask'),
            { ...job('new-grill', 'ask'), payload: { mode: 'ask', context: { ralph: { sessionId: 'session-two' } } } },
            { ...job('workflow', 'autopilot'), type: 'run-workflow' }];
        expect([...projectQueueJobModes(store, jobs).values()]).toEqual(['ralph', null, null, 'ralph']);
    });

    it('resolves the actual follow-up process, never the parent Sentinel or the initial task mode', async () => {
        await process('queue_child', 'autopilot');
        await process('queue_parent', 'sentinel');
        const followUp = { ...job('followup', 'ask'), payload: { mode: 'ask', processId: 'queue_child' } };
        expect(projectQueueJobModes(store, [followUp]).get(followUp)).toBe('autopilot');
        await store.updateProcess('queue_child', { metadata: { type: 'chat', workspaceId, mode: 'ask' } });
        expect(projectQueueJobModes(store, [followUp]).get(followUp)).toBe('ask');
    });

    it('carries current modes through the existing queued REST snapshot', async () => {
        const manager = bridge.registry.getQueueForRepo(dir);
        const id = manager.enqueue({ type: 'chat', repoId: workspaceId, priority: 'normal',
            payload: { kind: 'chat', workspaceId, mode: 'ask' }, config: {} });
        await process(`queue_${id}`, 'autopilot');
        const snapshot = await readRepoQueueSnapshot({ bridge, store }, workspaceId);
        expect(snapshot.queued).toEqual([expect.objectContaining({ id, executionMode: 'autopilot', payload: expect.objectContaining({ mode: 'ask' }) })]);
    });

    it('refreshes queued/running WebSocket mode metadata on follow-up changes with bot management disabled', async () => {
        const manager = bridge.registry.getQueueForRepo(dir);
        const id = manager.enqueue({ type: 'chat', repoId: workspaceId, priority: 'normal',
            payload: { kind: 'chat', workspaceId, mode: 'ask' }, config: {} });
        const value = await process(`queue_${id}`, 'ask');
        const server = http.createServer();
        const schedules = new ScheduleManager(new ScheduleYamlPersistence(dir));
        const ws = createWebSocketInfrastructure(server, store, bridge, bridge.registry, schedules);
        const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');
        await store.updateProcess(value.id, { metadata: { ...value.metadata, mode: 'autopilot' } });
        const updates = broadcast.mock.calls.map(([event]) => event).filter(event => event.type === 'queue-updated');
        expect(updates).toHaveLength(2);
        for (const event of updates) {
            if (event.type === 'queue-updated') expect(event.queue.queued).toEqual([
                expect.objectContaining({ executionMode: 'autopilot' }),
            ]);
        }
        manager.reActivate(id);
        const active = await readRepoQueueSnapshot({ bridge, store }, workspaceId);
        expect(active.running).toEqual([expect.objectContaining({ executionMode: 'autopilot' })]);
        broadcast.mockClear();
        await store.updateProcess(value.id, { title: 'Renamed' });
        expect(broadcast.mock.calls.some(([event]) => event.type === 'queue-updated')).toBe(false);
        ws.closeAll();
        schedules.dispose();
        server.close();
    });
});

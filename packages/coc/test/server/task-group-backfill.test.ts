import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database, initializeDatabase, SqliteProcessStore, SqliteTaskGroupStore } from '@plusplusoneplusplus/forge';
import { TaskGroupService } from '../../src/server/task-groups/task-group-service';
import { backfillTaskGroups } from '../../src/server/task-groups/backfill';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import { FileMapReduceRunStore } from '../../src/server/map-reduce/map-reduce-run-store';
import { FileDreamStore } from '../../src/server/dreams/dream-store';
import { RalphSessionStore } from '../../src/server/ralph/ralph-session-store';

const WS = 'ws-backfill';

describe('backfillTaskGroups', () => {
    let tmpDir: string;
    let db: Database.Database;
    let processStore: SqliteProcessStore;
    let service: TaskGroupService;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-tg-backfill-'));
        processStore = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        db = processStore.getDatabase();
        service = new TaskGroupService(new SqliteTaskGroupStore(db));
        await processStore.registerWorkspace({ id: WS, name: 'Backfill WS', rootPath: '/tmp/backfill' });
    });

    afterEach(() => {
        processStore.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('projects legacy runs and sessions into the registry, idempotently', async () => {
        // Seed legacy data through the feature stores WITHOUT change hooks,
        // simulating runs persisted before the framework existed.
        const forEachRunStore = new FileForEachRunStore({ dataDir: tmpDir });
        const mapReduceRunStore = new FileMapReduceRunStore({ dataDir: tmpDir });
        const dreamStore = new FileDreamStore({ dataDir: tmpDir });
        const ralphStore = new RalphSessionStore({ dataDir: tmpDir });

        const forEachRun = await forEachRunStore.createDraftRun({
            workspaceId: WS,
            originalRequest: 'legacy for-each',
            childMode: 'ask',
            generationProcessId: 'proc-gen-legacy',
            items: [{ id: 'item-1', title: 'One', prompt: 'p', status: 'pending' }],
        });
        const mapReduceRun = await mapReduceRunStore.createDraftRun({
            workspaceId: WS,
            originalRequest: 'legacy map-reduce',
            childMode: 'ask',
            reduceInstructions: 'merge',
            maxParallel: 2,
            items: [{ id: 'map-1', title: 'One', prompt: 'p', status: 'pending' }],
        });
        await ralphStore.initSession(WS, 'legacy-session', {
            originalGoal: 'legacy goal',
            maxIterations: 3,
        });
        const dreamRun = await dreamStore.createRun({ workspaceId: WS, trigger: 'idle' });

        // Nothing in the registry yet.
        expect(service.listGroups(WS, { includeHidden: true })).toHaveLength(0);

        const result = await backfillTaskGroups({
            processStore,
            taskGroupService: service,
            forEachRunStore,
            mapReduceRunStore,
            dreamStore,
            dataDir: tmpDir,
        });

        expect(result.errors).toBe(0);
        expect(result.groups).toBe(4);

        const groups = service.listGroups(WS, { includeHidden: true });
        const byId = new Map(groups.map(group => [group.groupId, group]));
        expect(byId.get(forEachRun.runId)).toMatchObject({ type: 'for-each', status: 'draft' });
        expect(byId.get(mapReduceRun.runId)).toMatchObject({ type: 'map-reduce', status: 'draft' });
        expect(byId.get('legacy-session')).toMatchObject({ type: 'ralph', status: 'running' });
        expect(byId.get(dreamRun.id)).toMatchObject({ type: 'dream', hidden: true });

        // Idempotent: re-running creates no duplicates and keeps counts stable.
        const second = await backfillTaskGroups({
            processStore,
            taskGroupService: service,
            forEachRunStore,
            mapReduceRunStore,
            dreamStore,
            dataDir: tmpDir,
        });
        expect(second.errors).toBe(0);
        expect(service.listGroups(WS, { includeHidden: true })).toHaveLength(4);
        expect(service.getGroup(WS, forEachRun.runId)!.children).toHaveLength(1);
    });

    it('handles workspaces with no legacy data', async () => {
        const result = await backfillTaskGroups({
            processStore,
            taskGroupService: service,
            forEachRunStore: new FileForEachRunStore({ dataDir: tmpDir }),
            mapReduceRunStore: new FileMapReduceRunStore({ dataDir: tmpDir }),
            dreamStore: new FileDreamStore({ dataDir: tmpDir }),
            dataDir: tmpDir,
        });
        expect(result).toEqual({ workspaces: 1, groups: 0, errors: 0 });
    });
});

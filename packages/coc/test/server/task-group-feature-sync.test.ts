import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database, initializeDatabase, SqliteTaskGroupStore } from '@plusplusoneplusplus/forge';
import { TaskGroupService } from '../../src/server/task-groups/task-group-service';
import {
    syncDreamRunToTaskGroup,
    syncForEachRunToTaskGroup,
    syncMapReduceRunToTaskGroup,
    syncRalphSessionToTaskGroup,
    toTaskGroupTitle,
} from '../../src/server/task-groups/feature-sync';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import { FileMapReduceRunStore } from '../../src/server/map-reduce/map-reduce-run-store';
import {
    RalphSessionStore,
    registerRalphSessionChangeListener,
    unregisterRalphSessionChangeListener,
} from '../../src/server/ralph/ralph-session-store';
import { FileDreamStore } from '../../src/server/dreams/dream-store';
import type { ForEachItem } from '../../src/server/for-each/types';
import type { MapReduceItem } from '../../src/server/map-reduce/types';

const WS = 'ws-sync';

function makeService(): { service: TaskGroupService; db: Database.Database } {
    const db = new Database(':memory:');
    initializeDatabase(db);
    return { service: new TaskGroupService(new SqliteTaskGroupStore(db)), db };
}

function forEachItems(): ForEachItem[] {
    return [
        { id: 'item-a', title: 'Item A', prompt: 'do a', status: 'pending' },
        { id: 'item-b', title: 'Item B', prompt: 'do b', status: 'pending' },
    ];
}

describe('task-group feature sync', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-tg-sync-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('toTaskGroupTitle collapses whitespace and truncates', () => {
        expect(toTaskGroupTitle('  hello\n  world ')).toBe('hello world');
        expect(toTaskGroupTitle('')).toBeUndefined();
        expect(toTaskGroupTitle(undefined)).toBeUndefined();
        const long = 'x'.repeat(200);
        expect(toTaskGroupTitle(long)!.length).toBeLessThanOrEqual(80);
    });

    it('keeps the registry in sync across the For Each run lifecycle', async () => {
        const { service, db } = makeService();
        const store = new FileForEachRunStore({
            dataDir: tmpDir,
            onRunChanged: run => syncForEachRunToTaskGroup(service, run),
        });

        const run = await store.createDraftRun({
            workspaceId: WS,
            originalRequest: 'Process two things',
            childMode: 'ask',
            generationProcessId: 'proc-gen',
            items: forEachItems(),
        });

        let group = service.getGroup(WS, run.runId)!;
        expect(group).toMatchObject({
            type: 'for-each',
            status: 'draft',
            title: 'Process two things',
            originProcessId: 'proc-gen',
            extra: { detailStatus: 'draft', itemCount: 2, childMode: 'ask' },
        });
        expect(group.children).toEqual([
            expect.objectContaining({ role: 'generation', processId: 'proc-gen' }),
        ]);

        await store.approveRun(WS, run.runId);
        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('draft');
        expect(group.extra?.detailStatus).toBe('approved');

        const claimed = await store.claimNextRunnableItem(WS, run.runId);
        expect(claimed).toBeDefined();
        await store.linkRunningItemChild(WS, run.runId, claimed!.item.id, 'task-a', 'proc-a');
        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('running');
        expect(group.children).toContainEqual(
            expect.objectContaining({ role: 'item', itemKey: 'item-a', taskId: 'task-a', processId: 'proc-a' }),
        );

        await store.markRunningItemCompleted(WS, run.runId, 'item-a', 'task-a');
        const claimedB = await store.claimNextRunnableItem(WS, run.runId);
        await store.linkRunningItemChild(WS, run.runId, claimedB!.item.id, 'task-b', 'proc-b');
        await store.markRunningItemCompleted(WS, run.runId, 'item-b', 'task-b');

        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('completed');
        expect(group.completedAt).toBeDefined();
        expect(group.childCount).toBe(3);

        db.close();
    });

    it('records failure and cancellation statuses for For Each runs', async () => {
        const { service, db } = makeService();
        const store = new FileForEachRunStore({
            dataDir: tmpDir,
            onRunChanged: run => syncForEachRunToTaskGroup(service, run),
        });

        const run = await store.createDraftRun({
            workspaceId: WS,
            originalRequest: 'fail then cancel',
            childMode: 'ask',
            items: forEachItems(),
        });
        await store.approveRun(WS, run.runId);
        const claimed = await store.claimNextRunnableItem(WS, run.runId);
        await store.linkRunningItemChild(WS, run.runId, claimed!.item.id, 'task-a', 'proc-a');
        await store.markRunningItemFailed(WS, run.runId, 'item-a', 'boom', 'task-a');

        expect(service.getGroup(WS, run.runId)!.status).toBe('failed');

        await store.cancelRun(WS, run.runId);
        const group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('cancelled');
        expect(group.completedAt).toBeDefined();

        db.close();
    });

    it('keeps the registry in sync across the Map Reduce run lifecycle including reduce', async () => {
        const { service, db } = makeService();
        const store = new FileMapReduceRunStore({
            dataDir: tmpDir,
            onRunChanged: run => syncMapReduceRunToTaskGroup(service, run),
        });

        const items: MapReduceItem[] = [
            { id: 'map-a', title: 'Map A', prompt: 'a', status: 'pending' },
            { id: 'map-b', title: 'Map B', prompt: 'b', status: 'pending' },
        ];
        const run = await store.createDraftRun({
            workspaceId: WS,
            originalRequest: 'Map and reduce things',
            childMode: 'ask',
            reduceInstructions: 'merge results',
            maxParallel: 2,
            generationProcessId: 'proc-gen-mr',
            items,
        });

        let group = service.getGroup(WS, run.runId)!;
        expect(group).toMatchObject({
            type: 'map-reduce',
            status: 'draft',
            originProcessId: 'proc-gen-mr',
            extra: { detailStatus: 'draft', itemCount: 2, maxParallel: 2, reduceStatus: 'pending' },
        });

        await store.approveRun(WS, run.runId);
        const claimed = await store.claimRunnableItems(WS, run.runId);
        expect(claimed!.items.length).toBeGreaterThan(0);
        for (const item of claimed!.items) {
            await store.linkRunningItemChild(WS, run.runId, item.id, `task-${item.id}`, `proc-${item.id}`);
        }
        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('running');

        for (const item of claimed!.items) {
            await store.markRunningItemCompleted(WS, run.runId, item.id, `task-${item.id}`, { ok: true });
        }

        const reduceClaim = await store.claimReduceStep(WS, run.runId);
        expect(reduceClaim).toBeDefined();
        await store.linkRunningReduceChild(WS, run.runId, 'task-reduce', 'proc-reduce');
        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('running');
        expect(group.extra?.detailStatus).toBe('reducing');
        expect(group.children).toContainEqual(
            expect.objectContaining({ role: 'reduce', taskId: 'task-reduce', processId: 'proc-reduce' }),
        );

        await store.markRunningReduceCompleted(WS, run.runId, 'task-reduce');
        group = service.getGroup(WS, run.runId)!;
        expect(group.status).toBe('completed');
        expect(group.extra?.reduceStatus).toBe('completed');
        // generation + 2 map items + reduce
        expect(group.childCount).toBe(4);

        db.close();
    });

    it('keeps the registry in sync across the Ralph session lifecycle via the change listener', async () => {
        const { service, db } = makeService();
        registerRalphSessionChangeListener(tmpDir, record => syncRalphSessionToTaskGroup(service, record));
        try {
            const store = new RalphSessionStore({ dataDir: tmpDir });
            await store.initSession(WS, 'session-1', {
                originalGoal: 'Build the thing end to end',
                maxIterations: 5,
            });

            let group = service.getGroup(WS, 'session-1')!;
            expect(group).toMatchObject({
                type: 'ralph',
                status: 'running',
                title: 'Build the thing end to end',
                extra: { detailStatus: 'executing', maxIterations: 5 },
            });

            await store.updateSessionRecord(WS, 'session-1', rec => ({
                ...rec!,
                currentIteration: 1,
                iterations: [
                    {
                        iteration: 1,
                        loopIndex: 1,
                        taskId: 'task-iter-1',
                        processId: 'proc-iter-1',
                        startedAt: new Date().toISOString(),
                        status: 'running',
                    },
                ],
            }));

            group = service.getGroup(WS, 'session-1')!;
            expect(group.children).toContainEqual(
                expect.objectContaining({ role: 'iteration', itemKey: '1', taskId: 'task-iter-1', processId: 'proc-iter-1' }),
            );

            await store.updateSessionRecord(WS, 'session-1', rec => ({
                ...rec!,
                phase: 'complete',
                completedAt: new Date().toISOString(),
                terminalReason: 'RALPH_COMPLETE',
                finalChecks: [
                    {
                        checkIndex: 1,
                        loopIndex: 1,
                        sourceIteration: 1,
                        taskId: 'task-check-1',
                        processId: 'proc-check-1',
                        startedAt: new Date().toISOString(),
                        status: 'completed',
                        hasGaps: false,
                    },
                ],
            }));

            group = service.getGroup(WS, 'session-1')!;
            expect(group.status).toBe('completed');
            expect(group.completedAt).toBeDefined();
            expect(group.children).toContainEqual(
                expect.objectContaining({ role: 'final-check', itemKey: 'check-1', taskId: 'task-check-1' }),
            );
        } finally {
            unregisterRalphSessionChangeListener(tmpDir);
            db.close();
        }
    });

    it('records dream runs as hidden groups with analyzer/critic links', async () => {
        const { service, db } = makeService();
        const store = new FileDreamStore({
            dataDir: tmpDir,
            onRunChanged: run => syncDreamRunToTaskGroup(service, run),
        });

        const run = await store.createRun({ workspaceId: WS, trigger: 'manual' });

        let group = service.getGroup(WS, run.id)!;
        expect(group).toMatchObject({ type: 'dream', status: 'running', hidden: true });
        // Hidden groups are excluded from default listings.
        expect(service.listGroups(WS).map(entry => entry.groupId)).not.toContain(run.id);
        expect(service.listGroups(WS, { includeHidden: true }).map(entry => entry.groupId)).toContain(run.id);

        await store.completeRun(WS, run.id, {
            sourceRanges: [{ processId: 'proc-src', startTurnIndex: 0, endTurnIndex: 2 }],
            candidateCardIds: [],
            analyzerProcessId: 'proc-analyzer',
            criticProcessId: 'proc-critic',
        });

        group = service.getGroup(WS, run.id)!;
        expect(group.status).toBe('completed');
        expect(group.children).toEqual([
            expect.objectContaining({ role: 'analyzer', processId: 'proc-analyzer' }),
            expect.objectContaining({ role: 'critic', processId: 'proc-critic' }),
        ]);

        db.close();
    });
});

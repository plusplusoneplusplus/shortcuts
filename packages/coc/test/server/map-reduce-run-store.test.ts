import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { FileMapReduceRunStore } from '../../src/server/map-reduce/map-reduce-run-store';
import { DEFAULT_MAP_REDUCE_MAX_PARALLEL } from '../../src/server/map-reduce/types';
import type { MapReduceItem } from '../../src/server/map-reduce/types';

const WORKSPACE_ID = 'ws-map-reduce-store-test';

function item(overrides: Partial<MapReduceItem> = {}): MapReduceItem {
    return {
        id: 'item-1',
        title: 'Map one thing',
        prompt: 'Do exactly one map step.',
        status: 'pending',
        ...overrides,
    };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-map-reduce-store-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function createApprovedRun(
    store: FileMapReduceRunStore,
    items: MapReduceItem[],
    maxParallel = 2,
): Promise<string> {
    const run = await store.createDraftRun({
        workspaceId: WORKSPACE_ID,
        originalRequest: 'Map these tasks and reduce the results',
        reduceInstructions: 'Combine the map outputs.',
        childMode: 'ask',
        maxParallel,
        items,
    });
    await store.approveRun(WORKSPACE_ID, run.runId);
    return run.runId;
}

describe('FileMapReduceRunStore', () => {
    it('persists draft runs under repo-scoped map-reduce-runs storage', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                sharedInstructions: 'Use existing patterns.',
                reduceInstructions: 'Summarize every result.',
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
                generationProcessId: 'queue_map-reduce-gen-1',
                generationId: 'map-reduce-gen-1',
                items: [item()],
            });

            const runDir = path.join(getRepoDataPath(dataDir, WORKSPACE_ID, 'map-reduce-runs'), run.runId);
            await expect(fs.stat(path.join(runDir, 'run.json'))).resolves.toBeDefined();
            await expect(fs.stat(path.join(runDir, 'items.json'))).resolves.toBeDefined();
            await expect(fs.stat(path.join(runDir, 'reduce-step.json'))).resolves.toBeDefined();
            await expect(fs.stat(getRepoDataPath(dataDir, WORKSPACE_ID, 'for-each-runs'))).rejects.toMatchObject({ code: 'ENOENT' });

            const restartedStore = new FileMapReduceRunStore({ dataDir });
            const loaded = await restartedStore.getRun(WORKSPACE_ID, run.runId);
            expect(loaded).toMatchObject({
                runId: run.runId,
                workspaceId: WORKSPACE_ID,
                status: 'draft',
                reduceInstructions: 'Summarize every result.',
                maxParallel: DEFAULT_MAP_REDUCE_MAX_PARALLEL,
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
                generationProcessId: 'queue_map-reduce-gen-1',
                generationId: 'map-reduce-gen-1',
                reduceStep: { status: 'pending' },
            });
            expect(loaded?.items[0].title).toBe('Map one thing');
        });
    });

    it('updates reviewed draft plans including reduce controls and summaries', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                reduceInstructions: 'Original reduce.',
                maxParallel: 2,
                childMode: 'ask',
                items: [item()],
            });

            const updated = await store.updateReviewedPlan(WORKSPACE_ID, run.runId, {
                childMode: 'autopilot',
                sharedInstructions: 'Reviewed instructions',
                reduceInstructions: 'Reviewed reduce.',
                maxParallel: 4,
                items: [item({ title: 'Reviewed task', prompt: 'Reviewed prompt.' })],
            });
            expect(updated.childMode).toBe('autopilot');
            expect(updated.sharedInstructions).toBe('Reviewed instructions');
            expect(updated.reduceInstructions).toBe('Reviewed reduce.');
            expect(updated.maxParallel).toBe(4);
            expect(updated.items[0]).toMatchObject({
                title: 'Reviewed task',
                status: 'pending',
            });
            expect(updated.reduceStep).toEqual({ status: 'pending' });

            const summaries = await store.listRuns(WORKSPACE_ID);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].itemCount).toBe(1);
            expect(summaries[0].itemStatusCounts.pending).toBe(1);
            expect(summaries[0].reduceStatus).toBe('pending');

            await store.approveRun(WORKSPACE_ID, run.runId);
            await expect(store.updateReviewedPlan(WORKSPACE_ID, run.runId, {
                reduceInstructions: 'Too late.',
                items: [item({ title: 'Too late' })],
            })).rejects.toThrow(/only draft runs/i);
        });
    });

    it('claims runnable map items in parallel while respecting maxParallel and dependencies', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const runId = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First' }),
                item({ id: 'item-2', title: 'Second' }),
                item({ id: 'item-3', title: 'Third', dependsOn: ['item-1'] }),
                item({ id: 'item-4', title: 'Fourth' }),
            ]);

            const firstClaim = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(firstClaim?.items.map(entry => entry.id)).toEqual(['item-1', 'item-2']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-1', 'task-1', 'queue_task-1');
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-2', 'task-2', 'queue_task-2');
            await expect(store.claimRunnableItems(WORKSPACE_ID, runId)).resolves.toBeUndefined();

            await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-1', 'task-1');
            const secondClaim = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(secondClaim?.items.map(entry => entry.id)).toEqual(['item-3']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-3', 'task-3', 'queue_task-3');

            await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-2', 'task-2');
            const thirdClaim = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(thirdClaim?.items.map(entry => entry.id)).toEqual(['item-4']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-4', 'task-4', 'queue_task-4');

            await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-3', 'task-3');
            const stillRunning = await store.getRun(WORKSPACE_ID, runId);
            expect(stillRunning?.status).toBe('running');

            const reducing = await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-4', 'task-4');
            expect(reducing.status).toBe('reducing');
            expect(reducing.reduceStep.status).toBe('pending');
            await expect(store.claimRunnableItems(WORKSPACE_ID, runId)).resolves.toBeUndefined();
        });
    });

    it('blocks new map claims after a failure until running items drain and the failed item is skipped', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const runId = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First' }),
                item({ id: 'item-2', title: 'Second' }),
                item({ id: 'item-3', title: 'Third', dependsOn: ['item-1'] }),
            ]);

            const claim = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(claim?.items.map(entry => entry.id)).toEqual(['item-1', 'item-2']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-1', 'task-1', 'queue_task-1');
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-2', 'task-2', 'queue_task-2');

            const draining = await store.markRunningItemFailed(WORKSPACE_ID, runId, 'item-1', 'boom', 'task-1');
            expect(draining.status).toBe('running');
            await expect(store.claimRunnableItems(WORKSPACE_ID, runId)).resolves.toBeUndefined();

            const drained = await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-2', 'task-2');
            expect(drained.status).toBe('failed');
            await expect(store.claimRunnableItems(WORKSPACE_ID, runId)).rejects.toThrow(/blocked by failed item 'item-1'/i);

            const skipped = await store.skipItem(WORKSPACE_ID, runId, 'item-1');
            expect(skipped.status).toBe('approved');
            expect(skipped.items.find(entry => entry.id === 'item-1')?.status).toBe('skipped');

            const resumed = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(resumed?.items.map(entry => entry.id)).toEqual(['item-3']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-3', 'task-3', 'queue_task-3');
            const readyToReduce = await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-3', 'task-3');
            expect(readyToReduce.status).toBe('reducing');
        });
    });

    it('retries failed map items and reduce steps before completing the run', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const runId = await createApprovedRun(store, [item()]);

            const claim = await store.claimRunnableItems(WORKSPACE_ID, runId);
            expect(claim?.items.map(entry => entry.id)).toEqual(['item-1']);
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-1', 'task-1', 'queue_task-1');
            const failedMap = await store.markRunningItemFailed(WORKSPACE_ID, runId, 'item-1', 'failed', 'task-1');
            expect(failedMap.status).toBe('failed');

            const retryMap = await store.claimFailedItemForRetry(WORKSPACE_ID, runId, 'item-1');
            expect(retryMap.items).toHaveLength(1);
            expect(retryMap.items[0]).toMatchObject({ id: 'item-1', status: 'running' });
            await store.linkRunningItemChild(WORKSPACE_ID, runId, 'item-1', 'task-2', 'queue_task-2');
            const readyToReduce = await store.markRunningItemCompleted(WORKSPACE_ID, runId, 'item-1', 'task-2');
            expect(readyToReduce.status).toBe('reducing');

            const reduceClaim = await store.claimReduceStep(WORKSPACE_ID, runId);
            expect(reduceClaim?.reduceStep.status).toBe('running');
            await store.linkRunningReduceChild(WORKSPACE_ID, runId, 'task-reduce-1', 'queue_task-reduce-1');
            const failedReduce = await store.markRunningReduceFailed(WORKSPACE_ID, runId, 'reduce failed', 'task-reduce-1');
            expect(failedReduce.status).toBe('failed');
            expect(failedReduce.reduceStep.status).toBe('failed');

            const retryReduce = await store.claimFailedReduceStepForRetry(WORKSPACE_ID, runId);
            expect(retryReduce.run.status).toBe('reducing');
            expect(retryReduce.reduceStep.status).toBe('running');
            await store.linkRunningReduceChild(WORKSPACE_ID, runId, 'task-reduce-2', 'queue_task-reduce-2');
            const completed = await store.markRunningReduceCompleted(WORKSPACE_ID, runId, 'task-reduce-2');
            expect(completed.status).toBe('completed');
            expect(completed.completedAt).toBeDefined();
            expect(completed.reduceStep.status).toBe('completed');
            expect(completed.reduceStep.completedAt).toBeDefined();
        });
    });

    it('cancels running map and reduce work with child task ids', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const mapRunId = await createApprovedRun(store, [item()]);
            await store.claimRunnableItems(WORKSPACE_ID, mapRunId);
            await store.linkRunningItemChild(WORKSPACE_ID, mapRunId, 'item-1', 'task-map', 'queue_task-map');

            const cancelledMap = await store.cancelRun(WORKSPACE_ID, mapRunId);
            expect(cancelledMap.childTaskIds).toEqual(['task-map']);
            expect(cancelledMap.run.status).toBe('cancelled');
            expect(cancelledMap.run.items[0].status).toBe('skipped');
            expect(cancelledMap.run.reduceStep.status).toBe('cancelled');

            const reduceRunId = await createApprovedRun(store, [item({ id: 'item-reduce' })]);
            await store.claimRunnableItems(WORKSPACE_ID, reduceRunId);
            await store.markRunningItemCompleted(WORKSPACE_ID, reduceRunId, 'item-reduce');
            await store.claimReduceStep(WORKSPACE_ID, reduceRunId);
            await store.linkRunningReduceChild(WORKSPACE_ID, reduceRunId, 'task-reduce', 'queue_task-reduce');

            const cancelledReduce = await store.cancelRun(WORKSPACE_ID, reduceRunId);
            expect(cancelledReduce.childTaskIds).toEqual(['task-reduce']);
            expect(cancelledReduce.run.status).toBe('cancelled');
            expect(cancelledReduce.run.reduceStep.status).toBe('cancelled');
        });
    });
});

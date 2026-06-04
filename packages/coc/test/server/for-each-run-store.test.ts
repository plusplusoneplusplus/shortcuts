import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import type { ForEachItem } from '../../src/server/for-each/types';

const WORKSPACE_ID = 'ws-store-test';

function item(overrides: Partial<ForEachItem> = {}): ForEachItem {
    return {
        id: 'item-1',
        title: 'Do one thing',
        prompt: 'Do exactly one thing.',
        status: 'pending',
        ...overrides,
    };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-for-each-store-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

describe('FileForEachRunStore', () => {
    it('persists draft runs under repo-scoped for-each-runs storage', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                sharedInstructions: 'Use existing patterns.',
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
                items: [item()],
            });

            const runDir = path.join(getRepoDataPath(dataDir, WORKSPACE_ID, 'for-each-runs'), run.runId);
            await expect(fs.stat(path.join(runDir, 'run.json'))).resolves.toBeDefined();
            await expect(fs.stat(path.join(runDir, 'items.json'))).resolves.toBeDefined();
            await expect(fs.stat(getRepoDataPath(dataDir, WORKSPACE_ID, 'ralph-sessions'))).rejects.toMatchObject({ code: 'ENOENT' });

            const restartedStore = new FileForEachRunStore({ dataDir });
            const loaded = await restartedStore.getRun(WORKSPACE_ID, run.runId);
            expect(loaded).toMatchObject({
                runId: run.runId,
                workspaceId: WORKSPACE_ID,
                status: 'draft',
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
            });
            expect(loaded?.items[0].title).toBe('Do one thing');
        });
    });

    it('updates reviewed draft item plans and approves without child links', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'ask',
                items: [item()],
            });

            const updated = await store.updateReviewedPlan(WORKSPACE_ID, run.runId, {
                childMode: 'autopilot',
                sharedInstructions: 'Reviewed instructions',
                items: [item({ title: 'Reviewed task', prompt: 'Reviewed prompt.' })],
            });
            expect(updated.childMode).toBe('autopilot');
            expect(updated.sharedInstructions).toBe('Reviewed instructions');
            expect(updated.items[0]).toMatchObject({
                title: 'Reviewed task',
                status: 'pending',
            });
            expect(updated.items[0].childProcessId).toBeUndefined();

            const approved = await store.approveRun(WORKSPACE_ID, run.runId);
            expect(approved.status).toBe('approved');
            expect(approved.approvedAt).toBeDefined();
            expect(approved.items[0].childProcessId).toBeUndefined();

            await expect(store.updateReviewedPlan(WORKSPACE_ID, run.runId, {
                items: [item({ title: 'Too late' })],
            })).rejects.toThrow(/only draft runs/i);
        });
    });

    it('lists run summaries with item status counts', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'ask',
                items: [item()],
            });

            const summaries = await store.listRuns(WORKSPACE_ID);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].itemCount).toBe(1);
            expect(summaries[0].itemStatusCounts.pending).toBe(1);
            expect(summaries[0].itemStatusCounts.completed).toBe(0);
        });
    });

    it('rejects invalid item plans', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            await expect(store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'ask',
                items: [item({ status: 'running' })],
            })).rejects.toThrow(/initial status 'pending'/i);
        });
    });

    it('claims sequential items, records child links, and stops on failure', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'ask',
                items: [
                    item({ id: 'item-1', title: 'First' }),
                    item({ id: 'item-2', title: 'Second', dependsOn: ['item-1'] }),
                ],
            });
            await store.approveRun(WORKSPACE_ID, run.runId);

            const firstClaim = await store.claimNextRunnableItem(WORKSPACE_ID, run.runId);
            expect(firstClaim?.item.id).toBe('item-1');
            await store.linkRunningItemChild(WORKSPACE_ID, run.runId, 'item-1', 'task-1', 'queue_task-1');
            await store.markRunningItemCompleted(WORKSPACE_ID, run.runId, 'item-1', 'task-1');

            const secondClaim = await store.claimNextRunnableItem(WORKSPACE_ID, run.runId);
            expect(secondClaim?.item.id).toBe('item-2');
            await store.linkRunningItemChild(WORKSPACE_ID, run.runId, 'item-2', 'task-2', 'queue_task-2');
            const failed = await store.markRunningItemFailed(WORKSPACE_ID, run.runId, 'item-2', 'boom', 'task-2');

            expect(failed.status).toBe('failed');
            expect(failed.items.map(i => [i.id, i.status])).toEqual([
                ['item-1', 'completed'],
                ['item-2', 'failed'],
            ]);
            await expect(store.claimNextRunnableItem(WORKSPACE_ID, run.runId)).rejects.toThrow(/blocked by failed item/i);
        });
    });

    it('supports retry, skip, and cancellation state transitions', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const run = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'autopilot',
                items: [item()],
            });
            await store.approveRun(WORKSPACE_ID, run.runId);

            const claim = await store.claimNextRunnableItem(WORKSPACE_ID, run.runId);
            expect(claim?.item.id).toBe('item-1');
            await store.linkRunningItemChild(WORKSPACE_ID, run.runId, 'item-1', 'task-1', 'queue_task-1');
            await store.markRunningItemFailed(WORKSPACE_ID, run.runId, 'item-1', 'failed', 'task-1');

            const retry = await store.claimFailedItemForRetry(WORKSPACE_ID, run.runId, 'item-1');
            expect(retry.item.status).toBe('running');
            await store.linkRunningItemChild(WORKSPACE_ID, run.runId, 'item-1', 'task-2', 'queue_task-2');
            await store.markRunningItemFailed(WORKSPACE_ID, run.runId, 'item-1', 'failed again', 'task-2');

            const skipped = await store.skipItem(WORKSPACE_ID, run.runId, 'item-1');
            expect(skipped.status).toBe('completed');
            expect(skipped.items[0].status).toBe('skipped');

            const cancellable = await store.createDraftRun({
                workspaceId: WORKSPACE_ID,
                originalRequest: 'Split this request',
                childMode: 'ask',
                items: [item({ id: 'item-cancel' })],
            });
            await store.approveRun(WORKSPACE_ID, cancellable.runId);
            await store.claimNextRunnableItem(WORKSPACE_ID, cancellable.runId);
            await store.linkRunningItemChild(WORKSPACE_ID, cancellable.runId, 'item-cancel', 'task-cancel', 'queue_task-cancel');
            const cancelled = await store.cancelRun(WORKSPACE_ID, cancellable.runId);
            expect(cancelled.childTaskIds).toEqual(['task-cancel']);
            expect(cancelled.run.status).toBe('cancelled');
            expect(cancelled.run.items[0].status).toBe('skipped');
        });
    });
});

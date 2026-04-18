import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import { reconcileExecutingWorkItems } from '../../../src/server/work-items/work-item-executor';
import type { WorkItem } from '../../../src/server/work-items/types';
import type { ReconcileOptions } from '../../../src/server/work-items/work-item-executor';

let tmpDir: string;
let store: FileWorkItemStore;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-reconcile-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('reconcileExecutingWorkItems', () => {
    it('relinks work item to re-queued task with new ID', async () => {
        const item = makeWorkItem({
            id: 'wi-relink-1',
            status: 'executing',
            taskId: 'old-task-100',
            executionHistory: [{
                taskId: 'old-task-100',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
                sessionCategory: 'generating-code',
            }],
            changes: [{
                id: 'change-1',
                planVersion: 1,
                commits: [],
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'open',
                taskId: 'old-task-100',
                headBefore: 'abc123',
            }],
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [
                { id: 'new-task-200', payload: { workItemId: 'wi-relink-1', kind: 'chat' } },
            ],
            getTask: () => undefined, // old task no longer exists
        };

        const result = await reconcileExecutingWorkItems(store, options);

        expect(result.relinked).toEqual(['wi-relink-1']);
        expect(result.failed).toEqual([]);

        const updated = await store.getWorkItem('wi-relink-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.taskId).toBe('new-task-200');

        // Execution history should be patched
        const exec = updated!.executionHistory!.find(e => e.taskId === 'new-task-200');
        expect(exec).toBeDefined();
        expect(exec!.status).toBe('running');
        // Old taskId should be gone
        expect(updated!.executionHistory!.find(e => e.taskId === 'old-task-100')).toBeUndefined();

        // Change entry should be patched
        const changes = await store.getChanges('wi-relink-1');
        const openChange = changes.find(c => c.status === 'open');
        expect(openChange!.taskId).toBe('new-task-200');
        expect(openChange!.headBefore).toBe('abc123');
    });

    it('transitions to aiFailed when no re-queued task found', async () => {
        const item = makeWorkItem({
            id: 'wi-fail-1',
            status: 'executing',
            taskId: 'old-task-300',
            executionHistory: [{
                taskId: 'old-task-300',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
            }],
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [], // no tasks re-queued
            getTask: () => undefined,
        };

        const result = await reconcileExecutingWorkItems(store, options);

        expect(result.relinked).toEqual([]);
        expect(result.failed).toEqual(['wi-fail-1']);

        const updated = await store.getWorkItem('wi-fail-1', 'test-repo');
        expect(updated!.status).toBe('aiFailed');
    });

    it('skips work items whose taskId still exists in the live queue', async () => {
        const item = makeWorkItem({
            id: 'wi-live-1',
            status: 'executing',
            taskId: 'live-task-400',
            executionHistory: [{
                taskId: 'live-task-400',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
            }],
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [],
            getTask: (id) => id === 'live-task-400' ? { id: 'live-task-400' } : undefined,
        };

        const result = await reconcileExecutingWorkItems(store, options);

        expect(result.relinked).toEqual([]);
        expect(result.failed).toEqual([]);

        // Work item should remain unchanged
        const updated = await store.getWorkItem('wi-live-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.taskId).toBe('live-task-400');
    });

    it('is idempotent — second call is a no-op', async () => {
        const item = makeWorkItem({
            id: 'wi-idempotent-1',
            status: 'executing',
            taskId: 'old-task-500',
            executionHistory: [{
                taskId: 'old-task-500',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
            }],
            changes: [{
                id: 'change-2',
                planVersion: 1,
                commits: [],
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'open',
                taskId: 'old-task-500',
            }],
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [
                { id: 'new-task-600', payload: { workItemId: 'wi-idempotent-1' } },
            ],
            getTask: (id) => id === 'new-task-600' ? { id: 'new-task-600' } : undefined,
        };

        // First call relinks
        const result1 = await reconcileExecutingWorkItems(store, options);
        expect(result1.relinked).toEqual(['wi-idempotent-1']);

        // Second call — task now exists in live queue via getTask
        const result2 = await reconcileExecutingWorkItems(store, options);
        expect(result2.relinked).toEqual([]);
        expect(result2.failed).toEqual([]);

        // Work item still correct
        const updated = await store.getWorkItem('wi-idempotent-1', 'test-repo');
        expect(updated!.taskId).toBe('new-task-600');
    });

    it('handles work item with no taskId', async () => {
        const item = makeWorkItem({
            id: 'wi-no-taskid',
            status: 'executing',
            // No taskId set — shouldn't happen normally but handle gracefully
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [],
            getTask: () => undefined,
        };

        const result = await reconcileExecutingWorkItems(store, options);

        expect(result.failed).toEqual(['wi-no-taskid']);
        const updated = await store.getWorkItem('wi-no-taskid', 'test-repo');
        expect(updated!.status).toBe('aiFailed');
    });

    it('returns empty result when no work items are executing', async () => {
        const item = makeWorkItem({
            id: 'wi-done',
            status: 'aiDone',
            taskId: 'task-done',
        });
        await store.addWorkItem(item);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [],
            getTask: () => undefined,
        };

        const result = await reconcileExecutingWorkItems(store, options);
        expect(result.relinked).toEqual([]);
        expect(result.failed).toEqual([]);
    });

    it('reconciles multiple executing work items across repos', async () => {
        const item1 = makeWorkItem({
            id: 'wi-multi-1',
            repoId: 'repo-a',
            status: 'executing',
            taskId: 'old-a',
            executionHistory: [{
                taskId: 'old-a',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
            }],
        });
        const item2 = makeWorkItem({
            id: 'wi-multi-2',
            repoId: 'repo-b',
            status: 'executing',
            taskId: 'old-b',
            executionHistory: [{
                taskId: 'old-b',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
            }],
        });
        await store.addWorkItem(item1);
        await store.addWorkItem(item2);

        const options: ReconcileOptions = {
            getQueuedTasks: () => [
                { id: 'new-a', payload: { workItemId: 'wi-multi-1' } },
                // wi-multi-2 has no re-queued task
            ],
            getTask: () => undefined,
        };

        const result = await reconcileExecutingWorkItems(store, options);

        expect(result.relinked).toEqual(['wi-multi-1']);
        expect(result.failed).toEqual(['wi-multi-2']);

        const updated1 = await store.getWorkItem('wi-multi-1', 'repo-a');
        expect(updated1!.taskId).toBe('new-a');
        expect(updated1!.status).toBe('executing');

        const updated2 = await store.getWorkItem('wi-multi-2', 'repo-b');
        expect(updated2!.status).toBe('aiFailed');
    });

    it('handleWorkItemTaskComplete works after reconciliation', async () => {
        // Simulate the full flow: executing → reconcile → task completes
        const { handleWorkItemTaskComplete } = await import(
            '../../../src/server/work-items/work-item-executor'
        );

        const item = makeWorkItem({
            id: 'wi-e2e-1',
            status: 'executing',
            taskId: 'old-task-e2e',
            executionHistory: [{
                taskId: 'old-task-e2e',
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'running',
                sessionCategory: 'generating-code',
            }],
            changes: [{
                id: 'change-e2e',
                planVersion: 1,
                commits: [],
                startedAt: '2026-01-01T10:00:00.000Z',
                status: 'open',
                taskId: 'old-task-e2e',
                headBefore: 'deadbeef',
            }],
        });
        await store.addWorkItem(item);

        // Reconcile: old task → new task
        const result = await reconcileExecutingWorkItems(store, {
            getQueuedTasks: () => [
                { id: 'new-task-e2e', payload: { workItemId: 'wi-e2e-1' } },
            ],
            getTask: () => undefined,
        });
        expect(result.relinked).toEqual(['wi-e2e-1']);

        // Now simulate the new task completing
        await handleWorkItemTaskComplete('wi-e2e-1', 'new-task-e2e', {
            status: 'completed',
            processId: 'queue_new-task-e2e',
        }, store);

        const final = await store.getWorkItem('wi-e2e-1', 'test-repo');
        expect(final!.status).toBe('aiDone');
        expect(final!.processId).toBe('queue_new-task-e2e');

        // Execution history should show completed
        const exec = final!.executionHistory!.find(e => e.taskId === 'new-task-e2e');
        expect(exec!.status).toBe('completed');
        expect(exec!.processId).toBe('queue_new-task-e2e');

        // Change entry should be closed
        const changes = await store.getChanges('wi-e2e-1');
        const closedChange = changes.find(c => c.taskId === 'new-task-e2e');
        expect(closedChange!.status).toBe('closed');
    });
});

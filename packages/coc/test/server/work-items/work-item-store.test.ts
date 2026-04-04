import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem, WorkItemPlanVersion, WorkItemExecution } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test work item description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-test-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FileWorkItemStore', () => {
    describe('addWorkItem / getWorkItem', () => {
        it('stores and retrieves a work item', async () => {
            const item = makeWorkItem({ id: 'wi-1' });
            await store.addWorkItem(item);

            const retrieved = await store.getWorkItem('wi-1', 'test-repo');
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe('wi-1');
            expect(retrieved!.title).toBe('Test work item');
            expect(retrieved!.status).toBe('created');
        });

        it('throws on duplicate ID', async () => {
            const item = makeWorkItem({ id: 'wi-dup' });
            await store.addWorkItem(item);

            await expect(store.addWorkItem(item)).rejects.toThrow('already exists');
        });

        it('returns undefined for non-existent item', async () => {
            const result = await store.getWorkItem('nonexistent', 'test-repo');
            expect(result).toBeUndefined();
        });

        it('cross-repo lookup finds item without repoId', async () => {
            const item = makeWorkItem({ id: 'wi-cross' });
            await store.addWorkItem(item);

            const found = await store.getWorkItem('wi-cross');
            expect(found).toBeDefined();
            expect(found!.id).toBe('wi-cross');
        });
    });

    describe('updateWorkItem', () => {
        it('updates mutable fields', async () => {
            const item = makeWorkItem({ id: 'wi-upd' });
            await store.addWorkItem(item);

            const updated = await store.updateWorkItem('wi-upd', {
                title: 'Updated title',
                status: 'planning',
                priority: 'high',
                tags: ['urgent'],
            });

            expect(updated).toBeDefined();
            expect(updated!.title).toBe('Updated title');
            expect(updated!.status).toBe('planning');
            expect(updated!.priority).toBe('high');
            expect(updated!.tags).toEqual(['urgent']);
            expect(updated!.updatedAt).not.toBe(item.updatedAt);
        });

        it('returns undefined for non-existent item', async () => {
            const result = await store.updateWorkItem('nonexistent', { title: 'x' });
            expect(result).toBeUndefined();
        });

        it('updates the index entry', async () => {
            const item = makeWorkItem({ id: 'wi-idx' });
            await store.addWorkItem(item);

            await store.updateWorkItem('wi-idx', { status: 'ready', priority: 'low' });

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.find(e => e.id === 'wi-idx');
            expect(entry).toBeDefined();
            expect(entry!.status).toBe('ready');
            expect(entry!.priority).toBe('low');
        });
    });

    describe('removeWorkItem', () => {
        it('removes an existing item', async () => {
            const item = makeWorkItem({ id: 'wi-rm' });
            await store.addWorkItem(item);

            const removed = await store.removeWorkItem('wi-rm');
            expect(removed).toBe(true);

            const retrieved = await store.getWorkItem('wi-rm', 'test-repo');
            expect(retrieved).toBeUndefined();
        });

        it('returns false for non-existent item', async () => {
            const removed = await store.removeWorkItem('nonexistent');
            expect(removed).toBe(false);
        });

        it('removes from index', async () => {
            const item = makeWorkItem({ id: 'wi-rm2' });
            await store.addWorkItem(item);
            await store.removeWorkItem('wi-rm2');

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            expect(entries.find(e => e.id === 'wi-rm2')).toBeUndefined();
        });
    });

    describe('listWorkItems', () => {
        it('lists all items for a repo', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-a' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-b' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-c' }));

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            expect(entries).toHaveLength(3);
        });

        it('filters by status', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', status: 'ready' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3', status: 'done' }));

            const ready = await store.listWorkItems({ repoId: 'test-repo', status: 'ready' });
            expect(ready).toHaveLength(1);
            expect(ready[0].id).toBe('wi-2');
        });

        it('filters by multiple statuses', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', status: 'ready' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3', status: 'done' }));

            const active = await store.listWorkItems({
                repoId: 'test-repo',
                status: ['created', 'ready'],
            });
            expect(active).toHaveLength(2);
        });

        it('filters by source', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', source: 'manual' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', source: 'chat' }));

            const chats = await store.listWorkItems({ repoId: 'test-repo', source: 'chat' });
            expect(chats).toHaveLength(1);
            expect(chats[0].id).toBe('wi-2');
        });

        it('filters by priority', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', priority: 'high' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', priority: 'low' }));

            const high = await store.listWorkItems({ repoId: 'test-repo', priority: 'high' });
            expect(high).toHaveLength(1);
            expect(high[0].id).toBe('wi-1');
        });

        it('filters by tags', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', tags: ['frontend', 'bug'] }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', tags: ['backend'] }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3' }));

            const backend = await store.listWorkItems({ repoId: 'test-repo', tags: ['backend'] });
            expect(backend).toHaveLength(1);
            expect(backend[0].id).toBe('wi-2');
        });

        it('lists across repos when no repoId specified', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', repoId: 'repo-a' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', repoId: 'repo-b' }));

            const all = await store.listWorkItems();
            expect(all).toHaveLength(2);
        });

        it('returns empty for repo with no work items', async () => {
            const entries = await store.listWorkItems({ repoId: 'empty-repo' });
            expect(entries).toEqual([]);
        });
    });

    describe('plan versioning', () => {
        it('saves initial plan version on addWorkItem', async () => {
            const item = makeWorkItem({
                id: 'wi-plan',
                plan: {
                    version: 1,
                    content: '# Step 1\nDo the thing',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                    resolvedBy: 'user',
                },
            });
            await store.addWorkItem(item);

            const versions = await store.getPlanVersions('wi-plan');
            expect(versions).toHaveLength(1);
            expect(versions[0].version).toBe(1);
            expect(versions[0].content).toBe('# Step 1\nDo the thing');
            expect(versions[0].resolvedBy).toBe('user');
        });

        it('saves and retrieves additional plan versions', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-plan2' }));

            const v1: WorkItemPlanVersion = {
                version: 1,
                content: 'Plan v1',
                createdAt: '2026-01-01T00:00:00.000Z',
                resolvedBy: 'user',
            };
            await store.savePlanVersion('wi-plan2', v1);

            const v2: WorkItemPlanVersion = {
                version: 2,
                content: 'Plan v2 - refined',
                createdAt: '2026-01-02T00:00:00.000Z',
                resolvedBy: 'ai',
                summary: 'Added error handling steps',
            };
            await store.savePlanVersion('wi-plan2', v2);

            const versions = await store.getPlanVersions('wi-plan2');
            expect(versions).toHaveLength(2);
            expect(versions[0].version).toBe(1);
            expect(versions[1].version).toBe(2);
            expect(versions[1].summary).toBe('Added error handling steps');
        });

        it('retrieves a specific plan version', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-plan3' }));
            await store.savePlanVersion('wi-plan3', {
                version: 1,
                content: 'First version',
                createdAt: '2026-01-01T00:00:00.000Z',
            });
            await store.savePlanVersion('wi-plan3', {
                version: 2,
                content: 'Second version',
                createdAt: '2026-01-02T00:00:00.000Z',
            });

            const v1 = await store.getPlanVersion('wi-plan3', 1);
            expect(v1).toBeDefined();
            expect(v1!.content).toBe('First version');

            const v2 = await store.getPlanVersion('wi-plan3', 2);
            expect(v2).toBeDefined();
            expect(v2!.content).toBe('Second version');
        });

        it('returns empty for non-existent work item plans', async () => {
            const versions = await store.getPlanVersions('nonexistent');
            expect(versions).toEqual([]);
        });

        it('returns undefined for non-existent plan version', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-plan4' }));
            const v = await store.getPlanVersion('wi-plan4', 99);
            expect(v).toBeUndefined();
        });
    });

    describe('execution history', () => {
        it('adds an execution record', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-exec' }));

            const exec: WorkItemExecution = {
                taskId: 'task-1',
                processId: 'proc-1',
                startedAt: '2026-01-01T12:00:00.000Z',
                status: 'running',
            };
            await store.addExecution('wi-exec', exec);

            const item = await store.getWorkItem('wi-exec', 'test-repo');
            expect(item!.executionHistory).toHaveLength(1);
            expect(item!.executionHistory![0].taskId).toBe('task-1');
            expect(item!.taskId).toBe('task-1');
            expect(item!.processId).toBe('proc-1');
        });

        it('updates an execution record', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-exec2' }));
            await store.addExecution('wi-exec2', {
                taskId: 'task-2',
                startedAt: '2026-01-01T12:00:00.000Z',
                status: 'running',
            });

            await store.updateExecution('wi-exec2', 'task-2', {
                status: 'completed',
                completedAt: '2026-01-01T13:00:00.000Z',
            });

            const item = await store.getWorkItem('wi-exec2', 'test-repo');
            expect(item!.executionHistory![0].status).toBe('completed');
            expect(item!.executionHistory![0].completedAt).toBe('2026-01-01T13:00:00.000Z');
        });

        it('appends multiple executions', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-exec3' }));

            await store.addExecution('wi-exec3', {
                taskId: 'task-a',
                startedAt: '2026-01-01T12:00:00.000Z',
                status: 'failed',
                error: 'timeout',
            });
            await store.addExecution('wi-exec3', {
                taskId: 'task-b',
                startedAt: '2026-01-01T14:00:00.000Z',
                status: 'running',
            });

            const item = await store.getWorkItem('wi-exec3', 'test-repo');
            expect(item!.executionHistory).toHaveLength(2);
            expect(item!.taskId).toBe('task-b');
        });
    });

    describe('concurrent writes', () => {
        it('handles concurrent addWorkItem calls safely', async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
                store.addWorkItem(makeWorkItem({ id: `wi-concurrent-${i}` }))
            );
            await Promise.all(promises);

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            expect(entries).toHaveLength(10);
        });
    });

    describe('removeWorkItem cleans up plan files', () => {
        it('removes plan version files along with the item', async () => {
            const item = makeWorkItem({ id: 'wi-cleanup' });
            await store.addWorkItem(item);
            await store.savePlanVersion('wi-cleanup', {
                version: 1,
                content: 'Plan content',
                createdAt: '2026-01-01T00:00:00.000Z',
            });

            // Verify plan exists
            const v = await store.getPlanVersion('wi-cleanup', 1);
            expect(v).toBeDefined();

            // Remove and verify cleanup
            await store.removeWorkItem('wi-cleanup');
            const vAfter = await store.getPlanVersion('wi-cleanup', 1);
            expect(vAfter).toBeUndefined();
        });
    });
});

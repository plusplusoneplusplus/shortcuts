import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItem, WorkItemIndexEntry, WorkItemPlanVersion, WorkItemExecution } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;

interface LegacyWorkItemSyncLink {
    provider: 'github' | 'azure-boards';
    remote: {
        owner?: string;
        repo?: string;
        projectId?: string;
        issueId?: string;
        issueNumber?: number;
        issueUrl?: string;
    };
    remoteRevision?: string;
    remoteUpdatedAt?: string;
    lastSyncedAt?: string;
    lastSyncedFingerprint?: string;
    parent?: {
        workItemId?: string;
        issueId?: string;
        issueNumber?: number;
        issueUrl?: string;
        owner?: string;
        repo?: string;
    };
}

type WorkItemOverrides = Partial<WorkItem> & { syncLinks?: LegacyWorkItemSyncLink[] };
type MaybeLegacySyncLinks = { syncLinks?: LegacyWorkItemSyncLink[] };

function legacySyncLinksOf(item: WorkItem | WorkItemIndexEntry | undefined): LegacyWorkItemSyncLink[] | undefined {
    return (item as (MaybeLegacySyncLinks | undefined))?.syncLinks;
}

function makeWorkItem(overrides: WorkItemOverrides = {}): WorkItem {
    const { syncLinks, ...fields } = overrides;
    const item: WorkItem = {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test work item description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...fields,
    };
    if (syncLinks) {
        (item as WorkItem & MaybeLegacySyncLinks).syncLinks = syncLinks;
    }
    return item;
}

function legacyIndexEntry(item: WorkItem & MaybeLegacySyncLinks): WorkItemIndexEntry & MaybeLegacySyncLinks {
    return {
        id: item.id,
        workItemNumber: item.workItemNumber,
        repoId: item.repoId,
        title: item.title,
        description: item.description || undefined,
        status: item.status,
        type: item.type,
        parentId: item.parentId,
        tracker: item.tracker,
        githubMirror: item.githubMirror,
        syncLinks: item.syncLinks,
        source: item.source,
        priority: item.priority,
        planVersion: item.plan?.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        completedAt: item.completedAt,
        pinnedAt: item.pinnedAt,
        archivedAt: item.archivedAt,
        tags: item.tags,
    };
}

async function writeLegacyWorkItem(item: WorkItem & MaybeLegacySyncLinks): Promise<void> {
    const dir = getRepoDataPath(tmpDir, item.repoId, 'work-items');
    await fs.mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.json');
    let index: Array<WorkItemIndexEntry & MaybeLegacySyncLinks> = [];
    try {
        index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as Array<WorkItemIndexEntry & MaybeLegacySyncLinks>;
    } catch {
        index = [];
    }
    const nextIndex = [
        ...index.filter(entry => entry.id !== item.id),
        legacyIndexEntry(item),
    ];
    await fs.writeFile(path.join(dir, `${item.id}.json`), JSON.stringify(item, null, 2), 'utf-8');
    await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), 'utf-8');
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

            await store.updateWorkItem('wi-idx', { status: 'readyToExecute', priority: 'low' });

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.items.find(e => e.id === 'wi-idx');
            expect(entry).toBeDefined();
            expect(entry!.status).toBe('readyToExecute');
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
            expect(entries.items.find(e => e.id === 'wi-rm2')).toBeUndefined();
        });

        it('blocks deletion when children exist', async () => {
            const parent = makeWorkItem({ id: 'wi-parent', type: 'pbi' });
            const child = makeWorkItem({ id: 'wi-child', type: 'work-item', parentId: 'wi-parent' });
            await store.addWorkItem(parent);
            await store.addWorkItem(child);

            await expect(store.removeWorkItem('wi-parent')).rejects.toThrow(
                'Cannot delete work item: it has 1 child item(s)',
            );
            // Parent still exists
            const retrieved = await store.getWorkItem('wi-parent', 'test-repo');
            expect(retrieved).toBeDefined();
        });

        it('allows deletion of parent after children are removed', async () => {
            const parent = makeWorkItem({ id: 'wi-par2', type: 'feature' });
            const child = makeWorkItem({ id: 'wi-chi2', type: 'pbi', parentId: 'wi-par2' });
            await store.addWorkItem(parent);
            await store.addWorkItem(child);

            // Remove child first
            await store.removeWorkItem('wi-chi2');

            // Now parent can be removed
            const removed = await store.removeWorkItem('wi-par2');
            expect(removed).toBe(true);
        });
    });

    describe('listChildren', () => {
        it('lists direct children of a parent item', async () => {
            const epic = makeWorkItem({ id: 'epic-1', type: 'epic' });
            const feat1 = makeWorkItem({ id: 'feat-1', type: 'feature', parentId: 'epic-1' });
            const feat2 = makeWorkItem({ id: 'feat-2', type: 'feature', parentId: 'epic-1' });
            const unrelated = makeWorkItem({ id: 'wi-unrelated' });

            await store.addWorkItem(epic);
            await store.addWorkItem(feat1);
            await store.addWorkItem(feat2);
            await store.addWorkItem(unrelated);

            const children = await store.listChildren('epic-1', 'test-repo');
            expect(children).toHaveLength(2);
            expect(children.map(c => c.id)).toContain('feat-1');
            expect(children.map(c => c.id)).toContain('feat-2');
        });

        it('returns empty array when parent has no children', async () => {
            const item = makeWorkItem({ id: 'lone-item' });
            await store.addWorkItem(item);

            const children = await store.listChildren('lone-item', 'test-repo');
            expect(children).toHaveLength(0);
        });
    });

    describe('listWorkItems', () => {
        it('lists all items for a repo', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-a' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-b' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-c' }));

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            expect(entries.items).toHaveLength(3);
        });

        it('filters by status', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', status: 'readyToExecute' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3', status: 'done' }));

            const ready = await store.listWorkItems({ repoId: 'test-repo', status: 'readyToExecute' });
            expect(ready.items).toHaveLength(1);
            expect(ready.items[0].id).toBe('wi-2');
        });

        it('filters by multiple statuses', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', status: 'readyToExecute' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3', status: 'done' }));

            const active = await store.listWorkItems({
                repoId: 'test-repo',
                status: ['created', 'readyToExecute'],
            });
            expect(active.items).toHaveLength(2);
        });

        it('filters by source', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', source: 'manual' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', source: 'chat' }));

            const chats = await store.listWorkItems({ repoId: 'test-repo', source: 'chat' });
            expect(chats.items).toHaveLength(1);
            expect(chats.items[0].id).toBe('wi-2');
        });

        it('filters by priority', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', priority: 'high' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', priority: 'low' }));

            const high = await store.listWorkItems({ repoId: 'test-repo', priority: 'high' });
            expect(high.items).toHaveLength(1);
            expect(high.items[0].id).toBe('wi-1');
        });

        it('filters by tags', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', tags: ['frontend', 'bug'] }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', tags: ['backend'] }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-3' }));

            const backend = await store.listWorkItems({ repoId: 'test-repo', tags: ['backend'] });
            expect(backend.items).toHaveLength(1);
            expect(backend.items[0].id).toBe('wi-2');
        });

        it('lists across repos when no repoId specified', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-1', repoId: 'repo-a' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-2', repoId: 'repo-b' }));

            const all = await store.listWorkItems();
            expect(all.items).toHaveLength(2);
        });

        it('returns empty for repo with no work items', async () => {
            const entries = await store.listWorkItems({ repoId: 'empty-repo' });
            expect(entries.items).toEqual([]);
            expect(entries.total).toBe(0);
        });

        it('filters by type', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-feat', type: 'work-item' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-bug', type: 'bug' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-none' })); // no type — defaults to 'work-item'

            const bugs = await store.listWorkItems({ repoId: 'test-repo', type: 'bug' });
            expect(bugs.items).toHaveLength(1);
            expect(bugs.items[0].id).toBe('wi-bug');

            const workItems = await store.listWorkItems({ repoId: 'test-repo', type: 'work-item' });
            expect(workItems.items).toHaveLength(2);
            expect(workItems.items.map(w => w.id).sort()).toEqual(['wi-feat', 'wi-none']);
        });

        it('stores and retrieves type field', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-typed', type: 'bug' }));
            const item = await store.getWorkItem('wi-typed', 'test-repo');
            expect(item).toBeDefined();
            expect(item!.type).toBe('bug');
        });

        it('index entry includes type field', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-bug-idx', type: 'bug' }));
            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.items.find(e => e.id === 'wi-bug-idx');
            expect(entry).toBeDefined();
            expect(entry!.type).toBe('bug');
        });

        it('stores tracker metadata on index entries', async () => {
            await store.addWorkItem(makeWorkItem({
                id: 'epic-github',
                type: 'epic',
                tracker: {
                    kind: 'github-backed',
                    provider: 'github',
                    github: {
                        issueNumber: 42,
                        issueUrl: 'https://github.com/org/repo/issues/42',
                        lastPulledAt: '2026-01-02T00:00:00.000Z',
                    },
                },
            }));

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.items.find(e => e.id === 'epic-github');
            expect(entry?.tracker).toEqual({
                kind: 'github-backed',
                provider: 'github',
                github: {
                    issueNumber: 42,
                    issueUrl: 'https://github.com/org/repo/issues/42',
                    lastPulledAt: '2026-01-02T00:00:00.000Z',
                },
            });
        });

        it('stores GitHub mirror metadata on index entries', async () => {
            await store.addWorkItem(makeWorkItem({
                id: 'github-mirror-item',
                type: 'feature',
                githubMirror: {
                    issueId: 'I_42',
                    issueNumber: 42,
                    issueUrl: 'https://github.com/org/repo/issues/42',
                    state: 'closed',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                    lastPulledAt: '2026-01-03T00:00:00.000Z',
                },
            }));

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.items.find(e => e.id === 'github-mirror-item');
            expect(entry?.githubMirror).toEqual({
                issueId: 'I_42',
                issueNumber: 42,
                issueUrl: 'https://github.com/org/repo/issues/42',
                state: 'closed',
                updatedAt: '2026-01-02T00:00:00.000Z',
                lastPulledAt: '2026-01-03T00:00:00.000Z',
            });
        });

        it('filters by inherited epic-rooted tracker kind', async () => {
            await store.addWorkItem(makeWorkItem({
                id: 'local-epic',
                type: 'epic',
                title: 'Local Epic',
            }));
            await store.addWorkItem(makeWorkItem({
                id: 'local-feature',
                type: 'feature',
                parentId: 'local-epic',
                title: 'Local Feature',
            }));
            await store.addWorkItem(makeWorkItem({
                id: 'github-epic',
                type: 'epic',
                title: 'GitHub Epic',
                tracker: {
                    kind: 'github-backed',
                    provider: 'github',
                    github: { issueNumber: 101 },
                },
            }));
            await store.addWorkItem(makeWorkItem({
                id: 'github-feature',
                type: 'feature',
                parentId: 'github-epic',
                title: 'GitHub Feature',
            }));
            await store.addWorkItem(makeWorkItem({
                id: 'orphan-task',
                type: 'work-item',
                title: 'Local Orphan',
            }));

            const githubBacked = await store.listWorkItems({ repoId: 'test-repo', tracker: 'github-backed' });
            expect(githubBacked.items.map(item => item.id).sort()).toEqual(['github-epic', 'github-feature']);

            const localOnly = await store.listWorkItems({ repoId: 'test-repo', tracker: 'local-only' });
            expect(localOnly.items.map(item => item.id).sort()).toEqual(['local-epic', 'local-feature', 'orphan-task']);
        });

        it('migrates legacy GitHub syncLinks into Epic-rooted tracker and mirror metadata', async () => {
            const rootSyncLink = {
                provider: 'github' as const,
                remote: {
                    owner: 'octo-org',
                    repo: 'octo-repo',
                    issueId: 'I_root',
                    issueNumber: 100,
                    issueUrl: 'https://github.com/octo-org/octo-repo/issues/100',
                },
                remoteUpdatedAt: '2026-01-02T00:00:00.000Z',
                lastSyncedAt: '2026-01-02T01:00:00.000Z',
            };
            const childSyncLink = {
                provider: 'github' as const,
                remote: {
                    owner: 'octo-org',
                    repo: 'octo-repo',
                    issueId: 'I_child',
                    issueNumber: 101,
                    issueUrl: 'https://github.com/octo-org/octo-repo/issues/101',
                },
                remoteUpdatedAt: '2026-01-03T00:00:00.000Z',
                lastSyncedAt: '2026-01-03T01:00:00.000Z',
            };
            await writeLegacyWorkItem(makeWorkItem({
                id: 'legacy-epic',
                type: 'epic',
                syncLinks: [rootSyncLink],
            }));
            await writeLegacyWorkItem(makeWorkItem({
                id: 'legacy-feature',
                type: 'feature',
                parentId: 'legacy-epic',
                syncLinks: [childSyncLink],
            }));

            const feature = await store.getWorkItem('legacy-feature', 'test-repo');
            expect(legacySyncLinksOf(feature)).toBeUndefined();
            expect(feature?.githubMirror).toEqual({
                issueId: 'I_child',
                issueNumber: 101,
                issueUrl: 'https://github.com/octo-org/octo-repo/issues/101',
                updatedAt: '2026-01-03T00:00:00.000Z',
                lastPulledAt: '2026-01-03T01:00:00.000Z',
            });

            const epic = await store.getWorkItem('legacy-epic', 'test-repo');
            expect(legacySyncLinksOf(epic)).toBeUndefined();
            expect(epic?.tracker).toEqual({
                kind: 'github-backed',
                provider: 'github',
                github: {
                    issueId: 'I_root',
                    issueNumber: 100,
                    issueUrl: 'https://github.com/octo-org/octo-repo/issues/100',
                    lastPulledAt: '2026-01-02T01:00:00.000Z',
                },
            });
            expect(epic?.githubMirror).toEqual({
                issueId: 'I_root',
                issueNumber: 100,
                issueUrl: 'https://github.com/octo-org/octo-repo/issues/100',
                updatedAt: '2026-01-02T00:00:00.000Z',
                lastPulledAt: '2026-01-02T01:00:00.000Z',
            });

            const githubBacked = await store.listWorkItems({ repoId: 'test-repo', tracker: 'github-backed' });
            expect(githubBacked.items.map(item => item.id).sort()).toEqual(['legacy-epic', 'legacy-feature']);
            expect(githubBacked.items.every(item => legacySyncLinksOf(item) === undefined)).toBe(true);
        });

        it('drops legacy syncLinks that cannot be rooted at a GitHub-backed Epic', async () => {
            await writeLegacyWorkItem(makeWorkItem({
                id: 'legacy-orphan',
                type: 'work-item',
                syncLinks: [{
                    provider: 'github',
                    remote: {
                        owner: 'octo-org',
                        repo: 'octo-repo',
                        issueNumber: 200,
                        issueUrl: 'https://github.com/octo-org/octo-repo/issues/200',
                    },
                    lastSyncedAt: '2026-01-04T00:00:00.000Z',
                }],
            }));

            const item = await store.getWorkItem('legacy-orphan', 'test-repo');
            expect(legacySyncLinksOf(item)).toBeUndefined();
            expect(item?.githubMirror).toBeUndefined();
            expect(item?.tracker).toBeUndefined();

            const list = await store.listWorkItems({ repoId: 'test-repo' });
            expect(legacySyncLinksOf(list.items.find(entry => entry.id === 'legacy-orphan'))).toBeUndefined();
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
            expect(entries.items).toHaveLength(10);
        });
    });

    describe('reviewComments field', () => {
        it('stores and retrieves reviewComments', async () => {
            const item = makeWorkItem({ id: 'wi-review' });
            await store.addWorkItem(item);

            const updated = await store.updateWorkItem('wi-review', {
                reviewComments: [
                    { id: 'rc-1', text: 'Fix the auth flow', createdAt: '2026-01-01T00:00:00.000Z' },
                    { id: 'rc-2', text: 'Add tests', createdAt: '2026-01-01T01:00:00.000Z', resolved: true },
                ],
            });

            expect(updated!.reviewComments).toHaveLength(2);
            expect(updated!.reviewComments![0].text).toBe('Fix the auth flow');
            expect(updated!.reviewComments![1].resolved).toBe(true);
        });

        it('clears reviewComments by setting to empty array', async () => {
            const item = makeWorkItem({
                id: 'wi-clear-review',
                reviewComments: [{ id: 'rc-1', text: 'Old comment', createdAt: '2026-01-01T00:00:00.000Z' }],
            });
            await store.addWorkItem(item);

            const updated = await store.updateWorkItem('wi-clear-review', {
                reviewComments: [],
            });

            expect(updated!.reviewComments).toEqual([]);
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

    describe('workItemNumber', () => {
        it('assigns sequential workItemNumber on create', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-num-1' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-num-2' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-num-3' }));

            const item1 = await store.getWorkItem('wi-num-1', 'test-repo');
            const item2 = await store.getWorkItem('wi-num-2', 'test-repo');
            const item3 = await store.getWorkItem('wi-num-3', 'test-repo');

            expect(item1!.workItemNumber).toBe(1);
            expect(item2!.workItemNumber).toBe(2);
            expect(item3!.workItemNumber).toBe(3);
        });

        it('includes workItemNumber in index entries', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-idx-num' }));

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const entry = entries.items.find(e => e.id === 'wi-idx-num');
            expect(entry).toBeDefined();
            expect(entry!.workItemNumber).toBe(1);
        });

        it('never reuses numbers after deletion', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-del-1' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-del-2' }));
            await store.removeWorkItem('wi-del-2');

            await store.addWorkItem(makeWorkItem({ id: 'wi-del-3' }));
            const item3 = await store.getWorkItem('wi-del-3', 'test-repo');
            expect(item3!.workItemNumber).toBe(3);
        });

        it('migrates existing items without numbers on first create', async () => {
            // Manually write items without workItemNumber to simulate legacy data
            const dir = path.join(tmpDir, 'repos', 'test-repo', 'work-items');
            await fs.mkdir(dir, { recursive: true });

            const legacyItem1: any = {
                id: 'legacy-1', repoId: 'test-repo', title: 'Legacy 1',
                description: '', status: 'created', source: 'manual',
                createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
            };
            const legacyItem2: any = {
                id: 'legacy-2', repoId: 'test-repo', title: 'Legacy 2',
                description: '', status: 'created', source: 'manual',
                createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
            };

            await fs.writeFile(path.join(dir, 'legacy-1.json'), JSON.stringify(legacyItem1));
            await fs.writeFile(path.join(dir, 'legacy-2.json'), JSON.stringify(legacyItem2));
            await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify([
                { id: 'legacy-1', repoId: 'test-repo', title: 'Legacy 1', status: 'created', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
                { id: 'legacy-2', repoId: 'test-repo', title: 'Legacy 2', status: 'created', source: 'manual', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
            ]));

            // Now add a new item — this should trigger migration
            await store.addWorkItem(makeWorkItem({ id: 'wi-new-after-legacy' }));

            // Legacy items should be backfilled (ordered by createdAt)
            const legacy1 = await store.getWorkItem('legacy-1', 'test-repo');
            const legacy2 = await store.getWorkItem('legacy-2', 'test-repo');
            const newItem = await store.getWorkItem('wi-new-after-legacy', 'test-repo');

            expect(legacy1!.workItemNumber).toBe(1);
            expect(legacy2!.workItemNumber).toBe(2);
            expect(newItem!.workItemNumber).toBe(3);
        });

        it('assigns independent numbers per repo', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-r1', repoId: 'repo-a' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-r2', repoId: 'repo-b' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-r3', repoId: 'repo-a' }));

            const r1 = await store.getWorkItem('wi-r1', 'repo-a');
            const r2 = await store.getWorkItem('wi-r2', 'repo-b');
            const r3 = await store.getWorkItem('wi-r3', 'repo-a');

            expect(r1!.workItemNumber).toBe(1);
            expect(r2!.workItemNumber).toBe(1); // independent counter
            expect(r3!.workItemNumber).toBe(2);
        });

        it('handles concurrent creates with unique numbers', async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
                store.addWorkItem(makeWorkItem({ id: `wi-conc-num-${i}` }))
            );
            await Promise.all(promises);

            const entries = await store.listWorkItems({ repoId: 'test-repo' });
            const numbers = entries.items.map(e => e.workItemNumber).sort((a, b) => a! - b!);
            expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        });
    });

    describe('search and pagination', () => {
        it('searches by title (case-insensitive)', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-s1', title: 'Fix login bug' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-s2', title: 'Add payment' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-s3', title: 'Update Login UI' }));

            const result = await store.listWorkItems({ repoId: 'test-repo', search: 'login' });
            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it('searches by description', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-sd1', description: 'Fix the authentication flow' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sd2', description: 'Update the navbar styling' }));

            const result = await store.listWorkItems({ repoId: 'test-repo', search: 'authentication' });
            expect(result.items).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('wi-sd1');
        });

        it('searches by tags', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-st1', tags: ['frontend'] }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-st2', tags: ['backend'] }));

            const result = await store.listWorkItems({ repoId: 'test-repo', search: 'frontend' });
            expect(result.items).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('wi-st1');
        });

        it('returns total before pagination', async () => {
            for (let i = 0; i < 5; i++) {
                await store.addWorkItem(makeWorkItem({ id: `wi-p${i}` }));
            }

            const result = await store.listWorkItems({ repoId: 'test-repo', limit: 2 });
            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(5);
        });

        it('respects offset', async () => {
            for (let i = 0; i < 5; i++) {
                await store.addWorkItem(makeWorkItem({ id: `wi-o${i}` }));
            }

            const result = await store.listWorkItems({ repoId: 'test-repo', offset: 3, limit: 10 });
            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(5);
        });

        it('combines search with pagination', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-sp1', title: 'Fix bug A' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sp2', title: 'Add feature' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sp3', title: 'Fix bug B' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sp4', title: 'Update docs' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sp5', title: 'Fix bug C' }));

            const result = await store.listWorkItems({ repoId: 'test-repo', search: 'fix', limit: 2 });
            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(3);
        });

        it('combines search with other filters', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-sf1', title: 'Fix login', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sf2', title: 'Fix payment', status: 'in-progress' }));
            await store.addWorkItem(makeWorkItem({ id: 'wi-sf3', title: 'Add dashboard', status: 'created' }));

            const result = await store.listWorkItems({ repoId: 'test-repo', status: 'created', search: 'fix' });
            expect(result.items).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('wi-sf1');
        });

        it('returns empty when search matches nothing', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'wi-empty1', title: 'Some item' }));

            const result = await store.listWorkItems({ repoId: 'test-repo', search: 'nonexistent-xyz' });
            expect(result.items).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    describe('listWorkItemsGrouped', () => {
        it('groups items by status', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'g1', title: 'Item 1', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'g2', title: 'Item 2', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'g3', title: 'Item 3', status: 'executing' }));
            await store.addWorkItem(makeWorkItem({ id: 'g4', title: 'Item 4', status: 'done' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo' });
            expect(Object.keys(result.groups)).toHaveLength(3);
            expect(result.groups['created'].items).toHaveLength(2);
            expect(result.groups['created'].total).toBe(2);
            expect(result.groups['executing'].items).toHaveLength(1);
            expect(result.groups['executing'].total).toBe(1);
            expect(result.groups['done'].items).toHaveLength(1);
            expect(result.groups['done'].total).toBe(1);
        });

        it('respects per-group limit', async () => {
            for (let i = 0; i < 5; i++) {
                await store.addWorkItem(makeWorkItem({ id: `gl-${i}`, title: `Item ${i}`, status: 'created' }));
            }
            await store.addWorkItem(makeWorkItem({ id: 'gl-done', title: 'Done item', status: 'done' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo', limit: 3 });
            expect(result.groups['created'].items).toHaveLength(3);
            expect(result.groups['created'].total).toBe(5);
            expect(result.groups['done'].items).toHaveLength(1);
            expect(result.groups['done'].total).toBe(1);
        });

        it('applies search across all groups', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'gs1', title: 'Login fix', status: 'created' }));
            await store.addWorkItem(makeWorkItem({ id: 'gs2', title: 'Login test', status: 'done' }));
            await store.addWorkItem(makeWorkItem({ id: 'gs3', title: 'Dashboard update', status: 'created' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo', search: 'login' });
            expect(Object.keys(result.groups)).toHaveLength(2);
            expect(result.groups['created'].items).toHaveLength(1);
            expect(result.groups['created'].items[0].id).toBe('gs1');
            expect(result.groups['done'].items).toHaveLength(1);
            expect(result.groups['done'].items[0].id).toBe('gs2');
        });

        it('applies non-status filters', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'gf1', title: 'High item', status: 'created', priority: 'high' }));
            await store.addWorkItem(makeWorkItem({ id: 'gf2', title: 'Low item', status: 'created', priority: 'low' }));
            await store.addWorkItem(makeWorkItem({ id: 'gf3', title: 'High done', status: 'done', priority: 'high' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo', priority: 'high' });
            expect(Object.keys(result.groups)).toHaveLength(2);
            expect(result.groups['created'].items).toHaveLength(1);
            expect(result.groups['done'].items).toHaveLength(1);
        });

        it('excludes empty groups', async () => {
            await store.addWorkItem(makeWorkItem({ id: 'ge1', title: 'Item', status: 'created' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo' });
            expect(Object.keys(result.groups)).toEqual(['created']);
            expect(result.groups['executing']).toBeUndefined();
        });

        it('returns empty groups object when no items', async () => {
            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo' });
            expect(result.groups).toEqual({});
        });

        it('combines search with filter and limit', async () => {
            for (let i = 0; i < 5; i++) {
                await store.addWorkItem(makeWorkItem({ id: `gcf-${i}`, title: `Fix bug ${i}`, status: 'created', priority: 'high' }));
            }
            await store.addWorkItem(makeWorkItem({ id: 'gcf-low', title: 'Fix bug low', status: 'created', priority: 'low' }));

            const result = await store.listWorkItemsGrouped({ repoId: 'test-repo', search: 'fix', priority: 'high', limit: 3 });
            expect(result.groups['created'].items).toHaveLength(3);
            expect(result.groups['created'].total).toBe(5);
        });
    });

    describe('index repair', () => {
        it('recovers orphaned item files not in index', async () => {
            // Add an item normally so the directory exists
            const item1 = makeWorkItem({ id: 'indexed-1', title: 'Indexed item' });
            await store.addWorkItem(item1);

            // Manually write an orphan item file (not in index)
            const wiDir = path.join(tmpDir, 'repos', 'test-repo', 'work-items');
            const orphan = makeWorkItem({ id: 'orphan-1', title: 'Orphaned item' });
            await fs.writeFile(path.join(wiDir, 'orphan-1.json'), JSON.stringify(orphan), 'utf-8');

            // Remove orphan from index by overwriting with just the first item
            const index = JSON.parse(await fs.readFile(path.join(wiDir, 'index.json'), 'utf-8'));
            await fs.writeFile(path.join(wiDir, 'index.json'), JSON.stringify(index), 'utf-8');

            // New store instance to trigger repair
            const freshStore = new FileWorkItemStore({ dataDir: tmpDir });
            const result = await freshStore.listWorkItems({ repoId: 'test-repo' });
            expect(result.total).toBe(2);
            const ids = result.items.map(i => i.id).sort();
            expect(ids).toEqual(['indexed-1', 'orphan-1']);
        });

        it('handles corrupted single-object index', async () => {
            const wiDir = path.join(tmpDir, 'repos', 'test-repo', 'work-items');
            await fs.mkdir(wiDir, { recursive: true });

            // Write an item file
            const item = makeWorkItem({ id: 'single-1', title: 'Single object' });
            await fs.writeFile(path.join(wiDir, 'single-1.json'), JSON.stringify(item), 'utf-8');

            // Write a corrupted index (object instead of array)
            const indexEntry = { id: 'single-1', repoId: 'test-repo', title: 'Single object', status: 'created', createdAt: item.createdAt, updatedAt: item.updatedAt };
            await fs.writeFile(path.join(wiDir, 'index.json'), JSON.stringify(indexEntry), 'utf-8');

            const freshStore = new FileWorkItemStore({ dataDir: tmpDir });
            const result = await freshStore.listWorkItems({ repoId: 'test-repo' });
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('single-1');
        });

        it('fixes missing repoId on entries', async () => {
            const wiDir = path.join(tmpDir, 'repos', 'test-repo', 'work-items');
            await fs.mkdir(wiDir, { recursive: true });

            // Write item file without repoId
            const item = { ...makeWorkItem({ id: 'no-repo', title: 'No repo' }), repoId: '' };
            await fs.writeFile(path.join(wiDir, 'no-repo.json'), JSON.stringify(item), 'utf-8');

            // Write index with missing repoId
            const indexEntry = { id: 'no-repo', repoId: '', title: 'No repo', status: 'created', createdAt: item.createdAt, updatedAt: item.updatedAt };
            await fs.writeFile(path.join(wiDir, 'index.json'), JSON.stringify([indexEntry]), 'utf-8');

            const freshStore = new FileWorkItemStore({ dataDir: tmpDir });
            const result = await freshStore.listWorkItems({ repoId: 'test-repo' });
            expect(result.total).toBe(1);
            expect(result.items[0].repoId).toBe('test-repo');
        });

        it('reads files with UTF-8 BOM', async () => {
            const wiDir = path.join(tmpDir, 'repos', 'test-repo', 'work-items');
            await fs.mkdir(wiDir, { recursive: true });

            // Write item file with BOM
            const item = makeWorkItem({ id: 'bom-item', title: 'BOM item' });
            const bom = '\uFEFF';
            await fs.writeFile(path.join(wiDir, 'bom-item.json'), bom + JSON.stringify(item), 'utf-8');

            // Write index with BOM too
            const indexEntry = { id: 'bom-item', repoId: 'test-repo', title: 'BOM item', status: 'created', createdAt: item.createdAt, updatedAt: item.updatedAt };
            await fs.writeFile(path.join(wiDir, 'index.json'), bom + JSON.stringify([indexEntry]), 'utf-8');

            const freshStore = new FileWorkItemStore({ dataDir: tmpDir });
            const result = await freshStore.listWorkItems({ repoId: 'test-repo' });
            expect(result.total).toBe(1);
            expect(result.items[0].id).toBe('bom-item');
            expect(result.items[0].title).toBe('BOM item');
        });
    });
});

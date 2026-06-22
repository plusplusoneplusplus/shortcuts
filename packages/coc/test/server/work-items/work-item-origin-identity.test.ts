import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import {
    FileWorkItemStore,
    type WorkItemStorageScope,
} from '../../../src/server/work-items/work-item-store';
import {
    deriveWorkItemOriginProvider,
    type WorkItem,
    type WorkItemIndexEntry,
} from '../../../src/server/work-items/types';

let tmpDir: string;

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

/**
 * Write a pre-origin-identity work item straight to disk (no originId), mirroring
 * data created before this field existed, so the store's backfill can be exercised.
 */
async function writePreMigrationItem(repoId: string, item: WorkItem): Promise<void> {
    const dir = getRepoDataPath(tmpDir, repoId, 'work-items');
    await fs.mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.json');
    let index: WorkItemIndexEntry[] = [];
    try {
        index = JSON.parse(await fs.readFile(indexPath, 'utf-8')) as WorkItemIndexEntry[];
    } catch {
        index = [];
    }
    const entry: WorkItemIndexEntry = {
        id: item.id,
        workItemNumber: item.workItemNumber,
        repoId: item.repoId,
        title: item.title,
        description: item.description || undefined,
        status: item.status,
        type: item.type,
        parentId: item.parentId,
        source: item.source,
        priority: item.priority,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        tags: item.tags,
    };
    const nextIndex = [...index.filter(e => e.id !== item.id), entry];
    await fs.writeFile(path.join(dir, `${item.id}.json`), JSON.stringify(item, null, 2), 'utf-8');
    await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), 'utf-8');
}

async function readItemFile(repoId: string, id: string): Promise<WorkItem> {
    const file = path.join(getRepoDataPath(tmpDir, repoId, 'work-items'), `${id}.json`);
    return JSON.parse(await fs.readFile(file, 'utf-8')) as WorkItem;
}

async function readIndexFile(repoId: string): Promise<WorkItemIndexEntry[]> {
    const file = path.join(getRepoDataPath(tmpDir, repoId, 'work-items'), 'index.json');
    return JSON.parse(await fs.readFile(file, 'utf-8')) as WorkItemIndexEntry[];
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-origin-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('deriveWorkItemOriginProvider', () => {
    it('maps canonical origin id prefixes to providers', () => {
        expect(deriveWorkItemOriginProvider('gh_owner_repo')).toBe('github');
        expect(deriveWorkItemOriginProvider('ado_org_project')).toBe('azure-devops');
        expect(deriveWorkItemOriginProvider('git_deadbeef')).toBe('git');
        expect(deriveWorkItemOriginProvider('local_ws-abc')).toBe('local');
    });

    it('defaults non-canonical caller stamps and absent ids to local', () => {
        expect(deriveWorkItemOriginProvider('ws-hcv3mg')).toBe('local');
        expect(deriveWorkItemOriginProvider('test-repo')).toBe('local');
        expect(deriveWorkItemOriginProvider(undefined)).toBe('local');
    });
});

describe('FileWorkItemStore origin identity (AC-03)', () => {
    it('stamps a local-scope origin identity on create when no resolver is configured', async () => {
        const store = new FileWorkItemStore({ dataDir: tmpDir });
        const item = makeWorkItem({ id: 'wi-local', repoId: 'test-repo' });
        await store.addWorkItem(item);

        // Mutated in place by the store.
        expect(item.originId).toBe('test-repo');
        expect(item.originProvider).toBe('local');

        const retrieved = await store.getWorkItem('wi-local', 'test-repo');
        expect(retrieved?.originId).toBe('test-repo');
        expect(retrieved?.originProvider).toBe('local');

        const onDisk = await readItemFile('test-repo', 'wi-local');
        expect(onDisk.originId).toBe('test-repo');
        expect(onDisk.originProvider).toBe('local');

        const [entry] = await readIndexFile('test-repo');
        expect(entry.originId).toBe('test-repo');
        expect(entry.originProvider).toBe('local');
    });

    it('stamps the canonical origin scope independent of the caller URL family', async () => {
        const sameOriginScope: WorkItemStorageScope = {
            storageRepoId: 'gh_owner_repo',
            legacyRepoIds: ['clone-a', 'clone-b'],
        };
        const store = new FileWorkItemStore({
            dataDir: tmpDir,
            scopeResolver: () => sameOriginScope,
        });

        const item = makeWorkItem({ id: 'origin-shared', repoId: 'clone-a' });
        await store.addWorkItem(item);

        expect(item.originId).toBe('gh_owner_repo');
        expect(item.originProvider).toBe('github');

        // Read back through a *different* clone id — origin identity is stable.
        const fromOtherClone = await store.getWorkItem('origin-shared', 'clone-b');
        expect(fromOtherClone?.repoId).toBe('clone-a');
        expect(fromOtherClone?.originId).toBe('gh_owner_repo');
        expect(fromOtherClone?.originProvider).toBe('github');

        const list = await store.listWorkItems({ repoId: 'clone-b' });
        expect(list.items[0]?.originId).toBe('gh_owner_repo');
        expect(list.items[0]?.originProvider).toBe('github');

        // Persisted under the canonical origin directory.
        const onDisk = await readItemFile('gh_owner_repo', 'origin-shared');
        expect(onDisk.originId).toBe('gh_owner_repo');
        expect(onDisk.originProvider).toBe('github');
    });

    it('backfills origin identity for pre-existing items and persists it', async () => {
        const legacy = makeWorkItem({ id: 'legacy-1', repoId: 'gh_owner_repo' });
        await writePreMigrationItem('gh_owner_repo', legacy);

        // Confirm the fixture really lacks the field.
        const before = await readItemFile('gh_owner_repo', 'legacy-1');
        expect(before.originId).toBeUndefined();

        const store = new FileWorkItemStore({ dataDir: tmpDir });
        const list = await store.listWorkItems({ repoId: 'gh_owner_repo' });
        expect(list.items[0]?.originId).toBe('gh_owner_repo');
        expect(list.items[0]?.originProvider).toBe('github');

        const retrieved = await store.getWorkItem('legacy-1', 'gh_owner_repo');
        expect(retrieved?.originId).toBe('gh_owner_repo');
        expect(retrieved?.originProvider).toBe('github');

        // Migration is persisted to disk, not merely computed on read.
        const onDiskItem = await readItemFile('gh_owner_repo', 'legacy-1');
        expect(onDiskItem.originId).toBe('gh_owner_repo');
        expect(onDiskItem.originProvider).toBe('github');

        const [onDiskEntry] = await readIndexFile('gh_owner_repo');
        expect(onDiskEntry.originId).toBe('gh_owner_repo');
        expect(onDiskEntry.originProvider).toBe('github');
    });

    it('backfills a local origin scope for a non-remote workspace directory', async () => {
        const legacy = makeWorkItem({ id: 'legacy-local', repoId: 'local_ws-xyz' });
        await writePreMigrationItem('local_ws-xyz', legacy);

        const store = new FileWorkItemStore({ dataDir: tmpDir });
        const retrieved = await store.getWorkItem('legacy-local', 'local_ws-xyz');
        expect(retrieved?.originId).toBe('local_ws-xyz');
        expect(retrieved?.originProvider).toBe('local');
    });

    it('does not overwrite an already-stamped origin identity', async () => {
        const store = new FileWorkItemStore({ dataDir: tmpDir });
        const item = makeWorkItem({ id: 'keep-origin', repoId: 'gh_owner_repo' });
        await store.addWorkItem(item);
        expect(item.originId).toBe('gh_owner_repo');

        // A later read must not re-derive or change the stored origin id.
        await store.listWorkItems({ repoId: 'gh_owner_repo' });
        const onDisk = await readItemFile('gh_owner_repo', 'keep-origin');
        expect(onDisk.originId).toBe('gh_owner_repo');
        expect(onDisk.originProvider).toBe('github');
    });
});

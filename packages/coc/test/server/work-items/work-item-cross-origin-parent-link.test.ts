/**
 * AC-01 — Same-origin parent linking.
 *
 * The same upstream repo carries two identity layers: a per-clone workspace id
 * (`ws-*`) and a canonical origin scope (`gh_<owner>_<repo>`). Work items are
 * physically stored under the canonical origin scope, but each item's `repoId`
 * is stamped with whatever id the caller's URL family used — so a child created
 * against `ws-*` and a parent stored under the `gh_*` mirror of the SAME repo
 * carry different `repoId` strings.
 *
 * These tests prove the parent-link gate compares resolved canonical origins
 * (not raw `repoId` strings): same-origin links succeed (create-with-parent and
 * link/move), while genuinely different upstream origins are still rejected with
 * the original error.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    FileWorkItemStore,
    type WorkItemStorageScopeResolver,
} from '../../../src/server/work-items/work-item-store';
import {
    createWorkItemCommand,
    updateWorkItemCommand,
    type WorkItemCommandContext,
} from '../../../src/server/work-items/work-item-commands';
import type { WorkItem } from '../../../src/server/work-items/types';
import {
    clearWorkItemResponseCache,
    getWorkItemResponseCacheEntry,
    makeWorkItemGroupedResponseCacheKey,
    makeWorkItemListResponseCacheKey,
    makeWorkItemTreeResponseCacheKey,
    refreshWorkItemResponseCacheEntry,
} from '../../../src/server/work-items/work-item-response-cache';

// Canonical origin scopes (where items physically live).
const ORIGIN = 'gh_owner_repo';
const OTHER_ORIGIN = 'gh_owner_other';
// Per-clone workspace ids that resolve to the origins above.
const WS = 'ws-hcv3mg';
const WS_OTHER = 'ws-other';
const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;
let store: FileWorkItemStore;
let ctx: WorkItemCommandContext;

// Mirrors createWorkItemStorageScopeResolver: same-origin clones collapse to one
// canonical storageRepoId; unrelated repos resolve to a different one.
const scopeResolver: WorkItemStorageScopeResolver = (repoId: string) => {
    if (repoId === WS || repoId === ORIGIN) {
        return { storageRepoId: ORIGIN, legacyRepoIds: [WS] };
    }
    if (repoId === WS_OTHER || repoId === OTHER_ORIGIN) {
        return { storageRepoId: OTHER_ORIGIN, legacyRepoIds: [WS_OTHER] };
    }
    return undefined;
};

function makeItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? ORIGIN,
        title: overrides.title ?? 'Item',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        type: overrides.type,
        parentId: overrides.parentId,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        source: overrides.source ?? 'manual',
    };
}

/** Rewrite a stored item's stamped repoId to simulate a foreign-origin stamp. */
async function restampStoredRepoId(storageRepoId: string, id: string, repoId: string): Promise<void> {
    const file = path.join(tmpDir, 'repos', storageRepoId, 'work-items', `${id}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
    raw.repoId = repoId;
    await fs.writeFile(file, JSON.stringify(raw, null, 2));
}

beforeEach(async () => {
    clearWorkItemResponseCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wi-cross-origin-'));
    store = new FileWorkItemStore({ dataDir: tmpDir, scopeResolver });
    ctx = {
        workItemStore: store,
        getHierarchyEnabled: () => true,
        getSyncEnabled: () => false,
    };
});

afterEach(async () => {
    clearWorkItemResponseCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

async function primeOriginResponseCaches(): Promise<string[]> {
    const listKey = makeWorkItemListResponseCacheKey({ repoId: ORIGIN });
    const groupedKey = makeWorkItemGroupedResponseCacheKey({ repoId: ORIGIN });
    const treeKey = makeWorkItemTreeResponseCacheKey(ORIGIN, {
        tracker: 'github-backed',
        includeArchived: false,
        includeDone: false,
    });
    await refreshWorkItemResponseCacheEntry(listKey, ORIGIN, 'list', async () => ({ stale: 'list' }));
    await refreshWorkItemResponseCacheEntry(groupedKey, ORIGIN, 'grouped', async () => ({ stale: 'grouped' }));
    await refreshWorkItemResponseCacheEntry(treeKey, ORIGIN, 'tree', async () => ({ stale: 'tree' }));
    return [listKey, groupedKey, treeKey];
}

function expectCachesCleared(keys: readonly string[]): void {
    for (const key of keys) {
        expect(getWorkItemResponseCacheEntry(key)).toBeUndefined();
    }
}

describe('AC-01 — same-origin parent linking (create-with-parent)', () => {
    it('links a ws-* child to a gh_* parent of the same upstream repo', async () => {
        // Parent PBI born under the canonical origin scope (gh_*).
        await store.addWorkItem(makeItem({ id: 'pbi-17', type: 'pbi', repoId: ORIGIN }));

        // Child created against the per-clone workspace id (ws-*).
        const child = await createWorkItemCommand(ctx, WS, { title: 'Task', parentId: 'pbi-17' });

        expect(child.parentId).toBe('pbi-17');
        // Stamped with the caller's ws-* id...
        expect(child.repoId).toBe(WS);
        // ...but physically stored under the shared canonical origin scope.
        const stored = await store.getWorkItem(child.id, ORIGIN);
        expect(stored?.parentId).toBe('pbi-17');
    });

    it('rejects a parent that resolves to a genuinely different upstream origin', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-foreign', type: 'pbi', repoId: ORIGIN }));
        // Simulate a parent stamped with a different upstream origin while still
        // physically present in the request's store directory.
        await restampStoredRepoId(ORIGIN, 'pbi-foreign', OTHER_ORIGIN);

        await expect(
            createWorkItemCommand(ctx, WS, { title: 'Task', parentId: 'pbi-foreign' }),
        ).rejects.toThrow('Parent work item must be in the same workspace');
    });
});

describe('AC-01 — same-origin parent linking (link/move path)', () => {
    it('reparents a ws-* item under a gh_* parent of the same upstream repo', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-17', type: 'pbi', repoId: ORIGIN }));
        const orphan = await createWorkItemCommand(ctx, WS, { title: 'Orphan' });
        expect(orphan.parentId).toBeUndefined();

        const linked = await updateWorkItemCommand(ctx, WS, orphan.id, { parentId: 'pbi-17' });

        expect(linked.parentId).toBe('pbi-17');
    });

    it('rejects reparenting under a parent from a genuinely different origin', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-foreign', type: 'pbi', repoId: ORIGIN }));
        await restampStoredRepoId(ORIGIN, 'pbi-foreign', OTHER_ORIGIN);
        const orphan = await createWorkItemCommand(ctx, WS, { title: 'Orphan' });

        await expect(
            updateWorkItemCommand(ctx, WS, orphan.id, { parentId: 'pbi-foreign' }),
        ).rejects.toThrow('Parent work item must be in the same workspace');
    });
});

describe('FileWorkItemStore.resolveOriginId', () => {
    it('collapses same-origin clones to one canonical id', async () => {
        expect(await store.resolveOriginId(WS)).toBe(ORIGIN);
        expect(await store.resolveOriginId(ORIGIN)).toBe(ORIGIN);
        expect(await store.resolveOriginId(WS_OTHER)).toBe(OTHER_ORIGIN);
    });

    it('falls back to the input id when no scope resolver is configured', async () => {
        const identityStore = new FileWorkItemStore({ dataDir: tmpDir });
        expect(await identityStore.resolveOriginId(WS)).toBe(WS);
        expect(await identityStore.resolveOriginId('anything')).toBe('anything');
    });
});

describe('AC-04 — response cache invalidation uses resolved origin scope', () => {
    it('create under ws-* clears origin-scoped list/grouped/tree caches and broadcasts both scopes', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-17', type: 'pbi', repoId: ORIGIN }));
        const cacheKeys = await primeOriginResponseCaches();
        const broadcasts: Array<{ type: string; workspaceId: string }> = [];
        ctx.broadcast = event => broadcasts.push({ type: event.type, workspaceId: event.workspaceId });

        await createWorkItemCommand(ctx, WS, { title: 'Task', parentId: 'pbi-17' });

        expectCachesCleared(cacheKeys);
        expect(broadcasts).toEqual([
            { type: 'work-item-added', workspaceId: WS },
            { type: 'work-item-added', workspaceId: ORIGIN },
        ]);
    });

    it('update under ws-* clears origin-scoped list/grouped/tree caches and broadcasts both scopes', async () => {
        const item = await createWorkItemCommand(ctx, WS, { title: 'Orphan' });
        const cacheKeys = await primeOriginResponseCaches();
        const broadcasts: Array<{ type: string; workspaceId: string }> = [];
        ctx.broadcast = event => broadcasts.push({ type: event.type, workspaceId: event.workspaceId });

        await updateWorkItemCommand(ctx, WS, item.id, { title: 'Renamed orphan' });

        expectCachesCleared(cacheKeys);
        expect(broadcasts).toEqual([
            { type: 'work-item-updated', workspaceId: WS },
            { type: 'work-item-updated', workspaceId: ORIGIN },
        ]);
    });
});

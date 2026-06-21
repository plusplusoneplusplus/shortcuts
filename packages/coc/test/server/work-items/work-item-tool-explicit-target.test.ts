/**
 * AC-02 — Create/update can target an explicit workspace/origin.
 *
 * The `create_update_work_item` AI tool bakes in the active workspace's repoId
 * at construction. These tests prove the new `targetWorkspaceId` argument lets a
 * caller scope a create (or update) to a DIFFERENT workspace of the same upstream
 * repo, resolved to its canonical origin — so an item can be born directly under
 * a mirrored parent (e.g. PBI-17) without the cross-workspace error — while
 * omitting the argument preserves today's active-workspace behavior byte-for-byte.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    FileWorkItemStore,
    type WorkItemStorageScopeResolver,
} from '../../../src/server/work-items/work-item-store';
import { createCreateUpdateWorkItemTool } from '../../../src/server/llm-tools/create-update-work-item-tool';
import type { WorkItem } from '../../../src/server/work-items/types';

// Canonical origin scopes (where items physically live).
const LOCAL_ORIGIN = 'local_localclone';
const MIRROR_ORIGIN = 'gh_owner_repo';
const OTHER_ORIGIN = 'gh_owner_other';
// Per-clone workspace ids that resolve to the origins above.
const WS_LOCAL = 'ws-local';
const WS_MIRROR = 'ws-mirror';
const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;
let store: FileWorkItemStore;

// Mirrors createWorkItemStorageScopeResolver: a per-clone ws-* id and its
// canonical origin collapse to one storageRepoId; unrelated repos differ.
const scopeResolver: WorkItemStorageScopeResolver = (repoId: string) => {
    if (repoId === WS_LOCAL || repoId === LOCAL_ORIGIN) {
        return { storageRepoId: LOCAL_ORIGIN, legacyRepoIds: [WS_LOCAL] };
    }
    if (repoId === WS_MIRROR || repoId === MIRROR_ORIGIN) {
        return { storageRepoId: MIRROR_ORIGIN, legacyRepoIds: [WS_MIRROR] };
    }
    if (repoId === OTHER_ORIGIN) {
        return { storageRepoId: OTHER_ORIGIN };
    }
    return undefined;
};

function makeItem(overrides: Partial<WorkItem>): WorkItem {
    return {
        id: overrides.id ?? 'item-1',
        repoId: overrides.repoId ?? MIRROR_ORIGIN,
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

// The active local workspace the tool is constructed against.
function makeTool() {
    const { tool } = createCreateUpdateWorkItemTool(tmpDir, WS_LOCAL, undefined, {
        workItemStore: store,
        getHierarchyEnabled: () => true,
        getSyncEnabled: () => false,
    });
    return tool;
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wi-tool-target-'));
    store = new FileWorkItemStore({ dataDir: tmpDir, scopeResolver });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AC-02 — create with explicit targetWorkspaceId', () => {
    it('creates an item under a mirrored parent when targetWorkspaceId is the mirror origin', async () => {
        // PBI born under the canonical mirror origin scope (gh_*).
        await store.addWorkItem(makeItem({ id: 'pbi-17', type: 'pbi', repoId: MIRROR_ORIGIN }));
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Task under mirrored PBI',
            parentId: 'pbi-17',
            targetWorkspaceId: MIRROR_ORIGIN,
        });

        expect(result.created).toBe(true);
        expect(result.parentId).toBe('pbi-17');
        // Stamped + physically stored under the mirror origin, not the active local one.
        const inMirror = await store.getWorkItem(result.id, MIRROR_ORIGIN);
        expect(inMirror?.repoId).toBe(MIRROR_ORIGIN);
        expect(inMirror?.parentId).toBe('pbi-17');
        // Not present in the active local workspace scope.
        const inLocal = await store.listWorkItems({ repoId: LOCAL_ORIGIN });
        expect(inLocal.items.some(i => i.id === result.id)).toBe(false);
    });

    it('resolves a ws-* target workspace to its canonical origin scope', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-17', type: 'pbi', repoId: MIRROR_ORIGIN }));
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Task via ws-* mirror id',
            parentId: 'pbi-17',
            targetWorkspaceId: WS_MIRROR,
        });

        expect(result.created).toBe(true);
        const stored = await store.getWorkItem(result.id, MIRROR_ORIGIN);
        // Resolved to the canonical origin even though a ws-* id was passed.
        expect(stored?.repoId).toBe(MIRROR_ORIGIN);
        expect(stored?.parentId).toBe('pbi-17');
    });

    it('still rejects a parent that resolves to a genuinely different origin than the target', async () => {
        await store.addWorkItem(makeItem({ id: 'pbi-foreign', type: 'pbi', repoId: MIRROR_ORIGIN }));
        await restampStoredRepoId(MIRROR_ORIGIN, 'pbi-foreign', OTHER_ORIGIN);
        const tool = makeTool();

        const result: any = await tool.handler({
            title: 'Task',
            parentId: 'pbi-foreign',
            targetWorkspaceId: MIRROR_ORIGIN,
        });

        expect(result.created).toBe(false);
        expect(result.error).toContain('Parent work item must be in the same workspace');
    });
});

describe('AC-02 — default (no targetWorkspaceId) preserves active-workspace behavior', () => {
    it('stamps the active workspace id and stores under its origin', async () => {
        const tool = makeTool();

        const result: any = await tool.handler({ title: 'Solo local task' });

        expect(result.created).toBe(true);
        // Stamped with the baked-in active workspace id (NOT rewritten to origin).
        const stored = await store.getWorkItem(result.id, WS_LOCAL);
        expect(stored?.repoId).toBe(WS_LOCAL);
        // Physically stored under the active workspace's origin scope.
        const inLocalOrigin = await store.listWorkItems({ repoId: LOCAL_ORIGIN });
        expect(inLocalOrigin.items.some(i => i.id === result.id)).toBe(true);
        // Not present in the unrelated mirror scope.
        const inMirror = await store.listWorkItems({ repoId: MIRROR_ORIGIN });
        expect(inMirror.items.some(i => i.id === result.id)).toBe(false);
    });

    it('treats a blank targetWorkspaceId as omitted', async () => {
        const tool = makeTool();

        const result: any = await tool.handler({ title: 'Blank target task', targetWorkspaceId: '   ' });

        expect(result.created).toBe(true);
        const stored = await store.getWorkItem(result.id, WS_LOCAL);
        expect(stored?.repoId).toBe(WS_LOCAL);
    });
});

describe('AC-02 — update with explicit targetWorkspaceId', () => {
    it('updates an item that lives in the targeted workspace scope', async () => {
        await store.addWorkItem(makeItem({ id: 'mirror-item', title: 'Original', repoId: MIRROR_ORIGIN }));
        const tool = makeTool();

        const result: any = await tool.handler({
            target: 'mirror-item',
            title: 'Renamed in mirror',
            targetWorkspaceId: MIRROR_ORIGIN,
        });

        expect(result.updated).toBe(true);
        const stored = await store.getWorkItem('mirror-item', MIRROR_ORIGIN);
        expect(stored?.title).toBe('Renamed in mirror');
    });
});

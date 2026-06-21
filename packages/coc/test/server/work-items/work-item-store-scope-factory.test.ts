/**
 * Regression tests for the createWorkItemStore factory and scope resolution.
 *
 * Proves that the chat-path tools (get_work_item, create_update_work_item) resolve
 * workspace IDs (e.g. `ws-abc`) to canonical git-origin IDs (e.g. `gh_owner_repo`)
 * when a processStore is available, matching the behavior of the REST routes.
 *
 * Before this fix, the tools used an identity scope so a lookup for workspace
 * `ws-xyz` missed items stored under `gh_owner_repo`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import {
    FileWorkItemStore,
    createWorkItemStore,
} from '../../../src/server/work-items/work-item-store';
import type { WorkItem } from '../../../src/server/work-items/types';
import { createGetWorkItemTool } from '../../../src/server/llm-tools/get-work-item-tool';
import { createCreateUpdateWorkItemTool } from '../../../src/server/llm-tools/create-update-work-item-tool';
import { buildCreateWorkItemAddon } from '../../../src/server/executors/prompt-builder';

// ============================================================================
// Helpers
// ============================================================================

function makeWorkItem(overrides: Partial<WorkItem> & { repoId: string }): WorkItem {
    return {
        id: overrides.id ?? `wi-${Date.now()}`,
        repoId: overrides.repoId,
        title: overrides.title ?? 'Test item',
        description: overrides.description ?? '',
        status: overrides.status ?? 'created',
        source: overrides.source ?? 'manual',
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeProcessStore(workspaces: WorkspaceInfo[]): Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'> {
    return {
        getWorkspaces: async () => workspaces,
        updateWorkspace: vi.fn(),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('createWorkItemStore factory', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-factory-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('with processStore (workspace-scoped)', () => {
        it('resolves ws-x to gh_o_r and finds an item stored under the canonical origin', async () => {
            const processStore = makeProcessStore([
                { id: 'ws-x', remoteUrl: 'https://github.com/o/r.git', rootPath: '/tmp/x' } as WorkspaceInfo,
            ]);

            // Write an item directly under the canonical origin directory.
            const canonicalStore = new FileWorkItemStore({ dataDir: tmpDir });
            const item = makeWorkItem({ id: 'item-uuid-1', repoId: 'gh_o_r' });
            await canonicalStore.addWorkItem(item);

            // The factory-built store should resolve ws-x → gh_o_r and find the item.
            const store = createWorkItemStore({ dataDir: tmpDir, processStore });

            const byId = await store.getWorkItem(item.id, 'ws-x');
            expect(byId).toBeDefined();
            expect(byId!.id).toBe(item.id);
        });

        it('resolves by work item number through ws-x scope via listWorkItems', async () => {
            const processStore = makeProcessStore([
                { id: 'ws-abc', remoteUrl: 'https://github.com/myorg/myrepo.git', rootPath: '/tmp/abc' } as WorkspaceInfo,
            ]);

            const canonicalStore = new FileWorkItemStore({ dataDir: tmpDir });
            const item = makeWorkItem({ id: 'item-uuid-2', repoId: 'gh_myorg_myrepo' });
            await canonicalStore.addWorkItem(item);

            // Re-read through canonical store to get the assigned workItemNumber.
            const stored = await canonicalStore.getWorkItem(item.id, 'gh_myorg_myrepo');
            expect(stored).toBeDefined();
            const itemNumber = stored!.workItemNumber;
            expect(itemNumber).toBeGreaterThan(0);

            // The scoped store should find the item under gh_myorg_myrepo when queried via ws-abc.
            const store = createWorkItemStore({ dataDir: tmpDir, processStore });
            const { items } = await store.listWorkItems({ repoId: 'ws-abc' });
            const found = items.find(i => i.workItemNumber === itemNumber);
            expect(found).toBeDefined();
            expect(found!.id).toBe(item.id);
        });
    });

    describe('without processStore (identity scope)', () => {
        it('reads from repos/<repoId>/work-items verbatim', async () => {
            const identityStore = createWorkItemStore({ dataDir: tmpDir });
            const item = makeWorkItem({ id: 'item-uuid-id', repoId: 'gh_direct' });
            await identityStore.addWorkItem(item);

            const found = await identityStore.getWorkItem(item.id, 'gh_direct');
            expect(found).toBeDefined();
            expect(found!.id).toBe(item.id);
        });

        it('does NOT cross workspace boundaries', async () => {
            const identityStore = createWorkItemStore({ dataDir: tmpDir });
            const item = makeWorkItem({ id: 'item-no-cross', repoId: 'gh_direct' });
            await identityStore.addWorkItem(item);

            // Without scope resolution, 'ws-x' does not map to 'gh_direct'.
            const notFound = await identityStore.getWorkItem(item.id, 'ws-x');
            expect(notFound).toBeUndefined();
        });
    });
});

describe('get_work_item tool — scope resolution regression', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-factory-get-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('resolves WI-N, UUID, and number via ws-x when workItemStore is injected with resolver', async () => {
        const processStore = makeProcessStore([
            { id: 'ws-x', remoteUrl: 'https://github.com/o/r.git', rootPath: '/tmp/x' } as WorkspaceInfo,
        ]);

        const canonicalStore = new FileWorkItemStore({ dataDir: tmpDir });
        const item = makeWorkItem({ id: 'fixed-uuid-9', repoId: 'gh_o_r' });
        await canonicalStore.addWorkItem(item);

        const stored = await canonicalStore.getWorkItem(item.id, 'gh_o_r');
        const itemNumber = stored!.workItemNumber!;

        const scopedStore = createWorkItemStore({ dataDir: tmpDir, processStore });
        const { tool: getTool } = createGetWorkItemTool(tmpDir, 'ws-x', { workItemStore: scopedStore });

        // By UUID
        const r1 = await getTool.handler({ workItemId: item.id });
        expect(r1.found).toBe(true);
        if (r1.found) expect(r1.item.id).toBe(item.id);

        // By number
        const r2 = await getTool.handler({ workItemNumber: itemNumber });
        expect(r2.found).toBe(true);

        // By WI-N target
        const r3 = await getTool.handler({ target: `WI-${itemNumber}` });
        expect(r3.found).toBe(true);
    });
});

describe('buildCreateWorkItemAddon — scope resolution', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-factory-addon-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('get_work_item from the addon resolves gh_o_r items via ws-x workspace id', async () => {
        const processStore = makeProcessStore([
            { id: 'ws-x', remoteUrl: 'https://github.com/o/r.git', rootPath: '/tmp/x' } as WorkspaceInfo,
        ]);

        const canonicalStore = new FileWorkItemStore({ dataDir: tmpDir });
        const item = makeWorkItem({ id: 'addon-item-uuid', repoId: 'gh_o_r' });
        await canonicalStore.addWorkItem(item);

        const { tools } = buildCreateWorkItemAddon(tmpDir, 'ws-x', undefined, {
            processStore: processStore as unknown as ProcessStore,
        });

        const getTool = tools.find(t => t.name === 'get_work_item');
        expect(getTool).toBeDefined();

        const result = await getTool!.handler({ workItemId: item.id });
        expect(result.found).toBe(true);
        if (result.found) expect(result.item.id).toBe(item.id);
    });

    it('round-trip: create_update_work_item writes under canonical origin, get_work_item reads it back', async () => {
        const processStore = makeProcessStore([
            { id: 'ws-rt', remoteUrl: 'https://github.com/rt/repo.git', rootPath: '/tmp/rt' } as WorkspaceInfo,
        ]);

        const broadcasts: unknown[] = [];
        const broadcast = (evt: unknown) => broadcasts.push(evt);

        const { tools } = buildCreateWorkItemAddon(tmpDir, 'ws-rt', broadcast, {
            processStore: processStore as unknown as ProcessStore,
            getHierarchyEnabled: () => false,
            getSyncEnabled: () => false,
        });

        const createTool = tools.find(t => t.name === 'create_update_work_item');
        const getTool = tools.find(t => t.name === 'get_work_item');
        expect(createTool).toBeDefined();
        expect(getTool).toBeDefined();

        // Create a new work item via the addon (writes under canonical origin dir).
        const createResult = await createTool!.handler({
            title: 'Round-trip item',
            description: 'Created via addon',
        });
        expect(createResult.created).toBe(true);
        const createdId: string = createResult.id;

        // Confirm it was written under the canonical origin directory, not ws-rt.
        const canonicalDir = path.join(tmpDir, 'repos', 'gh_rt_repo', 'work-items');
        const canonicalFiles = await fs.readdir(canonicalDir);
        expect(canonicalFiles.some(f => f.includes(createdId))).toBe(true);

        // The get_work_item tool from the same addon should find it via ws-rt.
        const getResult = await getTool!.handler({ workItemId: createdId });
        expect(getResult.found).toBe(true);
        if (getResult.found) {
            expect(getResult.item.title).toBe('Round-trip item');
        }
    });
});

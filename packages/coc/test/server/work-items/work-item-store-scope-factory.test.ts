/**
 * Regression tests for the createWorkItemStore factory and scope resolution.
 *
 * Proves that a factory-built store resolves workspace IDs (e.g. `ws-abc`) to
 * canonical git-origin IDs (e.g. `gh_owner_repo`) when a processStore is
 * available, matching the behavior of the REST routes, and falls back to an
 * identity scope (verbatim `repos/<repoId>/work-items`) when none is provided.
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

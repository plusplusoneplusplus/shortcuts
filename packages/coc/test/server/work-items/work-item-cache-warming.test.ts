import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkItemSyncStatusResponse } from '@plusplusoneplusplus/coc-client';
import { warmWorkItemWorkspaceCache } from '../../../src/server/routes/work-item-cache-warming';
import type { WorkItemGroupedRouteResponse, WorkItemListRouteResponse } from '../../../src/server/routes/work-item-routes';
import type { WorkItemTreeRouteResponse } from '../../../src/server/routes/work-item-hierarchy-routes';
import { createWorkItemStorageScopeResolver, FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import type { WorkItemSyncProviderAdapter } from '../../../src/server/work-items';
import {
    clearWorkItemResponseCache,
    getWorkItemResponseCacheEntry,
    makeWorkItemGroupedResponseCacheKey,
    makeWorkItemListResponseCacheKey,
    makeWorkItemSyncStatusResponseCacheKey,
    makeWorkItemTreeResponseCacheKey,
    refreshWorkItemResponseCacheEntry,
} from '../../../src/server/work-items/work-item-response-cache';

const REPO_ID = 'cache-warm-repo';
const ORIGIN_ID = 'gh_plusplusoneplusplus_shortcuts';

let tmpDir: string;
let store: FileWorkItemStore;

function makeProcessStore() {
    return {
        getWorkspaces: async () => [{
            id: REPO_ID,
            name: 'Cache Warm Repo',
            rootPath: tmpDir,
            remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
        }],
        updateWorkspace: async () => undefined,
    } as any;
}

function makeGitHubProvider(): WorkItemSyncProviderAdapter {
    return {
        provider: 'github',
        async getStatus() {
            return {
                provider: 'github',
                available: true,
                repository: {
                    provider: 'github',
                    owner: 'plusplusoneplusplus',
                    repo: 'shortcuts',
                    url: 'https://github.com/plusplusoneplusplus/shortcuts',
                    source: 'origin',
                },
                auth: { mode: 'external', authenticated: true },
            };
        },
    };
}

beforeEach(async () => {
    clearWorkItemResponseCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-cache-'));
    store = new FileWorkItemStore({
        dataDir: tmpDir,
        scopeResolver: createWorkItemStorageScopeResolver(makeProcessStore()),
    });
});

afterEach(async () => {
    clearWorkItemResponseCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('warmWorkItemWorkspaceCache', () => {
    it('warms default local and remote Work Items responses for the active workspace', async () => {
        await store.addWorkItem({
            id: 'local-epic',
            repoId: REPO_ID,
            title: 'Local Epic',
            description: '',
            status: 'created',
            type: 'epic',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            source: 'manual',
        });
        await store.addWorkItem({
            id: 'github-epic',
            repoId: REPO_ID,
            title: 'GitHub Epic',
            description: '',
            status: 'created',
            type: 'epic',
            tracker: {
                kind: 'github-backed',
                provider: 'github',
                github: { issueNumber: 42 },
            },
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            source: 'manual',
        });

        await warmWorkItemWorkspaceCache({
            workspaceId: REPO_ID,
            workItemStore: store,
            processStore: makeProcessStore(),
            dataDir: tmpDir,
            getHierarchyEnabled: () => true,
            getSyncEnabled: () => true,
            providers: [makeGitHubProvider()],
        });

        const list = getWorkItemResponseCacheEntry<WorkItemListRouteResponse>(
            makeWorkItemListResponseCacheKey({ repoId: ORIGIN_ID, limit: 20 }),
        );
        expect(list?.data.total).toBe(2);

        const grouped = getWorkItemResponseCacheEntry<WorkItemGroupedRouteResponse>(
            makeWorkItemGroupedResponseCacheKey({ repoId: ORIGIN_ID, limit: 20 }),
        );
        expect(grouped?.data.groups.created.total).toBe(2);

        const localTree = getWorkItemResponseCacheEntry<WorkItemTreeRouteResponse>(
            makeWorkItemTreeResponseCacheKey(ORIGIN_ID, { tracker: 'local-only', includeArchived: false, includeDone: false }),
        );
        expect(localTree?.data.roots.map(root => root.item.id)).toEqual(['local-epic']);

        const syncStatus = getWorkItemResponseCacheEntry<WorkItemSyncStatusResponse>(
            makeWorkItemSyncStatusResponseCacheKey(REPO_ID),
        );
        expect(syncStatus?.data.remoteProvider).toBe('github');
        expect(syncStatus?.data.provider?.available).toBe(true);

        const remoteTree = getWorkItemResponseCacheEntry<WorkItemTreeRouteResponse>(
            makeWorkItemTreeResponseCacheKey(ORIGIN_ID, { tracker: 'github-backed', includeArchived: false, includeDone: false }),
        );
        expect(remoteTree?.data.roots.map(root => root.item.id)).toEqual(['github-epic']);
    });

    it('preserves stale cached data when a background refresh fails', async () => {
        const key = makeWorkItemListResponseCacheKey({ repoId: REPO_ID, limit: 20 });
        await refreshWorkItemResponseCacheEntry<WorkItemListRouteResponse>(
            key,
            REPO_ID,
            'list',
            async () => ({ items: [], total: 1, hasMore: false }),
        );

        await expect(refreshWorkItemResponseCacheEntry(
            key,
            REPO_ID,
            'list',
            async () => {
                throw new Error('store unavailable');
            },
        )).rejects.toThrow('store unavailable');

        const cached = getWorkItemResponseCacheEntry<WorkItemListRouteResponse>(key);
        expect(cached?.data.total).toBe(1);
    });
});

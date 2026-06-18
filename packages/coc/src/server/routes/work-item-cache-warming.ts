import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { WorkItemStore, WorkItemSyncProvider, WorkItemTrackerKind } from '../work-items/types';
import type { WorkItemSyncProviderAdapter } from '../work-items/work-item-sync-provider';
import {
    makeWorkItemGroupedResponseCacheKey,
    makeWorkItemListResponseCacheKey,
    makeWorkItemSyncStatusResponseCacheKey,
    makeWorkItemTreeResponseCacheKey,
    refreshWorkItemResponseCacheEntry,
    type WorkItemTreeCacheOptions,
} from '../work-items/work-item-response-cache';
import { buildWorkItemGroupedRouteResponse, buildWorkItemListRouteResponse } from './work-item-routes';
import { buildWorkItemTreeRouteResponse } from './work-item-hierarchy-routes';
import { buildWorkItemSyncStatusRouteResponse } from './work-item-sync-routes';
import { resolveWorkspaceWorkItemOriginId } from './work-item-route-scope';

const DEFAULT_WORK_ITEM_PAGE_SIZE = 20;

export interface WarmWorkItemWorkspaceCacheOptions {
    workspaceId: string;
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    dataDir: string;
    getHierarchyEnabled: () => boolean;
    getSyncEnabled: () => boolean;
    providers?: WorkItemSyncProviderAdapter[];
}

function trackerForRemoteProvider(provider: WorkItemSyncProvider): WorkItemTrackerKind {
    return provider === 'azure-boards' ? 'azure-boards-backed' : 'github-backed';
}

export async function warmWorkItemWorkspaceCache(options: WarmWorkItemWorkspaceCacheOptions): Promise<void> {
    const workspaceId = options.workspaceId;
    const storageRepoId = await resolveWorkspaceWorkItemOriginId(options.processStore, workspaceId);
    const listFilter = { repoId: storageRepoId, limit: DEFAULT_WORK_ITEM_PAGE_SIZE };
    const groupedFilter = { repoId: storageRepoId, limit: DEFAULT_WORK_ITEM_PAGE_SIZE };
    const refreshes: Array<Promise<unknown>> = [
        refreshWorkItemResponseCacheEntry(
            makeWorkItemListResponseCacheKey(listFilter),
            storageRepoId,
            'list',
            () => buildWorkItemListRouteResponse(options.workItemStore, listFilter),
        ),
        refreshWorkItemResponseCacheEntry(
            makeWorkItemGroupedResponseCacheKey(groupedFilter),
            storageRepoId,
            'grouped',
            () => buildWorkItemGroupedRouteResponse(options.workItemStore, groupedFilter),
        ),
    ];

    if (options.getHierarchyEnabled()) {
        const localTreeOptions: WorkItemTreeCacheOptions = {
            tracker: 'local-only',
            includeArchived: false,
            includeDone: false,
        };
        refreshes.push(refreshWorkItemResponseCacheEntry(
            makeWorkItemTreeResponseCacheKey(storageRepoId, localTreeOptions),
            storageRepoId,
            'tree',
            () => buildWorkItemTreeRouteResponse(options.workItemStore, storageRepoId, localTreeOptions),
        ));

        if (options.getSyncEnabled()) {
            refreshes.push(warmRemoteWorkItemCache(options));
        }
    }

    await Promise.all(refreshes);
}

async function warmRemoteWorkItemCache(options: WarmWorkItemWorkspaceCacheOptions): Promise<void> {
    const workspaceId = options.workspaceId;
    const storageRepoId = await resolveWorkspaceWorkItemOriginId(options.processStore, workspaceId);
    const status = await refreshWorkItemResponseCacheEntry(
        makeWorkItemSyncStatusResponseCacheKey(workspaceId),
        workspaceId,
        'sync-status',
        () => buildWorkItemSyncStatusRouteResponse({
            routes: [],
            workItemStore: options.workItemStore,
            processStore: options.processStore,
            dataDir: options.dataDir,
            getHierarchyEnabled: options.getHierarchyEnabled,
            getSyncEnabled: options.getSyncEnabled,
            providers: options.providers,
        }, workspaceId),
    );

    if (status.disabled || !status.remoteProvider) {
        return;
    }

    const remoteTreeOptions: WorkItemTreeCacheOptions = {
        tracker: trackerForRemoteProvider(status.remoteProvider),
        includeArchived: false,
        includeDone: false,
    };
    await refreshWorkItemResponseCacheEntry(
        makeWorkItemTreeResponseCacheKey(storageRepoId, remoteTreeOptions),
        storageRepoId,
        'tree',
        () => buildWorkItemTreeRouteResponse(options.workItemStore, storageRepoId, remoteTreeOptions),
    );
}

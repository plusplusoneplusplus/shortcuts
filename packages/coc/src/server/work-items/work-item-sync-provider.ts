import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type {
    PerRepoPreferences,
    WorkItemSyncApplyRequest,
    WorkItemSyncApplyResponse,
    WorkItemSyncOperation,
    WorkItemSyncPreviewRequest,
    WorkItemSyncPreviewResponse,
    WorkItemSyncProvider as WorkItemSyncProviderName,
    WorkItemSyncProviderStatus,
    WorkItemSyncWarning,
} from '@plusplusoneplusplus/coc-client';
import type { WorkItem, WorkItemIndexEntry, WorkItemStore } from './types';
import { notFound } from '../errors';

export const WORK_ITEM_SYNC_MAX_ITEMS = 200;
export const DEFAULT_WORK_ITEM_SYNC_PROVIDER: WorkItemSyncProviderName = 'github';
export const SUPPORTED_WORK_ITEM_SYNC_PROVIDERS: readonly WorkItemSyncProviderName[] = ['github', 'azure-boards'];

export interface WorkItemSyncProviderContext {
    workspaceId: string;
    workspace?: WorkspaceInfo;
    preferences: PerRepoPreferences;
    workItemStore: WorkItemStore;
}

export interface WorkItemSyncProviderPreviewContext extends WorkItemSyncProviderContext {
    operation: WorkItemSyncOperation;
    request: WorkItemSyncPreviewRequest;
    items: WorkItem[];
}

export interface WorkItemSyncProviderApplyContext extends WorkItemSyncProviderContext {
    operation: WorkItemSyncOperation;
    request: WorkItemSyncApplyRequest;
    items: WorkItem[];
}

export interface WorkItemSyncProviderAdapter {
    readonly provider: WorkItemSyncProviderName;
    getStatus(context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderStatus>;
    preview(context: WorkItemSyncProviderPreviewContext): Promise<WorkItemSyncPreviewResponse>;
    apply(context: WorkItemSyncProviderApplyContext): Promise<WorkItemSyncApplyResponse>;
}

export interface WorkItemSyncScope {
    items: WorkItem[];
    warnings: WorkItemSyncWarning[];
}

export function isSupportedWorkItemSyncProvider(value: string): value is WorkItemSyncProviderName {
    return SUPPORTED_WORK_ITEM_SYNC_PROVIDERS.includes(value as WorkItemSyncProviderName);
}

export function unavailableWorkItemSyncProviderStatus(provider: WorkItemSyncProviderName): WorkItemSyncProviderStatus {
    const message = provider === 'azure-boards'
        ? 'Azure Boards work item sync is planned but unavailable in this version.'
        : `Work item sync provider '${provider}' is not registered.`;
    return {
        provider,
        available: false,
        reason: 'provider-unavailable',
        message,
    };
}

function childrenByParent(entries: WorkItemIndexEntry[]): Map<string, WorkItemIndexEntry[]> {
    const map = new Map<string, WorkItemIndexEntry[]>();
    for (const entry of entries) {
        if (!entry.parentId) continue;
        const siblings = map.get(entry.parentId) ?? [];
        siblings.push(entry);
        map.set(entry.parentId, siblings);
    }
    return map;
}

function collectSubtreeEntries(entries: WorkItemIndexEntry[], rootId: string): WorkItemIndexEntry[] {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const root = byId.get(rootId);
    if (!root) {
        throw notFound('Work item');
    }

    const byParent = childrenByParent(entries);
    const result: WorkItemIndexEntry[] = [];
    const visited = new Set<string>();
    const queue: WorkItemIndexEntry[] = [root];

    while (queue.length > 0) {
        const entry = queue.shift()!;
        if (visited.has(entry.id)) continue;
        visited.add(entry.id);
        result.push(entry);
        for (const child of byParent.get(entry.id) ?? []) {
            queue.push(child);
        }
    }

    return result;
}

async function loadFullItems(
    workItemStore: WorkItemStore,
    repoId: string,
    entries: WorkItemIndexEntry[],
): Promise<WorkItemSyncScope> {
    const items: WorkItem[] = [];
    const warnings: WorkItemSyncWarning[] = [];
    for (const entry of entries) {
        const item = await workItemStore.getWorkItem(entry.id, repoId);
        if (item) {
            items.push(item);
        } else {
            warnings.push({
                id: `missing-local-${entry.id}`,
                message: `Work item '${entry.id}' is indexed but its detail file is missing.`,
                workItemId: entry.id,
                severity: 'warning',
            });
        }
    }
    return { items, warnings };
}

export async function collectWorkItemSyncScope(options: {
    workItemStore: WorkItemStore;
    workspaceId: string;
    provider: WorkItemSyncProviderName;
    request: WorkItemSyncPreviewRequest | WorkItemSyncApplyRequest;
}): Promise<WorkItemSyncScope> {
    const { workItemStore, workspaceId, provider, request } = options;
    if (request.operation === 'import') {
        return { items: [], warnings: [] };
    }

    const result = await workItemStore.listWorkItems({ repoId: workspaceId });
    let entries: WorkItemIndexEntry[];

    if (request.operation === 'export-selected') {
        entries = collectSubtreeEntries(result.items, request.selectedWorkItemId ?? '');
    } else {
        entries = result.items.filter(entry => {
            if (!request.includeArchived && entry.archivedAt) return false;
            return entry.syncLinks?.some(link => link.provider === provider) ?? false;
        });
    }

    return loadFullItems(workItemStore, workspaceId, entries);
}

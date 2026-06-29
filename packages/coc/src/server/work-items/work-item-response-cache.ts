import { createCache } from '../cache';
import type {
    WorkItemFilter,
    WorkItemPriority,
    WorkItemSource,
    WorkItemStatus,
    WorkItemStore,
    WorkItemSyncProvider,
    WorkItemTrackerKind,
    WorkItemType,
} from './types';

export const WORK_ITEM_RESPONSE_CACHE_TTL_MS = 60 * 60 * 1000;

export type WorkItemResponseCacheDomain = 'list' | 'grouped' | 'tree' | 'sync-status';

export interface WorkItemTreeCacheOptions {
    q?: string;
    type?: string;
    status?: string;
    tracker?: WorkItemTrackerKind;
    includeArchived?: boolean;
    includeDone?: boolean;
}

export interface WorkItemResponseCacheEntry<T> {
    workspaceId: string;
    domain: WorkItemResponseCacheDomain;
    data: T;
    fetchedAt: number;
    expiresAt: number;
}

interface NormalizedWorkItemFilter {
    repoId?: string;
    status?: WorkItemStatus[];
    source?: WorkItemSource;
    priority?: WorkItemPriority;
    tags?: string[];
    type?: WorkItemType;
    tracker?: WorkItemTrackerKind;
    search?: string;
    offset?: number;
    limit?: number;
}

// Unified-cache handle (namespace `work-item-response`, 60min TTL). Entries are
// tagged with their workspaceId so workspace-scoped clears are O(matching) via
// the handle's per-workspace index. Default LRU cap (500) applies; the previous
// hand-rolled Map was unbounded (see progress.md AC-02).
const workItemResponseCache = createCache<WorkItemResponseCacheEntry<unknown>>({
    namespace: 'work-item-response',
    ttlMs: WORK_ITEM_RESPONSE_CACHE_TTL_MS,
});

function sortStrings<T extends string>(values: readonly T[] | undefined): T[] | undefined {
    return values && values.length > 0 ? [...values].sort((a, b) => a.localeCompare(b)) : undefined;
}

function normalizedWorkItemFilter(filter: WorkItemFilter): NormalizedWorkItemFilter {
    const status = filter.status
        ? sortStrings(Array.isArray(filter.status) ? filter.status : [filter.status])
        : undefined;
    return {
        repoId: filter.repoId,
        status,
        source: filter.source,
        priority: filter.priority,
        tags: sortStrings(filter.tags),
        type: filter.type,
        tracker: filter.tracker,
        search: filter.search,
        offset: filter.offset,
        limit: filter.limit,
    };
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort((a, b) => a.localeCompare(b))
        .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
}

function makeWorkItemResponseCacheKey(
    domain: WorkItemResponseCacheDomain,
    workspaceId: string,
    payload: unknown,
): string {
    return `${domain}|${workspaceId}|${stableStringify(payload)}`;
}

export function makeWorkItemListResponseCacheKey(filter: WorkItemFilter): string {
    return makeWorkItemResponseCacheKey('list', filter.repoId ?? '', normalizedWorkItemFilter(filter));
}

export function makeWorkItemGroupedResponseCacheKey(filter: WorkItemFilter): string {
    return makeWorkItemResponseCacheKey('grouped', filter.repoId ?? '', normalizedWorkItemFilter(filter));
}

export function makeWorkItemTreeResponseCacheKey(
    workspaceId: string,
    options: WorkItemTreeCacheOptions,
): string {
    return makeWorkItemResponseCacheKey('tree', workspaceId, {
        q: options.q,
        type: options.type,
        status: options.status,
        tracker: options.tracker,
        includeArchived: options.includeArchived === true,
        includeDone: options.includeDone === true,
    });
}

export function makeWorkItemSyncStatusResponseCacheKey(
    workspaceId: string,
    provider?: WorkItemSyncProvider,
): string {
    return makeWorkItemResponseCacheKey('sync-status', workspaceId, { provider });
}

export function getWorkItemResponseCacheEntry<T>(
    key: string,
    now: number = Date.now(),
): WorkItemResponseCacheEntry<T> | undefined {
    const entry = workItemResponseCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
        workItemResponseCache.delete(key);
        return undefined;
    }
    return entry as WorkItemResponseCacheEntry<T>;
}

export async function refreshWorkItemResponseCacheEntry<T>(
    key: string,
    workspaceId: string,
    domain: WorkItemResponseCacheDomain,
    load: () => Promise<T>,
    now: () => number = () => Date.now(),
): Promise<T> {
    const data = await load();
    const fetchedAt = now();
    workItemResponseCache.set(key, {
        workspaceId,
        domain,
        data,
        fetchedAt,
        expiresAt: fetchedAt + WORK_ITEM_RESPONSE_CACHE_TTL_MS,
    }, { workspaceId });
    return data;
}

export async function getOrRefreshWorkItemResponseCacheEntry<T>(
    key: string,
    workspaceId: string,
    domain: WorkItemResponseCacheDomain,
    force: boolean,
    load: () => Promise<T>,
): Promise<T> {
    const cached = force ? undefined : getWorkItemResponseCacheEntry<T>(key);
    if (cached) return cached.data;
    return refreshWorkItemResponseCacheEntry(key, workspaceId, domain, load);
}

export function clearWorkItemResponseCacheForWorkspace(workspaceId: string): void {
    clearWorkItemResponseCacheForWorkspaces([workspaceId]);
}

export function clearWorkItemResponseCacheForWorkspaces(workspaceIds: Iterable<string>): void {
    const ids = new Set(
        [...workspaceIds]
            .map(id => id.trim())
            .filter(Boolean),
    );
    if (ids.size === 0) return;
    for (const id of ids) {
        workItemResponseCache.invalidateWorkspace(id);
    }
}

export async function resolveWorkItemResponseCacheWorkspaceIds(
    workItemStore: Pick<WorkItemStore, 'resolveOriginId'>,
    workspaceId: string,
    additionalWorkspaceIds: readonly (string | undefined)[] = [],
): Promise<string[]> {
    const ids = new Set<string>();
    for (const id of [workspaceId, ...additionalWorkspaceIds]) {
        const normalized = id?.trim();
        if (normalized) ids.add(normalized);
    }
    const resolved = await workItemStore.resolveOriginId?.(workspaceId);
    if (resolved?.trim()) ids.add(resolved.trim());
    return [...ids];
}

export async function clearWorkItemResponseCacheForResolvedWorkspace(
    workItemStore: Pick<WorkItemStore, 'resolveOriginId'>,
    workspaceId: string,
    additionalWorkspaceIds: readonly (string | undefined)[] = [],
): Promise<void> {
    clearWorkItemResponseCacheForWorkspaces(
        await resolveWorkItemResponseCacheWorkspaceIds(workItemStore, workspaceId, additionalWorkspaceIds),
    );
}

export function clearWorkItemResponseCache(): void {
    workItemResponseCache.clear();
}

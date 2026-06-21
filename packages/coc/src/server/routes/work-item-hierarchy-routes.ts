/**
 * Work Item Hierarchy Routes
 *
 * Provides the hierarchy tree read API for the work item board.
 *
 * Routes:
 *   GET /api/origins/:originId/work-items/tree — Full hierarchy tree with rollup counts
 *
 * All routes are gated by the workItems.hierarchy.enabled feature flag.
 * When the flag is false the endpoints return a `{ disabled: true }` response
 * so the SPA can gracefully degrade.
 */

import * as http from 'http';
import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError } from '../errors';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';
import type { WorkItemStore, WorkItemIndexEntry, WorkItemTrackerKind, WorkItemType } from '../work-items/types';
import { WORK_ITEM_TYPES, WORK_ITEM_STATUSES, WORK_ITEM_TRACKER_KINDS, getOwnWorkItemTrackerKind } from '../work-items/types';
import {
    getOrRefreshWorkItemResponseCacheEntry,
    makeWorkItemTreeResponseCacheKey,
    type WorkItemTreeCacheOptions,
} from '../work-items/work-item-response-cache';

const WORK_ITEM_TREE_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/tree$/;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Descendant roll-up for a single tree node. */
export interface WorkItemRollup {
    descendantCount: number;
    byType: Record<WorkItemType, number>;
    byStatus: Record<string, number>;
}

/** One node in the hierarchy tree returned by the tree endpoint. */
export interface WorkItemTreeNode {
    item: WorkItemIndexEntry;
    children: WorkItemTreeNode[];
    rollup: WorkItemRollup;
}

/** Response shape from GET /work-items/tree. */
export interface WorkItemTreeRouteResponse {
    roots: WorkItemTreeNode[];
    total: number;
    disabled?: boolean;
}

export interface WorkItemHierarchyRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    /** Returns true when the hierarchy feature flag is enabled. */
    getHierarchyEnabled: () => boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyRollup(): WorkItemRollup {
    return {
        descendantCount: 0,
        byType: Object.fromEntries(WORK_ITEM_TYPES.map(t => [t, 0])) as Record<WorkItemType, number>,
        byStatus: Object.fromEntries(WORK_ITEM_STATUSES.map(s => [s, 0])),
    };
}

function mergeRollup(target: WorkItemRollup, source: WorkItemRollup): void {
    target.descendantCount += source.descendantCount;
    for (const t of Object.keys(source.byType) as WorkItemType[]) {
        target.byType[t] = target.byType[t] + source.byType[t];
    }
    for (const s of Object.keys(source.byStatus)) {
        target.byStatus[s] = (target.byStatus[s] ?? 0) + source.byStatus[s];
    }
}

/** Accumulate a descendant's own type/status into its ancestor's rollup. */
function accumulateEntry(rollup: WorkItemRollup, entry: WorkItemIndexEntry): void {
    const type = (entry.type ?? 'work-item') as WorkItemType;
    rollup.byType[type] = rollup.byType[type] + 1;
    rollup.byStatus[entry.status] = (rollup.byStatus[entry.status] ?? 0) + 1;
    rollup.descendantCount++;
}

/**
 * Sort index entries: pinned-first, then by lastRunAt/updatedAt descending.
 * Mutates the array in-place and returns it.
 */
function sortEntries(entries: WorkItemIndexEntry[]): WorkItemIndexEntry[] {
    return entries.sort((a, b) => {
        if (a.pinnedAt && !b.pinnedAt) return -1;
        if (!a.pinnedAt && b.pinnedAt) return 1;
        const aTime = a.lastRunAt ?? a.updatedAt;
        const bTime = b.lastRunAt ?? b.updatedAt;
        return bTime.localeCompare(aTime);
    });
}

/**
 * Build a hierarchy tree from a flat list of index entries.
 *
 * - Entries whose parentId is absent or references an id not in the working set
 *   are placed at the root.
 * - Cycles are prevented via a visited set (each entry is visited at most once).
 * - Rollup counts are computed bottom-up.
 */
function buildTree(entries: WorkItemIndexEntry[]): WorkItemTreeNode[] {
    const idMap = new Map<string, WorkItemIndexEntry>(entries.map(e => [e.id, e]));

    // Group direct children by effective parentId (null = root)
    const childrenMap = new Map<string | null, WorkItemIndexEntry[]>();
    for (const e of entries) {
        const parentId = e.parentId && idMap.has(e.parentId) ? e.parentId : null;
        const list = childrenMap.get(parentId) ?? [];
        list.push(e);
        childrenMap.set(parentId, list);
    }

    const visited = new Set<string>();

    function buildNode(entry: WorkItemIndexEntry): WorkItemTreeNode {
        visited.add(entry.id);
        const childEntries = sortEntries(
            (childrenMap.get(entry.id) ?? []).filter(c => !visited.has(c.id)),
        );
        const children = childEntries.map(c => buildNode(c));

        // Build rollup from children bottom-up
        const rollup = emptyRollup();
        for (const child of children) {
            // Count the child itself
            accumulateEntry(rollup, child.item);
            // Add child's own rollup
            mergeRollup(rollup, child.rollup);
        }

        return { item: entry, children, rollup };
    }

    const roots = sortEntries(
        (childrenMap.get(null) ?? []).filter(e => !visited.has(e.id)),
    );
    return roots.map(e => buildNode(e));
}

/**
 * Filter entries and preserve ancestors of matching entries so the SPA
 * can show full tree context for search results.
 */
function filterWithAncestors(
    entries: WorkItemIndexEntry[],
    opts: {
        q?: string;
        type?: string;
        status?: string;
        tracker?: WorkItemTrackerKind;
        includeArchived: boolean;
        includeDone: boolean;
    },
): WorkItemIndexEntry[] {
    // Step 1: apply archived filter
    let working = opts.includeArchived
        ? entries
        : entries.filter(e => !e.archivedAt);

    // Step 1.5: apply done filter
    if (!opts.includeDone) {
        working = working.filter(e => !isDoneLikeEntry(e));
    }

    if (opts.tracker) {
        const entriesById = new Map(entries.map(entry => [entry.id, entry]));
        working = working.filter(e => getInheritedTrackerKind(e, entriesById) === opts.tracker);
    }

    // Step 2: if no content filters, return as-is
    const hasContentFilter = opts.q || opts.type || opts.status;
    if (!hasContentFilter) return working;

    const q = opts.q?.toLowerCase();
    const idMap = new Map<string, WorkItemIndexEntry>(working.map(e => [e.id, e]));

    const matchedIds = new Set<string>();
    for (const e of working) {
        const typeMatch = !opts.type || (e.type ?? 'work-item') === opts.type;
        const statusMatch = !opts.status || e.status === opts.status;
        let textMatch = true;
        if (q) {
            textMatch =
                e.title.toLowerCase().includes(q) ||
                (e.description?.toLowerCase().includes(q) ?? false) ||
                (e.tags?.some(t => t.toLowerCase().includes(q)) ?? false);
        }
        if (typeMatch && statusMatch && textMatch) {
            matchedIds.add(e.id);
        }
    }

    // Step 3: collect all ancestors of matching entries
    const toInclude = new Set<string>(matchedIds);
    for (const id of matchedIds) {
        let entry: WorkItemIndexEntry | undefined = idMap.get(id);
        const path = new Set<string>(); // cycle guard
        while (entry?.parentId && !path.has(entry.id)) {
            path.add(entry.id);
            toInclude.add(entry.parentId);
            entry = idMap.get(entry.parentId);
        }
    }

    return working.filter(e => toInclude.has(e.id));
}

function getInheritedTrackerKind(
    entry: WorkItemIndexEntry,
    entriesById: Map<string, WorkItemIndexEntry>,
): WorkItemTrackerKind {
    let current = entry;
    const visited = new Set<string>();
    while (current.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        const parent = entriesById.get(current.parentId);
        if (!parent) break;
        current = parent;
    }
    return getOwnWorkItemTrackerKind(current);
}

function isDoneLikeEntry(entry: WorkItemIndexEntry): boolean {
    return entry.status === 'done' || entry.githubMirror?.state === 'closed';
}

export async function buildWorkItemTreeRouteResponse(
    workItemStore: WorkItemStore,
    repoId: string,
    options: WorkItemTreeCacheOptions,
): Promise<WorkItemTreeRouteResponse> {
    const result = await workItemStore.listWorkItems({ repoId });
    const entries = result.items as WorkItemIndexEntry[];
    const filtered = filterWithAncestors(entries, {
        q: options.q,
        type: options.type,
        status: options.status,
        tracker: options.tracker,
        includeArchived: options.includeArchived === true,
        includeDone: options.includeDone === true,
    });

    const roots = buildTree(filtered);
    return { roots, total: filtered.length };
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerWorkItemHierarchyRoutes(ctx: WorkItemHierarchyRouteContext): void {
    const { routes, workItemStore, getHierarchyEnabled } = ctx;

    // GET /api/origins/:originId/work-items/tree
    // Must be registered BEFORE the generic /:workItemId route to win the match.
    routes.push({
        method: 'GET',
        pattern: WORK_ITEM_TREE_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            let scope;
            try {
                scope = await resolveWorkItemRouteScope(ctx, routeKind, routeScopeId, queryWorkspaceId(req));
            } catch (err) {
                return handleAPIError(res, err);
            }

            if (!getHierarchyEnabled()) {
                return sendJSON(res, 200, { disabled: true, roots: [], total: 0 } satisfies WorkItemTreeRouteResponse);
            }

            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;

            const q = typeof query.q === 'string' ? query.q.trim() || undefined : undefined;
            const typeFilter = typeof query.type === 'string' ? query.type : undefined;
            const statusFilter = typeof query.status === 'string' ? query.status : undefined;
            const trackerFilter = typeof query.tracker === 'string' && WORK_ITEM_TRACKER_KINDS.includes(query.tracker as WorkItemTrackerKind)
                ? query.tracker as WorkItemTrackerKind
                : undefined;
            const includeArchived = query.includeArchived === 'true';
            const includeDone = query.includeDone === 'true';
            const force = query.force === 'true';

            const options: WorkItemTreeCacheOptions = {
                q,
                type: typeFilter,
                status: statusFilter,
                tracker: trackerFilter,
                includeArchived,
                includeDone,
            };
            const response = await getOrRefreshWorkItemResponseCacheEntry(
                makeWorkItemTreeResponseCacheKey(scope.storageRepoId, options),
                scope.storageRepoId,
                'tree',
                force,
                () => buildWorkItemTreeRouteResponse(workItemStore, scope.storageRepoId, options),
            );
            sendJSON(res, 200, response);
        },
    });
}

/**
 * Work Item Hierarchy Routes
 *
 * Provides the hierarchy tree read API for the work item board.
 *
 * Routes:
 *   GET /api/workspaces/:id/work-items/tree — Full hierarchy tree with rollup counts
 *
 * All routes are gated by the workItems.hierarchy.enabled feature flag.
 * When the flag is false the endpoints return a `{ disabled: true }` response
 * so the SPA can gracefully degrade.
 */

import * as http from 'http';
import * as url from 'url';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import type { WorkItemStore, WorkItemIndexEntry, WorkItemStatus, WorkItemType } from '../work-items/types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Descendant roll-up for a single tree node. */
interface WorkItemRollup {
    descendantCount: number;
    byType: Record<WorkItemType, number>;
    byStatus: Record<WorkItemStatus, number>;
}

/** One node in the hierarchy tree returned by the tree endpoint. */
interface WorkItemTreeNode {
    item: WorkItemIndexEntry;
    children: WorkItemTreeNode[];
    rollup: WorkItemRollup;
}

/** Response shape from GET /work-items/tree. */
interface WorkItemTreeResponse {
    roots: WorkItemTreeNode[];
    total: number;
    disabled?: boolean;
}

export interface WorkItemHierarchyRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    /** Returns true when the hierarchy feature flag is enabled. */
    getHierarchyEnabled: () => boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyRollup(): WorkItemRollup {
    return {
        descendantCount: 0,
        byType: { epic: 0, feature: 0, pbi: 0, 'work-item': 0, bug: 0 },
        byStatus: {
            created: 0,
            planning: 0,
            readyToExecute: 0,
            executing: 0,
            aiDone: 0,
            aiFailed: 0,
            done: 0,
            failed: 0,
        },
    };
}

function mergeRollup(target: WorkItemRollup, source: WorkItemRollup): void {
    target.descendantCount += source.descendantCount;
    for (const t of Object.keys(source.byType) as WorkItemType[]) {
        target.byType[t] = (target.byType[t] ?? 0) + source.byType[t];
    }
    for (const s of Object.keys(source.byStatus) as WorkItemStatus[]) {
        target.byStatus[s] = (target.byStatus[s] ?? 0) + source.byStatus[s];
    }
}

/** Accumulate a descendant's own type/status into its ancestor's rollup. */
function accumulateEntry(rollup: WorkItemRollup, entry: WorkItemIndexEntry): void {
    const type = (entry.type ?? 'work-item') as WorkItemType;
    rollup.byType[type] = (rollup.byType[type] ?? 0) + 1;
    rollup.byStatus[entry.status as WorkItemStatus] = (rollup.byStatus[entry.status as WorkItemStatus] ?? 0) + 1;
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
        includeArchived: boolean;
    },
): WorkItemIndexEntry[] {
    // Step 1: apply archived filter
    let working = opts.includeArchived
        ? entries
        : entries.filter(e => !e.archivedAt);

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

// ── Route registration ─────────────────────────────────────────────────────────

export function registerWorkItemHierarchyRoutes(ctx: WorkItemHierarchyRouteContext): void {
    const { routes, workItemStore, getHierarchyEnabled } = ctx;

    // GET /api/workspaces/:id/work-items/tree
    // Must be registered BEFORE the generic /:workItemId route to win the match.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/tree$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!getHierarchyEnabled()) {
                return sendJSON(res, 200, { disabled: true, roots: [], total: 0 } satisfies WorkItemTreeResponse);
            }

            const repoId = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;

            const q = typeof query.q === 'string' ? query.q.trim() || undefined : undefined;
            const typeFilter = typeof query.type === 'string' ? query.type : undefined;
            const statusFilter = typeof query.status === 'string' ? query.status : undefined;
            const includeArchived = query.includeArchived === 'true';

            // Load the full index for this workspace
            const result = await workItemStore.listWorkItems({ repoId });
            const entries = result.items as WorkItemIndexEntry[];

            // Filter and preserve ancestors
            const filtered = filterWithAncestors(entries, {
                q,
                type: typeFilter,
                status: statusFilter,
                includeArchived,
            });

            const roots = buildTree(filtered);
            sendJSON(res, 200, { roots, total: filtered.length } satisfies WorkItemTreeResponse);
        },
    });
}

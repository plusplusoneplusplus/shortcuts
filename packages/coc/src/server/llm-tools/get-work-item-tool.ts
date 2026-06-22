/**
 * Get Work Item Tool
 *
 * Factory that creates a read-only `get_work_item` custom tool for the Copilot SDK.
 * The model calls this tool to resolve a workspace-scoped work item by UUID, `WI-N`,
 * or sequential work-item number before drafting, reviewing, or proposing changes.
 *
 * This is the read-side companion to `create_update_work_item`: it never mutates the
 * item, creates plan versions, updates status, broadcasts events, or calls remote
 * provider write transports. It only reads through the workspace-scoped work-item
 * store, so it cannot return items from another workspace.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createWorkItemStore } from '../work-items/work-item-store';
import type { WorkItem, WorkItemIndexEntry, WorkItemStatus, WorkItemStore, WorkItemType } from '../work-items/types';

// ============================================================================
// Types
// ============================================================================

export interface GetWorkItemArgs {
    /** Work item UUID, or a chat-friendly WI-N target. */
    workItemId?: string;
    /** Work item UUID, WI-N, or number. */
    target?: string;
    /** Sequential work item number, e.g. 20 or "WI-20". */
    workItemNumber?: number | string;
}

/**
 * Optional server-side dependencies. When omitted, the tool falls back to a
 * dataDir-backed store.
 */
export interface GetWorkItemToolDeps {
    /** Workspace-scoped store. Defaults to a `FileWorkItemStore` rooted at `dataDir`. */
    workItemStore?: WorkItemStore;
    /** When provided alongside `workItemStore` being absent, wires scope resolution. */
    processStore?: ProcessStore;
}

/**
 * Lightweight hierarchy node carried by every ancestor and descendant. Deliberately
 * omits `description`, `plan`, and rollup counts so hierarchy context stays cheap.
 */
export interface WorkItemHierarchyNode {
    id: string;
    workItemNumber?: number;
    title: string;
    type?: WorkItemType;
    status: WorkItemStatus;
}

/** Descendant node: a lightweight node plus its own recursive subtree. */
export interface WorkItemDescendantNode extends WorkItemHierarchyNode {
    children: WorkItemDescendantNode[];
}

/** The queried item in full detail, augmented with its recursive descendant subtree. */
export type GetWorkItemWithChildren = WorkItem & { children: WorkItemDescendantNode[] };

export interface GetWorkItemSuccess {
    found: true;
    /** The queried item in full detail, plus a recursive `children` descendant subtree. */
    item: GetWorkItemWithChildren;
    /** Flat ancestor chain ordered from the epic root down to the direct parent. */
    ancestors: WorkItemHierarchyNode[];
}

export interface GetWorkItemNotFound {
    found: false;
    error: string;
}

export type GetWorkItemResult = GetWorkItemSuccess | GetWorkItemNotFound;

// ============================================================================
// Helpers
// ============================================================================

/** Parse a `WI-N` / numeric reference into a positive integer work-item number. */
function parseWorkItemNumber(value: string | number | undefined): number | undefined {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : undefined;
    }
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/^(?:WI-)?(\d+)$/i);
    if (!match) return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Pick the single requested target from the mutually-redundant input fields. */
function getTarget(args: GetWorkItemArgs): string | number | undefined {
    return args.workItemId?.trim()
        || args.target?.trim()
        || args.workItemNumber;
}

/**
 * Resolve a work item in the current workspace from a UUID, `WI-N`, or sequential
 * number. Numeric references are matched against the workspace listing; UUID-like
 * references are read directly. Both paths are workspace-scoped via `repoId`.
 */
async function resolveWorkItem(
    store: WorkItemStore,
    repoId: string,
    args: GetWorkItemArgs,
): Promise<WorkItem | undefined> {
    const target = getTarget(args);
    if (target === undefined || target === '') {
        return undefined;
    }

    const targetText = String(target).trim();
    const targetNumber = args.workItemNumber !== undefined
        ? parseWorkItemNumber(args.workItemNumber)
        : parseWorkItemNumber(targetText);

    if (targetNumber !== undefined) {
        const { items } = await store.listWorkItems({ repoId });
        const match = items.find(item => item.workItemNumber === targetNumber);
        return match ? store.getWorkItem(match.id, repoId) : undefined;
    }

    return store.getWorkItem(targetText, repoId);
}

// ============================================================================
// Hierarchy helpers
// ============================================================================

/** Reduce a full index entry to the lightweight hierarchy node shape. */
function toHierarchyNode(entry: WorkItemIndexEntry): WorkItemHierarchyNode {
    return {
        id: entry.id,
        workItemNumber: entry.workItemNumber,
        title: entry.title,
        type: entry.type,
        status: entry.status,
    };
}

/**
 * Sort index entries the same way the hierarchy tree route does: pinned-first,
 * then by lastRunAt/updatedAt descending. Mutates and returns the array.
 */
function sortHierarchyEntries(entries: WorkItemIndexEntry[]): WorkItemIndexEntry[] {
    return entries.sort((a, b) => {
        if (a.pinnedAt && !b.pinnedAt) return -1;
        if (!a.pinnedAt && b.pinnedAt) return 1;
        const aTime = a.lastRunAt ?? a.updatedAt ?? '';
        const bTime = b.lastRunAt ?? b.updatedAt ?? '';
        return bTime.localeCompare(aTime);
    });
}

/**
 * Walk parent links from `item` up to the epic root, returning lightweight nodes
 * ordered epic-root → direct-parent. Cycle-safe via a visited set seeded with the
 * queried item so a malformed parent loop cannot recurse forever.
 */
function buildAncestors(
    item: WorkItem,
    entriesById: Map<string, WorkItemIndexEntry>,
): WorkItemHierarchyNode[] {
    const ancestors: WorkItemHierarchyNode[] = [];
    const visited = new Set<string>([item.id]);
    let parentId = item.parentId;
    while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = entriesById.get(parentId);
        if (!parent) break;
        ancestors.push(toHierarchyNode(parent));
        parentId = parent.parentId;
    }
    ancestors.reverse();
    return ancestors;
}

/**
 * Build the recursive descendant subtree rooted at `parentId`. The `visited` set
 * (seeded with the queried item id) keeps the build cycle-safe so a parent loop
 * cannot cause infinite recursion.
 */
function buildDescendants(
    parentId: string,
    childrenByParent: Map<string, WorkItemIndexEntry[]>,
    visited: Set<string>,
): WorkItemDescendantNode[] {
    const directChildren = sortHierarchyEntries(
        (childrenByParent.get(parentId) ?? []).filter(child => !visited.has(child.id)),
    );
    const nodes: WorkItemDescendantNode[] = [];
    for (const child of directChildren) {
        visited.add(child.id);
        nodes.push({
            ...toHierarchyNode(child),
            children: buildDescendants(child.id, childrenByParent, visited),
        });
    }
    return nodes;
}

/**
 * Read the workspace index once and derive the queried item's ancestor chain and
 * recursive descendant subtree. Degrades to empty arrays if the index read fails,
 * so a hierarchy-read hiccup never breaks the primary lookup.
 */
async function buildHierarchyContext(
    store: WorkItemStore,
    repoId: string,
    item: WorkItem,
): Promise<{ children: WorkItemDescendantNode[]; ancestors: WorkItemHierarchyNode[] }> {
    let entries: WorkItemIndexEntry[] = [];
    try {
        const result = await store.listWorkItems({ repoId });
        entries = result?.items ?? [];
    } catch {
        return { children: [], ancestors: [] };
    }

    const entriesById = new Map<string, WorkItemIndexEntry>(entries.map(e => [e.id, e]));
    const childrenByParent = new Map<string, WorkItemIndexEntry[]>();
    for (const entry of entries) {
        if (!entry.parentId) continue;
        const list = childrenByParent.get(entry.parentId) ?? [];
        list.push(entry);
        childrenByParent.set(entry.parentId, list);
    }

    const visited = new Set<string>([item.id]);
    const children = buildDescendants(item.id, childrenByParent, visited);
    const ancestors = buildAncestors(item, entriesById);
    return { children, ancestors };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a read-only `get_work_item` custom tool definition for the Copilot SDK.
 *
 * @param dataDir - Base data directory (e.g. `~/.coc`).
 * @param repoId  - Workspace / repository ID the lookup is scoped to.
 * @param deps    - Optional server-side dependencies (store injection for tests/wiring).
 */
export function createGetWorkItemTool(
    dataDir: string,
    repoId: string,
    deps?: GetWorkItemToolDeps,
) {
    const store: WorkItemStore = deps?.workItemStore ?? createWorkItemStore({ dataDir, processStore: deps?.processStore });

    const tool = defineTool<GetWorkItemArgs>('get_work_item', {
        description:
            'Read the current detail of an existing work item in this repository by UUID, WI-N, or work-item number. ' +
            'Provide exactly one of `workItemId` (UUID or WI-N), `target` (UUID or WI-N), or `workItemNumber` ' +
            '(e.g. 20 or "WI-20"). Returns `{ found: true, item, ancestors }` when it exists, or `{ found: false, error }` ' +
            'when the target is missing or invalid. On success the queried `item` carries its full detail (title, ' +
            'description, status, priority, tags, parentId, plan, and metadata) plus `item.children`: the recursive ' +
            'descendant subtree, where each node is a lightweight `{ id, workItemNumber, title, type, status, children }`. ' +
            'The top-level `ancestors` is a flat array of those same lightweight nodes (without `children`) ordered from ' +
            'the epic root down to the direct parent; both `item.children` and `ancestors` are empty arrays when the ' +
            'item has no descendants / no parent. This gives you sibling, parent, and child context without extra ' +
            'lookups; only the queried item includes `description`/`plan`. This tool is read-only: it never creates, ' +
            'updates, or deletes a work item. ' +
            'Use it when the user references an existing work item, or when attached context supplies a work-item pointer, ' +
            'before drafting changes — unless the full detail is already present in the prompt. ' +
            'Do not use it as a substitute for conversation retrieval; use `get_conversation` for prior chat transcripts. ' +
            'Use `create_update_work_item` (after presenting a draft and receiving user confirmation) to make changes.',
        parameters: {
            type: 'object',
            properties: {
                workItemId: {
                    type: 'string',
                    description: 'Work item UUID, or WI-N target.',
                },
                target: {
                    type: 'string',
                    description: 'Work item UUID or WI-N target.',
                },
                workItemNumber: {
                    oneOf: [{ type: 'number' }, { type: 'string' }],
                    description: 'Sequential work item number, e.g. 20 or "WI-20".',
                },
            },
            required: [],
        },
        handler: async (args: GetWorkItemArgs): Promise<GetWorkItemResult> => {
            const target = getTarget(args);
            if (target === undefined || String(target).trim() === '') {
                return {
                    found: false,
                    error: 'Provide a work item target: one of workItemId, target, or workItemNumber',
                };
            }

            const item = await resolveWorkItem(store, repoId, args);
            if (!item) {
                return { found: false, error: `Work item not found: ${String(target)}` };
            }

            const { children, ancestors } = await buildHierarchyContext(store, repoId, item);
            return { found: true, item: { ...item, children }, ancestors };
        },
    });

    return { tool };
}

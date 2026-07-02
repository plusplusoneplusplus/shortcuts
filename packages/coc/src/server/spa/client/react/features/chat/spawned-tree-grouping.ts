/**
 * spawned-tree-grouping — groups the flat chat list into recursive trees that
 * mirror `send_to_conversation` spawn relationships.
 *
 * When a chat spawns another conversation via the `send_to_conversation` tool,
 * the spawned process records `AIProcess.parentProcessId` = the originating
 * chat's process id (see AC-01). This builder turns the already-returned flat
 * running/queued/history lists into a recursive tree by following those links,
 * so spawned descendants nest under their root chat instead of appearing as
 * flat sibling rows.
 *
 * Pure utility: no React, no side effects. Only `parentProcessId` links form
 * this tree — for-each / map-reduce / ralph groupings (which use the
 * `taskGroup` tag, not `parentProcessId`) are untouched.
 */

import { getTaskIds, getTaskTimestamp, isUnseenTask } from './task-group-grouping';

/** Resolve the parent process id a spawned chat links back to, if any. */
export function getSpawnedParentId(task: any): string | undefined {
    const id = task?.parentProcessId;
    return typeof id === 'string' && id.trim() ? id : undefined;
}

/** One node in a spawned-conversation tree. */
export interface SpawnedTreeNode {
    /** The underlying chat task / history item. */
    task: any;
    /** Direct spawned children, sorted oldest-first. */
    children: SpawnedTreeNode[];
    /** Total descendants beneath this node (recursive, excludes self). */
    descendantCount: number;
    /** Latest activity anywhere in this node's subtree (self + descendants). */
    subtreeLatestTimestamp: number;
    /** True when this node or any descendant is unseen. */
    hasUnseen: boolean;
}

/** A root chat that has at least one spawned descendant. */
export interface SpawnedTreeEntry {
    kind: 'spawned-tree';
    /** Stable group id — the root's process id. */
    rootProcessId: string;
    /** The root node (its `task` is the parent chat itself). */
    root: SpawnedTreeNode;
    /** Total descendants under the root (recursive). */
    descendantCount: number;
    /** Latest activity anywhere in the subtree — used for root ordering. */
    latestTimestamp: number;
    /** True when the root or any descendant is unseen. */
    hasUnseen: boolean;
}

/** A grouped chat list entry: either a spawned-tree root or a standalone task. */
export type SpawnedTreeHistoryEntry = SpawnedTreeEntry | any;

function makeNode(task: any): SpawnedTreeNode {
    return {
        task,
        children: [],
        descendantCount: 0,
        subtreeLatestTimestamp: getTaskTimestamp(task),
        hasUnseen: false,
    };
}

/**
 * Finalize a node's aggregate fields by folding in its (already-finalized)
 * children: total descendant count, subtree-latest timestamp, and unseen flag.
 */
function finalizeNode(node: SpawnedTreeNode, unseenIds?: Set<string>): void {
    node.children.sort((a, b) => getTaskTimestamp(a.task) - getTaskTimestamp(b.task));
    let descendantCount = 0;
    let latest = getTaskTimestamp(node.task);
    let hasUnseen = isUnseenTask(node.task, unseenIds);
    for (const child of node.children) {
        descendantCount += 1 + child.descendantCount;
        latest = Math.max(latest, child.subtreeLatestTimestamp);
        hasUnseen = hasUnseen || child.hasUnseen;
    }
    node.descendantCount = descendantCount;
    node.subtreeLatestTimestamp = latest;
    node.hasUnseen = hasUnseen;
}

/**
 * Group a flat task/history list into recursive spawn trees.
 *
 * Items with no `parentProcessId`, or whose parent is not present in the list
 * (deleted / not loaded — an orphan), become roots. A root with no spawned
 * descendants is emitted as the original task (flat rendering unchanged); a
 * root with descendants is emitted as a {@link SpawnedTreeEntry}. Entries sort
 * by latest subtree activity, descending — an active descendant pulls its whole
 * tree up. Cycles (a → b → a) are broken by a visited guard.
 */
export function groupBySpawnedTree(
    items: any[],
    unseenIds?: Set<string>,
): SpawnedTreeHistoryEntry[] {
    if (items.length === 0) {return items;}

    // Map every identity id (id + processId) of an item to its node, so a
    // child's parentProcessId resolves regardless of which id the parent uses.
    const nodeById = new Map<string, SpawnedTreeNode>();
    const nodes: SpawnedTreeNode[] = [];
    for (const item of items) {
        const node = makeNode(item);
        nodes.push(node);
        for (const id of getTaskIds(item)) {
            if (!nodeById.has(id)) {nodeById.set(id, node);}
        }
    }

    // Attach each node to its parent (if present and not self), else it is a root.
    const roots: SpawnedTreeNode[] = [];
    const parentOf = new Map<SpawnedTreeNode, SpawnedTreeNode>();
    let nested = false;
    for (const node of nodes) {
        const parentId = getSpawnedParentId(node.task);
        const parent = parentId ? nodeById.get(parentId) : undefined;
        if (parent && parent !== node && !wouldCycle(parent, node, parentOf)) {
            parent.children.push(node);
            parentOf.set(node, parent);
            nested = true;
        } else {
            roots.push(node);
        }
    }

    // No spawn links resolved within this list — return it untouched so the
    // caller's existing ordering and array reference are preserved.
    if (!nested) {return items;}

    // Finalize aggregates bottom-up: post-order traversal from each root.
    for (const root of roots) {
        finalizeSubtree(root, unseenIds);
    }

    const entries: SpawnedTreeHistoryEntry[] = roots.map(root =>
        root.children.length === 0
            ? root.task
            : ({
                kind: 'spawned-tree',
                rootProcessId: getNodePrimaryId(root) ?? '',
                root,
                descendantCount: root.descendantCount,
                latestTimestamp: root.subtreeLatestTimestamp,
                hasUnseen: root.hasUnseen,
            } satisfies SpawnedTreeEntry),
    );

    entries.sort((a, b) => getSpawnedEntryTimestamp(b) - getSpawnedEntryTimestamp(a));
    return entries;
}

function finalizeSubtree(node: SpawnedTreeNode, unseenIds?: Set<string>): void {
    for (const child of node.children) {
        finalizeSubtree(child, unseenIds);
    }
    finalizeNode(node, unseenIds);
}

/** Would attaching `node` under `parent` create a cycle (parent already in node's subtree chain)? */
function wouldCycle(
    parent: SpawnedTreeNode,
    node: SpawnedTreeNode,
    parentOf: Map<SpawnedTreeNode, SpawnedTreeNode>,
): boolean {
    let cursor: SpawnedTreeNode | undefined = parent;
    const guard = new Set<SpawnedTreeNode>();
    while (cursor) {
        if (cursor === node) {return true;}
        if (guard.has(cursor)) {return true;}
        guard.add(cursor);
        cursor = parentOf.get(cursor);
    }
    return false;
}

function getNodePrimaryId(node: SpawnedTreeNode): string | undefined {
    return getTaskIds(node.task)[0];
}

/**
 * Stable id for a tree node, used as the per-node collapse key. Matches the
 * `rootProcessId` an entry exposes (both resolve via {@link getTaskIds}), so a
 * collapsed root id round-trips against its entry.
 */
export function getSpawnedNodeId(node: SpawnedTreeNode): string {
    return getNodePrimaryId(node) ?? '';
}

/** Effective ordering timestamp for a grouped entry. */
export function getSpawnedEntryTimestamp(entry: SpawnedTreeHistoryEntry): number {
    if (isSpawnedTreeEntry(entry)) {return entry.latestTimestamp;}
    return getTaskTimestamp(entry);
}

export function isSpawnedTreeEntry(value: unknown): value is SpawnedTreeEntry {
    return !!value
        && typeof value === 'object'
        && (value as { kind?: unknown }).kind === 'spawned-tree';
}

/**
 * Collect every descendant identity id under a spawned-tree entry (excludes the
 * root). Used to hide nested chats from the flat list rendering.
 */
export function collectSpawnedDescendantIds(entry: SpawnedTreeEntry): Set<string> {
    const ids = new Set<string>();
    const walk = (node: SpawnedTreeNode) => {
        for (const child of node.children) {
            for (const id of getTaskIds(child.task)) {ids.add(id);}
            walk(child);
        }
    };
    walk(entry.root);
    return ids;
}

/** Collect every task (root + all descendants) under a spawned-tree entry. */
export function collectSpawnedEntryTasks(entry: SpawnedTreeEntry): any[] {
    const tasks: any[] = [];
    const walk = (node: SpawnedTreeNode) => {
        tasks.push(node.task);
        for (const child of node.children) {walk(child);}
    };
    walk(entry.root);
    return tasks;
}

/** The result of wiring the spawned-tree grouping into the flat chat list. */
export interface SpawnedTreeChatView {
    /**
     * The grouped entries: roots with descendants become {@link SpawnedTreeEntry}s,
     * everything else stays a plain task. When the view is disabled, this is the
     * original `items` array reference (flat rendering, unchanged).
     */
    entries: SpawnedTreeHistoryEntry[];
    /** Just the spawned-tree entries (roots that have at least one descendant). */
    groups: SpawnedTreeEntry[];
    /**
     * Every id (root + descendants) that should be removed from the flat list,
     * because those chats now render inside a {@link SpawnedTreeRow}. Empty when
     * the view is disabled.
     */
    hiddenIds: Set<string>;
}

/**
 * Build the spawned-tree view for the chat list (the wiring AC-03 consumes).
 *
 * When `enabled` is false, returns the items untouched with no hidden ids — the
 * toggle-off path restores flat rendering. When enabled, groups the items into
 * spawn trees (skipping any whose identity id is in `excludeIds`, so chats
 * already owned by a for-each / map-reduce / ralph group keep their existing
 * grouping) and reports the root + descendant ids to hide from the flat list.
 */
export function buildSpawnedTreeChatView(
    items: any[],
    options: { enabled: boolean; unseenIds?: Set<string>; excludeIds?: Set<string> },
): SpawnedTreeChatView {
    if (!options.enabled) {
        return { entries: items, groups: [], hiddenIds: new Set() };
    }
    const exclude = options.excludeIds;
    const source = exclude && exclude.size
        ? items.filter(item => !getTaskIds(item).some(id => exclude.has(id)))
        : items;
    const entries = groupBySpawnedTree(source, options.unseenIds);
    const groups = entries.filter(isSpawnedTreeEntry);
    const hiddenIds = new Set<string>();
    for (const group of groups) {
        for (const id of getTaskIds(group.root.task)) {hiddenIds.add(id);}
        for (const id of collectSpawnedDescendantIds(group)) {hiddenIds.add(id);}
    }
    return { entries, groups, hiddenIds };
}

/** True when this node is *explicitly* archived (its own id/processId is in `archivedIds`). */
function isNodeExplicitlyArchived(node: SpawnedTreeNode, archivedIds: ReadonlySet<string>): boolean {
    return getTaskIds(node.task).some(id => archivedIds.has(id));
}

/** Wrap a finalized node as a spawned-tree entry (mirrors {@link groupBySpawnedTree}). */
function entryFromNode(node: SpawnedTreeNode): SpawnedTreeEntry {
    return {
        kind: 'spawned-tree',
        rootProcessId: getSpawnedNodeId(node),
        root: node,
        descendantCount: node.descendantCount,
        latestTimestamp: node.subtreeLatestTimestamp,
        hasUnseen: node.hasUnseen,
    };
}

/**
 * Recursively split one node into its active remainder plus every archived
 * subtree root reachable through active ancestors.
 *
 * If the node is explicitly archived, the WHOLE subtree (unchanged) becomes an
 * archived root — deeper archived descendants do not re-root, so the subtree
 * travels together (display-only semantics; on unarchive of an ancestor they
 * re-root naturally on the next recompute). Otherwise the node stays active: its
 * children are split, archived branches peel off, and a fresh active node is
 * finalized over just the surviving children so aggregate fields
 * (descendantCount / subtree-latest / unseen) reflect the pruned shape.
 */
function splitNodeByArchived(
    node: SpawnedTreeNode,
    archivedIds: ReadonlySet<string>,
    unseenIds?: Set<string>,
): { active: SpawnedTreeNode | null; archivedRoots: SpawnedTreeNode[] } {
    if (isNodeExplicitlyArchived(node, archivedIds)) {
        return { active: null, archivedRoots: [node] };
    }
    const activeChildren: SpawnedTreeNode[] = [];
    const archivedRoots: SpawnedTreeNode[] = [];
    for (const child of node.children) {
        const split = splitNodeByArchived(child, archivedIds, unseenIds);
        if (split.active) {activeChildren.push(split.active);}
        archivedRoots.push(...split.archivedRoots);
    }
    const active = makeNode(node.task);
    active.children = activeChildren;
    finalizeNode(active, unseenIds);
    return { active, archivedRoots };
}

/**
 * The result of partitioning spawned-tree groups by effective-archived state.
 *
 * A node is *effectively archived* when it, or any ancestor in its spawn tree,
 * is explicitly in `archivedIds`. Trees split at the SHALLOWEST explicitly-
 * archived node in every chain: that node + its subtree move to the archived
 * side; the rest stays active. Roots pruned down to zero descendants are
 * returned as plain tasks (flat rendering) rather than single-node groups, so
 * they slot back into the flat COMPLETED / ARCHIVED lists.
 */
export interface SpawnedTreeArchivePartition {
    /** Active trees (root still has ≥1 descendant) — stay in COMPLETED. */
    activeGroups: SpawnedTreeEntry[];
    /** Active roots left childless after pruning — render flat in COMPLETED. */
    activeTasks: any[];
    /** Archived subtrees (root has ≥1 descendant) rooted at the shallowest archived node — render as trees in ARCHIVED. */
    archivedGroups: SpawnedTreeEntry[];
    /** Archived roots with no descendants — render flat in ARCHIVED. */
    archivedTasks: any[];
    /** Every identity id (root + descendants) that is effectively archived. */
    effectiveArchivedIds: Set<string>;
}

/**
 * Partition spawned-tree groups by effective-archived state (display-only,
 * recomputed each render from the per-chat `archivedIds` set — no cascade write
 * onto descendants).
 *
 * When `archivedIds` is empty the input groups pass through untouched (same
 * array reference for `activeGroups`), so the non-archived path stays a no-op.
 */
export function partitionSpawnedTreesByArchived(
    groups: SpawnedTreeEntry[],
    archivedIds?: ReadonlySet<string> | null,
    unseenIds?: Set<string>,
): SpawnedTreeArchivePartition {
    if (!archivedIds || archivedIds.size === 0) {
        return {
            activeGroups: groups,
            activeTasks: [],
            archivedGroups: [],
            archivedTasks: [],
            effectiveArchivedIds: new Set(),
        };
    }

    const activeGroups: SpawnedTreeEntry[] = [];
    const activeTasks: any[] = [];
    const archivedGroups: SpawnedTreeEntry[] = [];
    const archivedTasks: any[] = [];
    const effectiveArchivedIds = new Set<string>();

    for (const group of groups) {
        const { active, archivedRoots } = splitNodeByArchived(group.root, archivedIds, unseenIds);
        if (active) {
            if (active.children.length > 0) {activeGroups.push(entryFromNode(active));}
            else {activeTasks.push(active.task);}
        }
        for (const root of archivedRoots) {
            const entry = entryFromNode(root);
            for (const id of getTaskIds(root.task)) {effectiveArchivedIds.add(id);}
            for (const id of collectSpawnedDescendantIds(entry)) {effectiveArchivedIds.add(id);}
            if (root.children.length > 0) {archivedGroups.push(entry);}
            else {archivedTasks.push(root.task);}
        }
    }

    // Preserve the incoming latest-activity-descending order of the surviving trees.
    activeGroups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    archivedGroups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

    return { activeGroups, activeTasks, archivedGroups, archivedTasks, effectiveArchivedIds };
}

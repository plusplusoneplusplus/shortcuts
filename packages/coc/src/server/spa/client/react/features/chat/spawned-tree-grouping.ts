/**
 * spawned-tree-grouping — groups the flat chat list into recursive trees that
 * mirror `create_conversation` spawn relationships.
 *
 * When a chat spawns another conversation via the `create_conversation` tool,
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

// Tree projections for the agent-run navigator and sub-agent breadcrumb.
// Separate from layout.ts (which is spatial): these resolve nodes/paths by id
// and flatten only the rows currently visible in the tree popover.

import { countRuns } from './buildAgentRunTree';
import type { AgentRunNode } from './types';

export interface AgentTreeRow {
    node: AgentRunNode;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
}

/** Depth-first lookup of a node by id within the run tree. */
export function findAgentNode(node: AgentRunNode, id: string): AgentRunNode | null {
    if (node.id === id) {
        return node;
    }
    for (const child of node.children || []) {
        const found = findAgentNode(child, id);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * The ancestor chain from the root down to (and including) the node with `id`:
 * `[root, …, node]`, for rendering a breadcrumb. Returns `[]` when not found.
 */
export function pathToAgent(root: AgentRunNode, id: string): AgentRunNode[] {
    const trail: AgentRunNode[] = [];
    const dfs = (node: AgentRunNode): boolean => {
        trail.push(node);
        if (node.id === id) {
            return true;
        }
        for (const child of node.children || []) {
            if (dfs(child)) {
                return true;
            }
        }
        trail.pop();
        return false;
    };
    return dfs(root) ? trail : [];
}

/** Visible rows in render order, honoring collapsed subtrees. */
export function flattenVisibleAgentRows(root: AgentRunNode, expanded: ReadonlySet<string>): AgentTreeRow[] {
    const rows: AgentTreeRow[] = [];
    const walk = (node: AgentRunNode, depth: number): void => {
        const hasChildren = (node.children || []).length > 0;
        const isExpanded = hasChildren && expanded.has(node.id);
        rows.push({ node, depth, hasChildren, expanded: isExpanded });
        if (!isExpanded) {
            return;
        }
        for (const child of node.children || []) {
            walk(child, depth + 1);
        }
    };
    walk(root, 0);
    return rows;
}

/**
 * Seed expansion: every parent when the tree is small (<= 12 runs), otherwise
 * the root plus the ancestor chain of `selectedId`.
 */
export function defaultExpandedIds(root: AgentRunNode, selectedId: string | null): Set<string> {
    const expanded = new Set<string>();
    if (countRuns(root) <= 12) {
        const addParents = (node: AgentRunNode): void => {
            if ((node.children || []).length > 0) {
                expanded.add(node.id);
            }
            for (const child of node.children || []) {
                addParents(child);
            }
        };
        addParents(root);
        return expanded;
    }

    expanded.add(root.id);
    if (!selectedId) {
        return expanded;
    }
    const path = pathToAgent(root, selectedId);
    for (const node of path) {
        expanded.add(node.id);
    }
    return expanded;
}

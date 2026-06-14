// Linear projections of the agent-run tree used by the cascading "Agents"
// dropdown and the sub-agent breadcrumb. Separate from layout.ts (which is
// spatial) — these flatten the tree by depth and resolve nodes/paths by id.

import type { AgentRunNode } from './types';

export interface AgentLevel {
    /** Depth from the orchestrator root: 0 = L0 (orchestrator), 1 = L1, … */
    depth: number;
    /** Short menu label, e.g. 'L0 · orchestrator', 'L1', 'L2'. */
    label: string;
    /** Runs at this depth (L0 is always just the root; deeper levels are sub-agents). */
    agents: AgentRunNode[];
}

/** Stable sort by start time; runs with no known start time keep their order, last. */
function byStartedAt(a: AgentRunNode, b: AgentRunNode): number {
    if (a.startedAt === undefined && b.startedAt === undefined) {
        return 0;
    }
    if (a.startedAt === undefined) {
        return 1;
    }
    if (b.startedAt === undefined) {
        return -1;
    }
    return a.startedAt - b.startedAt;
}

/**
 * Group the tree's nodes by depth into contiguous levels (L0…Ln). Only levels
 * that exist are returned; each level's agents are ordered by start time. L0 is
 * the lone orchestrator root.
 */
export function flattenAgentLevels(root: AgentRunNode): AgentLevel[] {
    const byDepth = new Map<number, AgentRunNode[]>();
    const walk = (node: AgentRunNode, depth: number): void => {
        const bucket = byDepth.get(depth);
        if (bucket) {
            bucket.push(node);
        } else {
            byDepth.set(depth, [node]);
        }
        for (const child of node.children || []) {
            walk(child, depth + 1);
        }
    };
    walk(root, 0);

    const maxDepth = Math.max(...byDepth.keys());
    const levels: AgentLevel[] = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
        const agents = (byDepth.get(depth) || []).slice().sort(byStartedAt);
        levels.push({
            depth,
            label: depth === 0 ? 'L0 · orchestrator' : `L${depth}`,
            agents,
        });
    }
    return levels;
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

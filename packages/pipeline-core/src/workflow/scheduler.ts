/**
 * DAG Scheduler — Kahn's topological sort producing execution tiers.
 *
 * Pure, side-effect-free module. Takes a validated {@link DAGGraph} and
 * returns an ordered list of {@link ExecutionTier}s. Each tier is a sorted
 * array of node IDs that can safely execute in parallel because all of
 * their upstream dependencies have completed.
 *
 * Callers **must** run `validate()` before calling `schedule()` — the
 * scheduler assumes no cycles and no dangling references.
 */

import type { DAGGraph, ExecutionTier } from './types';

/**
 * Compute execution tiers via Kahn's algorithm.
 *
 * Nodes that share the same topological depth are grouped into a single
 * tier and sorted alphabetically for deterministic output.
 *
 * The caller's graph is never mutated — `inDegree` is shallow-copied
 * before processing.
 *
 * @param graph - A validated DAG (no cycles, no dangling refs).
 * @returns Ordered list of tiers; tier 0 contains all root nodes.
 */
export function schedule(graph: DAGGraph): ExecutionTier[] {
    // Work on a copy so the caller's graph is never mutated.
    const inDegree = new Map(graph.inDegree);
    const edges = graph.edges; // read-only reference

    // Bootstrap: every node with no incoming edges belongs to the first frontier.
    const frontier: string[] = [];
    for (const [nodeId, degree] of inDegree) {
        if (degree === 0) {
            frontier.push(nodeId);
        }
    }
    frontier.sort();

    const tiers: ExecutionTier[] = [];

    // BFS-by-tier: advance one tier per loop iteration.
    while (frontier.length > 0) {
        tiers.push([...frontier]);

        const nextFrontier: string[] = [];
        for (const nodeId of frontier) {
            const children = edges.get(nodeId) ?? [];
            for (const child of children) {
                const newDegree = (inDegree.get(child) ?? 0) - 1;
                inDegree.set(child, newDegree);
                if (newDegree === 0) {
                    nextFrontier.push(child);
                }
            }
        }

        nextFrontier.sort();
        frontier.length = 0;
        frontier.push(...nextFrontier);
    }

    return tiers;
}

/**
 * Flatten tiers into a single ordered list.
 *
 * Useful for logging: "execution order: raw, enriched, bugs, features, …"
 */
export function getExecutionOrder(tiers: ExecutionTier[]): string[] {
    return tiers.flat();
}

/**
 * Return which tier (0-indexed) a node belongs to, or -1 if not found.
 *
 * Useful for the executor to look up a node's tier quickly.
 */
export function getTierIndex(nodeId: string, tiers: ExecutionTier[]): number {
    for (let i = 0; i < tiers.length; i++) {
        if (tiers[i].includes(nodeId)) {
            return i;
        }
    }
    return -1;
}

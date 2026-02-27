/**
 * DAG Graph — adjacency-list construction and cycle detection.
 *
 * Pure data-structure utility with no I/O or validation logic.
 * The validator calls these functions; the executor reuses the built graph
 * for topological scheduling.
 */

import type { NodeConfig, DAGGraph } from './types';

/**
 * Build an adjacency-list DAG from a record of node configs.
 *
 * `from` references that point to unknown node IDs are tolerated here —
 * they are initialised in the maps to avoid undefined lookups during
 * cycle detection. Semantic validation (dangling refs) is the
 * validator's responsibility.
 */
export function buildGraph(nodes: Record<string, NodeConfig>): DAGGraph {
    const edges = new Map<string, string[]>();
    const reverseEdges = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialise every known node
    for (const id of Object.keys(nodes)) {
        edges.set(id, []);
        reverseEdges.set(id, []);
        inDegree.set(id, 0);
    }

    // Populate edges from `from` declarations
    for (const [id, node] of Object.entries(nodes)) {
        for (const parentId of node.from ?? []) {
            // Ensure maps have entries for unknown parentIds (robustness)
            if (!edges.has(parentId)) {
                edges.set(parentId, []);
                reverseEdges.set(parentId, []);
                inDegree.set(parentId, 0);
            }

            edges.get(parentId)!.push(id);
            reverseEdges.get(id)!.push(parentId);
            inDegree.set(id, inDegree.get(id)! + 1);
        }
    }

    // Roots: nodes with inDegree === 0
    const roots: string[] = [];
    for (const [id, degree] of inDegree) {
        if (degree === 0) {
            roots.push(id);
        }
    }

    // Leaves: nodes with no outgoing edges
    const leaves: string[] = [];
    for (const [id, children] of edges) {
        if (children.length === 0) {
            leaves.push(id);
        }
    }

    return { edges, reverseEdges, inDegree, roots, leaves };
}

// ---------------------------------------------------------------------------
// Cycle detection — iterative DFS with 3-colour marking
// ---------------------------------------------------------------------------

const WHITE = 0;
const GREY = 1;
const BLACK = 2;

/**
 * Detect a cycle in the graph using iterative DFS with 3-colour marking.
 *
 * @returns An array of node IDs forming the cycle (first and last element
 *          are identical), or `null` if the graph is acyclic.
 */
export function detectCycle(graph: DAGGraph): string[] | null {
    const colour = new Map<string, number>();

    // Initialise all nodes as WHITE
    for (const id of graph.edges.keys()) {
        colour.set(id, WHITE);
    }

    for (const startId of graph.edges.keys()) {
        if (colour.get(startId) !== WHITE) { continue; }

        // Stack frames: [nodeId, childIndex]
        const stack: [string, number][] = [[startId, 0]];
        colour.set(startId, GREY);

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const current = frame[0];
            const childIndex = frame[1];
            const children = graph.edges.get(current) ?? [];

            if (childIndex >= children.length) {
                // All children processed — backtrack
                colour.set(current, BLACK);
                stack.pop();
                continue;
            }

            // Advance child index for next iteration
            frame[1] = childIndex + 1;

            const child = children[childIndex];
            const childColour = colour.get(child) ?? WHITE;

            if (childColour === GREY) {
                // Back-edge → cycle found. Reconstruct the cycle path.
                const path: string[] = [child];
                for (let i = stack.length - 1; i >= 0; i--) {
                    path.push(stack[i][0]);
                    if (stack[i][0] === child) { break; }
                }
                path.reverse();
                return path;
            }

            if (childColour === WHITE) {
                colour.set(child, GREY);
                stack.push([child, 0]);
            }
        }
    }

    return null;
}

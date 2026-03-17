/**
 * WorkflowResult → Flat Display Adapter
 *
 * Converts the Map-based WorkflowResult into a flat structure suitable for
 * CLI output formatting, SPA display, and VS Code result viewers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WorkflowResult, NodeResult, Items, WorkflowConfig } from './types';

/**
 * Flat execution stats derived from a WorkflowResult.
 */
export interface ExecutionStats {
    totalItems: number;
    successfulMaps: number;
    failedMaps: number;
    totalDurationMs: number;
    mapDurationMs?: number;
    reduceDurationMs?: number;
}

/**
 * Flat per-item result for display.
 */
export interface ItemResult {
    index: number;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    success: boolean;
    error?: string;
    executionTimeMs?: number;
}

/**
 * Flat result shape for consumers that need a simple view of workflow output.
 */
export interface FlatWorkflowResult {
    success: boolean;
    name?: string;
    stats: ExecutionStats;
    items: ItemResult[];
    leafOutput: Record<string, unknown>[];
    formattedOutput?: string;
    error?: string;
}

/**
 * Convert a WorkflowResult into a FlatWorkflowResult.
 *
 * Heuristic:
 * - Map nodes are identified by node type === 'map' (via the config lookup).
 * - Leaf nodes provide the final output.
 * - If no config is supplied, all non-leaf nodes with items containing `__error`
 *   or `__success` fields are treated as map nodes.
 */
export function flattenWorkflowResult(
    result: WorkflowResult,
    config?: WorkflowConfig,
): FlatWorkflowResult {
    let mapNodeResult: NodeResult | undefined;
    let reduceNodeResult: NodeResult | undefined;

    // Identify map and reduce nodes from config
    if (config) {
        for (const [id, node] of Object.entries(config.nodes)) {
            const nr = result.results.get(id);
            if (!nr) { continue; }
            if (node.type === 'map' && !mapNodeResult) {
                mapNodeResult = nr;
            } else if (node.type === 'reduce' && !reduceNodeResult) {
                reduceNodeResult = nr;
            } else if (node.type === 'ai' && !mapNodeResult) {
                // Single-job (ai node) treated like a map with one item
                mapNodeResult = nr;
            }
        }
    }

    // Fallback: pick the largest non-leaf node as "map"
    if (!mapNodeResult) {
        let maxItems = 0;
        for (const [, nr] of result.results) {
            if (!result.leaves.has(nr.nodeId) && nr.items.length > maxItems) {
                maxItems = nr.items.length;
                mapNodeResult = nr;
            }
        }
    }

    // Build item results from map node
    const items: ItemResult[] = [];
    let successfulMaps = 0;
    let failedMaps = 0;

    if (mapNodeResult) {
        for (let i = 0; i < mapNodeResult.items.length; i++) {
            const item = mapNodeResult.items[i];
            const success = item.__error == null;
            if (success) { successfulMaps++; } else { failedMaps++; }
            items.push({
                index: i,
                input: item,
                output: item,
                success,
                error: item.__error as string | undefined,
                executionTimeMs: item.__executionTimeMs as number | undefined,
            });
        }
    }

    // Leaf output
    const leafOutput: Record<string, unknown>[] = [];
    for (const [, nr] of result.leaves) {
        for (const item of nr.items) {
            leafOutput.push(item);
        }
    }

    // Build formatted output from leaf items
    let formattedOutput: string | undefined;
    if (leafOutput.length > 0) {
        formattedOutput = JSON.stringify(leafOutput, null, 2);
    }

    const totalItems = mapNodeResult?.stats.inputCount ?? items.length;

    return {
        success: result.success,
        stats: {
            totalItems,
            successfulMaps,
            failedMaps,
            totalDurationMs: result.totalDurationMs,
            mapDurationMs: mapNodeResult?.stats.durationMs,
            reduceDurationMs: reduceNodeResult?.stats.durationMs,
        },
        items,
        leafOutput,
        formattedOutput,
        error: result.error,
    };
}

/**
 * Build DAG preview data from raw workflow YAML content.
 * Parses the YAML to determine workflow structure and produces
 * renderable graph data for the preview component.
 */

import yaml from 'js-yaml';
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';
import type { DAGChartData, DAGNodeData, DAGNodeState } from '../processes/dag';

// --- Types for workflow DAG preview (multi-node workflows) ---

export interface WorkflowPreviewNode {
    id: string;
    type: string;
    label: string;
    from: string[];
}

export interface WorkflowPreviewEdge {
    from: string;
    to: string;
}

export interface WorkflowPreviewData {
    nodes: WorkflowPreviewNode[];
    edges: WorkflowPreviewEdge[];
    /** Layer assignment for layout: nodeId → layer index (0-based). */
    layers: Map<string, number>;
    maxLayer: number;
}

export type PreviewDAGResult =
    | { type: 'linear'; data: DAGChartData; config: PipelineConfig }
    | { type: 'workflow'; data: WorkflowPreviewData }
    | null;

const previewState: DAGNodeState = 'waiting';

/**
 * Parse YAML content and build a preview DAG suitable for visualization.
 */
export function buildPreviewDAG(yamlContent: string): PreviewDAGResult {
    let config: any;
    try {
        config = yaml.load(yamlContent);
    } catch {
        return null;
    }
    if (!config || typeof config !== 'object') return null;

    // Workflow DAG: has `nodes` record with typed nodes
    if (config.nodes && typeof config.nodes === 'object' && !Array.isArray(config.nodes)) {
        return buildWorkflowPreview(config);
    }

    // Linear workflow: input → filter? → map → reduce?  or  job
    return buildLinearPreview(config);
}

function buildLinearPreview(config: any): PreviewDAGResult {
    const nodes: DAGNodeData[] = [];

    if (config.job || config.prompt) {
        // Simple job workflow
        nodes.push({ phase: 'job', state: previewState, label: 'Job' });
    } else {
        // Map-reduce workflow
        if (config.input) {
            nodes.push({ phase: 'input', state: previewState, label: 'Input' });
        }
        if (config.filter) {
            nodes.push({ phase: 'filter', state: previewState, label: 'Filter' });
        }
        if (config.map) {
            nodes.push({ phase: 'map', state: previewState, label: 'Map' });
        }
        if (config.reduce) {
            nodes.push({ phase: 'reduce', state: previewState, label: 'Reduce' });
        }
    }

    if (nodes.length === 0) return null;
    return { type: 'linear', data: { nodes }, config: config as PipelineConfig };
}

function buildWorkflowPreview(config: any): PreviewDAGResult {
    const rawNodes: Record<string, any> = config.nodes;
    const nodeEntries = Object.entries(rawNodes);
    if (nodeEntries.length === 0) return null;

    const nodes: WorkflowPreviewNode[] = [];
    const edges: WorkflowPreviewEdge[] = [];
    const nodeIds = new Set(nodeEntries.map(([id]) => id));

    for (const [id, nodeCfg] of nodeEntries) {
        const fromRefs: string[] = Array.isArray(nodeCfg.from)
            ? nodeCfg.from.filter((f: any) => typeof f === 'string')
            : typeof nodeCfg.from === 'string' ? [nodeCfg.from] : [];

        const type = nodeCfg.type || 'unknown';
        const label = nodeCfg.label || id;
        nodes.push({ id, type, label, from: fromRefs });

        for (const parentId of fromRefs) {
            if (nodeIds.has(parentId)) {
                edges.push({ from: parentId, to: id });
            }
        }
    }

    // Compute layer assignment via BFS from roots
    const layers = new Map<string, number>();
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const n of nodes) {
        inDegree.set(n.id, 0);
        children.set(n.id, []);
    }
    for (const e of edges) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
        children.get(e.from)?.push(e.to);
    }

    const queue: string[] = [];
    for (const n of nodes) {
        if ((inDegree.get(n.id) ?? 0) === 0) {
            queue.push(n.id);
            layers.set(n.id, 0);
        }
    }

    let maxLayer = 0;
    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        const currentLayer = layers.get(current) ?? 0;
        for (const child of children.get(current) ?? []) {
            const newLayer = currentLayer + 1;
            const existing = layers.get(child);
            if (existing === undefined || newLayer > existing) {
                layers.set(child, newLayer);
                if (newLayer > maxLayer) maxLayer = newLayer;
            }
            const deg = (inDegree.get(child) ?? 1) - 1;
            inDegree.set(child, deg);
            if (deg === 0) {
                queue.push(child);
            }
        }
    }

    // Nodes not reached (cycles) get placed at maxLayer + 1
    for (const n of nodes) {
        if (!layers.has(n.id)) {
            layers.set(n.id, maxLayer + 1);
            maxLayer = maxLayer + 1;
        }
    }

    return { type: 'workflow', data: { nodes, edges, layers, maxLayer } };
}

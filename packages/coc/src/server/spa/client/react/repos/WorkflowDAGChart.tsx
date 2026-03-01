/**
 * WorkflowDAGChart — SVG visualization for multi-node workflow DAGs.
 * Renders nodes in layers (left-to-right) with edges showing data flow.
 */

import { useCallback } from 'react';
import { DAGEdge } from '../processes/dag/DAGEdge';
import { getNodeColors } from '../processes/dag/dag-colors';
import { useZoomPan } from '../hooks/useZoomPan';
import { ZoomControls } from '../processes/dag/ZoomControls';
import type { WorkflowPreviewData } from './buildPreviewDAG';

export interface WorkflowDAGChartProps {
    data: WorkflowPreviewData;
    isDark: boolean;
}

const NODE_W = 120;
const NODE_H = 56;
const GAP_X = 60;
const GAP_Y = 20;
const PADDING = 20;

const nodeTypeIcons: Record<string, string> = {
    load: '📥',
    script: '⚙️',
    filter: '🔍',
    map: '🔄',
    reduce: '📊',
    merge: '🔗',
    transform: '🔧',
    ai: '🤖',
    unknown: '📦',
};

export function WorkflowDAGChart({ data, isDark }: WorkflowDAGChartProps) {
    const { nodes, edges, layers, maxLayer } = data;
    if (nodes.length === 0) return null;

    // Group nodes by layer for vertical stacking
    const layerBuckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const node of nodes) {
        const layer = layers.get(node.id) ?? 0;
        layerBuckets[layer].push(node.id);
    }

    const maxNodesInLayer = Math.max(...layerBuckets.map(b => b.length), 1);

    // Compute positions: x by layer, y by index within layer
    const positions = new Map<string, { x: number; y: number }>();
    for (let layer = 0; layer <= maxLayer; layer++) {
        const bucket = layerBuckets[layer];
        const totalHeight = bucket.length * NODE_H + (bucket.length - 1) * GAP_Y;
        const maxTotalHeight = maxNodesInLayer * NODE_H + (maxNodesInLayer - 1) * GAP_Y;
        const yOffset = PADDING + (maxTotalHeight - totalHeight) / 2;

        for (let i = 0; i < bucket.length; i++) {
            positions.set(bucket[i], {
                x: PADDING + layer * (NODE_W + GAP_X),
                y: yOffset + i * (NODE_H + GAP_Y),
            });
        }
    }

    const totalWidth = 2 * PADDING + (maxLayer + 1) * NODE_W + maxLayer * GAP_X;
    const totalHeight = 2 * PADDING + maxNodesInLayer * NODE_H + (maxNodesInLayer - 1) * GAP_Y;

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const colors = getNodeColors('waiting', isDark);

    const {
        containerRef,
        svgTransform,
        zoomIn, zoomOut, reset, fitToView,
        zoomLabel,
        state: zoomState,
    } = useZoomPan({ contentWidth: totalWidth, contentHeight: totalHeight });

    return (
        <div
            ref={containerRef}
            data-testid="workflow-dag-container"
            style={{
                position: 'relative',
                overflow: 'hidden',
                maxHeight: 300,
                cursor: zoomState.isDragging ? 'grabbing' : 'grab',
            }}
        >
        <svg
            data-testid="workflow-dag-chart"
            className="w-full"
            viewBox={`0 0 ${totalWidth} ${totalHeight}`}
            preserveAspectRatio="xMidYMid meet"
        >
            <g transform={svgTransform}>
            {/* Edges */}
            {edges.map((edge, i) => {
                const fromPos = positions.get(edge.from);
                const toPos = positions.get(edge.to);
                if (!fromPos || !toPos) return null;
                return (
                    <DAGEdge
                        key={`edge-${i}`}
                        fromX={fromPos.x + NODE_W}
                        fromY={fromPos.y + NODE_H / 2}
                        toX={toPos.x}
                        toY={toPos.y + NODE_H / 2}
                        state="waiting"
                        isDark={isDark}
                    />
                );
            })}

            {/* Nodes */}
            {nodes.map(node => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                const icon = nodeTypeIcons[node.type] ?? nodeTypeIcons.unknown;
                return (
                    <g key={node.id} data-testid={`workflow-node-${node.id}`}>
                        <title>{`${node.label} (${node.type})`}</title>
                        <rect
                            x={pos.x}
                            y={pos.y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={6}
                            fill={colors.fill}
                            stroke={colors.border}
                            strokeWidth={1.5}
                        />
                        <text
                            x={pos.x + NODE_W / 2}
                            y={pos.y + 24}
                            textAnchor="middle"
                            fill={isDark ? '#cccccc' : '#1e1e1e'}
                            fontSize={11}
                            fontFamily="system-ui, sans-serif"
                        >
                            {icon} {node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label}
                        </text>
                        <text
                            x={pos.x + NODE_W / 2}
                            y={pos.y + 40}
                            textAnchor="middle"
                            fill="#848484"
                            fontSize={9}
                            fontFamily="system-ui, sans-serif"
                        >
                            {node.type}
                        </text>
                    </g>
                );
            })}
            </g>
        </svg>
        <ZoomControls
            zoomLabel={zoomLabel}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={reset}
            onFitToView={fitToView}
        />
        </div>
    );
}

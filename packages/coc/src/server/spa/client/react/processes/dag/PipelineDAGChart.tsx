import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';
import type { DAGChartData } from './types';
import { DAGNode } from './DAGNode';
import { DAGEdge } from './DAGEdge';
import { DAGProgressBar } from './DAGProgressBar';
import type { EdgeState } from './dag-colors';

export interface PipelineDAGChartProps {
    data: DAGChartData;
    isDark: boolean;
    onNodeClick?: (phase: PipelinePhase) => void;
}

const NODE_W = 120;
const NODE_H = 70;
const GAP_X = 60;
const PADDING = 20;

function deriveEdgeState(fromState: string, toState: string): EdgeState {
    if (fromState === 'failed') return 'error';
    if (fromState === 'completed' && toState !== 'waiting') return 'completed';
    if (fromState === 'running' || toState === 'running') return 'active';
    return 'waiting';
}

export function PipelineDAGChart({ data, isDark, onNodeClick }: PipelineDAGChartProps) {
    const nodeCount = data.nodes.length;
    if (nodeCount === 0) return null;

    const totalWidth = 2 * PADDING + nodeCount * NODE_W + (nodeCount - 1) * GAP_X;
    const totalHeight = 2 * PADDING + NODE_H + 20; // extra for progress bar

    const positions = data.nodes.map((_, i) => ({
        x: PADDING + i * (NODE_W + GAP_X),
        y: PADDING,
    }));

    const mapNode = data.nodes.find(n => n.phase === 'map');

    return (
        <svg
            data-testid="dag-chart"
            className="w-full"
            style={{ maxHeight: 200 }}
            viewBox={`0 0 ${totalWidth} ${totalHeight}`}
            preserveAspectRatio="xMidYMid meet"
        >
            <defs>
                <style>{`
                    @keyframes dag-edge-dash {
                        to { stroke-dashoffset: -20; }
                    }
                `}</style>
            </defs>

            {/* Edges */}
            {data.nodes.map((node, i) => {
                if (i === 0) return null;
                const prev = data.nodes[i - 1];
                const fromPos = positions[i - 1];
                const toPos = positions[i];
                return (
                    <DAGEdge
                        key={`edge-${prev.phase}-${node.phase}`}
                        fromX={fromPos.x + NODE_W}
                        fromY={fromPos.y + NODE_H / 2}
                        toX={toPos.x}
                        toY={toPos.y + NODE_H / 2}
                        state={deriveEdgeState(prev.state, node.state)}
                        isDark={isDark}
                    />
                );
            })}

            {/* Nodes */}
            {data.nodes.map((node, i) => (
                <DAGNode
                    key={node.phase}
                    node={node}
                    x={positions[i].x}
                    y={positions[i].y}
                    isDark={isDark}
                    onClick={onNodeClick}
                />
            ))}

            {/* Progress bar for map node */}
            {mapNode && mapNode.totalItems != null && mapNode.totalItems > 0 && (() => {
                const mapIdx = data.nodes.findIndex(n => n.phase === 'map');
                if (mapIdx < 0) return null;
                const pos = positions[mapIdx];
                const successCount = (mapNode.totalItems ?? 0) - (mapNode.failedItems ?? 0);
                return (
                    <g transform={`translate(${pos.x}, ${pos.y + NODE_H + 4})`}>
                        <DAGProgressBar
                            successCount={successCount}
                            failedCount={mapNode.failedItems ?? 0}
                            totalCount={mapNode.totalItems}
                            width={NODE_W}
                        />
                    </g>
                );
            })()}
        </svg>
    );
}

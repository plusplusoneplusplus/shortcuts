import { getEdgeColor } from './dag-colors';
import type { EdgeState } from './dag-colors';

export interface DAGEdgeProps {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    state: EdgeState;
    isDark: boolean;
}

export function DAGEdge({ fromX, fromY, toX, toY, state, isDark }: DAGEdgeProps) {
    const color = getEdgeColor(state, isDark);
    const markerId = `arrowhead-${state}`;
    const dashed = state === 'waiting' || state === 'active' || state === 'error';
    const animated = state === 'active';

    return (
        <g data-testid="dag-edge">
            <defs>
                <marker
                    id={markerId}
                    markerWidth="8"
                    markerHeight="6"
                    refX="8"
                    refY="3"
                    orient="auto"
                >
                    <polygon points="0 0, 8 3, 0 6" fill={color} />
                </marker>
            </defs>
            <path
                d={`M ${fromX} ${fromY} L ${toX} ${toY}`}
                stroke={color}
                strokeWidth={2}
                fill="none"
                markerEnd={`url(#${markerId})`}
                strokeDasharray={dashed ? '6 4' : undefined}
                style={animated ? { animation: 'dag-edge-dash 1s linear infinite' } : undefined}
            />
        </g>
    );
}

import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';
import type { DAGNodeData } from './types';
import { getNodeColors, getNodeIcon } from './dag-colors';
import { formatDuration } from '../../utils/format';
import { cn } from '../../shared/cn';

export interface DAGNodeProps {
    node: DAGNodeData;
    x: number;
    y: number;
    isDark: boolean;
    onClick?: (phase: PipelinePhase) => void;
    onMouseEnter?: (phase: PipelinePhase) => void;
    onMouseLeave?: (phase: PipelinePhase) => void;
    elapsedMs?: number;
    selected?: boolean;
    parallelCount?: number;
}

export function DAGNode({ node, x, y, isDark, onClick, onMouseEnter, onMouseLeave, elapsedMs, selected, parallelCount }: DAGNodeProps) {
    const colors = getNodeColors(node.state, isDark);
    const icon = getNodeIcon(node.state);
    const hasClick = typeof onClick === 'function';

    const itemText = node.totalItems != null
        ? node.failedItems != null && node.failedItems > 0
            ? `${(node.totalItems - node.failedItems)}/${node.totalItems} items`
            : `${node.totalItems} items`
        : node.itemCount != null
            ? `${node.itemCount} items`
            : null;

    const durationText = node.durationMs != null ? formatDuration(node.durationMs) : null;
    const elapsedText = node.state === 'running' && elapsedMs != null ? formatDuration(elapsedMs) : null;
    const tooltipText = `${node.label} — ${node.state}${durationText ? ` (${durationText})` : ''}${itemText ? ` • ${itemText}` : ''}`;

    const strokeColor = selected
        ? (isDark ? '#3794ff' : '#0078d4')
        : colors.border;

    return (
        <g
            data-testid={`dag-node-${node.phase}`}
            onClick={hasClick ? () => onClick(node.phase) : undefined}
            onMouseEnter={onMouseEnter ? () => onMouseEnter(node.phase) : undefined}
            onMouseLeave={onMouseLeave ? () => onMouseLeave(node.phase) : undefined}
            style={hasClick ? { cursor: 'pointer' } : undefined}
        >
            <title>{tooltipText}</title>
            {parallelCount != null && parallelCount > 1 && (
                <>
                    <rect
                        x={x + 6}
                        y={y - 6}
                        width={120}
                        height={70}
                        rx={6}
                        fill={colors.fill}
                        stroke={colors.border}
                        strokeWidth={1.5}
                        opacity={0.2}
                    />
                    <rect
                        x={x + 3}
                        y={y - 3}
                        width={120}
                        height={70}
                        rx={6}
                        fill={colors.fill}
                        stroke={colors.border}
                        strokeWidth={1.5}
                        opacity={0.4}
                    />
                </>
            )}
            <rect
                x={x}
                y={y}
                width={120}
                height={70}
                rx={6}
                fill={colors.fill}
                stroke={strokeColor}
                strokeWidth={selected ? 2.5 : 1.5}
                className={cn(node.state === 'running' && 'animate-pulse')}
                style={{
                    transition: 'fill 300ms ease, stroke 300ms ease',
                }}
            />
            <text
                x={x + 60}
                y={y + 28}
                textAnchor="middle"
                fill={colors.text}
                fontSize={12}
                fontFamily="system-ui, sans-serif"
            >
                {icon} {node.label}
            </text>
            {itemText && (
                <text
                    x={x + 60}
                    y={y + 44}
                    textAnchor="middle"
                    fill="#848484"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                >
                    {itemText}
                </text>
            )}
            {durationText && (
                <text
                    x={x + 60}
                    y={y + (itemText ? 58 : 44)}
                    textAnchor="middle"
                    fill="#848484"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                >
                    {durationText}
                </text>
            )}
            {elapsedText && !durationText && (
                <text
                    data-testid={`dag-node-elapsed-${node.phase}`}
                    x={x + 60}
                    y={y + (itemText ? 58 : 44)}
                    textAnchor="middle"
                    fill="#848484"
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                >
                    {elapsedText}
                </text>
            )}
            {parallelCount != null && parallelCount > 1 && (
                <>
                    <rect
                        x={x + 120 - 24}
                        y={y - 6}
                        width={24}
                        height={14}
                        rx={7}
                        fill={colors.border}
                    />
                    <text
                        data-testid={`dag-parallel-badge-${node.phase}`}
                        x={x + 120 - 12}
                        y={y + 4}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#fff"
                        fontFamily="system-ui, sans-serif"
                    >
                        ×{parallelCount}
                    </text>
                </>
            )}
        </g>
    );
}

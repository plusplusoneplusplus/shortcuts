export interface DAGErrorPinProps {
    /** Absolute X of the node's top-right corner (node x + NODE_W) */
    x: number;
    /** Absolute Y of the node's top edge (node y) */
    y: number;
    /** Error messages to display */
    errors: string[];
    /** Dark mode flag */
    isDark: boolean;
}

export function DAGErrorPin({ x, y, errors, isDark }: DAGErrorPinProps): JSX.Element | null {
    if (errors.length === 0) return null;

    const cx = x - 4;
    const cy = y - 4;
    const fillColor = isDark ? '#f48771' : '#f14c4c';
    const label = errors.length === 1 ? '!' : errors.length.toString();
    const fontSize = errors.length === 1 ? 10 : 9;

    return (
        <g data-testid="dag-error-pin">
            <title>{errors.join('\n')}</title>
            <circle
                cx={cx}
                cy={cy}
                r={8}
                fill={fillColor}
                stroke="#fff"
                strokeWidth={1.5}
            />
            <text
                x={cx}
                y={cy + 3.5}
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight="bold"
                fill="#fff"
                fontFamily="system-ui, sans-serif"
            >
                {label}
            </text>
        </g>
    );
}

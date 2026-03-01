import { useState } from 'react';

export interface DAGEdgeLabelProps {
    /** Center X of the label (edge midpoint) */
    x: number;
    /** Center Y of the label (edge midpoint) */
    y: number;
    /** Short text for the pill badge, e.g. "150 rows" or "[category, summary]" */
    badgeText: string;
    /** Full schema text for hover tooltip (optional) */
    tooltipText?: string;
    isDark: boolean;
}

export function DAGEdgeLabel({ x, y, badgeText, tooltipText, isDark }: DAGEdgeLabelProps) {
    const [hovered, setHovered] = useState(false);

    const bgColor = isDark ? '#2d2d2d' : '#f3f3f3';
    const borderColor = isDark ? '#3c3c3c' : '#e0e0e0';
    const textColor = isDark ? '#cccccc' : '#616161';

    // Approximate badge width: ~6px per character + 16px padding
    const badgeWidth = Math.max(badgeText.length * 6 + 16, 40);
    const badgeHeight = 18;

    return (
        <g
            data-testid="dag-edge-label"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ cursor: tooltipText ? 'help' : 'default' }}
        >
            {/* Badge pill background */}
            <rect
                x={x - badgeWidth / 2}
                y={y - badgeHeight / 2}
                width={badgeWidth}
                height={badgeHeight}
                rx={9}
                fill={bgColor}
                stroke={borderColor}
                strokeWidth={1}
            />
            {/* Badge text */}
            <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill={textColor}
                fontSize={9}
                fontFamily="system-ui, sans-serif"
            >
                {badgeText}
            </text>
            {/* SVG <title> for native tooltip — simple, accessible */}
            {tooltipText && <title>{tooltipText}</title>}

            {/* HTML tooltip for richer hover display */}
            {hovered && tooltipText && (
                <foreignObject
                    x={x - 140}
                    y={y + badgeHeight / 2 + 4}
                    width={280}
                    height={80}
                    style={{ overflow: 'visible' }}
                >
                    <div
                        data-testid="dag-edge-tooltip"
                        style={{
                            background: isDark ? '#1e1e1e' : '#ffffff',
                            border: `1px solid ${borderColor}`,
                            borderRadius: 4,
                            padding: '6px 8px',
                            fontSize: 10,
                            fontFamily: 'system-ui, sans-serif',
                            color: isDark ? '#cccccc' : '#1e1e1e',
                            whiteSpace: 'pre-wrap',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                            maxWidth: 280,
                        }}
                    >
                        {tooltipText}
                    </div>
                </foreignObject>
            )}
        </g>
    );
}

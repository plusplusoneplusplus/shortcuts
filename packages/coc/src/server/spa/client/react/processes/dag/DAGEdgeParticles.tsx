export interface DAGEdgeParticlesProps {
    pathD: string;           // SVG path d-attribute (same path as the edge line)
    color: string;           // particle fill color (matches edge active color)
    particleCount: number;   // number of simultaneous particles (1–5)
    durationMs: number;      // time for one particle to traverse the full path
}

export function DAGEdgeParticles({ pathD, color, particleCount, durationMs }: DAGEdgeParticlesProps) {
    return (
        <g data-testid="dag-edge-particles">
            {Array.from({ length: particleCount }, (_, i) => (
                <circle
                    key={i}
                    r={3}
                    fill={color}
                    opacity={0.85}
                >
                    <animateMotion
                        path={pathD}
                        dur={`${durationMs}ms`}
                        repeatCount="indefinite"
                        begin={`${Math.round((i / particleCount) * durationMs)}ms`}
                    />
                </circle>
            ))}
        </g>
    );
}

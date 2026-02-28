export interface DAGProgressBarProps {
    successCount: number;
    failedCount: number;
    totalCount: number;
    width: number;
}

export function DAGProgressBar({ successCount, failedCount, totalCount, width }: DAGProgressBarProps) {
    if (totalCount === 0) return null;

    const successWidth = (successCount / totalCount) * width;
    const failedWidth = (failedCount / totalCount) * width;

    return (
        <g data-testid="dag-progress-bar">
            {/* Background */}
            <rect width={width} height={4} rx={2} fill="#e0e0e0" />
            {/* Success portion */}
            {successWidth > 0 && (
                <rect
                    width={successWidth}
                    height={4}
                    rx={2}
                    fill="#0078d4"
                    style={{ transition: 'width 0.3s ease' }}
                />
            )}
            {/* Failed portion */}
            {failedWidth > 0 && (
                <rect
                    x={successWidth}
                    width={failedWidth}
                    height={4}
                    rx={2}
                    fill="#f14c4c"
                    style={{ transition: 'width 0.3s ease' }}
                />
            )}
        </g>
    );
}

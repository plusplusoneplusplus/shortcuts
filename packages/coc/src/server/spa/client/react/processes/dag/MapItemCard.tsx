import { cn } from '../../shared/cn';
import { statusIcon, formatDuration } from '../../utils/format';
import { getNodeColors } from './dag-colors';
import type { DAGNodeState } from './types';

export interface MapItemCardProps {
    process: {
        processId: string;
        itemIndex: number;
        status: string;
        promptPreview?: string;
        durationMs?: number;
        error?: string;
    };
    onClick: () => void;
    isDark?: boolean;
}

function statusToNodeState(status: string): DAGNodeState {
    if (status === 'running') return 'running';
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    return 'waiting';
}

export function MapItemCard({ process, onClick, isDark = false }: MapItemCardProps) {
    const nodeState = statusToNodeState(process.status);
    const colors = getNodeColors(nodeState, isDark);
    const isRunning = process.status === 'running';
    const icon = statusIcon(process.status);
    const duration = process.durationMs != null ? formatDuration(process.durationMs) : null;
    const preview = process.promptPreview
        ? process.promptPreview.length > 80
            ? process.promptPreview.slice(0, 80) + '…'
            : process.promptPreview
        : null;

    return (
        <div
            data-testid={`map-item-card-${process.processId}`}
            className={cn(
                'flex flex-col gap-1 p-3 rounded-md border cursor-pointer',
                isRunning && 'animate-pulse',
            )}
            style={{ borderColor: colors.border, backgroundColor: colors.fill }}
            onClick={onClick}
        >
            <div className="flex items-center gap-2 text-sm font-medium">
                <span>{icon}</span>
                <span>Item {process.itemIndex}</span>
            </div>
            {preview && (
                <div className="text-xs text-[#848484] truncate" title={process.promptPreview}>
                    {preview}
                </div>
            )}
            <div className="flex items-center gap-2 text-xs text-[#848484]">
                {duration && <span>{duration}</span>}
                {process.error && (
                    <span
                        className="text-[#f14c4c] font-medium"
                        data-testid={`map-item-error-${process.processId}`}
                    >
                        Error
                    </span>
                )}
            </div>
        </div>
    );
}

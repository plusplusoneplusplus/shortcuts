import { cn } from '../../ui';
import type { AttentionGroup, AttentionGroupConfig } from './pr-attention-groups';

export interface AttentionGroupCount {
    config: AttentionGroupConfig;
    count: number;
}

interface AttentionSummaryBarProps {
    groups: AttentionGroupCount[];
    onChipClick: (group: AttentionGroup) => void;
}

export function AttentionSummaryBar({ groups, onChipClick }: AttentionSummaryBarProps) {
    return (
        <div
            className="sticky top-0 z-20 flex gap-2 overflow-x-auto border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900"
            data-testid="attention-summary-bar"
        >
            {groups.map(({ config, count }) => (
                <button
                    key={config.group}
                    type="button"
                    className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                        count === 0 && 'opacity-50',
                    )}
                    onClick={() => onChipClick(config.group)}
                    data-testid={`attention-summary-chip-${config.group}`}
                >
                    <span aria-hidden="true">{config.icon}</span>
                    <span>{config.label}</span>
                    <span className={cn('rounded-full px-1.5 py-0.5', config.color)}>{count}</span>
                </button>
            ))}
        </div>
    );
}

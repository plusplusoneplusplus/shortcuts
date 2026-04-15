/**
 * HistoryGroupHeader — collapsible header for plan-file task groups.
 *
 * Renders a card with chain icon, plan file basename, aggregate status,
 * expand/collapse chevron, and relative timestamp.
 */

import { Card, cn } from '../shared';
import { formatRelativeTime } from '../utils/format';
import type { HistoryGroup } from './history-grouping';

interface HistoryGroupHeaderProps {
    group: HistoryGroup;
    isExpanded: boolean;
    onToggle: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    isDense: boolean;
}

const STATUS_ICON: Record<string, string> = {
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
};

export function HistoryGroupHeader({ group, isExpanded, onToggle, onContextMenu, isDense }: HistoryGroupHeaderProps) {
    const statusIcon = STATUS_ICON[group.aggregateStatus] ?? '';
    const chevron = isExpanded ? '▾' : '▸';
    const timestamp = group.latestTimestamp
        ? formatRelativeTime(new Date(group.latestTimestamp).toISOString())
        : '';

    const completedCount = group.children.filter(c => c.status === 'completed').length;
    const failedCount = group.children.filter(c => c.status === 'failed').length;
    const cancelledCount = group.children.filter(c => c.status === 'cancelled').length;

    const parts: string[] = [];
    if (completedCount > 0) parts.push(`${completedCount} completed`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
    const summaryText = `${group.children.length} tasks${parts.length > 0 ? ' · ' + parts.join(', ') : ''}`;

    return (
        <Card
            className={cn(
                isDense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer",
                "bg-gray-50 dark:bg-gray-800/50",
            )}
            onClick={onToggle}
            onContextMenu={onContextMenu}
            data-testid="history-group-header"
            data-plan-file={group.planFilePath}
        >
            <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                <span className="flex items-center gap-1 min-w-0 truncate">
                    {group.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid="group-unseen-dot"
                        />
                    )}
                    <span className="shrink-0">🔗</span>
                    <span className={cn("truncate", group.hasUnseen && "font-semibold")} title={group.planFilePath}>
                        {group.label}
                    </span>
                    <span className="shrink-0">{statusIcon}</span>
                    <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#bbb]">{chevron}</span>
                </span>
                <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                    {timestamp}
                </span>
            </div>
            {!isDense && (
                <div className="text-[10px] mt-0.5 text-[#848484] dark:text-[#bbb]">
                    {summaryText}
                </div>
            )}
        </Card>
    );
}

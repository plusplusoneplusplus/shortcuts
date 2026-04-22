/**
 * HistoryGroupHeader — collapsible header for plan-file task groups.
 *
 * Visually distinct from regular task cards via a colored left accent
 * border, leading chevron, and always-visible count badge.
 */

import { cn } from '../../../shared';
import { formatRelativeTime } from '../../../utils/format';
import type { HistoryGroup } from '../history-grouping';

interface HistoryGroupHeaderProps {
    group: HistoryGroup;
    isExpanded: boolean;
    isSelected?: boolean;
    onToggle: () => void;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    isDense: boolean;
}

/** Left-border accent color by aggregate status. */
const ACCENT_COLOR: Record<string, string> = {
    completed: 'border-l-emerald-500 dark:border-l-emerald-400',
    failed: 'border-l-red-500 dark:border-l-red-400',
    cancelled: 'border-l-amber-500 dark:border-l-amber-400',
};

/** Count badge bg by aggregate status. */
const BADGE_BG: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export function HistoryGroupHeader({ group, isExpanded, isSelected, onToggle, onClick, onContextMenu, isDense }: HistoryGroupHeaderProps) {
    const chevron = isExpanded ? '▾' : '▸';
    const timestamp = group.latestTimestamp
        ? formatRelativeTime(new Date(group.latestTimestamp).toISOString())
        : '';

    const failedCount = group.children.filter(c => c.status === 'failed').length;
    const cancelledCount = group.children.filter(c => c.status === 'cancelled').length;

    // Compact badge text: "3 tasks" or "3 tasks · 1 failed"
    const badgeParts = [`${group.children.length}`];
    if (failedCount > 0) badgeParts.push(`${failedCount} ❌`);
    else if (cancelledCount > 0) badgeParts.push(`${cancelledCount} 🚫`);
    const badgeText = badgeParts.join(' · ');

    return (
        <div
            className={cn(
                "rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] border-l-[3px] cursor-pointer",
                isSelected
                    ? "bg-[#0078d4]/10 dark:bg-[#3794ff]/10 outline outline-1 outline-[#0078d4]/40 dark:outline-[#3794ff]/40"
                    : "bg-[#f5f5f5] dark:bg-[#2a2a2a] hover:bg-[#eaeaea] dark:hover:bg-[#333]",
                "transition-colors",
                isDense ? "px-2 py-1.5" : "px-2.5 py-2",
                ACCENT_COLOR[group.aggregateStatus] ?? ACCENT_COLOR.completed,
            )}
            onClick={onClick ?? onToggle}
            onContextMenu={onContextMenu}
            data-testid="history-group-header"
            data-plan-file={group.planFilePath}
            data-selected={isSelected || undefined}
        >
            <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                    {/* Chevron — dedicated collapse/expand target */}
                    <button
                        type="button"
                        className="shrink-0 text-[10px] text-[#848484] dark:text-[#999] w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10"
                        onClick={e => { e.stopPropagation(); onToggle(); }}
                        data-testid="group-chevron"
                        aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
                    >
                        {chevron}
                    </button>
                    {isSelected && <span className="shrink-0 text-[#0078d4] dark:text-[#3794ff] text-[10px]" data-testid="group-selection-checkbox">☑</span>}
                    {group.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid="group-unseen-dot"
                        />
                    )}
                    <span className={cn("truncate", group.hasUnseen && "font-semibold")} title={group.planFilePath}>
                        {group.label}
                    </span>
                    {/* Always-visible count badge */}
                    <span className={cn(
                        "shrink-0 text-[10px] font-medium px-1.5 py-px rounded-full",
                        BADGE_BG[group.aggregateStatus] ?? BADGE_BG.completed,
                    )}>
                        {badgeText}
                    </span>
                </span>
                <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                    {timestamp}
                </span>
            </div>
        </div>
    );
}

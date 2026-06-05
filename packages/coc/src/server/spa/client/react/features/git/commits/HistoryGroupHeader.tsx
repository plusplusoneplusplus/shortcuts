/**
 * HistoryGroupHeader — collapsible header for plan-file task groups.
 *
 * Renders as a compact one-line row matching the activity-compact reference's
 * `.row.has-children` style: status dot + mode pill + title (with rotating
 * chevron) + relative time, in the same `[10px_36px_minmax(0,1fr)_auto]`
 * grid as `renderChatListRow`. The mode pill collapses children's modes:
 * if every child shares the same mode the parent shows that mode
 * (ASK/AUTO/SCRP); when they differ a neutral "MIX" pill is shown with the
 * per-mode breakdown surfaced as a tooltip.
 */

import { cn } from '../../../ui';
import { formatRelativeTime } from '../../../utils/format';
import type { HistoryGroup } from '../history-grouping';
import type { ProcessHistoryItem } from '../../../types/dashboard';
import { normalizeChatMode } from '../../../repos/modeConfig';

/** Group-level mode pill key. `'mixed'` is used when children disagree. */
export type GroupAggregateMode = 'ask' | 'auto' | 'script' | 'mixed';

interface HistoryGroupHeaderProps {
    group: HistoryGroup;
    isExpanded: boolean;
    isSelected?: boolean;
    isUnseen?: boolean;
    /** Pre-computed aggregate mode (uniform child mode, else 'mixed'). */
    aggregateMode: GroupAggregateMode;
    onToggle: () => void;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    /** Reserved for future density variants — currently unused. */
    isDense?: boolean;
}

/** Map a child item's `mode` / `payload.mode` / `type` to the same 4 keys
 *  used elsewhere in the activity list. Mirrors `getTaskModeKey` in
 *  `ChatListPane.tsx` but takes a `ProcessHistoryItem`. */
function childModeKey(item: ProcessHistoryItem): 'ask' | 'auto' | 'script' {
    if (item.type === 'run-script') return 'script';
    if (item.type === 'chat') {
        if (normalizeChatMode(item.mode) === 'ask') return 'ask';
        return 'auto';
    }
    return 'auto';
}

/** Compute the aggregate mode from a group's children. */
export function computeAggregateMode(children: ProcessHistoryItem[]): GroupAggregateMode {
    if (children.length === 0) return 'auto';
    const first = childModeKey(children[0]);
    for (let i = 1; i < children.length; i++) {
        if (childModeKey(children[i]) !== first) return 'mixed';
    }
    return first;
}

const MODE_LABEL: Record<GroupAggregateMode, string> = {
    ask: 'A',
    auto: 'A',
    script: 'S',
    mixed: 'M',
};

const STATUS_DOT_CLASSES: Record<HistoryGroup['aggregateStatus'], string> = {
    completed: 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
    failed: 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.20)]',
    cancelled: 'bg-amber-500',
};

/** Build the mode-pill tooltip. For `mixed` it surfaces the breakdown. */
function buildModeTooltip(aggregateMode: GroupAggregateMode, children: ProcessHistoryItem[]): string {
    if (aggregateMode !== 'mixed') {
        const labels: Record<Exclude<GroupAggregateMode, 'mixed'>, string> = {
            ask: 'Ask · read-only Q&A',
            auto: 'Autopilot · executes edits',
            script: 'Script · scheduled automation',
        };
        return labels[aggregateMode];
    }
    const counts: Record<string, number> = {};
    for (const c of children) {
        const k = childModeKey(c).toUpperCase();
        counts[k] = (counts[k] ?? 0) + 1;
    }
    const breakdown = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => `${count} ${label}`)
        .join(' · ');
    return `Mixed modes: ${breakdown}`;
}

export function HistoryGroupHeader({
    group,
    isExpanded,
    isSelected,
    isUnseen,
    aggregateMode,
    onToggle,
    onClick,
    onContextMenu,
}: HistoryGroupHeaderProps) {
    const timestamp = group.latestTimestamp
        ? formatRelativeTime(new Date(group.latestTimestamp).toISOString())
        : '';

    const failedCount = group.children.filter(c => c.status === 'failed').length;
    const cancelledCount = group.children.filter(c => c.status === 'cancelled').length;
    const dotColor = STATUS_DOT_CLASSES[group.aggregateStatus] ?? STATUS_DOT_CLASSES.completed;

    const modeBadgeClasses = cn(
        'inline-flex items-center justify-center border font-mono font-bold uppercase select-none',
        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
        aggregateMode === 'ask' ? 'rounded-full' : 'rounded-[3px]',
        aggregateMode === 'ask' && 'text-amber-600 dark:text-amber-400 border-amber-400/70 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-500/10',
        aggregateMode === 'auto' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/70 dark:border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10',
        aggregateMode === 'script' && 'text-[#1e1e1e] dark:text-[#dcdcdc] border-[#3c3c3c]/55 dark:border-[#9d9d9d]/45 bg-[#1e1e1e]/[0.06] dark:bg-[#dcdcdc]/[0.06]',
        aggregateMode === 'mixed' && 'text-[#848484] dark:text-[#a0a0a0] border-[#9d9d9d]/55 dark:border-[#7d7d7d]/55 bg-[#9d9d9d]/[0.07] dark:bg-[#7d7d7d]/10',
    );

    return (
        <div
            className={cn(
                'chat-row group relative cursor-pointer leading-none transition-colors',
                'grid items-center gap-2 px-3 py-1',
                'grid-cols-[10px_30px_minmax(0,1fr)_auto]',
                'text-[12.5px] h-[26px]',
                'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
                'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
                isSelected && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 outline outline-1 outline-[#0078d4]/40 dark:outline-[#3794ff]/40',
            )}
            onClick={onClick ?? onToggle}
            onContextMenu={onContextMenu}
            data-testid="history-group-header"
            data-plan-file={group.planFilePath}
            data-aggregate-mode={aggregateMode}
            data-aggregate-status={group.aggregateStatus}
            data-expanded={isExpanded ? 'true' : 'false'}
            data-selected={isSelected || undefined}
            data-unseen={isUnseen || undefined}
            title={group.planFilePath}
        >
            <span
                className={cn('w-2 h-2 rounded-full justify-self-center', dotColor)}
                aria-label={`status: ${group.aggregateStatus}`}
            />
            <span className={modeBadgeClasses} title={buildModeTooltip(aggregateMode, group.children)}>
                {MODE_LABEL[aggregateMode]}
            </span>
            <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                {/* Chevron — also a stand-alone toggle target so chevron-only clicks
                    don't bubble to row-level click handlers (e.g. shift-range select). */}
                <button
                    type="button"
                    className={cn(
                        'shrink-0 inline-flex items-center justify-center w-4 h-4 -ml-1 rounded',
                        'text-[#848484] dark:text-[#a0a0a0] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                        'transition-transform',
                        isExpanded && 'rotate-90',
                    )}
                    onClick={e => { e.stopPropagation(); onToggle(); }}
                    data-testid="group-chevron"
                    aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
                    aria-expanded={isExpanded}
                >
                    <span className="text-[12px] leading-none" aria-hidden="true">›</span>
                </button>
                {isUnseen && (
                    <span
                        className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                        data-testid="group-unseen-dot"
                    />
                )}
                <span
                    className={cn(
                        'chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]',
                        isUnseen && 'font-semibold',
                    )}
                >
                    {group.label}
                </span>
                <span
                    className="shrink-0 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                    data-testid="group-child-count"
                >
                    {group.children.length}
                </span>
                {failedCount > 0 && (
                    <span
                        className="shrink-0 text-[10px] font-medium text-red-500 dark:text-red-400"
                        data-testid="group-failed-count"
                        title={`${failedCount} failed`}
                    >
                        {failedCount}❌
                    </span>
                )}
                {failedCount === 0 && cancelledCount > 0 && (
                    <span
                        className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                        data-testid="group-cancelled-count"
                        title={`${cancelledCount} cancelled`}
                    >
                        {cancelledCount}🚫
                    </span>
                )}
            </span>
            <span className="flex items-center gap-1 text-[#848484] dark:text-[#999]">
                <span className="text-[10.5px] font-mono tabular-nums whitespace-nowrap">
                    {timestamp}
                </span>
            </span>
        </div>
    );
}

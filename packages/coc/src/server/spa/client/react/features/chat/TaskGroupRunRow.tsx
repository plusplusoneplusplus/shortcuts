import type React from 'react';
import { useState } from 'react';
import { cn } from '../../ui/cn';
import { formatRelativeTime } from '../../utils/format';

/**
 * TaskGroupRunRow — shared parent-row chrome for hierarchical task groups in
 * the chat list (For Each runs, Map Reduce runs, future group types).
 *
 * Feature row components stay as thin wrappers that derive the display
 * config from their group data; all layout, expansion, pin/more affordances,
 * and child rendering live here once.
 */

export interface TaskGroupRunRowDisplay {
    /** DOM test-id prefix (e.g. 'for-each-run'). */
    testIdPrefix: string;
    /** Parent-row label (e.g. 'For Each'). */
    label: string;
    /** Compact mono badge text (e.g. 'FE'). */
    badge: string;
    /** Noun used in tooltips/ARIA copy (e.g. 'For Each run'). */
    groupNoun: string;
    /** Badge tooltip. Defaults to `groupNoun`. */
    badgeTitle?: string;
    /** Accent classes for the badge chip. */
    badgeClassName: string;
    /** Ring classes applied when the row is selected. */
    selectedRingClassName: string;
    /** Resolved status-dot classes for the group's current status. */
    statusDotClassName: string;
    /** Human-readable status (for the dot's ARIA label). */
    statusLabel: string;
    /** Full status-dot ARIA label. Defaults to `status: ${statusLabel}`. */
    statusAriaLabel?: string;
    /** Raw status value (exposed via `statusAttributeName`). */
    status: string;
    /** Body attribute carrying the raw status. Defaults to 'data-run-status'. */
    statusAttributeName?: string;
    /** Root attribute carrying the group id. Defaults to 'data-run-id'. */
    groupIdAttributeName?: string;
    /** Compact per-item status summary text. Omit to skip the summary span. */
    summary?: string;
    /** Accent + sizing classes for the summary text. */
    summaryClassName?: string;
    /** Title preview shown after the label. */
    title: string;
    /** Optional test id for the title span. */
    titleTestId?: string;
    /** Optional tooltip for the title span. */
    titleTooltip?: string;
    /** Optional ARIA label for the title span. */
    titleAriaLabel?: string;
    /** Chevron ARIA labels. Default to `Collapse/Expand ${groupNoun}`. */
    collapseAriaLabel?: string;
    expandAriaLabel?: string;
    /** Copy shown when the group has no child chats. Omit to render nothing. */
    emptyChildrenText?: string;
}

export interface TaskGroupRunRowGroup {
    runId: string;
    children: any[];
    latestTimestamp: number;
    hasUnseen: boolean;
}

export interface TaskGroupRunRowProps {
    group: TaskGroupRunRowGroup;
    display: TaskGroupRunRowDisplay;
    selectedRunId?: string | null;
    isRangeSelected?: boolean;
    expanded?: boolean;
    onToggleExpanded?: () => void;
    now: number;
    onSelectRun?: (runId: string, event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onTouchStart?: (e: React.TouchEvent) => void;
    onTouchEnd?: (e: React.TouchEvent) => void;
    onTouchMove?: (e: React.TouchEvent) => void;
    /** Parent-row pin state and actions. This is independent from child chat pins. */
    isPinned?: boolean;
    onTogglePin?: () => void;
    onMoreActions?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    /** Optional drag support for the row body (e.g. Ralph session-context drags). */
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
    /** Extra data attributes applied to the row body. */
    bodyDataAttributes?: Record<string, string | undefined>;
    /** Tooltip for the row body. */
    bodyTitle?: string;
    renderTaskCard: (task: any) => React.ReactNode;
}

export function TaskGroupRunRow({
    group,
    display,
    selectedRunId,
    isRangeSelected,
    expanded: controlledExpanded,
    onToggleExpanded,
    now: _now,
    onSelectRun,
    onContextMenu,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    isPinned,
    onTogglePin,
    onMoreActions,
    draggable,
    onDragStart,
    bodyDataAttributes,
    bodyTitle,
    renderTaskCard,
}: TaskGroupRunRowProps) {
    const [expanded, setExpanded] = useState(false);
    const isExpanded = controlledExpanded ?? expanded;
    const isSelected = selectedRunId === group.runId || !!isRangeSelected;
    const childCount = group.children.length;
    const timestamp = group.latestTimestamp
        ? formatRelativeTime(new Date(group.latestTimestamp).toISOString())
        : '';

    const toggle = () => {
        if (onToggleExpanded) {
            onToggleExpanded();
            return;
        }
        setExpanded(value => !value);
    };

    const groupIdAttribute = { [display.groupIdAttributeName ?? 'data-run-id']: group.runId };
    const statusAttribute = { [display.statusAttributeName ?? 'data-run-status']: display.status };

    return (
        <div
            data-testid={`${display.testIdPrefix}-row`}
            {...groupIdAttribute}
            data-selected={isSelected ? 'true' : 'false'}
            className={cn(
                isExpanded && 'bg-[#f7f7f8] dark:bg-[#1f1f20]/80',
                isSelected && `ring-1 ${display.selectedRingClassName}`,
            )}
            data-pinned={isPinned ? 'true' : undefined}
        >
            <div
                className={cn(
                    'chat-row group relative cursor-pointer leading-none transition-colors',
                    'grid items-center gap-2 px-3 py-1',
                    'grid-cols-[10px_30px_minmax(0,1fr)_auto]',
                    'text-[12.5px] h-[26px]',
                    'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
                    'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
                    isPinned && 'border-l-2 border-l-amber-400 dark:border-l-amber-500',
                )}
                onClick={e => {
                    if (onSelectRun) {onSelectRun(group.runId, e);}
                    else {toggle();}
                }}
                onContextMenu={onContextMenu}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                onTouchMove={onTouchMove}
                draggable={draggable}
                onDragStart={onDragStart}
                data-testid={`${display.testIdPrefix}-body`}
                {...statusAttribute}
                {...bodyDataAttributes}
                data-expanded={isExpanded ? 'true' : 'false'}
                data-pinned={isPinned ? 'true' : undefined}
                title={bodyTitle}
                aria-expanded={isExpanded}
            >
                <span
                    className={cn('w-2 h-2 rounded-full justify-self-center transition-shadow', display.statusDotClassName)}
                    aria-label={display.statusAriaLabel ?? `status: ${display.statusLabel}`}
                />
                <span
                    className={cn(
                        'inline-flex items-center justify-center rounded-[3px] border font-mono font-bold uppercase select-none',
                        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
                        display.badgeClassName,
                    )}
                    title={display.badgeTitle ?? display.groupNoun}
                >
                    {display.badge}
                </span>
                <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                    <button
                        type="button"
                        className={cn(
                            'shrink-0 inline-flex items-center justify-center w-4 h-4 -ml-1 rounded',
                            'text-[#848484] dark:text-[#a0a0a0] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                            'transition-transform',
                            isExpanded && 'rotate-90',
                        )}
                        onClick={e => { e.stopPropagation(); toggle(); }}
                        data-testid={`${display.testIdPrefix}-chevron`}
                        aria-label={isExpanded
                            ? display.collapseAriaLabel ?? `Collapse ${display.groupNoun}`
                            : display.expandAriaLabel ?? `Expand ${display.groupNoun}`}
                        aria-expanded={isExpanded}
                    >
                        <span className="text-[12px] leading-none" aria-hidden="true">›</span>
                    </button>
                    {group.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid={`${display.testIdPrefix}-unseen-dot`}
                            aria-label="Unseen activity"
                        />
                    )}
                    <span
                        className={cn('chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]', group.hasUnseen && 'font-semibold')}
                        title={display.titleTooltip}
                        aria-label={display.titleAriaLabel}
                        data-testid={display.titleTestId}
                    >
                        {display.label}
                        <span className="ml-1.5 font-normal text-[#848484] dark:text-[#9d9d9d]">
                            {display.title}
                        </span>
                    </span>
                    {display.summary !== undefined && (
                        <span
                            className={display.summaryClassName}
                            title={display.summary}
                            data-testid={`${display.testIdPrefix}-status-summary`}
                        >
                            {display.summary}
                        </span>
                    )}
                    {childCount > 0 && (
                        <span
                            className="shrink-0 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                            data-testid={`${display.testIdPrefix}-child-count`}
                        >
                            {childCount}
                        </span>
                    )}
                </span>
                <span className="flex items-center gap-1 text-[#848484] dark:text-[#999]">
                    <span className="chat-row-when text-[10.5px] font-mono tabular-nums whitespace-nowrap group-hover:hidden">
                        {timestamp}
                    </span>
                    {(onTogglePin || onMoreActions) && (
                        <span className="chat-row-actions hidden group-hover:flex items-center gap-0">
                            {onTogglePin && (
                                <button
                                    type="button"
                                    className="h-5 w-5 grid place-items-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#ececec] dark:hover:bg-[#2f2f30]"
                                    title={isPinned ? 'Unpin' : 'Pin'}
                                    aria-label={isPinned ? `Unpin ${display.groupNoun} group` : `Pin ${display.groupNoun} group`}
                                    data-testid={`${display.testIdPrefix}-pin`}
                                    onClick={e => { e.stopPropagation(); onTogglePin(); }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M9 1.5l3.5 3.5-2 1-1.5 4-2-2-3 3-.5-.5 3-3-2-2 4-1.5 1-1z"/>
                                    </svg>
                                </button>
                            )}
                            {onMoreActions && (
                                <button
                                    type="button"
                                    className="h-5 w-5 grid place-items-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#ececec] dark:hover:bg-[#2f2f30]"
                                    title="More"
                                    aria-label={`More ${display.groupNoun} group actions`}
                                    data-testid={`${display.testIdPrefix}-more`}
                                    onClick={e => { e.stopPropagation(); onMoreActions(e); }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                                        <circle cx="3.5" cy="7" r="1"/>
                                        <circle cx="7" cy="7" r="1"/>
                                        <circle cx="10.5" cy="7" r="1"/>
                                    </svg>
                                </button>
                            )}
                        </span>
                    )}
                </span>
            </div>

            {isExpanded && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid={`${display.testIdPrefix}-children`}
                >
                    {group.children.length === 0 ? (
                        display.emptyChildrenText !== undefined && (
                            <div className="px-3 py-1.5 text-[11px] text-[#848484] dark:text-[#a0a0a0]" data-testid={`${display.testIdPrefix}-no-children`}>
                                {display.emptyChildrenText}
                            </div>
                        )
                    ) : group.children.map((task: any, index: number) => (
                        <div key={task.id ?? index}>
                            {renderTaskCard(task)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * WorkItemHierarchyNode — a single row in the hierarchy tree.
 * Renders type pill, number, title, status chip, rollup summary, and collapse toggle.
 */

import { type ReactNode } from 'react';
import { cn } from '../../ui';
import type { WorkItemTreeNode } from '@plusplusoneplusplus/coc-client';
import { formatRelativeTime } from '../../utils/format';

// ── Type display config ──────────────────────────────────────────────────────

export type WorkItemTypeLabel = 'epic' | 'feature' | 'pbi' | 'work-item' | 'bug' | 'goal';

export const TYPE_LABELS: Record<WorkItemTypeLabel, string> = {
    epic: 'Epic',
    feature: 'Feature',
    pbi: 'PBI',
    'work-item': 'Work Item',
    bug: 'Bug',
    goal: 'Goal',
};

const TYPE_PREFIX: Record<WorkItemTypeLabel, string> = {
    epic: 'E',
    feature: 'F',
    pbi: 'PBI',
    'work-item': 'WI',
    bug: 'BUG',
    goal: 'GOAL',
};

const TYPE_PILL_CLASS: Record<WorkItemTypeLabel, string> = {
    epic:        'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    feature:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    pbi:         'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    'work-item': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    bug:         'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    goal:        'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

const STATUS_CHIP_CLASS: Record<string, string> = {
    created:          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    drafting:         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    planning:         'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    readyToExecute:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    executing:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    aiDone:           'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    aiFailed:         'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    done:             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    failed:           'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
    created: 'Created',
    drafting: 'Drafting',
    planning: 'Planning',
    readyToExecute: 'Ready',
    executing: 'Executing',
    aiDone: 'AI Done',
    aiFailed: 'AI Failed',
    done: 'Done',
    failed: 'Failed',
};

// ── Component ────────────────────────────────────────────────────────────────

export interface WorkItemHierarchyNodeProps {
    node: WorkItemTreeNode;
    depth: number;
    collapsed: boolean;
    selected: boolean;
    hasChildren: boolean;
    onSelect: (id: string) => void;
    onToggleCollapse: (id: string) => void;
    onContextMenu: (e: React.MouseEvent, node: WorkItemTreeNode) => void;
    /** Mobile only: fires when the inline '+' add-child button is tapped. */
    onAddChild?: (node: WorkItemTreeNode) => void;
    /** When true the '+' add-child button is always visible (no hover). */
    isMobile?: boolean;
    children?: ReactNode;
}

export function WorkItemHierarchyNode({
    node,
    depth,
    collapsed,
    selected,
    hasChildren,
    onSelect,
    onToggleCollapse,
    onContextMenu,
    onAddChild,
    isMobile = false,
    children,
}: WorkItemHierarchyNodeProps) {
    const { item, rollup } = node;
    const effectiveType = (item.type ?? 'work-item') as WorkItemTypeLabel;
    const typeLabel = TYPE_LABELS[effectiveType] ?? effectiveType;
    const typePrefix = TYPE_PREFIX[effectiveType] ?? 'WI';
    const pillClass = TYPE_PILL_CLASS[effectiveType] ?? TYPE_PILL_CLASS['work-item'];
    const statusChipClass = STATUS_CHIP_CLASS[item.status] ?? STATUS_CHIP_CLASS.created;
    const statusLabel = STATUS_LABEL[item.status] ?? item.status;
    const isContainer = ['epic', 'feature', 'pbi'].includes(effectiveType);

    const indentWidth = depth * 16;

    const depthPadding = depth === 0 ? 8 : depth === 1 ? 28 : depth === 2 ? 48 : 68;
    const guideLeft = depth === 1 ? 18 : depth === 2 ? 38 : depth === 3 ? 58 : 0;

    return (
        <div data-testid={`hierarchy-node-${item.id}`}>
            <button
                className={cn(
                    'group w-full grid items-center gap-1.5 rounded-md border border-transparent text-left relative',
                    'py-[7px] px-2 text-[12px] transition-colors cursor-pointer',
                    selected
                        ? 'bg-[#ddf4ff] dark:bg-[#0969da]/20 border-[color-mix(in_srgb,#0969da_42%,#d0d7de)] dark:border-[#0969da]/40'
                        : 'hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] hover:border-[#eaeef2] dark:hover:border-[#3c3c3c]',
                )}
                style={{
                    paddingLeft: `${depthPadding}px`,
                    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
                }}
                onClick={() => onSelect(item.id)}
                onContextMenu={e => { e.preventDefault(); onContextMenu(e, node); }}
                data-testid={`hierarchy-node-row-${item.id}`}
                type="button"
            >
                {/* Guide line for nested depth */}
                {depth > 0 && (
                    <span
                        className="absolute top-[-7px] bottom-[-7px] w-px bg-[#eaeef2] dark:bg-[#3c3c3c]"
                        style={{ left: `${guideLeft}px` }}
                        aria-hidden="true"
                    />
                )}

                {/* Collapse toggle */}
                <span
                    className={cn(
                        'w-[18px] h-[18px] inline-flex items-center justify-center text-[#656d76] dark:text-[#999] rounded',
                        hasChildren ? 'hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] hover:text-[#1f2328] dark:hover:text-[#ccc] cursor-pointer' : '',
                    )}
                    onClick={e => { e.stopPropagation(); if (hasChildren) onToggleCollapse(item.id); }}
                    data-testid={`hierarchy-node-collapse-${item.id}`}
                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                    aria-hidden="true"
                >
                    {hasChildren ? (collapsed ? '›' : 'v') : ''}
                </span>

                {/* Type pill */}
                <span
                    className={cn(
                        'inline-flex items-center rounded-full text-[11px] leading-[1.25] px-[7px] py-px border border-transparent whitespace-nowrap font-medium',
                        pillClass,
                    )}
                    title={typeLabel}
                    data-testid={`hierarchy-node-type-${item.id}`}
                >
                    {typeLabel}
                </span>

                {/* Tree title — two-line: title + meta subtitle */}
                <span className="min-w-0 grid gap-px" data-testid={`hierarchy-node-title-${item.id}`}>
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc]">
                        {item.title}
                    </strong>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.25] text-[#656d76] dark:text-[#999]">
                        {item.workItemNumber != null && (
                            <span className="font-mono tabular-nums">{typePrefix}-{item.workItemNumber}</span>
                        )}
                        {item.workItemNumber != null && ' · '}
                        {statusLabel}
                        {' · updated '}
                        {formatRelativeTime(item.updatedAt)}
                        {' ago'}
                    </span>
                </span>

                {/* Rollup summary for containers */}
                {isContainer && rollup.descendantCount > 0 && (
                    <span className="shrink-0 text-[11px] text-[#656d76] dark:text-[#999] font-mono tabular-nums whitespace-nowrap" title="Done / Total descendants">
                        {rollup.byStatus.done}/{rollup.descendantCount}
                    </span>
                )}

                {/* Status chip — hidden when rollup is shown */}
                {!(isContainer && rollup.descendantCount > 0) && (
                    <span
                        className={cn('shrink-0 px-1 py-0.5 rounded text-[9px] font-medium leading-none', statusChipClass)}
                        data-testid={`hierarchy-node-status-${item.id}`}
                    >
                        {statusLabel}
                    </span>
                )}

                {/* Mobile add-child button — containers only, always visible on mobile */}
                {isMobile && isContainer && (
                    <button
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[11px] font-bold text-[#0969da] bg-[#0969da]/10 hover:bg-[#0969da]/20 active:bg-[#0969da]/30"
                        onClick={e => { e.stopPropagation(); onAddChild?.(node); }}
                        data-testid={`hierarchy-node-add-child-${item.id}`}
                        aria-label="Add child"
                    >
                        +
                    </button>
                )}
            </button>

            {/* Children */}
            {!collapsed && children}
        </div>
    );
}

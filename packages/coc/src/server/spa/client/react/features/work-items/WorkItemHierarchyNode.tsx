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

    return (
        <div data-testid={`hierarchy-node-${item.id}`}>
            <div
                className={cn(
                    'group flex items-center gap-1 px-2 py-1.5 cursor-pointer text-[12px] rounded-sm transition-colors',
                    selected
                        ? 'bg-[#007acc]/15 dark:bg-[#007acc]/20'
                        : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                )}
                style={{ paddingLeft: `${8 + indentWidth}px` }}
                onClick={() => onSelect(item.id)}
                onContextMenu={e => { e.preventDefault(); onContextMenu(e, node); }}
                data-testid={`hierarchy-node-row-${item.id}`}
            >
                {/* Collapse toggle */}
                <button
                    className={cn(
                        'flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] text-[#848484]',
                        hasChildren ? 'hover:text-[#333] dark:hover:text-[#ccc]' : 'invisible',
                    )}
                    onClick={e => { e.stopPropagation(); if (hasChildren) onToggleCollapse(item.id); }}
                    data-testid={`hierarchy-node-collapse-${item.id}`}
                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                >
                    {hasChildren ? (collapsed ? '▶' : '▼') : null}
                </button>

                {/* Type pill */}
                <span
                    className={cn('flex-shrink-0 px-1 py-0.5 rounded text-[9px] font-medium leading-none', pillClass)}
                    title={typeLabel}
                    data-testid={`hierarchy-node-type-${item.id}`}
                >
                    {typeLabel}
                </span>

                {/* Number */}
                {item.workItemNumber != null && (
                    <span className="flex-shrink-0 text-[10px] text-[#848484] dark:text-[#999] font-mono">
                        {typePrefix}-{item.workItemNumber}
                    </span>
                )}

                {/* Title */}
                <span
                    className="flex-1 min-w-0 truncate text-[#3c3c3c] dark:text-[#cccccc]"
                    title={item.title}
                    data-testid={`hierarchy-node-title-${item.id}`}
                >
                    {item.title}
                </span>

                {/* Rollup summary for containers */}
                {isContainer && rollup.descendantCount > 0 && (
                    <span className="flex-shrink-0 text-[10px] text-[#848484] dark:text-[#999]" title="Done / Total descendants">
                        {rollup.byStatus.done}/{rollup.descendantCount}
                    </span>
                )}

                {/* Status chip */}
                <span
                    className={cn('flex-shrink-0 px-1 py-0.5 rounded text-[9px] font-medium leading-none', statusChipClass)}
                    data-testid={`hierarchy-node-status-${item.id}`}
                >
                    {statusLabel}
                </span>

                {/* Updated time */}
                <span className="flex-shrink-0 text-[10px] text-[#848484] dark:text-[#999] opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatRelativeTime(item.updatedAt)}
                </span>
            </div>

            {/* Children */}
            {!collapsed && children}
        </div>
    );
}

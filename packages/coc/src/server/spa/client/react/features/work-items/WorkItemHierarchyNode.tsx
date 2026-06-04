/**
 * WorkItemHierarchyNode — a single row in the hierarchy tree.
 * Renders type pill, number, title, status chip, rollup summary, and collapse toggle.
 */

import { type ReactNode } from 'react';
import { cn } from '../../ui';
import type { WorkItemTreeNode } from '@plusplusoneplusplus/coc-client';
import { formatRelativeTime } from '../../utils/format';
import { WorkItemRemoteMirrorBadge } from './WorkItemGitHubMirrorBadge';

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

const TYPE_SHORT: Record<WorkItemTypeLabel, string> = {
    epic:        'E',
    feature:     'F',
    pbi:         'P',
    'work-item': 'W',
    bug:         'B',
    goal:        'G',
};

const TYPE_PILL_CLASS: Record<WorkItemTypeLabel, string> = {
    epic:        'text-[#8250df] bg-[color-mix(in_srgb,#8250df_10%,white)] border-[color-mix(in_srgb,#8250df_25%,#d0d7de)] dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700/40',
    feature:     'text-[#0969da] bg-[#ddf4ff] border-[color-mix(in_srgb,#0969da_25%,#d0d7de)] dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/40',
    pbi:         'text-[#0a7280] bg-[#ddf7fa] border-[#b6e8ef] dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-700/40',
    'work-item': 'text-[#656d76] bg-[#f6f8fa] border-[#d0d7de] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
    bug:         'text-[#cf222e] bg-[#ffebe9] border-[color-mix(in_srgb,#cf222e_25%,#d0d7de)] dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/40',
    goal:        'text-[#9a6700] bg-[#fff8c5] border-[color-mix(in_srgb,#9a6700_25%,#d0d7de)] dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700/40',
};

const STATUS_CHIP_CLASS: Record<string, string> = {
    created:          'bg-[#f6f8fa] text-[#656d76] border-[#d0d7de] dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600',
    drafting:         'bg-[#fff8c5] text-[#9a6700] border-[color-mix(in_srgb,#9a6700_25%,#d0d7de)] dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700/40',
    planning:         'bg-[#fff8c5] text-[#9a6700] border-[color-mix(in_srgb,#9a6700_25%,#d0d7de)] dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-700/40',
    readyToExecute:   'bg-[#dafbe1] text-[#1a7f37] border-[color-mix(in_srgb,#1a7f37_30%,#d0d7de)] dark:bg-green-900/20 dark:text-green-400 dark:border-green-700/40',
    executing:        'bg-[#ddf4ff] text-[#0969da] border-[color-mix(in_srgb,#0969da_30%,#d0d7de)] dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700/40',
    aiDone:           'bg-[color-mix(in_srgb,#8250df_10%,white)] text-[#8250df] border-[color-mix(in_srgb,#8250df_25%,#d0d7de)] dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700/40',
    aiFailed:         'bg-[#fff8c5] text-[#9a6700] border-[color-mix(in_srgb,#9a6700_25%,#d0d7de)] dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-700/40',
    done:             'bg-[#dafbe1] text-[#1a7f37] border-[color-mix(in_srgb,#1a7f37_30%,#d0d7de)] dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700/40',
    failed:           'bg-[#ffebe9] text-[#cf222e] border-[color-mix(in_srgb,#cf222e_25%,#d0d7de)] dark:bg-red-900/20 dark:text-red-400 dark:border-red-700/40',
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
    highlighted?: boolean;
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
    highlighted = false,
    children,
}: WorkItemHierarchyNodeProps) {
    const { item, rollup } = node;
    const effectiveType = (item.type ?? 'work-item') as WorkItemTypeLabel;
    const typeLabel = TYPE_LABELS[effectiveType] ?? effectiveType;
    const typePrefix = TYPE_PREFIX[effectiveType] ?? 'WI';
    const typeShort = TYPE_SHORT[effectiveType] ?? 'W';
    const pillClass = TYPE_PILL_CLASS[effectiveType] ?? TYPE_PILL_CLASS['work-item'];
    const statusChipClass = STATUS_CHIP_CLASS[item.status] ?? STATUS_CHIP_CLASS.created;
    const statusLabel = STATUS_LABEL[item.status] ?? item.status;
    const isContainer = ['epic', 'feature', 'pbi'].includes(effectiveType);

    const depthPadding = depth === 0 ? 5 : depth === 1 ? 19 : depth === 2 ? 34 : 49;
    const guideLeft = depth === 1 ? 11 : depth === 2 ? 26 : depth === 3 ? 41 : 0;

    return (
        <div data-testid={`hierarchy-node-${item.id}`}>
            <button
                className={cn(
                    'group w-full grid items-center gap-[5px] rounded-[5px] border border-transparent text-left relative',
                    'min-h-[30px] py-[3px] text-[12px] transition-colors cursor-pointer',
                    selected
                        ? 'bg-[#ddf4ff] dark:bg-[#0969da]/20 border-[color-mix(in_srgb,#0969da_42%,#d0d7de)] dark:border-[#0969da]/40 min-h-[44px]'
                        : 'hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] hover:border-[#eaeef2] dark:hover:border-[#3c3c3c]',
                    highlighted && 'animate-pulse ring-2 ring-[#0078d4]/50',
                )}
                style={{
                    paddingLeft: `${depthPadding}px`,
                    paddingRight: '5px',
                    gridTemplateColumns: '14px 18px minmax(0, 1fr) auto auto',
                }}
                onClick={() => onSelect(item.id)}
                onContextMenu={e => { e.preventDefault(); onContextMenu(e, node); }}
                data-testid={`hierarchy-node-row-${item.id}`}
                data-work-item-id={item.id}
                type="button"
            >
                {/* Guide line for nested depth */}
                {depth > 0 && (
                    <span
                        className="absolute top-[-4px] bottom-[-4px] w-px bg-[#eaeef2] dark:bg-[#3c3c3c]"
                        style={{ left: `${guideLeft}px` }}
                        aria-hidden="true"
                    />
                )}

                {/* Collapse toggle */}
                <span
                    className={cn(
                        'w-[14px] h-[20px] inline-flex items-center justify-center text-[#656d76] dark:text-[#999] text-[12px] font-semibold font-mono',
                        hasChildren ? 'cursor-pointer' : '',
                    )}
                    onClick={e => { e.stopPropagation(); if (hasChildren) onToggleCollapse(item.id); }}
                    data-testid={`hierarchy-node-collapse-${item.id}`}
                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                    aria-hidden="true"
                >
                    {hasChildren ? (collapsed ? '›' : 'v') : ''}
                </span>

                {/* Type pill — compact single letter */}
                <span
                    className={cn(
                        'inline-flex items-center justify-center w-[18px] min-w-[18px] h-[18px] rounded-full text-[10px] leading-none font-semibold font-mono border whitespace-nowrap',
                        pillClass,
                    )}
                    title={typeLabel}
                    data-testid={`hierarchy-node-type-${item.id}`}
                >
                    {typeShort}
                </span>

                {/* Tree main — title + meta that shows on hover/select */}
                <span className="min-w-0 grid gap-px" data-testid={`hierarchy-node-title-${item.id}`}>
                    <span className="flex items-baseline gap-[5px] min-w-0">
                        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc]">
                            {item.title}
                        </strong>
                        {item.workItemNumber != null && (
                            <code className="text-[10px] text-[#656d76] dark:text-[#999] font-mono shrink-0">{typePrefix}-{item.workItemNumber}</code>
                        )}
                    </span>
                    <span className={cn(
                        'overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] leading-[1.15] text-[#656d76] dark:text-[#999]',
                        selected || isMobile ? 'block' : 'hidden group-hover:block',
                    )}>
                        {statusLabel}
                        {' \u00b7 updated '}
                        {formatRelativeTime(item.updatedAt)}
                        {' ago'}
                    </span>
                </span>

                {/* Mirror badge */}
                <WorkItemRemoteMirrorBadge
                    githubMirror={item.githubMirror}
                    azureBoardsMirror={item.azureBoardsMirror}
                    compact
                    data-testid={`hierarchy-node-remote-mirror-badge-${item.id}`}
                />

                {/* Rollup summary for containers, status pill for leaf items */}
                {isContainer && rollup.descendantCount > 0 ? (
                    <span className="shrink-0 text-[11px] text-[#656d76] dark:text-[#999] font-mono tabular-nums whitespace-nowrap" title="Done / Total descendants">
                        {rollup.byStatus.done}/{rollup.descendantCount}
                    </span>
                ) : (
                    <span
                        className={cn('shrink-0 inline-flex items-center justify-center h-[18px] px-1.5 rounded-full text-[10px] font-semibold leading-none border whitespace-nowrap', statusChipClass)}
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

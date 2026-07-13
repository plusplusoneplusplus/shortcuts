import type React from 'react';
import type { ForEachItemStatus, ForEachRunStatus } from '@plusplusoneplusplus/coc-client';
import type { ForEachRunGroup } from './for-each-run-grouping';
import { TaskGroupRunRow } from './TaskGroupRunRow';

interface ForEachRunRowProps {
    group: ForEachRunGroup;
    selectedRunId?: string | null;
    isRangeSelected?: boolean;
    /** Some — but not all — child chats are selected by history multi-select. */
    isPartiallySelected?: boolean;
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
    renderTaskCard: (task: any) => React.ReactNode;
}

const STATUS_DOT_CLASSES: Record<ForEachRunStatus, string> = {
    draft: 'bg-zinc-400 dark:bg-zinc-500',
    approved: 'bg-sky-500 dark:bg-sky-400',
    running: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    failed: 'bg-[#e5534b] dark:bg-[#f85149]',
    completed: 'bg-emerald-500 dark:bg-emerald-400',
    cancelled: 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
};

const STATUS_ORDER: ForEachItemStatus[] = ['running', 'failed', 'pending', 'completed', 'skipped'];

function summarizeItems(group: ForEachRunGroup): string {
    if (group.run.itemCount === 0) {return '0 items';}
    const parts = STATUS_ORDER
        .map(status => {
            const count = group.run.itemStatusCounts[status] ?? 0;
            return count > 0 ? `${count} ${status}` : null;
        })
        .filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join(' · ') : `${group.run.itemCount} items`;
}

function titlePreview(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 80 ? flat.slice(0, 77) + '...' : flat;
}

export function ForEachRunRow({ group, ...behavior }: ForEachRunRowProps) {
    return (
        <TaskGroupRunRow
            group={group}
            display={{
                testIdPrefix: 'for-each-run',
                label: 'For Each',
                badge: 'FE',
                groupNoun: 'For Each run',
                badgeClassName: 'text-sky-700 dark:text-sky-300 border-sky-500/70 dark:border-sky-400/60 bg-sky-50/70 dark:bg-sky-400/10',
                selectedRingClassName: 'ring-sky-500/45',
                statusDotClassName: STATUS_DOT_CLASSES[group.run.status],
                statusLabel: group.run.status,
                status: group.run.status,
                summary: summarizeItems(group),
                summaryClassName: 'shrink min-w-0 max-w-[150px] truncate text-[10px] font-medium leading-none text-sky-700 dark:text-sky-300',
                title: titlePreview(group.run.originalRequest),
                emptyChildrenText: 'No child chats yet',
            }}
            {...behavior}
        />
    );
}

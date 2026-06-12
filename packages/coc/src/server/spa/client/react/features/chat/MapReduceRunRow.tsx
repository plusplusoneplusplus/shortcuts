import type React from 'react';
import type { MapReduceItemStatus, MapReduceRunStatus } from '@plusplusoneplusplus/coc-client';
import type { MapReduceRunGroup } from './map-reduce-run-grouping';
import { TaskGroupRunRow } from './TaskGroupRunRow';

interface MapReduceRunRowProps {
    group: MapReduceRunGroup;
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
    isPinned?: boolean;
    onTogglePin?: () => void;
    onMoreActions?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    renderTaskCard: (task: any) => React.ReactNode;
}

const STATUS_DOT_CLASSES: Record<MapReduceRunStatus, string> = {
    draft: 'bg-zinc-400 dark:bg-zinc-500',
    approved: 'bg-indigo-500 dark:bg-indigo-400',
    running: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    reducing: 'bg-purple-500 dark:bg-purple-400 animate-pulse shadow-[0_0_0_3px_rgba(168,85,247,0.22)]',
    failed: 'bg-[#e5534b] dark:bg-[#f85149]',
    completed: 'bg-emerald-500 dark:bg-emerald-400',
    cancelled: 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
};

const STATUS_ORDER: MapReduceItemStatus[] = ['running', 'failed', 'pending', 'completed', 'skipped'];

function summarizeItems(group: MapReduceRunGroup): string {
    if (group.run.itemCount === 0) {return `0 items · reduce ${group.run.reduceStatus}`;}
    const parts = STATUS_ORDER
        .map(status => {
            const count = group.run.itemStatusCounts[status] ?? 0;
            return count > 0 ? `${count} ${status}` : null;
        })
        .filter((part): part is string => !!part);
    const itemSummary = parts.length > 0 ? parts.join(' · ') : `${group.run.itemCount} items`;
    return `${itemSummary} · reduce ${group.run.reduceStatus}`;
}

function titlePreview(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 80 ? flat.slice(0, 77) + '...' : flat;
}

export function MapReduceRunRow({ group, ...behavior }: MapReduceRunRowProps) {
    return (
        <TaskGroupRunRow
            group={group}
            display={{
                testIdPrefix: 'map-reduce-run',
                label: 'Map Reduce',
                badge: 'MR',
                groupNoun: 'Map Reduce run',
                badgeClassName: 'text-indigo-700 dark:text-indigo-300 border-indigo-500/70 dark:border-indigo-400/60 bg-indigo-50/70 dark:bg-indigo-400/10',
                selectedRingClassName: 'ring-indigo-500/45',
                statusDotClassName: STATUS_DOT_CLASSES[group.run.status],
                statusLabel: group.run.status,
                status: group.run.status,
                summary: summarizeItems(group),
                summaryClassName: 'shrink min-w-0 max-w-[180px] truncate text-[10px] font-medium leading-none text-indigo-700 dark:text-indigo-300',
                title: titlePreview(group.run.originalRequest),
                emptyChildrenText: 'No map or reduce chats yet',
            }}
            {...behavior}
        />
    );
}

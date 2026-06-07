import type React from 'react';
import { useState } from 'react';
import type { MapReduceItemStatus, MapReduceRunStatus } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui/cn';
import { formatRelativeTime } from '../../utils/format';
import type { MapReduceRunGroup } from './map-reduce-run-grouping';

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

const STATUS_LABEL: Record<MapReduceRunStatus, string> = {
    draft: 'draft',
    approved: 'approved',
    running: 'running',
    reducing: 'reducing',
    failed: 'failed',
    completed: 'completed',
    cancelled: 'cancelled',
};

const STATUS_ORDER: MapReduceItemStatus[] = ['running', 'failed', 'pending', 'completed', 'skipped'];

function summarizeItems(group: MapReduceRunGroup): string {
    if (group.run.itemCount === 0) return `0 items · reduce ${group.run.reduceStatus}`;
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

export function MapReduceRunRow({
    group,
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
    renderTaskCard,
}: MapReduceRunRowProps) {
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

    return (
        <div
            data-testid="map-reduce-run-row"
            data-run-id={group.runId}
            data-selected={isSelected ? 'true' : 'false'}
            className={cn(
                isExpanded && 'bg-[#f7f7f8] dark:bg-[#1f1f20]/80',
                isSelected && 'ring-1 ring-indigo-500/45',
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
                    if (onSelectRun) onSelectRun(group.runId, e);
                    else toggle();
                }}
                onContextMenu={onContextMenu}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                onTouchMove={onTouchMove}
                data-testid="map-reduce-run-body"
                data-run-status={group.run.status}
                data-expanded={isExpanded ? 'true' : 'false'}
                data-pinned={isPinned ? 'true' : undefined}
                aria-expanded={isExpanded}
            >
                <span
                    className={cn('w-2 h-2 rounded-full justify-self-center transition-shadow', STATUS_DOT_CLASSES[group.run.status])}
                    aria-label={`status: ${STATUS_LABEL[group.run.status]}`}
                />
                <span
                    className={cn(
                        'inline-flex items-center justify-center rounded-[3px] border font-mono font-bold uppercase select-none',
                        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
                        'text-indigo-700 dark:text-indigo-300',
                        'border-indigo-500/70 dark:border-indigo-400/60',
                        'bg-indigo-50/70 dark:bg-indigo-400/10',
                    )}
                    title="Map Reduce run"
                >
                    MR
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
                        data-testid="map-reduce-run-chevron"
                        aria-label={isExpanded ? 'Collapse Map Reduce run' : 'Expand Map Reduce run'}
                        aria-expanded={isExpanded}
                    >
                        <span className="text-[12px] leading-none" aria-hidden="true">›</span>
                    </button>
                    {group.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid="map-reduce-run-unseen-dot"
                            aria-label="Unseen activity"
                        />
                    )}
                    <span className={cn('chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]', group.hasUnseen && 'font-semibold')}>
                        Map Reduce
                        <span className="ml-1.5 font-normal text-[#848484] dark:text-[#9d9d9d]">
                            {titlePreview(group.run.originalRequest)}
                        </span>
                    </span>
                    <span
                        className="shrink min-w-0 max-w-[180px] truncate text-[10px] font-medium leading-none text-indigo-700 dark:text-indigo-300"
                        title={summarizeItems(group)}
                        data-testid="map-reduce-run-status-summary"
                    >
                        {summarizeItems(group)}
                    </span>
                    {childCount > 0 && (
                        <span
                            className="shrink-0 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                            data-testid="map-reduce-run-child-count"
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
                                    aria-label={isPinned ? 'Unpin Map Reduce run group' : 'Pin Map Reduce run group'}
                                    data-testid="map-reduce-run-pin"
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
                                    aria-label="More Map Reduce run group actions"
                                    data-testid="map-reduce-run-more"
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
                    data-testid="map-reduce-run-children"
                >
                    {group.children.length === 0 ? (
                        <div className="px-3 py-1.5 text-[11px] text-[#848484] dark:text-[#a0a0a0]" data-testid="map-reduce-run-no-children">
                            No map or reduce chats yet
                        </div>
                    ) : group.children.map((task: any) => (
                        <div key={task.id}>
                            {renderTaskCard(task)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

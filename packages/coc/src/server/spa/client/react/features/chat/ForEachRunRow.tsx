import type React from 'react';
import { useState } from 'react';
import type { ForEachItemStatus, ForEachRunStatus } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui/cn';
import { formatRelativeTime } from '../../utils/format';
import type { ForEachRunGroup } from './for-each-run-grouping';

interface ForEachRunRowProps {
    group: ForEachRunGroup;
    selectedRunId?: string | null;
    now: number;
    onSelectRun?: (runId: string) => void;
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

const STATUS_LABEL: Record<ForEachRunStatus, string> = {
    draft: 'draft',
    approved: 'approved',
    running: 'running',
    failed: 'failed',
    completed: 'completed',
    cancelled: 'cancelled',
};

const STATUS_ORDER: ForEachItemStatus[] = ['running', 'failed', 'pending', 'completed', 'skipped'];

function summarizeItems(group: ForEachRunGroup): string {
    if (group.run.itemCount === 0) return '0 items';
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

export function ForEachRunRow({ group, selectedRunId, now: _now, onSelectRun, renderTaskCard }: ForEachRunRowProps) {
    const [expanded, setExpanded] = useState(false);
    const isSelected = selectedRunId === group.runId;
    const childCount = group.children.length;
    const timestamp = group.latestTimestamp
        ? formatRelativeTime(new Date(group.latestTimestamp).toISOString())
        : '';

    const toggle = () => setExpanded(value => !value);

    return (
        <div
            data-testid="for-each-run-row"
            data-run-id={group.runId}
            data-selected={isSelected ? 'true' : 'false'}
            className={cn(
                expanded && 'bg-[#f7f7f8] dark:bg-[#1f1f20]/80',
                isSelected && 'ring-1 ring-sky-500/45',
            )}
        >
            <div
                className={cn(
                    'chat-row group relative cursor-pointer leading-none transition-colors',
                    'grid items-center gap-2 px-3 py-1',
                    'grid-cols-[10px_30px_minmax(0,1fr)_auto]',
                    'text-[12.5px] h-[26px]',
                    'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
                    'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
                )}
                onClick={() => {
                    if (onSelectRun) onSelectRun(group.runId);
                    else toggle();
                }}
                data-testid="for-each-run-body"
                data-run-status={group.run.status}
                data-expanded={expanded ? 'true' : 'false'}
                aria-expanded={expanded}
            >
                <span
                    className={cn('w-2 h-2 rounded-full justify-self-center transition-shadow', STATUS_DOT_CLASSES[group.run.status])}
                    aria-label={`status: ${STATUS_LABEL[group.run.status]}`}
                />
                <span
                    className={cn(
                        'inline-flex items-center justify-center rounded-[3px] border font-mono font-bold uppercase select-none',
                        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
                        'text-sky-700 dark:text-sky-300',
                        'border-sky-500/70 dark:border-sky-400/60',
                        'bg-sky-50/70 dark:bg-sky-400/10',
                    )}
                    title="For Each run"
                >
                    FE
                </span>
                <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                    <button
                        type="button"
                        className={cn(
                            'shrink-0 inline-flex items-center justify-center w-4 h-4 -ml-1 rounded',
                            'text-[#848484] dark:text-[#a0a0a0] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                            'transition-transform',
                            expanded && 'rotate-90',
                        )}
                        onClick={e => { e.stopPropagation(); toggle(); }}
                        data-testid="for-each-run-chevron"
                        aria-label={expanded ? 'Collapse For Each run' : 'Expand For Each run'}
                        aria-expanded={expanded}
                    >
                        <span className="text-[12px] leading-none" aria-hidden="true">›</span>
                    </button>
                    {group.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid="for-each-run-unseen-dot"
                            aria-label="Unseen activity"
                        />
                    )}
                    <span className={cn('chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]', group.hasUnseen && 'font-semibold')}>
                        For Each
                        <span className="ml-1.5 font-normal text-[#848484] dark:text-[#9d9d9d]">
                            {titlePreview(group.run.originalRequest)}
                        </span>
                    </span>
                    <span
                        className="shrink min-w-0 max-w-[150px] truncate text-[10px] font-medium leading-none text-sky-700 dark:text-sky-300"
                        title={summarizeItems(group)}
                        data-testid="for-each-run-status-summary"
                    >
                        {summarizeItems(group)}
                    </span>
                    {childCount > 0 && (
                        <span
                            className="shrink-0 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                            data-testid="for-each-run-child-count"
                        >
                            {childCount}
                        </span>
                    )}
                </span>
                <span className="flex items-center gap-1 text-[#848484] dark:text-[#999]">
                    <span className="text-[10.5px] font-mono tabular-nums whitespace-nowrap">
                        {timestamp}
                    </span>
                </span>
            </div>

            {expanded && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="for-each-run-children"
                >
                    {group.children.length === 0 ? (
                        <div className="px-3 py-1.5 text-[11px] text-[#848484] dark:text-[#a0a0a0]" data-testid="for-each-run-no-children">
                            No child chats yet
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

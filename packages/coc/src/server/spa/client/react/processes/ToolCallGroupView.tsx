/**
 * ToolCallGroupView — collapsible summary row for a group of consecutive
 * same-category tool calls (read / write / shell).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../shared';
import type { ToolGroupCategory, GroupContentItem } from './toolGroupUtils';
import { getCategoryLabel, getToolGroupStatus } from './toolGroupUtils';

export interface RenderToolCall {
    id: string;
    toolName: string;
    name?: string;
    args?: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
}

export interface ToolCallGroupViewProps {
    category: ToolGroupCategory;
    toolCalls: RenderToolCall[];
    contentItems?: GroupContentItem[];
    compactness: 0 | 1 | 2;
    isStreaming?: boolean;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
}

export const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📄',
    write: '✏️',
    shell: '💻',
};

/** Formats the startTime of the earliest tool call as `MM/DD HH:MM:SSZ`. */
export function groupStartLabel(toolCalls: RenderToolCall[]): string {
    const first = toolCalls.find(tc => tc.startTime);
    if (!first?.startTime) return '';
    const d = new Date(first.startTime);
    if (isNaN(d.getTime())) return '';
    const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm}:${ss}Z`;
}

/** Returns human-readable elapsed time spanning first startTime to last endTime. */
export function groupDuration(toolCalls: RenderToolCall[]): string {
    const starts = toolCalls
        .map(tc => (tc.startTime ? new Date(tc.startTime).getTime() : NaN))
        .filter(n => !isNaN(n));
    const ends = toolCalls
        .map(tc => (tc.endTime ? new Date(tc.endTime).getTime() : NaN))
        .filter(n => !isNaN(n));
    if (starts.length === 0) return '';
    const firstStart = Math.min(...starts);
    const lastEnd = ends.length > 0 ? Math.max(...ends) : Date.now();
    const ms = lastEnd - firstStart;
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function buildCounts(toolNames: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const name of toolNames) {
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
}

export function ToolCallGroupView({
    category,
    toolCalls,
    contentItems,
    compactness,
    isStreaming,
    renderToolTree,
}: ToolCallGroupViewProps) {
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        setExpanded(!!isStreaming);
    }, [isStreaming]);

    const toggle = useCallback(() => setExpanded(v => !v), []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        },
        [toggle]
    );

    const { icon: statusIcon, summary: statusSummary } = getToolGroupStatus(
        toolCalls.map(tc => tc.status)
    );
    const summaryLabel = getCategoryLabel(category, buildCounts(toolCalls.map(tc => tc.toolName)));
    const messageCount = contentItems?.length ?? 0;
    const startLabel   = groupStartLabel(toolCalls);
    const duration     = groupDuration(toolCalls);
    const isMinimal    = compactness === 2;

    return (
        <div
            className={cn(
                'tool-call-group my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
                isMinimal && !expanded && 'tool-call-group--minimal'
            )}
            data-category={category}
        >
            {/* ── Header row ────────────────────────────────────────── */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                className={cn(
                    'tool-call-group-header flex items-center gap-2 px-2.5 py-1.5',
                    'cursor-pointer select-none',
                    'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                    isMinimal && !expanded &&
                        'tool-call-group-header--minimal overflow-hidden max-h-6 transition-[max-height] duration-200'
                )}
                onClick={toggle}
                onKeyDown={handleKeyDown}
            >
                <span className="shrink-0">{statusIcon}</span>
                <span className="shrink-0">{CATEGORY_ICONS[category]}</span>

                <span className="tool-call-group-label font-medium text-[#0078d4] dark:text-[#3794ff] truncate min-w-0">
                    {summaryLabel}
                    {messageCount > 0 && (
                        <span className="text-[#848484] font-normal">
                            {` + ${messageCount} message${messageCount > 1 ? 's' : ''}`}
                        </span>
                    )}
                </span>

                {statusSummary && (
                    <span className="tool-call-group-status text-[#c4a000] dark:text-[#e0c862] font-medium shrink-0">
                        ({statusSummary})
                    </span>
                )}

                {startLabel && (
                    <span className="text-[#848484] ml-auto shrink-0">{startLabel}</span>
                )}
                {duration && (
                    <span className={cn('text-[#848484] shrink-0', !startLabel && 'ml-auto')}>
                        {duration}
                    </span>
                )}

                <span className={cn('text-[#848484] shrink-0', !duration && !startLabel && 'ml-auto')}>
                    {expanded ? '▼' : '▶'}
                </span>
            </div>

            {/* ── Expanded body ──────────────────────────────────────── */}
            {expanded && (
                <div className="tool-call-group-body border-t border-[#e0e0e0] dark:border-[#3c3c3c] py-1">
                    {toolCalls.map(tc => (
                        <React.Fragment key={tc.id}>
                            {renderToolTree(tc.id, 0)}
                        </React.Fragment>
                    ))}
                    {contentItems && contentItems.length > 0 && (
                        <div className="tool-call-group-content px-3 py-1 text-xs text-[#616161] dark:text-[#a0a0a0] italic border-t border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                            {contentItems.map(item => (
                                <div key={item.key} dangerouslySetInnerHTML={{ __html: item.html }} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

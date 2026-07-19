/**
 * ToolCallGroupView — collapsible summary row for a group of consecutive
 * same-category tool calls (read / write / shell).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../../../../ui';
import { useBreakpoint } from '../../../../hooks/ui/useBreakpoint';
import type { ToolGroupCategory, GroupContentItem, GroupOrderedItem } from './toolGroupUtils';
import { getCategoryLabel, getToolGroupStatus, getShellGroupSemanticLabel } from './toolGroupUtils';
import type { DetectedCommit } from '../commitDetection';
import { CommitStrip } from '../CommitStrip';
import { useToolCallVariant } from './ToolCallVariant';

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
    /** Interleaved order of tools and content for faithful rendering. */
    orderedItems?: GroupOrderedItem[];
    compactness: 0 | 1 | 2 | 3;
    isStreaming?: boolean;
    /** The shared agent_id when category === 'agent'. */
    agentId?: string;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
    /** Git commits detected in this tool group's results. */
    commits?: DetectedCommit[];
    /** Workspace ID for commit detail navigation. */
    workspaceId?: string;
}

export const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📄',
    write: '✏️',
    shell: '💻',
    agent: '🤖',
};

/** Formats the startTime of the earliest tool call as `MM/DD h:mm AM/PM` (local time). */
export function groupStartLabel(toolCalls: RenderToolCall[]): string {
    const first = toolCalls.find(tc => tc.startTime);
    if (!first?.startTime) return '';
    const d = new Date(first.startTime);
    if (isNaN(d.getTime())) return '';
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm} ${ampm}`;
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
    orderedItems,
    compactness,
    isStreaming,
    agentId,
    renderToolTree,
    commits,
    workspaceId,
}: ToolCallGroupViewProps) {
    const [expanded, setExpanded] = useState(false);
    const { isMobile } = useBreakpoint();

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
    // Homogeneous shell groups (all Search / Read / Files / Git) get a semantic
    // summary; mixed or unknown groups keep the generic `N shell operations`.
    const semanticShellLabel = category === 'shell' ? getShellGroupSemanticLabel(toolCalls) : null;
    const summaryLabel = semanticShellLabel
        ?? getCategoryLabel(category, buildCounts(toolCalls.map(tc => tc.toolName)), agentId);
    const messageCount = contentItems?.length ?? 0;
    const startLabel   = groupStartLabel(toolCalls);
    const duration     = groupDuration(toolCalls);
    const isMinimal    = compactness === 2;
    const variant      = useToolCallVariant();
    const isWhisperRow = variant === 'whisper-row';

    return (
        <div
            className={cn(
                'tool-call-group my-0.5 md:my-1 rounded border text-xs',
                isWhisperRow
                    ? 'tool-call-group--whisper rounded-md border-[#e5e7eb] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e] overflow-hidden'
                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e]',
                isMinimal && !expanded && 'tool-call-group--minimal'
            )}
            data-category={category}
            data-tool-variant={isWhisperRow ? 'whisper-row' : 'card'}
        >
            {/* ── Header row ────────────────────────────────────────── */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                className={cn(
                    'tool-call-group-header flex items-center select-none cursor-pointer',
                    isWhisperRow
                        ? 'gap-2 px-3 py-2 text-[12.5px] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f5f5f4] dark:hover:bg-[#252525]'
                        : 'gap-1.5 px-2 py-1 md:gap-2 md:px-2.5 md:py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                    isMinimal && !expanded &&
                        'tool-call-group-header--minimal overflow-hidden max-h-6 transition-[max-height] duration-200'
                )}
                onClick={toggle}
                onKeyDown={handleKeyDown}
            >
                <span
                    className={cn(
                        'shrink-0',
                        isWhisperRow && 'text-[#1a7f37] dark:text-[#85e89d] text-[13px] w-[14px] text-center',
                    )}
                >
                    {statusIcon}
                </span>
                {!isWhisperRow && (
                    <span className="shrink-0">{CATEGORY_ICONS[category]}</span>
                )}

                <span
                    className={cn(
                        'tool-call-group-label truncate min-w-0',
                        isWhisperRow
                            ? 'font-medium text-[#1f2328] dark:text-[#cccccc]'
                            : 'font-medium text-[#0078d4] dark:text-[#3794ff]',
                    )}
                >
                    {summaryLabel}
                    {messageCount > 0 && (
                        <span
                            className={cn(
                                'font-normal',
                                isWhisperRow ? 'text-[#6b7280] dark:text-[#9aa0a6]' : 'text-[#848484]',
                            )}
                        >
                            {` + ${messageCount} message${messageCount > 1 ? 's' : ''}`}
                        </span>
                    )}
                </span>

                {statusSummary && (
                    <span
                        className={cn(
                            'tool-call-group-status font-medium shrink-0',
                            isWhisperRow ? 'text-[#9a6700] dark:text-[#d4a72c]' : 'text-[#c4a000] dark:text-[#e0c862]',
                        )}
                    >
                        ({statusSummary})
                    </span>
                )}

                {!isMobile && startLabel && (
                    <span
                        className={cn(
                            'shrink-0 ml-auto',
                            isWhisperRow
                                ? 'text-[#6b7280] dark:text-[#9aa0a6] font-mono text-[11.5px]'
                                : 'text-[#848484]',
                        )}
                    >
                        {startLabel}
                    </span>
                )}
                {duration && (
                    <span
                        className={cn(
                            'shrink-0',
                            (!startLabel || isMobile) && 'ml-auto',
                            isWhisperRow
                                ? 'text-[#6b7280] dark:text-[#9aa0a6] font-mono text-[11.5px] before:content-["·"] before:mx-1.5 before:text-[#9aa0a6]'
                                : 'text-[#848484]',
                        )}
                    >
                        {duration}
                    </span>
                )}

                {isWhisperRow ? (
                    <span
                        className={cn(
                            'tool-call-group-toggle inline-flex items-center gap-1 shrink-0',
                            'text-[#0969da] dark:text-[#79c0ff] text-[12px]',
                            !duration && (!startLabel || isMobile) && 'ml-auto',
                        )}
                        data-testid="whisper-group-toggle"
                    >
                        <span>{expanded ? 'Hide' : 'Show'}</span>
                        <span className="text-[9px]">{expanded ? '▾' : '▸'}</span>
                    </span>
                ) : (
                    <span className={cn('text-[#848484] shrink-0', !duration && (!startLabel || isMobile) && 'ml-auto')}>
                        {expanded ? '▼' : '▶'}
                    </span>
                )}
            </div>

            {/* ── Commit strip (visible in both collapsed and expanded states) ── */}
            {commits && commits.length > 0 && (
                <CommitStrip commits={commits} workspaceId={workspaceId} />
            )}

            {/* ── Expanded body ──────────────────────────────────────── */}
            {expanded && (
                <div
                    className={cn(
                        'tool-call-group-body border-t',
                        isWhisperRow
                            ? 'border-[#e5e7eb] dark:border-[#3c3c3c] bg-white dark:bg-[#252525]'
                            : 'border-[#e0e0e0] dark:border-[#3c3c3c] py-1',
                    )}
                >
                    {orderedItems ? (
                        orderedItems.map(item =>
                            item.type === 'tool' ? (
                                <React.Fragment key={item.toolId}>
                                    {renderToolTree(item.toolId, 0)}
                                </React.Fragment>
                            ) : (
                                <div
                                    key={item.key}
                                    className={cn(
                                        'tool-call-group-content px-2 py-0.5 md:px-3 md:py-1 text-xs italic',
                                        isWhisperRow
                                            ? 'text-[#6b7280] dark:text-[#9aa0a6] border-b border-dashed border-[#ececec] dark:border-[#3c3c3c]'
                                            : 'text-[#616161] dark:text-[#a0a0a0] border-t border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] mt-1',
                                    )}
                                    dangerouslySetInnerHTML={{ __html: item.html }}
                                />
                            )
                        )
                    ) : (
                        <>
                            {toolCalls.map(tc => (
                                <React.Fragment key={tc.id}>
                                    {renderToolTree(tc.id, 0)}
                                </React.Fragment>
                            ))}
                            {contentItems && contentItems.length > 0 && (
                                <div
                                    className={cn(
                                        'tool-call-group-content px-2 py-0.5 md:px-3 md:py-1 text-xs italic',
                                        isWhisperRow
                                            ? 'text-[#6b7280] dark:text-[#9aa0a6] border-t border-dashed border-[#ececec] dark:border-[#3c3c3c]'
                                            : 'text-[#616161] dark:text-[#a0a0a0] border-t border-dashed border-[#e0e0e0] dark:border-[#3c3c3c] mt-1',
                                    )}
                                >
                                    {contentItems.map(item => (
                                        <div key={item.key} dangerouslySetInnerHTML={{ __html: item.html }} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

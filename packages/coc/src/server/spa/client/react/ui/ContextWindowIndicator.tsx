/**
 * ContextWindowIndicator — displays current context window usage as a progress bar.
 *
 * When breakdown props (systemTokens / toolDefinitionsTokens / conversationTokens) are
 * provided (Copilot SDK only), renders a segmented bar:
 *   purple  — system prompt
 *   blue    — tool definitions
 *   green   — conversation
 *   gray    — other / uncategorised
 *
 * Falls back to a single-colour fill (green/yellow/red at 50%/80% thresholds) when
 * the breakdown is not available.
 *
 * A breakdown popover appears on hover (desktop) or tap (mobile) when breakdown data
 * is present, listing each category's token count and percentage of the limit.
 *
 * Hidden when tokenLimit is not yet known.
 */

import React, { useState } from 'react';
import { cn } from './cn';

export interface ContextWindowIndicatorProps {
    /** Total context window size in tokens */
    tokenLimit?: number;
    /** Tokens currently occupying the context */
    currentTokens?: number;
    /** Optional model name to display to the left of the ctx label */
    modelName?: string;
    className?: string;
    /** System-prompt token count (Copilot SDK only) */
    systemTokens?: number;
    /** Tool-definition token count (Copilot SDK only) */
    toolDefinitionsTokens?: number;
    /** Conversation-history token count (Copilot SDK only) */
    conversationTokens?: number;
}

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function ContextWindowIndicator({
    tokenLimit,
    currentTokens,
    modelName,
    className,
    systemTokens,
    toolDefinitionsTokens,
    conversationTokens,
}: ContextWindowIndicatorProps) {
    const [popoverOpen, setPopoverOpen] = useState(false);

    if (!tokenLimit || tokenLimit <= 0) return null;

    const used = currentTokens ?? 0;
    const pct = Math.min(100, (used / tokenLimit) * 100);

    const hasBreakdown =
        systemTokens != null && toolDefinitionsTokens != null && conversationTokens != null;

    // Single-bar colour (used when no breakdown, and for the outer threshold border)
    const singleBarColor =
        pct > 80 ? 'bg-red-500 dark:bg-red-400' :
        pct > 50 ? 'bg-yellow-500 dark:bg-yellow-400' :
                   'bg-green-500 dark:bg-green-400';

    // Segment widths as percentage of tokenLimit
    const sysPct    = hasBreakdown ? Math.min(100, (systemTokens!           / tokenLimit) * 100) : 0;
    const toolPct   = hasBreakdown ? Math.min(100, (toolDefinitionsTokens!  / tokenLimit) * 100) : 0;
    const convPct   = hasBreakdown ? Math.min(100, (conversationTokens!     / tokenLimit) * 100) : 0;
    const knownPct  = sysPct + toolPct + convPct;
    const otherTokens = hasBreakdown
        ? Math.max(0, used - systemTokens! - toolDefinitionsTokens! - conversationTokens!)
        : 0;
    const otherPct  = hasBreakdown ? Math.max(0, pct - knownPct) : 0;

    const ariaLabel = `Context window: ${formatTokenCount(used)} / ${formatTokenCount(tokenLimit)} tokens (${pct.toFixed(1)}%)`;

    const breakdownRows = hasBreakdown ? [
        { label: 'System prompt',    tokens: systemTokens!,          dotClass: 'bg-purple-500 dark:bg-purple-400' },
        { label: 'Tool definitions', tokens: toolDefinitionsTokens!, dotClass: 'bg-blue-500 dark:bg-blue-400' },
        { label: 'Conversation',     tokens: conversationTokens!,    dotClass: 'bg-green-500 dark:bg-green-400' },
        { label: 'Other',            tokens: otherTokens,            dotClass: 'bg-gray-400 dark:bg-gray-500' },
    ] : [];

    return (
        <div
            className={cn('flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 relative', className)}
            aria-label={ariaLabel}
            data-testid="context-window-indicator"
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
            onClick={() => setPopoverOpen(v => !v)}
        >
            {modelName && <span className="shrink-0 whitespace-nowrap">{modelName}</span>}
            <span className="shrink-0 whitespace-nowrap">ctx</span>

            {/* Progress bar — segmented when breakdown available, single colour otherwise */}
            <div className="relative flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden min-w-[60px]">
                {hasBreakdown ? (
                    <>
                        {sysPct > 0 && (
                            <div
                                className="absolute inset-y-0 left-0 bg-purple-500 dark:bg-purple-400"
                                style={{ width: `${sysPct}%` }}
                                data-testid="ctx-segment-system"
                            />
                        )}
                        {toolPct > 0 && (
                            <div
                                className="absolute inset-y-0 bg-blue-500 dark:bg-blue-400"
                                style={{ left: `${sysPct}%`, width: `${toolPct}%` }}
                                data-testid="ctx-segment-tools"
                            />
                        )}
                        {convPct > 0 && (
                            <div
                                className="absolute inset-y-0 bg-green-500 dark:bg-green-400"
                                style={{ left: `${sysPct + toolPct}%`, width: `${convPct}%` }}
                                data-testid="ctx-segment-conversation"
                            />
                        )}
                        {otherPct > 0 && (
                            <div
                                className="absolute inset-y-0 bg-gray-400 dark:bg-gray-500"
                                style={{ left: `${knownPct}%`, width: `${otherPct}%` }}
                                data-testid="ctx-segment-other"
                            />
                        )}
                    </>
                ) : (
                    <div
                        className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', singleBarColor)}
                        style={{ width: `${pct}%` }}
                        data-testid="context-window-bar"
                    />
                )}
            </div>

            <span className="shrink-0 whitespace-nowrap tabular-nums" data-testid="context-window-label">
                {formatTokenCount(used)}/{formatTokenCount(tokenLimit)}
            </span>

            {/* Breakdown popover — shown on hover/tap; full breakdown when available, simple total otherwise */}
            {popoverOpen && (
                <div
                    className="absolute bottom-full left-0 mb-2 z-50 bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md shadow-lg p-3 min-w-[220px] text-xs pointer-events-auto"
                    data-testid="ctx-breakdown-popover"
                    onMouseEnter={() => setPopoverOpen(true)}
                    onMouseLeave={() => setPopoverOpen(false)}
                    onClick={(e) => e.stopPropagation()}
                >
                    <table className="w-full border-collapse">
                        {hasBreakdown && (
                            <thead>
                                <tr className="text-[#848484] dark:text-[#999999]">
                                    <th className="text-left font-medium pb-1.5 pr-3">Category</th>
                                    <th className="text-right font-medium pb-1.5 pr-2">Tokens</th>
                                    <th className="text-right font-medium pb-1.5">% of limit</th>
                                </tr>
                            </thead>
                        )}
                        {hasBreakdown && (
                            <tbody>
                                {breakdownRows.map(row => (
                                    <tr key={row.label}>
                                        <td className="py-0.5 pr-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn('inline-block w-2 h-2 rounded-sm flex-shrink-0', row.dotClass)} />
                                                <span className="text-[#1e1e1e] dark:text-[#cccccc]">{row.label}</span>
                                            </div>
                                        </td>
                                        <td className="text-right tabular-nums text-[#1e1e1e] dark:text-[#cccccc] py-0.5 pr-2">
                                            {formatTokenCount(row.tokens)}
                                        </td>
                                        <td className="text-right tabular-nums text-[#848484] dark:text-[#999999] py-0.5">
                                            {((row.tokens / tokenLimit) * 100).toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        )}
                        <tfoot>
                            <tr className={cn('font-medium', hasBreakdown && 'border-t border-[#e0e0e0] dark:border-[#3c3c3c]')}>
                                <td className="pt-1.5 text-[#1e1e1e] dark:text-[#cccccc]">Total</td>
                                <td className="text-right tabular-nums text-[#1e1e1e] dark:text-[#cccccc] pt-1.5 pr-2">
                                    {formatTokenCount(used)}&nbsp;/&nbsp;{formatTokenCount(tokenLimit)}
                                </td>
                                <td className="text-right tabular-nums text-[#848484] dark:text-[#999999] pt-1.5">
                                    {pct.toFixed(1)}%
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}

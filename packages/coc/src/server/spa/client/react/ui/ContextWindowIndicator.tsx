/**
 * ContextWindowIndicator — displays current context window usage as a progress bar.
 *
 * When breakdown props (systemTokens / toolDefinitionsTokens / conversationTokens) are
 * provided by the active provider, renders a segmented bar:
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
 * Hidden when tokenLimit is not yet known. Sentinel chats pass `autoCompact`,
 * which adds a threshold marker, a status badge and the auto-compact section.
 */

import React from 'react';
import { cn } from './cn';
import {
    CONTEXT_POPOVER_CLASS, CONTEXT_TRIGGER_CLASS, ContextAutoCompactBadge, ContextThresholdMarker, ContextUsageBreakdown,
    formatTokenCount, useContextUsagePopover, type ContextAutoCompact,
} from './ContextUsagePopover';

export interface ContextWindowIndicatorProps {
    /** Total context window size in tokens */
    tokenLimit?: number;
    /** Tokens currently occupying the context */
    currentTokens?: number;
    /** Optional model name to display to the left of the ctx label */
    modelName?: string;
    className?: string;
    /** System-prompt token count when the provider reports a breakdown */
    systemTokens?: number;
    /** Tool-definition token count when the provider reports a breakdown */
    toolDefinitionsTokens?: number;
    /** Conversation-history token count when the provider reports a breakdown */
    conversationTokens?: number;
    /** Sentinel auto-compact state and popover section. */
    autoCompact?: ContextAutoCompact;
}

export function ContextWindowIndicator({
    tokenLimit,
    currentTokens,
    modelName,
    className,
    systemTokens,
    toolDefinitionsTokens,
    conversationTokens,
    autoCompact,
}: ContextWindowIndicatorProps) {
    const popover = useContextUsagePopover();

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

    const ariaLabel = `Context window: ${formatTokenCount(used)} / ${formatTokenCount(tokenLimit)} tokens (${pct.toFixed(1)}%)${autoCompact ? ` · ${autoCompact.label}` : ''}`;

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
            {...popover.containerProps}
        >
            <button {...popover.triggerProps} aria-label={ariaLabel} className={cn(CONTEXT_TRIGGER_CLASS, 'flex-1 gap-2 min-w-0')}>
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
                <ContextThresholdMarker autoCompact={autoCompact} testId="ctx-threshold-marker" />
            </div>

            <span className="shrink-0 whitespace-nowrap tabular-nums" data-testid="context-window-label">
                {formatTokenCount(used)}/{formatTokenCount(tokenLimit)}
            </span>
            <ContextAutoCompactBadge autoCompact={autoCompact} testId="ctx-autocompact-badge" />
            </button>

            {/* Breakdown popover — hover previews, click/Enter pins; full breakdown when available, simple total otherwise */}
            {popover.open && (
                <div
                    className={cn(CONTEXT_POPOVER_CLASS, autoCompact && 'w-[300px] max-w-[calc(100vw-1rem)]')}
                    data-testid="ctx-breakdown-popover"
                    role={autoCompact ? 'dialog' : undefined}
                    aria-label={autoCompact ? 'Context usage' : undefined}
                    {...popover.popoverProps}
                >
                    <ContextUsageBreakdown used={used} limit={tokenLimit} pct={pct} rows={breakdownRows} />
                    {autoCompact?.panel}
                </div>
            )}
        </div>
    );
}

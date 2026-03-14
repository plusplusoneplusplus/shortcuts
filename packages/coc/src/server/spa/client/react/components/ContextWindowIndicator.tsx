/**
 * ContextWindowIndicator — displays current context window usage as a progress bar.
 *
 * Shows: currentTokens / tokenLimit with colour-coded fill:
 *   green  (<50%)
 *   yellow (50–80%)
 *   red    (>80%)
 *
 * Hidden when tokenLimit is not yet known.
 */

import React from 'react';
import { cn } from '../shared/cn';

interface ContextWindowIndicatorProps {
    /** Total context window size in tokens */
    tokenLimit?: number;
    /** Tokens currently occupying the context */
    currentTokens?: number;
    /** Optional model name to display to the left of the ctx label */
    modelName?: string;
    className?: string;
}

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function ContextWindowIndicator({ tokenLimit, currentTokens, modelName, className }: ContextWindowIndicatorProps) {
    if (!tokenLimit || tokenLimit <= 0) return null;

    const used = currentTokens ?? 0;
    const pct = Math.min(100, (used / tokenLimit) * 100);

    const barColor =
        pct > 80 ? 'bg-red-500 dark:bg-red-400' :
        pct > 50 ? 'bg-yellow-500 dark:bg-yellow-400' :
                   'bg-green-500 dark:bg-green-400';

    const label = `${formatTokenCount(used)} / ${formatTokenCount(tokenLimit)} tokens (${pct.toFixed(1)}%)`;
    const ariaLabel = `Context window: ${label}`;

    return (
        <div
            className={cn('flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400', className)}
            title={ariaLabel}
            aria-label={ariaLabel}
            data-testid="context-window-indicator"
        >
            {modelName && <span className="shrink-0 whitespace-nowrap">{modelName}</span>}
            <span className="shrink-0 whitespace-nowrap">ctx</span>
            <div className="relative flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden min-w-[60px]">
                <div
                    className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', barColor)}
                    style={{ width: `${pct}%` }}
                    data-testid="context-window-bar"
                />
            </div>
            <span className="shrink-0 whitespace-nowrap tabular-nums" data-testid="context-window-label">{formatTokenCount(used)}/{formatTokenCount(tokenLimit)}</span>
        </div>
    );
}

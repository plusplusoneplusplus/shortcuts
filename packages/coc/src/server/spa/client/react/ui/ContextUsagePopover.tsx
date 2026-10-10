/**
 * Shared pieces of the context-usage popover rendered by both
 * `ContextWindowIndicator` and the composer `ComposerMetaStrip` gauge:
 * open/pin/keyboard behavior, the category/token/% breakdown table with its
 * model footer, and the optional auto-compact threshold marker + status badge.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

/** Pill-level auto-compact state for a context gauge. */
export type ContextAutoCompactStatus = 'off' | 'enabled' | 'queued' | 'running' | 'paused';

export interface ContextAutoCompact {
    status: ContextAutoCompactStatus;
    /** Saved threshold percent; drawn as a marker on the bar when status is not `off`. */
    thresholdPercent: number;
    /** Short status phrase appended to the gauge's accessible label. */
    label: string;
    /** The popover section (Sentinel chats only). */
    panel: React.ReactNode;
}

/**
 * Hover previews the popover; click/Enter pins it so its controls can be used.
 * Focus inside keeps it open, Escape closes it and returns focus to the
 * trigger, and an outside press closes a pinned popover.
 */
export function useContextUsagePopover() {
    const [hovered, setHovered] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const containerRef = useRef<HTMLSpanElement & HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const open = hovered || pinned || focusWithin;

    const close = useCallback(() => {
        setHovered(false);
        setPinned(false);
        setFocusWithin(false);
        triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!pinned) return;
        const onPointerDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setPinned(false);
                setFocusWithin(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [pinned]);

    const containerProps = {
        ref: containerRef,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onClick: () => setPinned(value => !value),
        onFocus: (event: React.FocusEvent) => { if (event.target !== triggerRef.current) setFocusWithin(true); },
        onBlur: (event: React.FocusEvent) => {
            if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
        },
        onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Escape' && open) {
                event.stopPropagation();
                close();
            }
        },
    };
    const triggerProps = {
        ref: triggerRef,
        type: 'button' as const,
        'aria-expanded': open,
        'aria-haspopup': 'dialog' as const,
    };
    const popoverProps = {
        onMouseEnter: () => setHovered(true),
        onClick: (event: React.MouseEvent) => event.stopPropagation(),
    };
    return { open, containerProps, triggerProps, popoverProps };
}

/** Unstyled button reset so the trigger keeps the gauge's existing look. */
export const CONTEXT_TRIGGER_CLASS = 'inline-flex items-center bg-transparent border-0 p-0 m-0 text-inherit font-inherit cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#0078d4] dark:focus-visible:outline-[#3794ff]';

export interface ContextBreakdownRow {
    label: string;
    tokens: number;
    dotClass: string;
}

export function ContextUsageBreakdown({ used, limit, pct, rows, modelName, modelTestId }: {
    used: number;
    limit: number;
    pct: number;
    rows: ContextBreakdownRow[];
    modelName?: string;
    modelTestId?: string;
}) {
    const hasBreakdown = rows.length > 0;
    return (
        <>
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
                        {rows.map(row => (
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
                                    {((row.tokens / limit) * 100).toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                )}
                <tfoot>
                    <tr className={cn('font-medium', hasBreakdown && 'border-t border-[#e0e0e0] dark:border-[#3c3c3c]')}>
                        <td className="pt-1.5 text-[#1e1e1e] dark:text-[#cccccc]">Total</td>
                        <td className="text-right tabular-nums text-[#1e1e1e] dark:text-[#cccccc] pt-1.5 pr-2">
                            {formatTokenCount(used)}&nbsp;/&nbsp;{formatTokenCount(limit)}
                        </td>
                        <td className="text-right tabular-nums text-[#848484] dark:text-[#999999] pt-1.5">
                            {pct.toFixed(1)}%
                        </td>
                    </tr>
                </tfoot>
            </table>
            {modelName && (
                <div className="mt-1.5 pt-1.5 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-[#848484] dark:text-[#999999] truncate" data-testid={modelTestId}>
                    {modelName}
                </div>
            )}
        </>
    );
}

/** Threshold tick drawn over a gauge bar. */
export function ContextThresholdMarker({ autoCompact, testId }: { autoCompact?: ContextAutoCompact; testId: string }) {
    if (!autoCompact || autoCompact.status === 'off') return null;
    return (
        <span
            aria-hidden="true"
            data-testid={testId}
            className="absolute inset-y-0 w-px bg-[#1e1e1e] dark:bg-[#ffffff] opacity-70"
            style={{ left: `${autoCompact.thresholdPercent}%` }}
        />
    );
}

const BADGE_TONE: Record<Exclude<ContextAutoCompactStatus, 'off'>, string> = {
    enabled: 'text-[#5a5a5a] dark:text-[#999999]',
    queued: 'text-[#e8912d] dark:text-[#cca700]',
    running: 'text-[#0078d4] dark:text-[#3794ff] motion-safe:animate-pulse',
    paused: 'text-[#f14c4c] dark:text-[#f48771]',
};

/** Small compress glyph showing auto-compact is on, queued, running or paused. */
export function ContextAutoCompactBadge({ autoCompact, testId }: { autoCompact?: ContextAutoCompact; testId: string }) {
    if (!autoCompact || autoCompact.status === 'off') return null;
    return (
        <span aria-hidden="true" data-testid={testId} data-state={autoCompact.status}
            className={cn('inline-flex flex-shrink-0', BADGE_TONE[autoCompact.status])}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2l4 4 4-4M4 14l4-4 4 4M2 8h12" />
            </svg>
        </span>
    );
}

export const CONTEXT_POPOVER_CLASS = 'absolute bottom-full right-0 mb-2 z-50 bg-white dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md shadow-lg p-3 min-w-[220px] text-xs pointer-events-auto';

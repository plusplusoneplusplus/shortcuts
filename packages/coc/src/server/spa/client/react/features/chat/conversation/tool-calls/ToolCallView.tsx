/**
 * ToolCallView — renders a single tool call with collapsible args/result.
 *
 * All display policy (normalized identity, parsed args, summary, detail-section
 * inputs, result truncation, preview eligibility, metrics, duration/start
 * labels) is computed by the pure `buildToolCallRenderModel` kernel. This file
 * owns only the variant-specific header chrome, hover-popover wiring, and the
 * shared `ToolCallDetailSections` body.
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { cn } from '../../../../ui';
import { ToolResultPopover } from './ToolResultPopover';
import { useBreakpoint } from '../../../../hooks/ui/useBreakpoint';
import { useToolCallVariant } from './ToolCallVariant';
import { buildToolCallRenderModel, statusIndicator } from './toolCallRenderModel';
import { ToolCallDetailSections } from './ToolCallDetailSections';

interface ToolCallData {
    id?: string;
    toolName?: string;
    name?: string;
    args?: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
    children?: ToolCallData[];
}

interface ToolCallProps {
    toolCall: ToolCallData;
    depth?: number;
    hasSubtools?: boolean;
    subtoolsCollapsed?: boolean;
    onToggleSubtools?: () => void;
    children?: React.ReactNode;
}

export function ToolCallView({
    toolCall,
    depth = 0,
    hasSubtools = false,
    subtoolsCollapsed = false,
    onToggleSubtools,
    children,
}: ToolCallProps) {
    const variant = useToolCallVariant();
    const model = useMemo(() => buildToolCallRenderModel(toolCall, variant), [toolCall, variant]);
    const [expanded, setExpanded] = useState(model.isTaskComplete);
    const [hoverVisible, setHoverVisible] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { isMobile } = useBreakpoint();

    const { name, hasDetails, hasHoverResult, summaryIsPath, summaryFullPath } = model;

    const clearTimers = useCallback(() => {
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    }, []);

    const handleHeaderMouseEnter = useCallback(() => {
        if (!hasHoverResult) return;
        clearTimers();
        hoverTimerRef.current = setTimeout(() => {
            if (headerRef.current) {
                setAnchorRect(headerRef.current.getBoundingClientRect());
                setHoverVisible(true);
            }
        }, 300);
    }, [hasHoverResult, clearTimers]);

    const handleHeaderMouseLeave = useCallback(() => {
        if (!hasHoverResult) return;
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        graceTimerRef.current = setTimeout(() => setHoverVisible(false), 100);
    }, [hasHoverResult]);

    const handlePopoverMouseEnter = useCallback(() => {
        if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    }, []);

    const handlePopoverMouseLeave = useCallback(() => {
        setHoverVisible(false);
    }, []);

    const handleMobilePreviewTap = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!hasHoverResult) return;
        if (headerRef.current) {
            setAnchorRect(headerRef.current.getBoundingClientRect());
            setHoverVisible(true);
        }
    }, [hasHoverResult]);

    if (depth > 20) return null;

    const depthLevel = Math.max(0, Math.min(depth, 8));
    const isWhisperRow = variant === 'whisper-row';

    const hoverPopover = hoverVisible && anchorRect && hasHoverResult ? (
        <ToolResultPopover
            result={model.popoverResultText}
            toolName={name}
            args={model.argsObj ?? undefined}
            anchorRect={anchorRect}
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handlePopoverMouseLeave}
        />
    ) : null;

    if (isWhisperRow) {
        return (
            <div
                className={cn(
                    'tool-call-row tool-call-row--whisper group/row',
                    'border-b border-[#ececec] dark:border-[#3c3c3c] last:border-b-0',
                    'bg-white dark:bg-[#252525]',
                    'hover:bg-[#fafafa] dark:hover:bg-[#2a2a2a]',
                    'select-text',
                )}
                data-tool-id={model.id}
                data-tool-variant="whisper-row"
                data-tool-kind={model.kindInfo.cls}
                style={depthLevel > 0 ? { marginLeft: `${depthLevel * (isMobile ? 8 : 12)}px` } : undefined}
            >
                <div
                    ref={headerRef}
                    className={cn(
                        'tool-call-row-header flex items-center gap-2.5 px-3 py-1 font-mono text-[12px]',
                        'text-[#2c2f33] dark:text-[#cccccc]',
                        hasDetails && 'cursor-pointer',
                        model.isRunning && 'tool-call-row--running',
                    )}
                    onClick={(e) => {
                        if ((e.target as HTMLElement).closest?.('.file-path-link')) return;
                        if (hasDetails) setExpanded(!expanded);
                    }}
                    onMouseEnter={!isMobile ? handleHeaderMouseEnter : undefined}
                    onMouseLeave={!isMobile ? handleHeaderMouseLeave : undefined}
                    role={hasDetails ? 'button' : undefined}
                    aria-expanded={hasDetails ? expanded : undefined}
                >
                    <span
                        className={cn(
                            'tool-call-kind shrink-0 inline-block min-w-[42px] text-center px-2 py-px rounded-sm font-mono text-[11px] font-medium',
                            model.isRunning
                                ? 'bg-[#f5f5f4] text-[#6b7280] dark:bg-[#3c3c3c] dark:text-[#9aa0a6]'
                                : model.kindPillClass,
                        )}
                        data-testid="tool-call-kind"
                    >
                        {model.kindInfo.label}
                    </span>
                    {hasSubtools && (
                        <button
                            type="button"
                            className="text-[#9aa0a6] hover:text-[#1f2328] dark:hover:text-[#cccccc] shrink-0 text-[10px]"
                            aria-label={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                            title={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleSubtools?.();
                            }}
                        >
                            {subtoolsCollapsed ? '▶' : '▼'}
                        </button>
                    )}
                    <span
                        className={cn(
                            'tool-call-row-path flex-1 min-w-0 truncate text-[#2c2f33] dark:text-[#cccccc]',
                            summaryIsPath && 'file-path-link',
                        )}
                        title={model.rowSummary}
                        {...(summaryIsPath ? { 'data-full-path': summaryFullPath, 'data-no-preview-hover': '' } : {})}
                    >
                        {model.rowSummary || <span className="text-[#9aa0a6] italic">{name}</span>}
                    </span>
                    {model.metric && (
                        <span
                            className="tool-call-row-metric shrink-0 font-mono text-[11.5px] text-[#6b7280] dark:text-[#9aa0a6]"
                            data-testid="tool-call-metric"
                        >
                            {model.metric.kind === 'diff' ? (
                                <>
                                    {(model.metric.insertions ?? 0) > 0 && (
                                        <span className="text-[#1a7f37] dark:text-[#85e89d] font-medium">+{model.metric.insertions}</span>
                                    )}
                                    {(model.metric.insertions ?? 0) > 0 && (model.metric.deletions ?? 0) > 0 && ' '}
                                    {(model.metric.deletions ?? 0) > 0 && (
                                        <span className="text-[#cf222e] dark:text-[#f97583] font-medium">−{model.metric.deletions}</span>
                                    )}
                                </>
                            ) : (
                                model.metric.text
                            )}
                        </span>
                    )}
                    {model.duration && (
                        <span className="tool-call-row-duration shrink-0 font-mono text-[11px] text-[#9aa0a6] dark:text-[#6b7280]">
                            {model.duration}
                        </span>
                    )}
                    {isMobile && hasHoverResult && (
                        <button
                            type="button"
                            className="text-[#9aa0a6] hover:text-[#0969da] dark:hover:text-[#79c0ff] shrink-0 text-[11px]"
                            aria-label="Preview result"
                            title="Preview result"
                            data-testid="mobile-preview-btn"
                            onClick={handleMobilePreviewTap}
                        >
                            👁
                        </button>
                    )}
                    {hasDetails && (
                        <span className="text-[#9aa0a6] shrink-0 text-[10px]">{expanded ? '▼' : '▶'}</span>
                    )}
                </div>
                {hasDetails && expanded && (
                    <div className="tool-call-row-body border-t border-[#ececec] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e] px-3 py-1.5 space-y-1.5 text-xs select-text">
                        <ToolCallDetailSections model={model} errorClassName="text-[#cf222e]" />
                    </div>
                )}
                {children && (
                    <div className={cn('tool-call-children', subtoolsCollapsed && 'subtree-collapsed')}>
                        {children}
                    </div>
                )}
                {hoverPopover}
            </div>
        );
    }

    return (
        <div
            className={cn(
                'tool-call-card my-0.5 md:my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
                depthLevel > 0 && 'border-l-2'
            )}
            data-tool-id={model.id}
            style={depthLevel > 0 ? { marginLeft: `${depthLevel * (isMobile ? 8 : 12)}px` } : undefined}
        >
            <div
                ref={headerRef}
                className={cn(
                    'tool-call-header flex items-center gap-1.5 px-2 py-1 md:gap-2 md:px-2.5 md:py-1.5 cursor-pointer select-none',
                    hasDetails && 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                )}
                onClick={(e) => {
                    if ((e.target as HTMLElement).closest?.('.file-path-link')) return;
                    hasDetails && setExpanded(!expanded);
                }}
                onMouseEnter={!isMobile ? handleHeaderMouseEnter : undefined}
                onMouseLeave={!isMobile ? handleHeaderMouseLeave : undefined}
            >
                <span>{statusIndicator(model.status)}</span>
                {hasSubtools && (
                    <button
                        type="button"
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        aria-label={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                        title={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleSubtools?.();
                        }}
                    >
                        {subtoolsCollapsed ? '▶' : '▼'}
                    </button>
                )}
                <span className="tool-call-name font-medium text-[#0078d4] dark:text-[#3794ff]">{name}</span>
                {model.summary && (
                    <span
                        className={cn('text-[#848484] min-w-0', isMobile ? 'truncate max-w-[40vw]' : 'break-all', summaryIsPath && 'file-path-link')}
                        title={model.summary}
                        {...(summaryIsPath ? { 'data-full-path': summaryFullPath, 'data-no-preview-hover': '' } : {})}
                    >
                        {model.summary}
                    </span>
                )}
                {!isMobile && model.startTimeLabel && (
                    <span className="text-[#848484] ml-auto shrink-0">{model.startTimeLabel}</span>
                )}
                {model.duration && (
                    <span className={cn('text-[#848484] shrink-0', (!model.startTimeLabel || isMobile) && 'ml-auto')}>{model.duration}</span>
                )}
                {isMobile && hasHoverResult && (
                    <button
                        type="button"
                        className={cn('text-[#848484] hover:text-[#0078d4] dark:hover:text-[#3794ff] shrink-0',
                            !model.duration && 'ml-auto')}
                        aria-label="Preview result"
                        title="Preview result"
                        data-testid="mobile-preview-btn"
                        onClick={handleMobilePreviewTap}
                    >
                        👁
                    </button>
                )}
                {hasDetails && (
                    <span className={cn('text-[#848484]', !model.duration && !model.startTimeLabel && !isMobile && 'ml-auto')}>{expanded ? '▼' : '▶'}</span>
                )}
            </div>
            {hasDetails && (
                <div className={cn(
                    'tool-call-body border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-1.5 space-y-1.5 md:px-2.5 md:py-2 md:space-y-2 select-text',
                    !expanded && 'collapsed',
                    !expanded && 'hidden'
                )}>
                    <ToolCallDetailSections model={model} errorClassName="text-[#f14c4c]" />
                </div>
            )}
            {children && (
                <div className={cn('tool-call-children', subtoolsCollapsed && 'subtree-collapsed')}>
                    {children}
                </div>
            )}
            {hoverPopover}
        </div>
    );
}

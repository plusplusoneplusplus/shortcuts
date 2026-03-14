/**
 * ConversationMiniMap — compact vertical overview of conversation turns.
 *
 * Shows colored strips proportional to turn content length.  Users can click a
 * strip to smooth-scroll to that turn, or drag the viewport indicator to scrub
 * through the conversation.  Collapses automatically on narrow viewports and
 * supports Alt+M toggling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientConversationTurn } from '../types/dashboard';

// ── Constants ──────────────────────────────────────────────────────────

const MIN_STRIP_HEIGHT = 4;
const MAX_STRIP_HEIGHT = 40;
const MINIMAP_WIDTH = 80;
const COLLAPSED_WIDTH = 12;
const MIN_TURNS_TO_SHOW = 5;
const NARROW_VIEWPORT_PX = 900;
const SCROLL_THROTTLE_MS = 100;
const HEAVY_TOOL_THRESHOLD = 3;

// ── Helpers ────────────────────────────────────────────────────────────

interface StripInfo {
    index: number;
    color: string;
    height: number;
    label: string;
    tooltipRole: string;
    tooltipTime: string;
    tooltipPreview: string;
    landmark: string | null;
}

function getTurnColor(turn: ClientConversationTurn): string {
    if (turn.streaming) return 'var(--minimap-streaming)';
    if (turn.historical) return 'var(--minimap-historical)';
    if (turn.role === 'user') return 'var(--minimap-user)';
    // assistant
    const hasError = turn.toolCalls?.some(tc => tc.status === 'failed' || tc.error);
    if (hasError) return 'var(--minimap-error)';
    const hasTools = turn.toolCalls && turn.toolCalls.length > 0;
    if (hasTools) return 'var(--minimap-tool)';
    return 'var(--minimap-assistant)';
}

function getTurnContentLength(turn: ClientConversationTurn): number {
    let len = (turn.content || '').length;
    if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
            len += (tc.result || '').length + (tc.args ? JSON.stringify(tc.args).length : 0);
        }
    }
    return len;
}

function computeStripHeights(turns: ClientConversationTurn[]): number[] {
    if (turns.length === 0) return [];
    const lengths = turns.map(getTurnContentLength);
    const maxLen = Math.max(...lengths, 1);
    return lengths.map(len => {
        const ratio = len / maxLen;
        return Math.round(MIN_STRIP_HEIGHT + ratio * (MAX_STRIP_HEIGHT - MIN_STRIP_HEIGHT));
    });
}

function getLandmark(turn: ClientConversationTurn, index: number, turns: ClientConversationTurn[]): string | null {
    // First user message
    if (turn.role === 'user' && index === turns.findIndex(t => t.role === 'user')) {
        return '▶';
    }
    // Turns with errors
    const hasError = turn.toolCalls?.some(tc => tc.status === 'failed' || tc.error);
    if (hasError) return '⚠';
    // Heavy tool activity
    if (turn.toolCalls && turn.toolCalls.length >= HEAVY_TOOL_THRESHOLD) return '⚡';
    return null;
}

function formatTime(timestamp?: string): string {
    if (!timestamp) return '';
    try {
        const d = new Date(timestamp);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function buildStrips(turns: ClientConversationTurn[]): StripInfo[] {
    const heights = computeStripHeights(turns);
    return turns.map((turn, i) => ({
        index: i,
        color: getTurnColor(turn),
        height: heights[i],
        label: `Turn ${i + 1}`,
        tooltipRole: turn.role === 'user' ? 'User' : 'Assistant',
        tooltipTime: formatTime(turn.timestamp),
        tooltipPreview: (turn.content || '').slice(0, 60),
        landmark: getLandmark(turn, i, turns),
    }));
}

// ── Props ──────────────────────────────────────────────────────────────

export interface ConversationMiniMapProps {
    turns: ClientConversationTurn[];
    /** Ref to the scrollable container (the outer overflow-y-auto div) */
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    /** Ref to the turns container whose children correspond 1:1 to `turns` */
    turnsContainerRef: React.RefObject<HTMLElement | null>;
    /** Whether the process is currently streaming */
    isStreaming?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────

export function ConversationMiniMap({
    turns,
    scrollContainerRef,
    turnsContainerRef,
    isStreaming,
}: ConversationMiniMapProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [narrowViewport, setNarrowViewport] = useState(false);
    const [viewportTop, setViewportTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; strip: StripInfo } | null>(null);
    const [userScrolledUp, setUserScrolledUp] = useState(false);

    const minimapRef = useRef<HTMLDivElement>(null);
    const stripAreaRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const strips = useMemo(() => buildStrips(turns), [turns]);
    const totalStripHeight = useMemo(() => strips.reduce((sum, s) => sum + s.height + 2, 0), [strips]); // +2 for gap

    const isVisible = turns.length >= MIN_TURNS_TO_SHOW;
    const isCollapsed = collapsed || narrowViewport;

    // ── Responsive collapse ────────────────────────────────────────────

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX}px)`);
        setNarrowViewport(mql.matches);
        const handler = (e: MediaQueryListEvent) => setNarrowViewport(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);

    // ── Keyboard shortcut (Alt+M) ─────────────────────────────────────

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.altKey && e.code === 'KeyM') {
                e.preventDefault();
                setCollapsed(prev => !prev);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // ── Sync viewport indicator with scroll position ──────────────────

    const updateViewportIndicator = useCallback(() => {
        const sc = scrollContainerRef.current;
        const sa = stripAreaRef.current;
        if (!sc || !sa) return;

        const scrollRatio = sc.scrollTop / Math.max(sc.scrollHeight - sc.clientHeight, 1);
        const visibleRatio = sc.clientHeight / Math.max(sc.scrollHeight, 1);
        const saHeight = sa.clientHeight;

        setViewportTop(scrollRatio * saHeight * (1 - visibleRatio));
        setViewportHeight(Math.max(visibleRatio * saHeight, 16));

        // Track whether user has scrolled up during streaming
        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 40;
        setUserScrolledUp(!atBottom && !!isStreaming);
    }, [scrollContainerRef, isStreaming]);

    useEffect(() => {
        const sc = scrollContainerRef.current;
        if (!sc) return;

        const onScroll = () => {
            if (scrollThrottleRef.current) return;
            scrollThrottleRef.current = setTimeout(() => {
                scrollThrottleRef.current = null;
                updateViewportIndicator();
            }, SCROLL_THROTTLE_MS);
        };

        sc.addEventListener('scroll', onScroll, { passive: true });
        updateViewportIndicator();
        return () => sc.removeEventListener('scroll', onScroll);
    }, [scrollContainerRef, updateViewportIndicator]);

    // Re-calc on turns change
    useEffect(() => {
        updateViewportIndicator();
    }, [turns.length, updateViewportIndicator]);

    // ── Click-to-navigate ─────────────────────────────────────────────

    const scrollToTurn = useCallback((index: number) => {
        const tc = turnsContainerRef.current;
        if (!tc) return;
        const el = tc.children[index] as HTMLElement | undefined;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Brief highlight pulse
        el.classList.add('minimap-highlight-pulse');
        setTimeout(() => el.classList.remove('minimap-highlight-pulse'), 1200);
    }, [turnsContainerRef]);

    // ── Drag viewport ─────────────────────────────────────────────────

    const onDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        draggingRef.current = true;

        const onMove = (me: MouseEvent) => {
            if (!draggingRef.current) return;
            const sa = stripAreaRef.current;
            const sc = scrollContainerRef.current;
            if (!sa || !sc) return;

            const rect = sa.getBoundingClientRect();
            const y = me.clientY - rect.top;
            const ratio = Math.max(0, Math.min(1, y / rect.height));
            sc.scrollTop = ratio * (sc.scrollHeight - sc.clientHeight);
        };

        const onUp = () => {
            draggingRef.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [scrollContainerRef]);

    // ── Jump to latest ────────────────────────────────────────────────

    const jumpToLatest = useCallback(() => {
        const sc = scrollContainerRef.current;
        if (!sc) return;
        sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    }, [scrollContainerRef]);

    // ── Tooltip handling ──────────────────────────────────────────────

    const showTooltip = useCallback((e: React.MouseEvent, strip: StripInfo) => {
        setTooltip({ x: e.clientX, y: e.clientY, strip });
    }, []);

    const hideTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    // ── Render ────────────────────────────────────────────────────────

    if (!isVisible) return null;

    if (isCollapsed) {
        return (
            <div
                className="minimap-collapsed"
                data-testid="minimap-collapsed"
                onClick={() => setCollapsed(false)}
                title="Expand mini map (Alt+M)"
            >
                <div
                    className="minimap-collapsed-indicator"
                    style={{ top: `${viewportTop}px`, height: `${Math.max(viewportHeight, 8)}px` }}
                />
            </div>
        );
    }

    return (
        <div
            className="minimap-panel"
            data-testid="minimap-panel"
            ref={minimapRef}
            style={{ width: MINIMAP_WIDTH }}
        >
            {/* Collapse button */}
            <button
                className="minimap-collapse-btn"
                data-testid="minimap-collapse-btn"
                onClick={() => setCollapsed(true)}
                title="Collapse mini map (Alt+M)"
                aria-label="Collapse mini map"
            >
                ›
            </button>

            {/* Strip area */}
            <div className="minimap-strip-area" ref={stripAreaRef} data-testid="minimap-strip-area">
                {/* Viewport indicator */}
                <div
                    className="minimap-viewport-indicator"
                    data-testid="minimap-viewport-indicator"
                    style={{ top: `${viewportTop}px`, height: `${viewportHeight}px` }}
                    onMouseDown={onDragStart}
                />

                {/* Strips */}
                {strips.map(strip => (
                    <div
                        key={strip.index}
                        className={`minimap-strip${strip.color === 'var(--minimap-streaming)' ? ' minimap-strip-streaming' : ''}`}
                        data-testid={`minimap-strip-${strip.index}`}
                        data-turn-index={strip.index}
                        style={{
                            height: `${strip.height}px`,
                            backgroundColor: strip.color,
                        }}
                        onClick={() => scrollToTurn(strip.index)}
                        onMouseEnter={(e) => showTooltip(e, strip)}
                        onMouseLeave={hideTooltip}
                    >
                        {strip.landmark && (
                            <span className="minimap-landmark" data-testid={`minimap-landmark-${strip.index}`}>
                                {strip.landmark}
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* Jump to latest badge */}
            {userScrolledUp && isStreaming && (
                <button
                    className="minimap-jump-latest"
                    data-testid="minimap-jump-latest"
                    onClick={jumpToLatest}
                >
                    Jump to latest ↓
                </button>
            )}

            {/* Tooltip */}
            {tooltip && (
                <div
                    className="minimap-tooltip"
                    data-testid="minimap-tooltip"
                    style={{
                        top: tooltip.y - 10,
                        left: tooltip.x - MINIMAP_WIDTH - 160,
                    }}
                >
                    <div className="minimap-tooltip-header">
                        {tooltip.strip.tooltipRole} Turn {tooltip.strip.index + 1}
                        {tooltip.strip.tooltipTime && ` · ${tooltip.strip.tooltipTime}`}
                    </div>
                    {tooltip.strip.tooltipPreview && (
                        <div className="minimap-tooltip-preview">{tooltip.strip.tooltipPreview}</div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Exports for testing ────────────────────────────────────────────────

export { buildStrips, getTurnColor, computeStripHeights, getLandmark, MIN_TURNS_TO_SHOW };
export type { StripInfo };

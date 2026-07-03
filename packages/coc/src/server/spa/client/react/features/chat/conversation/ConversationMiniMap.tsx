/**
 * ConversationMiniMap — compact vertical overview of conversation turns.
 *
 * Shows colored strips proportional to turn content length.  Users can click a
 * strip to smooth-scroll to that turn, or drag the viewport indicator to scrub
 * through the conversation.  Collapses automatically on narrow viewports and
 * supports Alt+M toggling.
 *
 * Visual design matches the `coc-conversation-redesign-3` spec:
 *  - 7 strip kinds (user / assistant / whisper / agent / error / pinned / historical)
 *    plus a streaming animation overlay.
 *  - Active strip (currently in viewport) gets a scaleX(1.12) emphasis.
 *  - Hover transforms with scaleX(1.12) for a tactile feel.
 *  - rAF-driven viewport indicator updates (replaces fixed-interval throttle).
 *  - Container-relative click-to-scroll using getBoundingClientRect math so
 *    scrolling stays within the conversation scroll container.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientConversationTurn } from '../../../types/dashboard';

// ── Constants ──────────────────────────────────────────────────────────

const MIN_STRIP_HEIGHT = 4;
const MAX_STRIP_HEIGHT = 60;
const MINIMAP_WIDTH = 28;
const MIN_TURNS_TO_SHOW = 5;
const NARROW_VIEWPORT_PX = 900;
const HEAVY_TOOL_THRESHOLD = 3;
const ACTIVE_PROBE_OFFSET_RATIO = 0.28;
const SCROLL_OFFSET_PX = 14;
const TOOLTIP_DEFAULT_WIDTH = 220;
const TOOLTIP_DEFAULT_HEIGHT = 56;
const TOOLTIP_MARGIN = 8;
const VIEWPORT_INDICATOR_MIN = 16;
const JUMP_LATEST_THRESHOLD = 40;

// ── Kind / Color ───────────────────────────────────────────────────────

/** Strip kind — drives both color and landmark icon. Priority order: streaming >
 *  error > pinned > historical > agent (assistant + read_agent) > whisper
 *  (assistant + heavy tools) > assistant > user. */
export type MiniMapStripKind =
    | 'user'
    | 'assistant'
    | 'whisper'
    | 'agent'
    | 'error'
    | 'pinned'
    | 'historical'
    | 'streaming';

interface StripInfo {
    index: number;
    kind: MiniMapStripKind;
    color: string;
    height: number;
    label: string;
    tooltipRole: string;
    tooltipTime: string;
    tooltipPreview: string;
    landmark: string | null;
}

function hasReadAgentTool(turn: ClientConversationTurn): boolean {
    return !!turn.toolCalls?.some(tc => tc.toolName === 'read_agent' || tc.toolName === 'task');
}

function hasHeavyTools(turn: ClientConversationTurn): boolean {
    return !!turn.toolCalls && turn.toolCalls.length >= HEAVY_TOOL_THRESHOLD;
}

function hasFailedTool(turn: ClientConversationTurn): boolean {
    return !!turn.toolCalls?.some(tc => tc.status === 'failed' || tc.error);
}

export function getTurnKind(turn: ClientConversationTurn): MiniMapStripKind {
    if (turn.streaming) return 'streaming';
    if (turn.isError || hasFailedTool(turn)) return 'error';
    if (turn.pinnedAt) return 'pinned';
    if (turn.historical) return 'historical';
    if (turn.role === 'user') return 'user';
    if (hasReadAgentTool(turn)) return 'agent';
    if (hasHeavyTools(turn)) return 'whisper';
    return 'assistant';
}

/** CSS variable string for a strip kind. Kept exported for back-compat with
 *  earlier consumers and tests. */
export function getTurnColor(turn: ClientConversationTurn): string {
    return `var(--minimap-${getTurnKind(turn)})`;
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
    if (turn.streaming) return '●';
    if (turn.isError || hasFailedTool(turn)) return '⚠';
    if (turn.pinnedAt) return '📌';
    if (turn.role === 'assistant' && hasReadAgentTool(turn)) return '🤖';
    if (turn.role === 'user' && index === turns.findIndex(t => t.role === 'user')) return '▶';
    if (turn.role === 'assistant' && hasHeavyTools(turn)) return '🔇';
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
    return turns.map((turn, i) => {
        const kind = getTurnKind(turn);
        return {
            index: i,
            kind,
            color: `var(--minimap-${kind})`,
            height: heights[i],
            label: `Turn ${i + 1}`,
            tooltipRole: turn.role === 'user' ? 'User' : 'Assistant',
            tooltipTime: formatTime(turn.timestamp),
            tooltipPreview: (turn.content || '').slice(0, 60),
            landmark: getLandmark(turn, i, turns),
        };
    });
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
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; strip: StripInfo } | null>(null);
    const [userScrolledUp, setUserScrolledUp] = useState(false);

    const minimapRef = useRef<HTMLDivElement>(null);
    const stripAreaRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const rafRef = useRef<number>(0);

    const strips = useMemo(() => buildStrips(turns), [turns]);
    const hasStreamingStrip = useMemo(
        () => strips.some(s => s.kind === 'streaming'),
        [strips],
    );

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

    // ── Sync viewport indicator + active strip with scroll position ───

    const updateMiniMap = useCallback(() => {
        const sc = scrollContainerRef.current;
        const tc = turnsContainerRef.current;
        if (!sc) return;

        const scrollHeight = Math.max(sc.scrollHeight, 1);
        const maxScroll = Math.max(sc.scrollHeight - sc.clientHeight, 1);
        const visibleRatio = Math.min(1, sc.clientHeight / scrollHeight);

        // The strip area height is used for the viewport indicator; fall back
        // to the scroll container's clientHeight when the strip area is not
        // mounted yet (collapsed rail uses clientHeight directly).
        const trackHeight = stripAreaRef.current?.clientHeight ?? sc.clientHeight;
        const trackable = Math.max(trackHeight * (1 - visibleRatio), 0);
        const indicatorTop = (sc.scrollTop / maxScroll) * trackable;
        const indicatorHeight = Math.max(visibleRatio * trackHeight, VIEWPORT_INDICATOR_MIN);

        setViewportTop(indicatorTop);
        setViewportHeight(indicatorHeight);

        // Active turn = the last turn whose top crosses the probe line. We use
        // getBoundingClientRect math because the turns container is not always
        // the immediate child of the scroll container (it's wrapped).
        if (tc && tc.children.length > 0) {
            const containerRect = sc.getBoundingClientRect();
            const probe = sc.clientHeight * ACTIVE_PROBE_OFFSET_RATIO;
            let nextActive: number | null = null;
            const children = tc.children;
            for (let i = 0; i < children.length; i++) {
                const rect = (children[i] as HTMLElement).getBoundingClientRect();
                const offset = rect.top - containerRect.top;
                if (offset <= probe) {
                    nextActive = i;
                } else {
                    break;
                }
            }
            setActiveIndex(nextActive);
        }

        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - JUMP_LATEST_THRESHOLD;
        setUserScrolledUp(!atBottom);
    }, [scrollContainerRef, turnsContainerRef]);

    const scheduleUpdate = useCallback(() => {
        if (rafRef.current) return;
        rafRef.current = window.requestAnimationFrame(() => {
            rafRef.current = 0;
            updateMiniMap();
        });
    }, [updateMiniMap]);

    useEffect(() => {
        const sc = scrollContainerRef.current;
        if (!sc) return;
        sc.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);
        updateMiniMap();
        return () => {
            sc.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            if (rafRef.current) {
                window.cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
        };
    }, [scrollContainerRef, scheduleUpdate, updateMiniMap]);

    // Re-calc on turns change
    useEffect(() => {
        updateMiniMap();
    }, [turns.length, updateMiniMap]);

    // ── Click-to-navigate (container-relative, with breathing-room offset) ─

    const scrollToTurn = useCallback((index: number) => {
        const sc = scrollContainerRef.current;
        const tc = turnsContainerRef.current;
        if (!sc || !tc) return;
        const el = tc.children[index] as HTMLElement | undefined;
        if (!el) return;
        const containerRect = sc.getBoundingClientRect();
        const targetRect = el.getBoundingClientRect();
        const top = Math.max(0, sc.scrollTop + targetRect.top - containerRect.top - SCROLL_OFFSET_PX);
        sc.scrollTo({ top, behavior: 'smooth' });
        el.classList.add('minimap-highlight-pulse');
        setTimeout(() => el.classList.remove('minimap-highlight-pulse'), 1100);
    }, [scrollContainerRef, turnsContainerRef]);

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

    const moveTooltip = useCallback((e: React.MouseEvent) => {
        setTooltip(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
    }, []);

    const hideTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    // Smart-clamp tooltip position using measured size when available
    const tooltipPosition = useMemo(() => {
        if (!tooltip || typeof window === 'undefined') return null;
        const measured = tooltipRef.current;
        const width = measured?.offsetWidth || TOOLTIP_DEFAULT_WIDTH;
        const height = measured?.offsetHeight || TOOLTIP_DEFAULT_HEIGHT;
        const winW = window.innerWidth || 0;
        const winH = window.innerHeight || 0;
        // Prefer placing left of the cursor so the tooltip doesn't sit on top
        // of the minimap rail; clamp to viewport on both axes.
        const left = Math.max(TOOLTIP_MARGIN, Math.min(tooltip.x - width - 14, winW - width - TOOLTIP_MARGIN));
        const top = Math.max(TOOLTIP_MARGIN, Math.min(tooltip.y - 12, winH - height - TOOLTIP_MARGIN));
        return { left, top };
    }, [tooltip]);

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

    const showJumpLatest = hasStreamingStrip && userScrolledUp;

    return (
        <div
            className="minimap-panel"
            data-testid="minimap-panel"
            ref={minimapRef}
            aria-label="Conversation minimap"
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
                    aria-hidden="true"
                />

                {/* Strips */}
                {strips.map(strip => {
                    const isActive = strip.index === activeIndex;
                    const isStreamingStrip = strip.kind === 'streaming';
                    const className = [
                        'minimap-strip',
                        `minimap-strip-${strip.kind}`,
                        isStreamingStrip ? 'minimap-strip-streaming' : '',
                        isActive ? 'active' : '',
                    ].filter(Boolean).join(' ');
                    const tooltipTitle = `${strip.tooltipRole} Turn ${strip.index + 1}${strip.tooltipTime ? ` · ${strip.tooltipTime}` : ''}`;
                    return (
                        <button
                            key={strip.index}
                            type="button"
                            className={className}
                            data-testid={`minimap-strip-${strip.index}`}
                            data-turn-index={strip.index}
                            data-kind={strip.kind}
                            aria-label={tooltipTitle}
                            aria-current={isActive ? 'location' : undefined}
                            style={{
                                height: `${strip.height}px`,
                                // Non-streaming strips: keep inline backgroundColor so consumers
                                // (and tests) can read it directly. Streaming uses the CSS gradient
                                // via the `minimap-strip-streaming` class.
                                ...(isStreamingStrip
                                    ? {}
                                    : { backgroundColor: `var(--minimap-${strip.kind})` }),
                            }}
                            onClick={() => scrollToTurn(strip.index)}
                            onMouseEnter={(e) => showTooltip(e, strip)}
                            onMouseMove={moveTooltip}
                            onMouseLeave={hideTooltip}
                        >
                            {strip.landmark && (
                                <span className="minimap-landmark" data-testid={`minimap-landmark-${strip.index}`}>
                                    {strip.landmark}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Jump to latest badge */}
            {showJumpLatest && (
                <button
                    className="minimap-jump-latest"
                    data-testid="minimap-jump-latest"
                    onClick={jumpToLatest}
                >
                    Latest ↓
                </button>
            )}

            {/* Tooltip */}
            {tooltip && tooltipPosition && (
                <div
                    ref={tooltipRef}
                    className="minimap-tooltip max-w-[calc(100vw-16px)]"
                    data-testid="minimap-tooltip"
                    style={{
                        top: tooltipPosition.top,
                        left: tooltipPosition.left,
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

export { buildStrips, computeStripHeights, getLandmark, MIN_TURNS_TO_SHOW };
export type { StripInfo };

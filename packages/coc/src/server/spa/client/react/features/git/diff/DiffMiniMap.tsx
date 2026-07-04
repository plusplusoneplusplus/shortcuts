/**
 * DiffMiniMap — compact vertical overview of a unified diff.
 *
 * Shows colored strips whose vertical position and height are derived from the
 * actual rendered pixel layout of the diff viewer (via `data-diff-line-index`
 * elements).  This ensures correct alignment even when long lines wrap to
 * multiple visual rows.
 *
 * Users can click anywhere on the strip to scroll the diff viewer to that
 * position, or drag the viewport indicator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLine } from './UnifiedDiffViewer';

// ── Constants ──────────────────────────────────────────────────────────

const MINIMAP_WIDTH = 14;
const MIN_SEGMENT_HEIGHT = 1;
const SCROLL_THROTTLE_MS = 60;

// ── Types ──────────────────────────────────────────────────────────────

type SegmentType = 'added' | 'removed' | 'context' | 'meta' | 'hunk-header';

export interface DiffSegment {
    type: SegmentType;
    startLine: number;
    lineCount: number;
}

export interface LineOffset {
    top: number;
    height: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Group consecutive same-type diff lines into segments. */
export function buildDiffSegments(diffLines: DiffLine[]): DiffSegment[] {
    if (diffLines.length === 0) return [];
    const segments: DiffSegment[] = [];
    let current: DiffSegment = { type: diffLines[0].type, startLine: 0, lineCount: 1 };
    for (let i = 1; i < diffLines.length; i++) {
        const type = diffLines[i].type;
        if (type === current.type) {
            current.lineCount++;
        } else {
            segments.push(current);
            current = { type, startLine: i, lineCount: 1 };
        }
    }
    segments.push(current);
    return segments;
}

/** Return the CSS background color for a segment type. */
export function getSegmentColor(type: SegmentType): string {
    switch (type) {
        case 'added': return 'var(--diff-minimap-added)';
        case 'removed': return 'var(--diff-minimap-removed)';
        default: return 'transparent';
    }
}

/**
 * Measure pixel offsets (top + height) of each diff line element within
 * the scroll container.  Returns per-line offsets plus total content height.
 */
export function measureLineOffsets(
    scrollContainer: HTMLElement,
): { offsets: Array<LineOffset | undefined>; totalHeight: number } {
    const lineEls = scrollContainer.querySelectorAll<HTMLElement>('[data-diff-line-index]');
    if (lineEls.length === 0) return { offsets: [], totalHeight: scrollContainer.scrollHeight };

    const containerRect = scrollContainer.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;

    const result: Array<LineOffset | undefined> = [];
    for (const el of lineEls) {
        const index = Number.parseInt(el.getAttribute('data-diff-line-index') ?? '', 10);
        if (!Number.isFinite(index) || index < 0) continue;

        const elRect = el.getBoundingClientRect();
        const top = elRect.top - containerRect.top + scrollTop;
        const bottom = top + elRect.height;
        const existing = result[index];
        if (existing) {
            const unionTop = Math.min(existing.top, top);
            const unionBottom = Math.max(existing.top + existing.height, bottom);
            result[index] = { top: unionTop, height: unionBottom - unionTop };
        } else {
            result[index] = { top, height: elRect.height };
        }
    }

    return { offsets: result, totalHeight: scrollContainer.scrollHeight };
}

function findFirstMeasuredOffset(
    lineOffsets: Array<LineOffset | undefined>,
    startIdx: number,
    endIdx: number,
): { index: number; offset: LineOffset } | null {
    for (let i = startIdx; i <= endIdx && i < lineOffsets.length; i++) {
        const offset = lineOffsets[i];
        if (offset) return { index: i, offset };
    }
    return null;
}

function findLastMeasuredOffset(
    lineOffsets: Array<LineOffset | undefined>,
    startIdx: number,
    endIdx: number,
): { index: number; offset: LineOffset } | null {
    for (let i = Math.min(endIdx, lineOffsets.length - 1); i >= startIdx; i--) {
        const offset = lineOffsets[i];
        if (offset) return { index: i, offset };
    }
    return null;
}

/**
 * Compute segment position/size as percentages of total content height
 * using pixel-accurate line offsets.
 */
export function computeSegmentPositions(
    segments: DiffSegment[],
    lineOffsets: Array<LineOffset | undefined>,
    totalHeight: number,
): { topPercent: number; heightPercent: number }[] {
    if (totalHeight <= 0 || lineOffsets.length === 0) {
        return segments.map(() => ({ topPercent: 0, heightPercent: 0 }));
    }

    return segments.map(seg => {
        const firstIdx = seg.startLine;
        const lastIdx = seg.startLine + seg.lineCount - 1;

        if (firstIdx >= lineOffsets.length) {
            return { topPercent: 100, heightPercent: 0 };
        }

        const first = findFirstMeasuredOffset(lineOffsets, firstIdx, lastIdx);
        const last = findLastMeasuredOffset(lineOffsets, firstIdx, lastIdx);
        if (!first || !last) {
            return { topPercent: 0, heightPercent: 0 };
        }

        const segTop = first.offset.top;
        const segHeight = (last.offset.top + last.offset.height) - segTop;

        return {
            topPercent: (segTop / totalHeight) * 100,
            heightPercent: (segHeight / totalHeight) * 100,
        };
    });
}

// ── Props ──────────────────────────────────────────────────────────────

export interface DiffMiniMapProps {
    diffLines: DiffLine[];
    /** Ref to the scrollable container wrapping the diff viewer */
    scrollContainerRef: React.RefObject<HTMLElement | null>;
}

// ── Component ──────────────────────────────────────────────────────────

export function DiffMiniMap({ diffLines, scrollContainerRef }: DiffMiniMapProps) {
    const [viewportTop, setViewportTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [lineOffsets, setLineOffsets] = useState<Array<LineOffset | undefined>>([]);
    const [totalContentHeight, setTotalContentHeight] = useState(0);

    const stripAreaRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const measureRafRef = useRef<number | null>(null);

    const segments = useMemo(() => buildDiffSegments(diffLines), [diffLines]);
    const totalLines = diffLines.length;

    // ── Measure line offsets from the DOM ──────────────────────────────

    const measureLines = useCallback(() => {
        const sc = scrollContainerRef.current;
        if (!sc) return;

        const { offsets, totalHeight } = measureLineOffsets(sc);

        // When the diff viewer is windowed (large files), only viewport rows are
        // mounted, so DOM measurement covers a fraction of the lines. Fall back to
        // uniform offsets derived from the virtual content height (scrollHeight),
        // which reflects the virtualizer's estimated total size.
        const measuredCount = offsets.reduce((n, o) => (o ? n + 1 : n), 0);
        if (totalLines > 0 && measuredCount > 0 && measuredCount < totalLines) {
            const contentHeight = sc.scrollHeight || totalHeight;
            const perLine = contentHeight / totalLines;
            const uniform: Array<LineOffset> = Array.from(
                { length: totalLines },
                (_, i) => ({ top: i * perLine, height: perLine }),
            );
            setLineOffsets(uniform);
            setTotalContentHeight(contentHeight);
            return;
        }

        setLineOffsets(offsets);
        setTotalContentHeight(totalHeight);
    }, [scrollContainerRef, totalLines]);

    const scheduleMeasure = useCallback(() => {
        if (measureRafRef.current !== null) return;
        measureRafRef.current = requestAnimationFrame(() => {
            measureRafRef.current = null;
            measureLines();
        });
    }, [measureLines]);

    // Measure on mount and when diff changes
    useEffect(() => {
        measureLines();
        // Re-measure after a frame in case layout hasn't settled yet
        const raf = requestAnimationFrame(() => measureLines());
        return () => cancelAnimationFrame(raf);
    }, [diffLines, measureLines]);

    // Re-measure on resize via ResizeObserver
    useEffect(() => {
        const sc = scrollContainerRef.current;
        if (!sc) return;

        const ro = new ResizeObserver(() => scheduleMeasure());
        ro.observe(sc);

        return () => {
            ro.disconnect();
            if (measureRafRef.current !== null) {
                cancelAnimationFrame(measureRafRef.current);
                measureRafRef.current = null;
            }
        };
    }, [scrollContainerRef, scheduleMeasure]);

    // ── Compute segment positions ─────────────────────────────────────

    const segmentPositions = useMemo(
        () => computeSegmentPositions(segments, lineOffsets, totalContentHeight),
        [segments, lineOffsets, totalContentHeight],
    );

    // ── Sync viewport indicator with scroll position ──────────────────

    const updateViewportIndicator = useCallback(() => {
        const sc = scrollContainerRef.current;
        const sa = stripAreaRef.current;
        if (!sc || !sa) return;

        const maxScroll = sc.scrollHeight - sc.clientHeight;
        const scrollRatio = maxScroll > 0 ? sc.scrollTop / maxScroll : 0;
        const visibleRatio = sc.scrollHeight > 0 ? sc.clientHeight / sc.scrollHeight : 1;
        const saHeight = sa.clientHeight;

        const vpHeight = Math.max(visibleRatio * saHeight, 8);
        const vpTop = scrollRatio * (saHeight - vpHeight);

        setViewportTop(vpTop);
        setViewportHeight(vpHeight);
    }, [scrollContainerRef]);

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

    // Re-calc when diff changes
    useEffect(() => {
        updateViewportIndicator();
    }, [diffLines.length, updateViewportIndicator]);

    // ── Click-to-scroll ───────────────────────────────────────────────

    const handleClick = useCallback((e: React.MouseEvent) => {
        const sa = stripAreaRef.current;
        const sc = scrollContainerRef.current;
        if (!sa || !sc) return;

        const rect = sa.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const ratio = Math.max(0, Math.min(1, y / rect.height));
        sc.scrollTo({
            top: ratio * (sc.scrollHeight - sc.clientHeight),
            behavior: 'smooth',
        });
    }, [scrollContainerRef]);

    // ── Drag viewport ─────────────────────────────────────────────────

    const onDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
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

    // ── Render ────────────────────────────────────────────────────────

    if (totalLines === 0) return null;

    // Check if there are any changes worth showing
    const hasChanges = segments.some(s => s.type === 'added' || s.type === 'removed');
    if (!hasChanges) return null;

    return (
        <div
            className="diff-minimap"
            data-testid="diff-minimap"
            style={{ width: MINIMAP_WIDTH }}
        >
            <div
                className="diff-minimap-strip-area"
                ref={stripAreaRef}
                data-testid="diff-minimap-strip-area"
                onClick={handleClick}
            >
                {/* Viewport indicator */}
                <div
                    className="diff-minimap-viewport"
                    data-testid="diff-minimap-viewport"
                    style={{ top: `${viewportTop}px`, height: `${viewportHeight}px` }}
                    onMouseDown={onDragStart}
                />

                {/* Segments — absolutely positioned based on pixel measurements */}
                {segments.map((seg, i) => {
                    const pos = segmentPositions[i];
                    const color = getSegmentColor(seg.type);
                    return (
                        <div
                            key={i}
                            className="diff-minimap-segment"
                            data-testid={`diff-minimap-segment-${i}`}
                            data-segment-type={seg.type}
                            style={{
                                top: `${pos.topPercent}%`,
                                height: `${pos.heightPercent}%`,
                                minHeight: `${MIN_SEGMENT_HEIGHT}px`,
                                backgroundColor: color,
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}

// ── Exports for testing ────────────────────────────────────────────────

export { MINIMAP_WIDTH };

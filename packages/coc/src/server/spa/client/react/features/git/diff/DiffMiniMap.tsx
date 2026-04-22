/**
 * DiffMiniMap — compact vertical overview of a unified diff.
 *
 * Shows colored strips proportional to line count for each contiguous region
 * of added, removed, or context lines.  Users can click anywhere on the strip
 * to scroll the diff viewer to that position, or drag the viewport indicator.
 * Mirrors VS Code's diff-editor minimap decoration gutter.
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

    const stripAreaRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const segments = useMemo(() => buildDiffSegments(diffLines), [diffLines]);
    const totalLines = diffLines.length;

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

                {/* Segments */}
                {segments.map((seg, i) => {
                    const heightPercent = (seg.lineCount / totalLines) * 100;
                    const color = getSegmentColor(seg.type);
                    return (
                        <div
                            key={i}
                            className="diff-minimap-segment"
                            data-testid={`diff-minimap-segment-${i}`}
                            data-segment-type={seg.type}
                            style={{
                                height: `max(${MIN_SEGMENT_HEIGHT}px, ${heightPercent}%)`,
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

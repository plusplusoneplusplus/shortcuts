/**
 * SideBySideDiffViewer — renders a unified diff string as a two-column side-by-side view.
 *
 * Accepts the same props and exposes the same imperative handle as UnifiedDiffViewer,
 * allowing parent containers to swap between views with zero prop changes.
 * Comment props are accepted but intentionally unused (deferred to commit 5).
 */

import { useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { highlightLine } from './useSyntaxHighlight';
import {
    computeDiffLines,
    computeSideBySideLines,
    getLanguagesForLines,
    type UnifiedDiffViewerProps,
    type UnifiedDiffViewerHandle,
    type DiffLine,
    type SideBySideLine,
} from './UnifiedDiffViewer';

/** Walk up the DOM tree to find the nearest ancestor that scrolls vertically. */
function getScrollableAncestor(el: HTMLElement): HTMLElement {
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
        const { overflowY } = getComputedStyle(current);
        if (overflowY === 'auto' || overflowY === 'scroll') return current;
        current = current.parentElement;
    }
    return document.documentElement as HTMLElement;
}

function getSideBg(line: { type: string } | null, side: 'left' | 'right'): string {
    if (!line || line.type === 'empty') return 'bg-[#f0f0f0] dark:bg-[#1a1a1a]';
    if (side === 'left'  && line.type === 'removed') return 'bg-[#fecaca] dark:bg-[#4c1d1d]';
    if (side === 'right' && line.type === 'added')   return 'bg-[#d1f7c4] dark:bg-[#1a4731]';
    return '';
}

export const SideBySideDiffViewer = forwardRef<UnifiedDiffViewerHandle, UnifiedDiffViewerProps>(
    function SideBySideDiffViewer(
        {
            diff,
            fileName,
            'data-testid': testId,
            showLineNumbers,
            onLinesReady,
            enableComments: _enableComments,
            comments: _comments,
            onAddComment: _onAddComment,
            onCommentClick: _onCommentClick,
        },
        ref
    ) {
        const lines     = useMemo(() => diff.split('\n'), [diff]);
        const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
        const sxsLines  = useMemo(() => computeSideBySideLines(diffLines), [diffLines]);
        const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);

        const containerRef        = useRef<HTMLDivElement>(null);
        const currentHunkIndexRef = useRef<number>(-1);

        useEffect(() => {
            currentHunkIndexRef.current = -1;
            onLinesReady?.(diffLines);
        }, [diffLines, onLinesReady]);

        useImperativeHandle(ref, () => ({
            scrollToNextHunk: () => {
                const container = containerRef.current;
                if (!container) return;
                const edits = Array.from(container.querySelectorAll<HTMLElement>('[data-edit-start]'));
                if (edits.length === 0) return;
                const next = (currentHunkIndexRef.current + 1) % edits.length;
                currentHunkIndexRef.current = next;
                const scrollParent = getScrollableAncestor(container);
                const parentTop    = scrollParent.getBoundingClientRect().top;
                const centerOffset = scrollParent.clientHeight / 3;
                scrollParent.scrollTo({
                    top: scrollParent.scrollTop + edits[next].getBoundingClientRect().top - parentTop - centerOffset,
                    behavior: 'smooth',
                });
            },
            scrollToPrevHunk: () => {
                const container = containerRef.current;
                if (!container) return;
                const edits      = Array.from(container.querySelectorAll<HTMLElement>('[data-edit-start]'));
                if (edits.length === 0) return;
                const startIndex = currentHunkIndexRef.current === -1 ? edits.length - 1 : currentHunkIndexRef.current;
                const prev       = (startIndex - 1 + edits.length) % edits.length;
                currentHunkIndexRef.current = prev;
                const scrollParent = getScrollableAncestor(container);
                const parentTop    = scrollParent.getBoundingClientRect().top;
                const centerOffset = scrollParent.clientHeight / 3;
                scrollParent.scrollTo({
                    top: scrollParent.scrollTop + edits[prev].getBoundingClientRect().top - parentTop - centerOffset,
                    behavior: 'smooth',
                });
            },
            getHunkCount: () => containerRef.current?.querySelectorAll('[data-edit-start]').length ?? 0,
        }));

        function renderRow(row: SideBySideLine, rowIdx: number) {
            // Hunk-header row: spans full width, acts as nav anchor
            if (row.hunkHeader !== undefined) {
                return (
                    <div
                        key={rowIdx}
                        className="flex w-full bg-[#dbedff] dark:bg-[#1d3251] text-[#0550ae] dark:text-[#79c0ff] whitespace-pre-wrap break-words"
                        data-edit-start=""
                    >
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap" />
                        )}
                        <span className="px-1 flex-1 min-w-0">{row.hunkHeader}</span>
                    </div>
                );
            }

            const leftBg  = getSideBg(row.left,  'left');
            const rightBg = getSideBg(row.right, 'right');

            return (
                <div key={rowIdx} className="flex w-full">
                    {/* LEFT column — removed or context */}
                    <div className={`flex w-1/2 min-w-0 ${leftBg}`}>
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap">
                                {row.left.lineNumber ?? ''}
                            </span>
                        )}
                        <span className="px-1 flex-1 min-w-0 whitespace-pre-wrap break-words">
                            {row.left.type !== 'empty' && row.left.originalIndex !== null
                                ? <span dangerouslySetInnerHTML={{ __html: highlightLine(row.left.content.slice(1), languages[row.left.originalIndex]) }} />
                                : '\u00a0'}
                        </span>
                    </div>
                    {/* RIGHT column — added or context */}
                    <div className={`flex w-1/2 min-w-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c] ${rightBg}`}>
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap">
                                {row.right.lineNumber ?? ''}
                            </span>
                        )}
                        <span className="px-1 flex-1 min-w-0 whitespace-pre-wrap break-words">
                            {row.right.type !== 'empty' && row.right.originalIndex !== null
                                ? <span dangerouslySetInnerHTML={{ __html: highlightLine(row.right.content.slice(1), languages[row.right.originalIndex]) }} />
                                : '\u00a0'}
                        </span>
                    </div>
                </div>
            );
        }

        return (
            <div
                ref={containerRef}
                data-testid={testId}
                className="font-mono text-xs leading-tight overflow-x-auto bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            >
                {sxsLines.map((row, rowIdx) => renderRow(row, rowIdx))}
            </div>
        );
    }
);

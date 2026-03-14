/**
 * SideBySideDiffViewer — renders a unified diff string as a two-column side-by-side view.
 *
 * Accepts the same props and exposes the same imperative handle as UnifiedDiffViewer,
 * allowing parent containers to swap between views with zero prop changes.
 */

import { useMemo, useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { highlightLine } from './useSyntaxHighlight';
import {
    computeDiffLines,
    computeEditStarts,
    computeSideBySideLines,
    getLanguagesForLines,
    buildLineCommentMap,
    getLineHighlightClass,
    type UnifiedDiffViewerProps,
    type UnifiedDiffViewerHandle,
    type DiffLine,
    type SideBySideLine,
} from './UnifiedDiffViewer';
import { DiffContextMenu } from '../tasks/comments/DiffContextMenu';
import type { DiffComment, DiffCommentSelection } from '../../diff-comment-types';

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

function getBadgeClass(lineComments: DiffComment[]): string {
    const hasOpen = lineComments.some(c => c.status !== 'resolved');
    return hasOpen ? 'bg-yellow-400 text-white' : 'bg-green-500 text-white';
}

/** Walk node ancestors up to (but not including) boundary to find the nearest element with data-diff-line-index. */
function findLineElement(node: Node, boundary: Element | null): Element | null {
    let current: Node | null = node;
    while (current) {
        if (current === boundary) return null;
        if (current.nodeType === Node.ELEMENT_NODE) {
            const el = current as Element;
            if (el.hasAttribute('data-diff-line-index')) return el;
        }
        current = current.parentNode;
    }
    return null;
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
            enableComments,
            comments,
            onAddComment,
            onCommentClick,
        },
        ref
    ) {
        const lines     = useMemo(() => diff.split('\n'), [diff]);
        const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
        const sxsLines  = useMemo(() => computeSideBySideLines(diffLines), [diffLines]);
        const editStarts = useMemo(() => computeEditStarts(diffLines), [diffLines]);
        const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
        const lineCommentMap = useMemo(
            () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
            [comments]
        );

        const containerRef        = useRef<HTMLDivElement>(null);
        const currentHunkIndexRef = useRef<number>(-1);

        const [toolbar, setToolbar] = useState<{
            visible: boolean;
            position: { x: number; y: number };
            selection: DiffCommentSelection | null;
            selectedText: string;
            activeSide: 'left' | 'right';
        }>({ visible: false, position: { x: 0, y: 0 }, selection: null, selectedText: '', activeSide: 'left' });

        // Stores the last validated selection so handleContextMenu can use it without stale closures.
        const pendingSelectionRef = useRef<{ selection: DiffCommentSelection; selectedText: string } | null>(null);

        // Latest-ref pattern: keep onLinesReady always current without adding it
        // to the diffLines effect's dependency array, preventing stale callback
        // from resetting navigation position on every parent re-render.
        const onLinesReadyRef = useRef(onLinesReady);
        useEffect(() => { onLinesReadyRef.current = onLinesReady; });

        useEffect(() => {
            currentHunkIndexRef.current = -1;
            onLinesReadyRef.current?.(diffLines);
        }, [diffLines]);

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
                const startIndex = currentHunkIndexRef.current === -1 ? edits.length : currentHunkIndexRef.current;
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

        const handleMouseUp = useCallback((_e: React.MouseEvent) => {
            if (!enableComments) return;
            const clear = () => {
                pendingSelectionRef.current = null;
                setToolbar(t => ({ ...t, visible: false, selection: null, selectedText: '' }));
            };
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) { clear(); return; }
            const range = sel.getRangeAt(0);
            const boundary = containerRef.current;

            const startEl = findLineElement(range.startContainer, boundary);
            const endEl   = findLineElement(range.endContainer,   boundary);
            if (!startEl || !endEl) { clear(); return; }

            // reject cross-column selections
            const startSide = startEl.closest('[data-split-side]')?.getAttribute('data-split-side');
            const endSide   = endEl.closest('[data-split-side]')?.getAttribute('data-split-side');
            if (!startSide || startSide !== endSide) { clear(); return; }

            const startIdx = parseInt(startEl.getAttribute('data-diff-line-index') ?? '-1', 10);
            const endIdx   = parseInt(endEl.getAttribute('data-diff-line-index')   ?? '-1', 10);
            if (startIdx < 0 || endIdx < 0) { clear(); return; }

            if (startEl.getAttribute('data-line-type') === 'hunk-header' ||
                endEl.getAttribute('data-line-type')   === 'hunk-header') {
                clear(); return;
            }

            const minIdx = Math.min(startIdx, endIdx);
            const maxIdx = Math.max(startIdx, endIdx);
            const [firstEl, lastEl] = startIdx <= endIdx ? [startEl, endEl] : [endEl, startEl];

            const sideValue = (startSide === 'right')
                ? ((firstEl.getAttribute('data-line-type') === 'added') ? 'added' : 'context') as DiffCommentSelection['side']
                : ((firstEl.getAttribute('data-line-type') as DiffCommentSelection['side']) ?? 'context');

            const selection: DiffCommentSelection = {
                diffLineStart: minIdx,
                diffLineEnd:   maxIdx,
                side: sideValue,
                oldLineStart: parseInt(firstEl.getAttribute('data-old-line') ?? '0', 10),
                oldLineEnd:   parseInt(lastEl.getAttribute('data-old-line')  ?? '0', 10),
                newLineStart: parseInt(firstEl.getAttribute('data-new-line') ?? '0', 10),
                newLineEnd:   parseInt(lastEl.getAttribute('data-new-line')  ?? '0', 10),
                startColumn: range.startOffset,
                endColumn:   range.endOffset,
            };
            const selectedText = sel.toString();
            pendingSelectionRef.current = { selection, selectedText };
            setToolbar(t => ({ ...t, visible: false, selection, selectedText, activeSide: startSide as 'left' | 'right' }));
        }, [enableComments]);

        const handleContextMenu = useCallback((e: React.MouseEvent) => {
            if (!enableComments) return;
            const pending = pendingSelectionRef.current;
            if (!pending) return;
            const browserSel = window.getSelection();
            if (!browserSel || browserSel.isCollapsed) { pendingSelectionRef.current = null; return; }
            e.preventDefault();
            setToolbar(t => ({ ...t, visible: true, position: { x: e.clientX, y: e.clientY } }));
        }, [enableComments]);

        const handleMouseDown = useCallback(() => {
            pendingSelectionRef.current = null;
            setToolbar(t => ({ ...t, visible: false }));
        }, []);

        // Dismiss context menu on scroll.
        useEffect(() => {
            if (!toolbar.visible) return;
            const handler = () => setToolbar(t => ({ ...t, visible: false }));
            const scrollParent = containerRef.current ? getScrollableAncestor(containerRef.current) : null;
            scrollParent?.addEventListener('scroll', handler, { passive: true });
            return () => scrollParent?.removeEventListener('scroll', handler);
        }, [toolbar.visible]);

        function renderRow(row: SideBySideLine, rowIdx: number) {
            // Hunk-header row: spans full width, acts as nav anchor
            if (row.hunkHeader !== undefined) {
                return (
                    <div
                        key={rowIdx}
                        className="flex w-full bg-[#dbedff] dark:bg-[#1d3251] text-[#0550ae] dark:text-[#79c0ff] whitespace-pre-wrap break-words"
                        data-hunk-header=""
                    >
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap" />
                        )}
                        <span className="px-1 flex-1 min-w-0">{row.hunkHeader}</span>
                    </div>
                );
            }

            const leftLine  = row.left.type  !== 'empty' ? row.left  : null;
            const rightLine = row.right.type !== 'empty' ? row.right : null;

            const isEditStart =
                (row.left.originalIndex !== null && editStarts.has(row.left.originalIndex)) ||
                (row.right.originalIndex !== null && editStarts.has(row.right.originalIndex));

            const leftBg  = getSideBg(row.left,  'left');
            const rightBg = getSideBg(row.right, 'right');

            const leftHighlight  = leftLine  && leftLine.originalIndex  !== null
                ? getLineHighlightClass(lineCommentMap.get(leftLine.originalIndex))  : '';
            const rightHighlight = rightLine && rightLine.originalIndex !== null
                ? getLineHighlightClass(lineCommentMap.get(rightLine.originalIndex)) : '';

            return (
                <div key={rowIdx} className="flex w-full" data-edit-start={isEditStart ? '' : undefined}>
                    {/* LEFT column — removed or context */}
                    <div
                        className={`flex w-1/2 min-w-0 ${leftBg} ${leftHighlight}`}
                        data-diff-line-index={enableComments && leftLine && leftLine.originalIndex !== null ? leftLine.originalIndex : undefined}
                        data-line-type={enableComments && leftLine ? leftLine.type : undefined}
                        data-old-line={enableComments && leftLine ? (row.left.lineNumber ?? '') : undefined}
                        data-new-line={enableComments && leftLine ? (row.right.lineNumber ?? '') : undefined}
                        data-split-side="left"
                    >
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap">
                                {row.left.lineNumber ?? ''}
                            </span>
                        )}
                        {enableComments && (
                            <span className="inline-flex w-4 shrink-0 items-center justify-center">
                                {(() => {
                                    if (!leftLine || leftLine.originalIndex === null) return <span className="w-4 h-4" />;
                                    const all = (lineCommentMap.get(leftLine.originalIndex) ?? []).filter(c => c.status !== 'orphaned');
                                    const lc = all.filter(c => c.selection.side === 'removed' || c.selection.side === 'context');
                                    if (lc.length === 0) return <span className="w-4 h-4" />;
                                    return (
                                        <button
                                            className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${getBadgeClass(lc)} leading-none`}
                                            onClick={e => { e.stopPropagation(); onCommentClick?.(lc[0], e); }}
                                            title={`${lc.length} comment${lc.length > 1 ? 's' : ''}`}
                                            data-testid="comment-badge"
                                        >
                                            {lc.length}
                                        </button>
                                    );
                                })()}
                            </span>
                        )}
                        <span className="px-1 flex-1 min-w-0 whitespace-pre-wrap break-words">
                            {row.left.type !== 'empty' && row.left.originalIndex !== null
                                ? <span dangerouslySetInnerHTML={{ __html: highlightLine(row.left.content.slice(1), languages[row.left.originalIndex]) }} />
                                : '\u00a0'}
                        </span>
                    </div>
                    {/* RIGHT column — added or context */}
                    <div
                        className={`flex w-1/2 min-w-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c] ${rightBg} ${rightHighlight}`}
                        data-diff-line-index={enableComments && rightLine && rightLine.originalIndex !== null ? rightLine.originalIndex : undefined}
                        data-line-type={enableComments && rightLine ? rightLine.type : undefined}
                        data-old-line={enableComments && rightLine ? (row.left.lineNumber ?? '') : undefined}
                        data-new-line={enableComments && rightLine ? (row.right.lineNumber ?? '') : undefined}
                        data-split-side="right"
                    >
                        {showLineNumbers && (
                            <span className="select-none text-right w-8 shrink-0 text-[#6e7681] pr-1 whitespace-nowrap">
                                {row.right.lineNumber ?? ''}
                            </span>
                        )}
                        {enableComments && (
                            <span className="inline-flex w-4 shrink-0 items-center justify-center">
                                {(() => {
                                    if (!rightLine || rightLine.originalIndex === null) return <span className="w-4 h-4" />;
                                    const all = (lineCommentMap.get(rightLine.originalIndex) ?? []).filter(c => c.status !== 'orphaned');
                                    const lc = all.filter(c => c.selection.side === 'added' || c.selection.side === 'context');
                                    if (lc.length === 0) return <span className="w-4 h-4" />;
                                    return (
                                        <button
                                            className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${getBadgeClass(lc)} leading-none`}
                                            onClick={e => { e.stopPropagation(); onCommentClick?.(lc[0], e); }}
                                            title={`${lc.length} comment${lc.length > 1 ? 's' : ''}`}
                                            data-testid="comment-badge"
                                        >
                                            {lc.length}
                                        </button>
                                    );
                                })()}
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
            <>
                <div
                    ref={containerRef}
                    data-testid={testId}
                    onMouseUp={enableComments ? handleMouseUp : undefined}
                    onMouseDown={enableComments ? handleMouseDown : undefined}
                    onContextMenu={enableComments ? handleContextMenu : undefined}
                    className="font-mono text-xs leading-tight overflow-x-auto bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
                >
                    {sxsLines.map((row, rowIdx) => renderRow(row, rowIdx))}
                </div>
                {enableComments && (
                    <DiffContextMenu
                        visible={toolbar.visible}
                        position={toolbar.position}
                        onAddComment={() => {
                            if (toolbar.selection) {
                                onAddComment?.(toolbar.selection, toolbar.selectedText, { top: toolbar.position.y, left: toolbar.position.x });
                            }
                        }}
                        onClose={() => setToolbar(t => ({ ...t, visible: false }))}
                    />
                )}
            </>
        );
    }
);

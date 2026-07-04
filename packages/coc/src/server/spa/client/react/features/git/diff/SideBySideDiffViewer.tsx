/**
 * SideBySideDiffViewer — renders a unified diff string as a two-column side-by-side view.
 *
 * Accepts the same props and exposes the same imperative handle as UnifiedDiffViewer,
 * allowing parent containers to swap between views with zero prop changes.
 */

import { useMemo, useEffect, useLayoutEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    computeDiffLines,
    computeEditStarts,
    computeSideBySideLines,
    computeHighlightedHtml,
    shouldSkipHighlight,
    getLanguagesForLines,
    buildLineCommentMap,
    getLineHighlightClass,
    DIFF_LINE_ESTIMATE_PX,
    VIRTUALIZE_THRESHOLD,
    type UnifiedDiffViewerProps,
    type UnifiedDiffViewerHandle,
    type DiffLine,
    type SideBySideLine,
    type IntraLinePart,
} from './UnifiedDiffViewer';
import { DiffContextMenu } from '../../../tasks/comments/DiffContextMenu';
import type { DiffComment, DiffCommentSelection } from '../../../../comments/diff-comment-types';

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
            onAskAI,
            onCopyAsContext,
            onCommentClick,
        },
        ref
    ) {
        const lines     = useMemo(() => diff.split('\n'), [diff]);
        const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
        // Generated/huge files skip highlight + word-level intra-line diff (fast path).
        const skipHighlight = useMemo(() => shouldSkipHighlight(fileName, lines.length), [fileName, lines.length]);
        const sxsLines  = useMemo(() => computeSideBySideLines(diffLines, skipHighlight), [diffLines, skipHighlight]);
        const editStarts = useMemo(() => computeEditStarts(diffLines), [diffLines]);
        const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
        // Syntax highlighting computed ONCE (per-file block pass), keyed by diff-line index.
        const highlightedHtml = useMemo(
            () => computeHighlightedHtml(diffLines, languages, skipHighlight),
            [diffLines, languages, skipHighlight]
        );
        const lineCommentMap = useMemo(
            () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
            [comments]
        );

        const containerRef        = useRef<HTMLDivElement>(null);
        const currentHunkIndexRef = useRef<number>(-1);

        // Column the in-progress text selection started in. Left and right cells are
        // interleaved per row in the DOM, so a native drag down one column would otherwise
        // also sweep the interleaved cells of the other column. While a drag is active we
        // set the OTHER column to `user-select: none`; reset to null on mouse up.
        const [selectSide, setSelectSide] = useState<'left' | 'right' | null>(null);

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

        // ── Windowing (large files only) ────────────────────────────────
        // Small diffs render eagerly so existing behavior/tests are unchanged.
        // Beyond VIRTUALIZE_THRESHOLD the row list is windowed to bound DOM size.
        const virtualized = sxsLines.length > VIRTUALIZE_THRESHOLD;
        const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
        const [scrollMargin, setScrollMargin] = useState(0);
        useLayoutEffect(() => {
            const c = containerRef.current;
            if (!c) return;
            const se = getScrollableAncestor(c);
            setScrollEl(se);
            setScrollMargin(c.getBoundingClientRect().top - se.getBoundingClientRect().top + se.scrollTop);
        }, [virtualized]);

        const rowVirtualizer = useVirtualizer({
            count: virtualized ? sxsLines.length : 0,
            getScrollElement: () => scrollEl,
            estimateSize: () => DIFF_LINE_ESTIMATE_PX,
            overscan: 24,
            scrollMargin,
            measureElement: (el) => {
                const h = (el as HTMLElement).getBoundingClientRect?.().height;
                return h && h > 0 ? h : DIFF_LINE_ESTIMATE_PX;
            },
        });

        // Row (sxsLines) indices where an edit group starts, and file-header rows —
        // derived from the row model so navigation works when rows are windowed.
        const editStartRows = useMemo(() => {
            const rows: number[] = [];
            sxsLines.forEach((row, idx) => {
                const isEdit =
                    (row.left.originalIndex !== null && editStarts.has(row.left.originalIndex)) ||
                    (row.right.originalIndex !== null && editStarts.has(row.right.originalIndex));
                if (isEdit) rows.push(idx);
            });
            return rows;
        }, [sxsLines, editStarts]);
        const fileHeaderRows = useMemo(() => {
            const map = new Map<string, number>();
            sxsLines.forEach((row, idx) => {
                if (row.filePath && !map.has(row.filePath)) map.set(row.filePath, idx);
            });
            return map;
        }, [sxsLines]);

        useImperativeHandle(ref, () => {
            if (virtualized) {
                const scrollToEdit = (n: number) => rowVirtualizer.scrollToIndex(editStartRows[n], { align: 'center' });
                return {
                    scrollToNextHunk: () => {
                        if (editStartRows.length === 0) return;
                        const next = (currentHunkIndexRef.current + 1) % editStartRows.length;
                        currentHunkIndexRef.current = next;
                        scrollToEdit(next);
                    },
                    scrollToPrevHunk: () => {
                        if (editStartRows.length === 0) return;
                        const start = currentHunkIndexRef.current === -1 ? editStartRows.length : currentHunkIndexRef.current;
                        const prev = (start - 1 + editStartRows.length) % editStartRows.length;
                        currentHunkIndexRef.current = prev;
                        scrollToEdit(prev);
                    },
                    getHunkCount: () => editStartRows.length,
                    getCurrentHunkIndex: () => currentHunkIndexRef.current,
                    scrollToHunk: (index: number) => {
                        if (index < 0 || index >= editStartRows.length) return;
                        currentHunkIndexRef.current = index;
                        scrollToEdit(index);
                    },
                    scrollToFile: (filePath: string) => {
                        const idx = fileHeaderRows.get(filePath);
                        if (idx === undefined) return;
                        rowVirtualizer.scrollToIndex(idx, { align: 'start' });
                    },
                };
            }
            return {
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
            getCurrentHunkIndex: () => currentHunkIndexRef.current,
            scrollToHunk: (index: number) => {
                const container = containerRef.current;
                if (!container) return;
                const edits = Array.from(container.querySelectorAll<HTMLElement>('[data-edit-start]'));
                if (edits.length === 0 || index < 0 || index >= edits.length) return;
                currentHunkIndexRef.current = index;
                const scrollParent = getScrollableAncestor(container);
                const parentTop = scrollParent.getBoundingClientRect().top;
                const centerOffset = scrollParent.clientHeight / 3;
                scrollParent.scrollTo({
                    top: scrollParent.scrollTop + edits[index].getBoundingClientRect().top - parentTop - centerOffset,
                    behavior: 'smooth',
                });
            },
            scrollToFile: (filePath: string) => {
                const container = containerRef.current;
                if (!container) return;
                const els = container.querySelectorAll<HTMLElement>('[data-file-path]');
                let target: HTMLElement | null = null;
                for (const el of Array.from(els)) {
                    if (el.getAttribute('data-file-path') === filePath) { target = el; break; }
                }
                if (!target) return;
                const scrollParent = getScrollableAncestor(container);
                const parentTop = scrollParent.getBoundingClientRect().top;
                scrollParent.scrollTo({
                    top: scrollParent.scrollTop + target.getBoundingClientRect().top - parentTop,
                    behavior: 'smooth',
                });
            },
            };
        });

        const handleMouseUp = useCallback((e: React.MouseEvent) => {
            if (e.button !== 0) return;
            // Selection (if any) is finalized on mouse up — release the column lock so both
            // columns are selectable again for the next gesture (and for select-all).
            setSelectSide(null);
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

            // Reject cross-column selections. Left/right cells are interleaved per row, so a
            // native range that spans both columns paints across both panels once the column
            // lock is released. Collapse it so the stray highlight disappears. This must run
            // regardless of enableComments, since the bleed affects plain split views too.
            const startSide = startEl?.closest('[data-split-side]')?.getAttribute('data-split-side');
            const endSide   = endEl?.closest('[data-split-side]')?.getAttribute('data-split-side');
            if (startSide && endSide && startSide !== endSide && typeof sel.removeAllRanges === 'function') { sel.removeAllRanges(); }

            if (!enableComments) return;
            if (!startEl || !endEl) { clear(); return; }
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

        const handleMouseDown = useCallback((e: React.MouseEvent) => {
            // On macOS, Ctrl+Click triggers a secondary-click (contextmenu) but fires
            // a mousedown with button===0 and ctrlKey===true. Skip clearing the pending
            // selection in that case so the contextmenu handler can still use it.
            if (e.button !== 0 || e.ctrlKey) return;
            // Lock text selection to the column this drag starts in (see selectSide).
            const side = (e.target as HTMLElement)
                .closest('[data-split-side]')?.getAttribute('data-split-side');
            setSelectSide(side === 'left' || side === 'right' ? side : null);
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
                        data-file-path={row.filePath ?? undefined}
                        data-diff-line-index={row.originalIndex}
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
                        style={selectSide === 'right' ? { userSelect: 'none' } : undefined}
                        data-diff-line-index={leftLine && leftLine.originalIndex !== null ? leftLine.originalIndex : undefined}
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
                                ? row.leftParts
                                    ? row.leftParts.map((part: IntraLinePart, pi: number) =>
                                        part.changed
                                            ? <mark key={pi} className="bg-[#f97575] dark:bg-[#b91c1c] rounded-[2px]">{part.text}</mark>
                                            : <span key={pi}>{part.text}</span>
                                      )
                                    : <span dangerouslySetInnerHTML={{ __html: highlightedHtml[row.left.originalIndex] }} />
                                : '\u00a0'}
                        </span>
                    </div>
                    {/* RIGHT column — added or context */}
                    <div
                        className={`flex w-1/2 min-w-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c] ${rightBg} ${rightHighlight}`}
                        style={selectSide === 'left' ? { userSelect: 'none' } : undefined}
                        data-diff-line-index={rightLine && rightLine.originalIndex !== null ? rightLine.originalIndex : undefined}
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
                                ? row.rightParts
                                    ? row.rightParts.map((part: IntraLinePart, pi: number) =>
                                        part.changed
                                            ? <mark key={pi} className="bg-[#34c759] dark:bg-[#166534] rounded-[2px]">{part.text}</mark>
                                            : <span key={pi}>{part.text}</span>
                                      )
                                    : <span dangerouslySetInnerHTML={{ __html: highlightedHtml[row.right.originalIndex] }} />
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
                    onMouseUp={handleMouseUp}
                    onMouseDown={handleMouseDown}
                    onContextMenu={enableComments ? handleContextMenu : undefined}
                    className="font-mono text-xs leading-tight overflow-x-auto text-[#1e1e1e] dark:text-[#cccccc] bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
                >
                    {virtualized ? (
                        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                            {rowVirtualizer.getVirtualItems().map(vi => (
                                <div
                                    key={vi.key}
                                    data-index={vi.index}
                                    ref={rowVirtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${vi.start - rowVirtualizer.options.scrollMargin}px)`,
                                    }}
                                >
                                    {renderRow(sxsLines[vi.index], vi.index)}
                                </div>
                            ))}
                        </div>
                    ) : (
                        sxsLines.map((row, rowIdx) => renderRow(row, rowIdx))
                    )}
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
                        onAskAI={onAskAI ? () => {
                            if (toolbar.selection) {
                                onAskAI(toolbar.selection, toolbar.selectedText, { top: toolbar.position.y, left: toolbar.position.x });
                            }
                        } : undefined}
                        onCopyAsContext={onCopyAsContext ? () => {
                            if (toolbar.selection) {
                                onCopyAsContext(toolbar.selection, toolbar.selectedText);
                            }
                        } : undefined}
                        onClose={() => setToolbar(t => ({ ...t, visible: false }))}
                    />
                )}
            </>
        );
    }
);

/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { useMemo, useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { getLanguageFromFileName, highlightLine } from './useSyntaxHighlight';
import { DiffContextMenu } from '../tasks/comments/DiffContextMenu';
import type { DiffCommentSelection, DiffComment } from '../../diff-comment-types';

export interface UnifiedDiffViewerProps {
    diff: string;
    fileName?: string;
    'data-testid'?: string;
    enableComments?: boolean;
    showLineNumbers?: boolean;
    onLinesReady?: (lines: DiffLine[]) => void;
    comments?: DiffComment[];
    onAddComment?: (
        selection: DiffCommentSelection,
        selectedText: string,
        position: { top: number; left: number }
    ) => void;
    onCommentClick?: (comment: DiffComment, event: React.MouseEvent) => void;
}

type LineType = 'added' | 'removed' | 'hunk-header' | 'meta' | 'context';

export interface DiffLine {
    index: number;
    type: LineType;
    oldLine?: number;
    newLine?: number;
    content: string;
}

export interface SideBySideLine {
    left: {
        type: 'removed' | 'context' | 'empty';
        content: string;
        lineNumber: number | null;
        originalIndex: number | null;
    };
    right: {
        type: 'added' | 'context' | 'empty';
        content: string;
        lineNumber: number | null;
        originalIndex: number | null;
    };
    hunkHeader?: string;
}

const LINE_CLASSES: Record<LineType, string> = {
    added: 'bg-[#d1f7c4] dark:bg-[#1a4731]',
    removed: 'bg-[#fecaca] dark:bg-[#4c1d1d]',
    'hunk-header': 'bg-[#dbedff] dark:bg-[#1d3251] text-[#0550ae] dark:text-[#79c0ff]',
    meta: 'text-[#6e7681] dark:text-[#8b949e]',
    context: '',
};

function classifyLine(line: string): LineType {
    if (line.startsWith('@@')) return 'hunk-header';
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename')) return 'meta';
    if (line.startsWith('+')) return 'added';
    if (line.startsWith('-')) return 'removed';
    return 'context';
}

/** Extract file path from a `diff --git a/<path> b/<path>` header line. */
export function extractFilePathFromDiffHeader(line: string): string | null {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
    return match ? match[1] : null;
}

/** Parse a `@@ -old,count +new,count @@` hunk header. */
export function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    return m ? { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) } : null;
}

/** Identify indices where an edit group starts (first added/removed line after a non-change line). */
export function computeEditStarts(diffLines: DiffLine[]): Set<number> {
    const starts = new Set<number>();
    for (let i = 0; i < diffLines.length; i++) {
        const { type } = diffLines[i];
        if (type === 'added' || type === 'removed') {
            if (i === 0 || (diffLines[i - 1].type !== 'added' && diffLines[i - 1].type !== 'removed')) {
                starts.add(i);
            }
        }
    }
    return starts;
}

/** Compute per-line identity (old/new line numbers) for a unified diff. */
export function computeDiffLines(lines: string[]): DiffLine[] {
    let oldLine: number | undefined;
    let newLine: number | undefined;
    return lines.map((raw, index) => {
        const type = classifyLine(raw);
        if (type === 'hunk-header') {
            const parsed = parseHunkHeader(raw);
            if (parsed) { oldLine = parsed.oldStart; newLine = parsed.newStart; }
            return { index, type, content: raw };
        }
        if (type === 'context') {
            const result: DiffLine = { index, type, oldLine, newLine, content: raw };
            if (oldLine !== undefined) oldLine++;
            if (newLine !== undefined) newLine++;
            return result;
        }
        if (type === 'removed') {
            const result: DiffLine = { index, type, oldLine, content: raw };
            if (oldLine !== undefined) oldLine++;
            return result;
        }
        if (type === 'added') {
            const result: DiffLine = { index, type, newLine, content: raw };
            if (newLine !== undefined) newLine++;
            return result;
        }
        // meta
        return { index, type, content: raw };
    });
}

export function computeSideBySideLines(lines: DiffLine[]): SideBySideLine[] {
    const result: SideBySideLine[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.type === 'meta') {
            i++;
            continue;
        }

        if (line.type === 'hunk-header') {
            result.push({
                left: { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                right: { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                hunkHeader: line.content,
            });
            i++;
            continue;
        }

        if (line.type === 'context') {
            result.push({
                left: { type: 'context', content: line.content, lineNumber: line.oldLine ?? null, originalIndex: line.index },
                right: { type: 'context', content: line.content, lineNumber: line.newLine ?? null, originalIndex: line.index },
            });
            i++;
            continue;
        }

        if (line.type === 'removed' || line.type === 'added') {
            const removedGroup: DiffLine[] = [];
            const addedGroup: DiffLine[] = [];

            while (i < lines.length && (lines[i].type === 'removed' || lines[i].type === 'added')) {
                if (lines[i].type === 'removed') removedGroup.push(lines[i]);
                else addedGroup.push(lines[i]);
                i++;
            }

            const pairCount = Math.max(removedGroup.length, addedGroup.length);
            for (let k = 0; k < pairCount; k++) {
                const rem = removedGroup[k];
                const add = addedGroup[k];
                result.push({
                    left: rem
                        ? { type: 'removed', content: rem.content, lineNumber: rem.oldLine ?? null, originalIndex: rem.index }
                        : { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                    right: add
                        ? { type: 'added', content: add.content, lineNumber: add.newLine ?? null, originalIndex: add.index }
                        : { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                });
            }
            continue;
        }

        i++;
    }

    return result;
}

/**
 * Compute per-line language for syntax highlighting.
 * When `fileName` is provided, every line uses that language.
 * Otherwise, parses `diff --git` headers to switch language per file section.
 */
export function getLanguagesForLines(lines: string[], fileName: string | undefined): (string | null)[] {
    if (fileName) {
        const lang = getLanguageFromFileName(fileName);
        return lines.map(() => lang);
    }
    const result: (string | null)[] = [];
    let currentLang: string | null = null;
    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            const filePath = extractFilePathFromDiffHeader(line);
            currentLang = getLanguageFromFileName(filePath);
        }
        result.push(currentLang);
    }
    return result;
}

export interface UnifiedDiffViewerHandle {
    scrollToNextHunk: () => void;
    scrollToPrevHunk: () => void;
    getHunkCount: () => number;
}

/** Reusable up/down buttons for navigating between diff hunks. */
export function HunkNavButtons({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
    return (
        <span className="inline-flex items-center gap-0.5 flex-shrink-0">
            <button
                onClick={onPrev}
                title="Previous change"
                className="w-6 h-6 flex items-center justify-center rounded text-xs text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                data-testid="prev-hunk-btn"
            >
                ▲
            </button>
            <button
                onClick={onNext}
                title="Next change"
                className="w-6 h-6 flex items-center justify-center rounded text-xs text-[#616161] dark:text-[#999] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                data-testid="next-hunk-btn"
            >
                ▼
            </button>
        </span>
    );
}

/** Build a map from diff-line index → comments covering that line. */
export function buildLineCommentMap(comments: DiffComment[]): Map<number, DiffComment[]> {
    const map = new Map<number, DiffComment[]>();
    for (const c of comments) {
        const { diffLineStart, diffLineEnd } = c.selection;
        for (let i = diffLineStart; i <= diffLineEnd; i++) {
            const existing = map.get(i);
            if (existing) existing.push(c);
            else map.set(i, [c]);
        }
    }
    return map;
}

/** Return the highlight background class for a line based on its comments. */
export function getLineHighlightClass(lineComments: DiffComment[] | undefined): string {
    if (!lineComments || lineComments.length === 0) return '';
    const hasOpen = lineComments.some(c => c.status !== 'resolved');
    if (hasOpen) return 'bg-[#fff9c4] dark:bg-[#3d3a00]';
    return 'bg-[#e6ffed] dark:bg-[#1a3d2b] opacity-80';
}

/** Return badge background+text classes based on whether any comment is open. */
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

/**
 * Walk up the DOM tree to find the nearest ancestor that scrolls vertically.
 * Falls back to `document.documentElement` when no scrollable ancestor is found.
 * Using `parentElement` directly would break when the viewer is nested inside
 * a non-scrolling wrapper (e.g. CommitDetail's diff-section div).
 */
function getScrollableAncestor(el: HTMLElement): HTMLElement {
    let current = el.parentElement;
    while (current && current !== document.documentElement) {
        const { overflowY } = getComputedStyle(current);
        if (overflowY === 'auto' || overflowY === 'scroll') return current;
        current = current.parentElement;
    }
    return document.documentElement as HTMLElement;
}

export const UnifiedDiffViewer = forwardRef<UnifiedDiffViewerHandle, UnifiedDiffViewerProps>(function UnifiedDiffViewer({ diff, fileName, 'data-testid': testId, enableComments, showLineNumbers, onLinesReady, onAddComment, comments, onCommentClick }, ref) {
    const lines = useMemo(() => diff.split('\n'), [diff]);
    const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
    const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
    const editStarts = useMemo(() => computeEditStarts(diffLines), [diffLines]);
    const lineCommentMap = useMemo(
        () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
        [comments]
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const currentHunkIndexRef = useRef<number>(-1);
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
            const parentTop = scrollParent.getBoundingClientRect().top;
            const centerOffset = scrollParent.clientHeight / 3;
            scrollParent.scrollTo({
                top: scrollParent.scrollTop + edits[next].getBoundingClientRect().top - parentTop - centerOffset,
                behavior: 'smooth',
            });
        },
        scrollToPrevHunk: () => {
            const container = containerRef.current;
            if (!container) return;
            const edits = Array.from(container.querySelectorAll<HTMLElement>('[data-edit-start]'));
            if (edits.length === 0) return;
            const startIndex =
                currentHunkIndexRef.current === -1 ? edits.length : currentHunkIndexRef.current;
            const prev = (startIndex - 1 + edits.length) % edits.length;
            currentHunkIndexRef.current = prev;
            const scrollParent = getScrollableAncestor(container);
            const parentTop = scrollParent.getBoundingClientRect().top;
            const centerOffset = scrollParent.clientHeight / 3;
            scrollParent.scrollTo({
                top: scrollParent.scrollTop + edits[prev].getBoundingClientRect().top - parentTop - centerOffset,
                behavior: 'smooth',
            });
        },
        getHunkCount: () => {
            return containerRef.current?.querySelectorAll('[data-edit-start]').length ?? 0;
        },
    }));

    const [toolbar, setToolbar] = useState<{
        visible: boolean;
        position: { x: number; y: number };
        selection: DiffCommentSelection | null;
        selectedText: string;
    }>({ visible: false, position: { x: 0, y: 0 }, selection: null, selectedText: '' });

    // Stores the last validated selection so handleContextMenu can use it without stale closures.
    const pendingSelectionRef = useRef<{ selection: DiffCommentSelection; selectedText: string } | null>(null);

    const handleMouseUp = useCallback(() => {
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
        const endEl   = findLineElement(range.endContainer, boundary);
        if (!startEl || !endEl) { clear(); return; }

        const startIdx = parseInt(startEl.getAttribute('data-diff-line-index') ?? '-1', 10);
        const endIdx   = parseInt(endEl.getAttribute('data-diff-line-index')   ?? '-1', 10);
        if (startIdx < 0 || endIdx < 0) { clear(); return; }

        const startType = startEl.getAttribute('data-line-type');
        const endType   = endEl.getAttribute('data-line-type');
        if (startType === 'hunk-header' || endType === 'hunk-header') { clear(); return; }

        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        const lineEls = containerRef.current?.querySelectorAll<HTMLElement>('[data-diff-line-index]') ?? [];
        for (const el of Array.from(lineEls)) {
            const idx = parseInt(el.getAttribute('data-diff-line-index') ?? '-1', 10);
            if (idx >= minIdx && idx <= maxIdx && el.getAttribute('data-line-type') === 'meta') {
                const text = el.textContent ?? '';
                if (text.startsWith('diff --git') || text.startsWith('diff ')) { clear(); return; }
            }
        }

        const [firstEl, lastEl] = startIdx <= endIdx ? [startEl, endEl] : [endEl, startEl];
        const selection: DiffCommentSelection = {
            diffLineStart: minIdx,
            diffLineEnd:   maxIdx,
            side: (firstEl.getAttribute('data-line-type') as 'added' | 'removed' | 'context') ?? 'context',
            oldLineStart: parseInt(firstEl.getAttribute('data-old-line') ?? '0', 10),
            oldLineEnd:   parseInt(lastEl.getAttribute('data-old-line')  ?? '0', 10),
            newLineStart: parseInt(firstEl.getAttribute('data-new-line') ?? '0', 10),
            newLineEnd:   parseInt(lastEl.getAttribute('data-new-line')  ?? '0', 10),
            startColumn: range.startOffset,
            endColumn:   range.endOffset,
        };
        const selectedText = sel.toString();
        pendingSelectionRef.current = { selection, selectedText };
        setToolbar(t => ({ ...t, visible: false, selection, selectedText }));
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

    return (
        <>
        <div
            ref={containerRef}
            onMouseUp={enableComments ? handleMouseUp : undefined}
            onMouseDown={enableComments ? handleMouseDown : undefined}
            onContextMenu={enableComments ? handleContextMenu : undefined}
            className="overflow-x-auto font-mono text-xs leading-tight bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
        >
            {lines.map((line, i) => {
                const { type, oldLine, newLine } = diffLines[i];
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const content = line.slice(1);
                    const html = highlightLine(content, languages[i]);
                    return (
                        <div
                            key={i}
                            className={`whitespace-pre-wrap break-words flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                            data-diff-line-index={enableComments ? i : undefined}
                            data-old-line={enableComments ? (oldLine ?? '') : undefined}
                            data-new-line={enableComments ? (newLine ?? '') : undefined}
                            data-line-type={enableComments ? type : undefined}
                            data-edit-start={editStarts.has(i) ? '' : undefined}
                        >
                            {showLineNumbers && (
                                <>
                                    <span className="select-none text-right w-8 shrink-0 inline-block text-[#6e7681] pr-1 whitespace-nowrap">
                                        {oldLine ?? ''}
                                    </span>
                                    <span className="select-none text-right w-8 shrink-0 inline-block text-[#6e7681] pr-1 whitespace-nowrap">
                                        {newLine ?? ''}
                                    </span>
                                </>
                            )}
                            {enableComments && (
                                <span className="inline-flex w-4 shrink-0 items-center justify-center">
                                    {(() => {
                                        const lc = (lineCommentMap.get(i) ?? []).filter(c => c.status !== 'orphaned');
                                        if (!lc || lc.length === 0) return <span className="w-4 h-4" />;
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
                            <span className="px-1 flex-1 min-w-0">
                                <span dangerouslySetInnerHTML={{ __html: html }} />
                            </span>
                        </div>
                    );
                }
                return (
                    <div
                        key={i}
                        className={`whitespace-pre-wrap break-words flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                        data-diff-line-index={enableComments ? i : undefined}
                        data-old-line={enableComments ? (oldLine ?? '') : undefined}
                        data-new-line={enableComments ? (newLine ?? '') : undefined}
                        data-line-type={enableComments ? type : undefined}
                        data-hunk-header={type === 'hunk-header' ? '' : undefined}
                    >
                        {showLineNumbers && (
                            <>
                                <span className="select-none text-right w-8 shrink-0 inline-block text-[#6e7681] pr-1 whitespace-nowrap">
                                    {oldLine ?? ''}
                                </span>
                                <span className="select-none text-right w-8 shrink-0 inline-block text-[#6e7681] pr-1 whitespace-nowrap">
                                    {newLine ?? ''}
                                </span>
                            </>
                        )}
                        {enableComments && (
                            <span className="inline-flex w-4 shrink-0 items-center justify-center">
                                {(() => {
                                    const lc = (lineCommentMap.get(i) ?? []).filter(c => c.status !== 'orphaned');
                                    if (!lc || lc.length === 0) return <span className="w-4 h-4" />;
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
                        <span className="px-1 flex-1 min-w-0">{line || '\u00a0'}</span>
                    </div>
                );
            })}
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
});

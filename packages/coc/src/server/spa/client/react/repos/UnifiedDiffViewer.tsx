/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { getLanguageFromFileName, highlightLine } from './useSyntaxHighlight';
import { SelectionToolbar } from '../tasks/comments/SelectionToolbar';
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
    onCommentClick?: (comment: DiffComment) => void;
}

type LineType = 'added' | 'removed' | 'hunk-header' | 'meta' | 'context';

export interface DiffLine {
    index: number;
    type: LineType;
    oldLine?: number;
    newLine?: number;
    content: string;
}

const LINE_CLASSES: Record<LineType, string> = {
    added: 'bg-[#e6ffed] dark:bg-[#1a3d2b] text-[#22863a] dark:text-[#3fb950]',
    removed: 'bg-[#ffeef0] dark:bg-[#3d1a1a] text-[#b31d28] dark:text-[#f85149]',
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

export function UnifiedDiffViewer({ diff, fileName, 'data-testid': testId, enableComments, showLineNumbers, onLinesReady, onAddComment, comments, onCommentClick }: UnifiedDiffViewerProps) {
    const lines = useMemo(() => diff.split('\n'), [diff]);
    const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
    const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
    const lineCommentMap = useMemo(
        () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
        [comments]
    );

    useEffect(() => {
        onLinesReady?.(diffLines);
    }, [diffLines, onLinesReady]);

    const containerRef = useRef<HTMLDivElement>(null);

    const [toolbar, setToolbar] = useState<{
        visible: boolean;
        position: { top: number; left: number };
        selection: DiffCommentSelection | null;
        selectedText: string;
    }>({ visible: false, position: { top: 0, left: 0 }, selection: null, selectedText: '' });

    const handleMouseUp = useCallback(() => {
        if (!enableComments) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            setToolbar(t => ({ ...t, visible: false }));
            return;
        }
        const range = sel.getRangeAt(0);
        const boundary = containerRef.current;
        const startEl = findLineElement(range.startContainer, boundary);
        const endEl   = findLineElement(range.endContainer, boundary);
        if (!startEl || !endEl) {
            setToolbar(t => ({ ...t, visible: false }));
            return;
        }

        const startIdx = parseInt(startEl.getAttribute('data-diff-line-index') ?? '-1', 10);
        const endIdx   = parseInt(endEl.getAttribute('data-diff-line-index')   ?? '-1', 10);
        if (startIdx < 0 || endIdx < 0) {
            setToolbar(t => ({ ...t, visible: false }));
            return;
        }

        const startType = startEl.getAttribute('data-line-type');
        const endType   = endEl.getAttribute('data-line-type');
        if (startType === 'hunk-header' || endType === 'hunk-header') {
            setToolbar(t => ({ ...t, visible: false }));
            return;
        }

        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        const lineEls = containerRef.current?.querySelectorAll<HTMLElement>('[data-diff-line-index]') ?? [];
        for (const el of Array.from(lineEls)) {
            const idx = parseInt(el.getAttribute('data-diff-line-index') ?? '-1', 10);
            if (idx >= minIdx && idx <= maxIdx && el.getAttribute('data-line-type') === 'meta') {
                const text = el.textContent ?? '';
                if (text.startsWith('diff --git') || text.startsWith('diff ')) {
                    setToolbar(t => ({ ...t, visible: false }));
                    return;
                }
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

        const rect = range.getBoundingClientRect();
        const position = { top: rect.top - 40, left: rect.left + rect.width / 2 };

        setToolbar({
            visible: true,
            position,
            selection,
            selectedText: sel.toString(),
        });
    }, [enableComments]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!(e.target as Element).closest('[data-testid="selection-toolbar"]')) {
            setToolbar(t => ({ ...t, visible: false }));
        }
    }, []);

    return (
        <>
        <div
            ref={containerRef}
            onMouseUp={enableComments ? handleMouseUp : undefined}
            onMouseDown={enableComments ? handleMouseDown : undefined}
            className="overflow-x-auto font-mono text-xs bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
        >
            {lines.map((line, i) => {
                const { type, oldLine, newLine } = diffLines[i];
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const prefix = line[0];
                    const content = line.slice(1);
                    const html = highlightLine(content, languages[i]);
                    return (
                        <div
                            key={i}
                            className={`whitespace-pre flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                            data-diff-line-index={enableComments ? i : undefined}
                            data-old-line={enableComments ? (oldLine ?? '') : undefined}
                            data-new-line={enableComments ? (newLine ?? '') : undefined}
                            data-line-type={enableComments ? type : undefined}
                        >
                            {showLineNumbers && (
                                <>
                                    <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                        {oldLine ?? ''}
                                    </span>
                                    <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                        {newLine ?? ''}
                                    </span>
                                </>
                            )}
                            {enableComments && (
                                <span className="inline-flex w-5 shrink-0 items-center justify-center">
                                    {(() => {
                                        const lc = (lineCommentMap.get(i) ?? []).filter(c => c.status !== 'orphaned');
                                        if (!lc || lc.length === 0) return <span className="w-4 h-4" />;
                                        return (
                                            <button
                                                className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${getBadgeClass(lc)} leading-none`}
                                                onClick={e => { e.stopPropagation(); onCommentClick?.(lc[0]); }}
                                                title={`${lc.length} comment${lc.length > 1 ? 's' : ''}`}
                                                data-testid="comment-badge"
                                            >
                                                {lc.length}
                                            </button>
                                        );
                                    })()}
                                </span>
                            )}
                            <span className="px-3 flex-1 min-w-0">
                                <span>{prefix}</span>
                                <span dangerouslySetInnerHTML={{ __html: html }} />
                            </span>
                        </div>
                    );
                }
                return (
                    <div
                        key={i}
                        className={`whitespace-pre flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                        data-diff-line-index={enableComments ? i : undefined}
                        data-old-line={enableComments ? (oldLine ?? '') : undefined}
                        data-new-line={enableComments ? (newLine ?? '') : undefined}
                        data-line-type={enableComments ? type : undefined}
                    >
                        {showLineNumbers && (
                            <>
                                <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                    {oldLine ?? ''}
                                </span>
                                <span className="select-none text-right w-10 inline-block text-[#6e7681] pr-1">
                                    {newLine ?? ''}
                                </span>
                            </>
                        )}
                        {enableComments && (
                            <span className="inline-flex w-5 shrink-0 items-center justify-center">
                                {(() => {
                                    const lc = (lineCommentMap.get(i) ?? []).filter(c => c.status !== 'orphaned');
                                    if (!lc || lc.length === 0) return <span className="w-4 h-4" />;
                                    return (
                                        <button
                                            className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${getBadgeClass(lc)} leading-none`}
                                            onClick={e => { e.stopPropagation(); onCommentClick?.(lc[0]); }}
                                            title={`${lc.length} comment${lc.length > 1 ? 's' : ''}`}
                                            data-testid="comment-badge"
                                        >
                                            {lc.length}
                                        </button>
                                    );
                                })()}
                            </span>
                        )}
                        <span className="px-3 flex-1 min-w-0">{line || '\u00a0'}</span>
                    </div>
                );
            })}
        </div>
        {enableComments && (
            <SelectionToolbar
                visible={toolbar.visible}
                position={toolbar.position}
                onAddComment={() => {
                    if (toolbar.selection) {
                        onAddComment?.(toolbar.selection, toolbar.selectedText, toolbar.position);
                    }
                    setToolbar(t => ({ ...t, visible: false }));
                }}
            />
        )}
        </>
    );
}

/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { useMemo, useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { getLanguageFromFileName, highlightLine } from '../hooks/useSyntaxHighlight';
import { DiffContextMenu } from '../../../tasks/comments/DiffContextMenu';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { HunkCategory, HunkClassification } from '../../pull-requests/classification-types';
import { CATEGORY_LABELS, HUNK_CATEGORIES } from '../../pull-requests/classification-types';

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
    onAskAI?: (
        selection: DiffCommentSelection,
        selectedText: string,
        position: { top: number; left: number }
    ) => void;
    onCopyAsContext?: (
        selection: DiffCommentSelection,
        selectedText: string,
    ) => void;
    onCommentClick?: (comment: DiffComment, event: React.MouseEvent) => void;
    /**
     * Optional classification integration for AC-02. When the trio
     * (filePath, getHunkClassification, activeFilters) is provided, hunks
     * whose category is not in activeFilters collapse into a single summary
     * row with category, intensity, reason, changed-line count, and an
     * expand control. Reviewer can expand an individual collapsed hunk
     * without resetting filters; setting activeFilters to all categories
     * ("Show all") also restores all hunks.
     */
    filePath?: string;
    getHunkClassification?: (filePath: string, hunkIndex: number) => HunkClassification | undefined;
    activeFilters?: Set<HunkCategory>;
}

/** Per-hunk metadata used to drive AC-02 collapsed summary rows. */
export interface HunkRange {
    /** 0-based hunk index within this file. */
    hunkIndex: number;
    /** Index of the `@@` header line in the unified diff. */
    startIdx: number;
    /** Exclusive end index (next hunk header or end of diff). */
    endIdx: number;
    /** Approximate changed-line count (added + removed lines in body). */
    changedLines: number;
    classification?: HunkClassification;
}

/**
 * Walk diffLines and produce one HunkRange per `@@` hunk header.
 * If filePath/getHunkClassification are omitted, returns ranges without
 * classifications so callers can use the geometry without filtering.
 */
export function computeHunkRanges(
    diffLines: DiffLine[],
    filePath?: string,
    getHunkClassification?: (filePath: string, hunkIndex: number) => HunkClassification | undefined,
): HunkRange[] {
    const result: HunkRange[] = [];
    let hi = -1;
    let start = -1;
    let changed = 0;
    const flush = (endIdx: number) => {
        if (start < 0) return;
        const classification = filePath && getHunkClassification
            ? getHunkClassification(filePath, hi)
            : undefined;
        result.push({ hunkIndex: hi, startIdx: start, endIdx, changedLines: changed, classification });
    };
    for (let i = 0; i < diffLines.length; i++) {
        if (diffLines[i].type === 'hunk-header') {
            flush(i);
            hi += 1;
            start = i;
            changed = 0;
        } else if (start >= 0 && (diffLines[i].type === 'added' || diffLines[i].type === 'removed')) {
            changed += 1;
        }
    }
    flush(diffLines.length);
    return result;
}

type LineType = 'added' | 'removed' | 'hunk-header' | 'meta' | 'context';

export interface DiffLine {
    index: number;
    type: LineType;
    oldLine?: number;
    newLine?: number;
    content: string;
}

/** A single token in an intra-line diff result. */
export interface IntraLinePart {
    text: string;
    changed: boolean;
}

/** Split a line into word/non-word tokens for diff granularity. */
function tokenizeLine(line: string): string[] {
    return line.match(/\w+|\W+/g) ?? [];
}

/**
 * Compute word-level intra-line diff between two strings using LCS.
 * Returns `[partsA, partsB]` where each part carries a `changed` flag.
 * Consecutive tokens with the same `changed` state are merged.
 * Skipped for very long lines (> 300 tokens) to avoid O(m*n) perf issues.
 */
export function computeIntraLineDiff(a: string, b: string): [IntraLinePart[], IntraLinePart[]] {
    const tokA = tokenizeLine(a);
    const tokB = tokenizeLine(b);

    // Safety cap to avoid quadratic perf on huge lines
    if (tokA.length === 0 && tokB.length === 0) return [[], []];
    if (tokA.length > 300 || tokB.length > 300) {
        return [
            [{ text: a, changed: true }],
            [{ text: b, changed: true }],
        ];
    }

    const m = tokA.length, n = tokB.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = tokA[i - 1] === tokB[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    const aChanged = new Array<boolean>(m).fill(true);
    const bChanged = new Array<boolean>(n).fill(true);
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (tokA[i - 1] === tokB[j - 1]) {
            aChanged[i - 1] = false;
            bChanged[j - 1] = false;
            i--; j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    const buildParts = (toks: string[], changed: boolean[]): IntraLinePart[] => {
        const parts: IntraLinePart[] = [];
        let k = 0;
        while (k < toks.length) {
            const c = changed[k];
            let text = toks[k++];
            while (k < toks.length && changed[k] === c) text += toks[k++];
            parts.push({ text, changed: c });
        }
        return parts;
    };

    return [buildParts(tokA, aChanged), buildParts(tokB, bChanged)];
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
    /** Intra-line parts for the left (removed) side — set only for 1:1 paired rows. */
    leftParts?: IntraLinePart[];
    /** Intra-line parts for the right (added) side — set only for 1:1 paired rows. */
    rightParts?: IntraLinePart[];
    /** File path from a `diff --git` header — set on the first row of each file section. */
    filePath?: string;
    /** Original unified diff line index represented by a full-width split row. */
    originalIndex?: number;
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

/**
 * Parse a raw unified diff string into a list of changed files.
 * Detects status from diff meta headers (new file, deleted file, rename).
 * Counts per-file additions and deletions from `+`/`-` content lines.
 */
export function parseDiffFileList(diffText: string): import('./FileTree').FileChange[] {
    const files: import('./FileTree').FileChange[] = [];
    const lines = diffText.split('\n');
    let current: import('./FileTree').FileChange | null = null;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            if (current) files.push(current);
            const filePath = extractFilePathFromDiffHeader(line);
            current = { status: 'M', path: filePath ?? '', additions: 0, deletions: 0 };
        } else if (current) {
            if (line.startsWith('new file'))       current.status = 'A';
            else if (line.startsWith('deleted file')) current.status = 'D';
            else if (line.startsWith('rename from'))  { current.status = 'R'; current.oldPath = line.slice('rename from '.length); }
            else if (line.startsWith('+') && !line.startsWith('+++')) current.additions = (current.additions ?? 0) + 1;
            else if (line.startsWith('-') && !line.startsWith('---')) current.deletions = (current.deletions ?? 0) + 1;
        }
    }
    if (current) files.push(current);
    return files;
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
    let pendingFilePath: string | null = null;

    while (i < lines.length) {
        const line = lines[i];

        if (line.type === 'meta') {
            const fp = extractFilePathFromDiffHeader(line.content);
            if (fp) pendingFilePath = fp;
            i++;
            continue;
        }

        if (line.type === 'hunk-header') {
            const entry: SideBySideLine = {
                left: { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                right: { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                hunkHeader: line.content,
                originalIndex: line.index,
            };
            if (pendingFilePath) {
                entry.filePath = pendingFilePath;
                pendingFilePath = null;
            }
            result.push(entry);
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
                let leftParts: IntraLinePart[] | undefined;
                let rightParts: IntraLinePart[] | undefined;
                if (rem && add) {
                    const [lp, rp] = computeIntraLineDiff(rem.content.slice(1), add.content.slice(1));
                    if (lp.some(p => p.changed) || rp.some(p => p.changed)) {
                        leftParts = lp;
                        rightParts = rp;
                    }
                }
                result.push({
                    left: rem
                        ? { type: 'removed', content: rem.content, lineNumber: rem.oldLine ?? null, originalIndex: rem.index }
                        : { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                    right: add
                        ? { type: 'added', content: add.content, lineNumber: add.newLine ?? null, originalIndex: add.index }
                        : { type: 'empty', content: '', lineNumber: null, originalIndex: null },
                    leftParts,
                    rightParts,
                });
            }
            continue;
        }

        i++;
    }

    return result;
}

/**
 * Build a map from diff-line `originalIndex` → `IntraLinePart[]` for all
 * paired changed lines in a side-by-side result.  Used by the unified viewer
 * so it can share the same intra-line computation without duplicating logic.
 */
export function buildIntraLinePartsMap(sxsLines: SideBySideLine[]): Map<number, IntraLinePart[]> {
    const map = new Map<number, IntraLinePart[]>();
    for (const row of sxsLines) {
        if (row.leftParts && row.left.originalIndex !== null) {
            map.set(row.left.originalIndex, row.leftParts);
        }
        if (row.rightParts && row.right.originalIndex !== null) {
            map.set(row.right.originalIndex, row.rightParts);
        }
    }
    return map;
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
    /** Returns the 0-based index of the currently active hunk, or -1 if none. */
    getCurrentHunkIndex: () => number;
    /** Scrolls to the hunk at the given 0-based index and updates the internal cursor. */
    scrollToHunk: (index: number) => void;
    /** Scrolls to the first row of the given file in a multi-file diff. */
    scrollToFile: (filePath: string) => void;
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

export const UnifiedDiffViewer = forwardRef<UnifiedDiffViewerHandle, UnifiedDiffViewerProps>(function UnifiedDiffViewer({ diff, fileName, 'data-testid': testId, enableComments, showLineNumbers, onLinesReady, onAddComment, onAskAI, onCopyAsContext, comments, onCommentClick, filePath, getHunkClassification, activeFilters }, ref) {
    const lines = useMemo(() => diff.split('\n'), [diff]);
    const languages = useMemo(() => getLanguagesForLines(lines, fileName), [lines, fileName]);
    const diffLines = useMemo(() => computeDiffLines(lines), [lines]);
    const sxsLines = useMemo(() => computeSideBySideLines(diffLines), [diffLines]);
    const intraLinePartsMap = useMemo(() => buildIntraLinePartsMap(sxsLines), [sxsLines]);
    const editStarts = useMemo(() => computeEditStarts(diffLines), [diffLines]);
    const lineCommentMap = useMemo(
        () => (comments ? buildLineCommentMap(comments) : new Map<number, DiffComment[]>()),
        [comments]
    );

    // ── AC-02: classification-driven hunk collapse ──────────────────
    // Hunks whose category is not in activeFilters render as compact
    // summary rows (category, intensity, reason, changed-line count, and
    // an expand control) instead of disappearing. expandedHunks tracks
    // per-hunk overrides so a reviewer can expand one collapsed hunk
    // without resetting all filters.
    const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());

    const hunkRanges = useMemo(
        () => computeHunkRanges(diffLines, filePath, getHunkClassification),
        [diffLines, filePath, getHunkClassification],
    );

    const collapsedByStart = useMemo(() => {
        const map = new Map<number, HunkRange>();
        if (!activeFilters || !filePath || !getHunkClassification) return map;
        for (const h of hunkRanges) {
            if (!h.classification) continue;
            if (activeFilters.has(h.classification.category)) continue;
            if (expandedHunks.has(h.hunkIndex)) continue;
            map.set(h.startIdx, h);
        }
        return map;
    }, [hunkRanges, activeFilters, expandedHunks, filePath, getHunkClassification]);

    // AC-03: hunks that were filtered-out but manually expanded by the reviewer.
    // These keep a compact classification badge + Collapse button on their @@ header.
    const expandedByStart = useMemo(() => {
        const map = new Map<number, HunkRange>();
        if (!activeFilters || !filePath || !getHunkClassification) return map;
        for (const h of hunkRanges) {
            if (!h.classification) continue;
            if (activeFilters.has(h.classification.category)) continue;
            if (!expandedHunks.has(h.hunkIndex)) continue;
            map.set(h.startIdx, h);
        }
        return map;
    }, [hunkRanges, activeFilters, expandedHunks, filePath, getHunkClassification]);

    const skipIndices = useMemo(() => {
        const set = new Set<number>();
        for (const h of collapsedByStart.values()) {
            // Skip every line inside the collapsed hunk except the start
            // (we render a summary row in place of the @@ header line).
            for (let k = h.startIdx + 1; k < h.endIdx; k++) set.add(k);
        }
        return set;
    }, [collapsedByStart]);

    // When the active-filter set becomes the full set (Show all), clear
    // any per-hunk overrides so subsequent filter changes start fresh.
    useEffect(() => {
        if (!activeFilters) return;
        if (activeFilters.size >= HUNK_CATEGORIES.length) {
            setExpandedHunks(prev => (prev.size === 0 ? prev : new Set()));
        }
    }, [activeFilters]);

    const expandHunk = useCallback((hunkIndex: number) => {
        setExpandedHunks(prev => {
            if (prev.has(hunkIndex)) return prev;
            const next = new Set(prev);
            next.add(hunkIndex);
            return next;
        });
    }, []);

    const collapseHunk = useCallback((hunkIndex: number) => {
        setExpandedHunks(prev => {
            if (!prev.has(hunkIndex)) return prev;
            const next = new Set(prev);
            next.delete(hunkIndex);
            return next;
        });
    }, []);

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
    }));

    const [toolbar, setToolbar] = useState<{
        visible: boolean;
        position: { x: number; y: number };
        selection: DiffCommentSelection | null;
        selectedText: string;
    }>({ visible: false, position: { x: 0, y: 0 }, selection: null, selectedText: '' });

    // Stores the last validated selection so handleContextMenu can use it without stale closures.
    const pendingSelectionRef = useRef<{ selection: DiffCommentSelection; selectedText: string } | null>(null);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
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

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
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
                if (skipIndices.has(i)) return null;
                const collapsedHunk = collapsedByStart.get(i);
                if (collapsedHunk && collapsedHunk.classification) {
                    const c = collapsedHunk.classification;
                    return (
                        <div
                            key={i}
                            className="whitespace-pre-wrap break-words flex items-center gap-2 px-2 py-1 bg-[#f0f4f8] dark:bg-[#252b33] text-[#0550ae] dark:text-[#79c0ff] border-y border-[#e0e0e0] dark:border-[#3c3c3c] cursor-default"
                            data-collapsed-hunk-index={collapsedHunk.hunkIndex}
                            data-testid="collapsed-hunk-summary"
                        >
                            <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${c.intensity === 'high' ? 'bg-[#ffd8b2] text-[#b94a00] dark:bg-[#5a2e00] dark:text-[#ffb380]' : 'bg-[#e0e7ff] text-[#3730a3] dark:bg-[#1e293b] dark:text-[#93c5fd]'}`}
                            >
                                {CATEGORY_LABELS[c.category]}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide text-[#6e7681] dark:text-[#8b949e]">
                                {c.intensity}
                            </span>
                            <span
                                className="flex-1 min-w-0 truncate text-[#24292f] dark:text-[#c9d1d9]"
                                title={c.reason}
                            >
                                {c.reason}
                            </span>
                            <span className="shrink-0 text-[10px] text-[#6e7681] dark:text-[#8b949e] whitespace-nowrap">
                                ~{collapsedHunk.changedLines} line{collapsedHunk.changedLines === 1 ? '' : 's'}
                            </span>
                            <button
                                type="button"
                                className="shrink-0 text-[11px] px-2 py-0.5 rounded bg-white dark:bg-[#1f2937] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#24292f] dark:text-[#c9d1d9] hover:bg-[#f3f4f6] dark:hover:bg-[#2a3340]"
                                onClick={() => expandHunk(collapsedHunk.hunkIndex)}
                                data-testid="collapsed-hunk-expand"
                            >
                                Expand
                            </button>
                        </div>
                    );
                }
                // AC-03: hunk that was filtered-out but manually expanded (shows badge + Collapse).
                const expandedHunk = expandedByStart.get(i);
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const content = line.slice(1);
                    const intraParts = (type === 'added' || type === 'removed') ? intraLinePartsMap.get(i) : undefined;
                    const markClass = type === 'removed'
                        ? 'bg-[#f97575] dark:bg-[#b91c1c] rounded-[2px]'
                        : 'bg-[#34c759] dark:bg-[#166534] rounded-[2px]';
                    const html = intraParts ? null : highlightLine(content, languages[i]);
                    return (
                        <div
                            key={i}
                            className={`whitespace-pre-wrap break-words flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                            data-diff-line-index={i}
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
                            <span className="px-1 flex-1 min-w-0 whitespace-pre-wrap break-words font-mono">
                                {intraParts
                                    ? intraParts.map((part, pi) =>
                                        part.changed
                                            ? <mark key={pi} className={markClass}>{part.text}</mark>
                                            : <span key={pi}>{part.text}</span>
                                      )
                                    : <span dangerouslySetInnerHTML={{ __html: html! }} />
                                }
                            </span>
                        </div>
                    );
                }
                return (
                    <div
                        key={i}
                        className={`whitespace-pre-wrap break-words flex ${LINE_CLASSES[type]} ${getLineHighlightClass(lineCommentMap.get(i))}`}
                        data-diff-line-index={i}
                        data-old-line={enableComments ? (oldLine ?? '') : undefined}
                        data-new-line={enableComments ? (newLine ?? '') : undefined}
                        data-line-type={enableComments ? type : undefined}
                        data-hunk-header={type === 'hunk-header' ? '' : undefined}
                        data-file-path={type === 'meta' && line.startsWith('diff --git') ? (extractFilePathFromDiffHeader(line) ?? undefined) : undefined}
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
                        {expandedHunk?.classification && type === 'hunk-header' && (
                            <>
                                <span
                                    className={`shrink-0 inline-flex items-center self-center px-1.5 py-0.5 mx-1 rounded text-[10px] font-semibold uppercase tracking-wide ${expandedHunk.classification.intensity === 'high' ? 'bg-[#ffd8b2] text-[#b94a00] dark:bg-[#5a2e00] dark:text-[#ffb380]' : 'bg-[#e0e7ff] text-[#3730a3] dark:bg-[#1e293b] dark:text-[#93c5fd]'}`}
                                    title={expandedHunk.classification.reason}
                                    data-testid="expanded-hunk-badge"
                                >
                                    {CATEGORY_LABELS[expandedHunk.classification.category]}
                                </span>
                                <button
                                    type="button"
                                    className="shrink-0 self-center text-[11px] px-2 py-0.5 mx-1 rounded bg-white dark:bg-[#1f2937] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#24292f] dark:text-[#c9d1d9] hover:bg-[#f3f4f6] dark:hover:bg-[#2a3340]"
                                    onClick={() => collapseHunk(expandedHunk.hunkIndex)}
                                    data-testid="expanded-hunk-collapse"
                                >
                                    Collapse
                                </button>
                            </>
                        )}
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
});

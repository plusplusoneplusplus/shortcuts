/**
 * UnifiedDiffViewer — renders a unified diff string with syntax highlighting.
 *
 * Classifies each line by its prefix and applies appropriate background/text
 * colors for added, removed, hunk-header, and metadata lines.
 * Code content lines are syntax-highlighted using highlight.js token spans.
 */

import { Fragment, useMemo, useEffect, useLayoutEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getLanguageFromFileName, highlightBlock, escapeHtml } from '../hooks/useSyntaxHighlight';
import { DiffContextMenu } from '../../../tasks/comments/DiffContextMenu';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { HunkCategory, HunkClassification } from '../../pull-requests/classification-types';
import { CATEGORY_LABELS, HUNK_CATEGORIES, pickDominantClassification } from '../../pull-requests/classification-types';

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
 *
 * Robustness guard: a classifier may emit MORE classification entries than the
 * diff has physical `@@` hunks (e.g. it conceptually split one contiguous block
 * into "imports" + "logic"). Such orphan entries (hunkIndex >= number of `@@`
 * hunks) have no `@@` header to attach to and would otherwise be silently
 * dropped from the rendered diff — even though the file-tree badge still counts
 * them, producing a badge/diff mismatch. We fold every orphan into the last
 * real hunk, keeping the most review-worthy classification (max priority), so a
 * logic edit can never disappear while the badge claims logic.
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

    // Fold orphan classifications (hunkIndex >= physical `@@` hunk count) into
    // the last real hunk so they are never silently dropped.
    if (filePath && getHunkClassification && result.length > 0) {
        const realHunkCount = result.length;
        const last = result[realHunkCount - 1];
        let dominant = last.classification;
        const SAFETY_CAP = realHunkCount + 10_000;
        for (let idx = realHunkCount; idx < SAFETY_CAP; idx++) {
            const orphan = getHunkClassification(filePath, idx);
            if (!orphan) break;
            dominant = pickDominantClassification(dominant, orphan);
        }
        last.classification = dominant;
    }

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

export function computeSideBySideLines(lines: DiffLine[], skipIntraLineDiff = false): SideBySideLine[] {
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
                if (rem && add && !skipIntraLineDiff) {
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

// ── Performance guards ──────────────────────────────────────────────────
//
// Two structural safeguards keep large files from freezing the diff tab:
//   1. Windowing: once a diff exceeds VIRTUALIZE_THRESHOLD lines only the
//      visible rows (plus overscan) are mounted, bounding DOM-node count.
//   2. Memoized highlighting: syntax highlighting runs once per file via
//      highlightBlock, not per-line on every render.
// Plus a fast path for generated/huge files that skips highlighting AND
// word-level intra-line diff entirely (escaped plain text only).

/** Estimated row height (px) for the virtualizer at `text-xs leading-tight`. */
export const DIFF_LINE_ESTIMATE_PX = 18;

/** Diffs longer than this many lines render through the windowed row list. */
export const VIRTUALIZE_THRESHOLD = 500;

/** Files longer than this many lines skip highlight + word-level intra-line diff. */
export const LARGE_FILE_LINES = 5000;

/** Base names always treated as generated (skip highlight + word diff). */
const GENERATED_FILE_NAMES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'npm-shrinkwrap.json',
    'composer.lock',
    'Cargo.lock',
    'poetry.lock',
    'Gemfile.lock',
]);

/** Extensions/suffixes always treated as generated. */
const GENERATED_FILE_RE = /\.(min\.js|min\.css|map)$/i;

/** True when a file name matches a known generated/lock artifact. */
export function isGeneratedFile(fileName: string | undefined): boolean {
    if (!fileName) return false;
    const base = fileName.split('/').pop() ?? fileName;
    return GENERATED_FILE_NAMES.has(base) || GENERATED_FILE_RE.test(base);
}

/**
 * Decide whether to skip syntax highlighting + word-level intra-line diff for a
 * file. Triggers on known generated names or when the diff is very large, where
 * per-line highlight and O(m*n) word diff dominate render cost with little value.
 */
export function shouldSkipHighlight(fileName: string | undefined, lineCount: number): boolean {
    return isGeneratedFile(fileName) || lineCount > LARGE_FILE_LINES;
}

/**
 * Precompute per-line highlighted HTML for every content line of a unified diff.
 *
 * Highlighting runs ONCE per contiguous same-language run of content lines via
 * `highlightBlock` (a single hljs pass that also fixes multi-line tokens such as
 * block comments), instead of calling `highlightLine` per-line inside the render
 * body on every re-render. Returns an array indexed by diff-line index; entries
 * for meta / hunk-header / empty lines are '' and are ignored by the row
 * renderer. When `skipHighlight` is set the content falls back to escaped plain
 * text with no hljs pass at all.
 */
export function computeHighlightedHtml(
    diffLines: DiffLine[],
    languages: (string | null)[],
    skipHighlight = false,
): string[] {
    const result = new Array<string>(diffLines.length).fill('');
    const isContent = (dl: DiffLine) =>
        (dl.type === 'added' || dl.type === 'removed' || dl.type === 'context') && dl.content.length > 0;

    let i = 0;
    while (i < diffLines.length) {
        if (!isContent(diffLines[i])) { i++; continue; }
        // Gather a maximal run of consecutive content lines sharing one language.
        const startI = i;
        const lang = languages[i] ?? null;
        const contents: string[] = [];
        while (i < diffLines.length && isContent(diffLines[i]) && (languages[i] ?? null) === lang) {
            contents.push(diffLines[i].content.slice(1));
            i++;
        }
        const htmls = skipHighlight ? contents.map(escapeHtml) : highlightBlock(contents, lang);
        for (let k = 0; k < htmls.length; k++) result[startI + k] = htmls[k];
    }
    return result;
}

/** Ascending diff-line indices where an edit group starts (from `editStarts`). */
export function editStartIndexList(editStarts: Set<number>): number[] {
    return Array.from(editStarts).sort((a, b) => a - b);
}

/** Map of file path → diff-line index of its first `diff --git` header. */
export function fileHeaderIndexMap(diffLines: DiffLine[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const dl of diffLines) {
        if (dl.type !== 'meta') continue;
        const fp = extractFilePathFromDiffHeader(dl.content);
        if (fp && !map.has(fp)) map.set(fp, dl.index);
    }
    return map;
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

function classificationPillClass(classification: HunkClassification): string {
    return classification.intensity === 'high'
        ? 'bg-[#ffd8b2] text-[#b94a00] dark:bg-[#5a2e00] dark:text-[#ffb380]'
        : 'bg-[#e0e7ff] text-[#3730a3] dark:bg-[#1e293b] dark:text-[#93c5fd]';
}

function hunkGuidanceComment(classification: HunkClassification): { label: string; text: string; testId: string } | null {
    if (classification.category === 'test' && classification.testFidelityComment) {
        return {
            label: 'Test fidelity',
            text: classification.testFidelityComment,
            testId: 'hunk-test-fidelity-comment',
        };
    }
    if (classification.category === 'logic' && classification.summaryComment) {
        return {
            label: 'Summary',
            text: classification.summaryComment,
            testId: 'hunk-summary-comment',
        };
    }
    return null;
}

function locationLabel(file: string, line?: number): string {
    return line === undefined ? file : `${file}:${line}`;
}

function CriticalEvidence({
    classification,
    compact = false,
}: {
    classification: HunkClassification;
    compact?: boolean;
}) {
    const critical = classification.critical;
    if (!critical) return null;

    return (
        <div
            className={compact
                ? 'mt-1 rounded border border-red-200 bg-red-50/80 px-2 py-1 text-[10px] text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100'
                : 'mt-1 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-950 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100'}
            data-testid={compact ? 'collapsed-hunk-critical-guidance' : 'hunk-critical-guidance'}
        >
            <div className="flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    ! Critical
                </span>
                <span className="font-semibold">{critical.label}</span>
                <span className="text-red-800 dark:text-red-200">{critical.impactSummary}</span>
            </div>
            <div className="mt-1 grid gap-1 text-red-800 dark:text-red-200">
                <div data-testid={compact ? 'collapsed-hunk-critical-usages' : 'hunk-critical-usages'}>
                    <span className="font-semibold">Usage: </span>
                    {critical.usages.length > 0 ? (
                        <span>
                            {critical.usages.map((usage, index) => (
                                <span key={`${usage.file}:${usage.line ?? 'noline'}:${index}`}>
                                    {index > 0 ? '; ' : ''}
                                    {usage.symbol ? `${usage.symbol} at ` : ''}
                                    {locationLabel(usage.file, usage.line)} - {usage.description}
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span>Usage not determined</span>
                    )}
                </div>
                <div data-testid={compact ? 'collapsed-hunk-critical-call-path' : 'hunk-critical-call-path'}>
                    <span className="font-semibold">Call stack: </span>
                    {critical.callPath.length > 0 ? (
                        <span>
                            {critical.callPath.map((frame, index) => (
                                <span key={`${frame.file}:${frame.symbol}:${frame.line ?? 'noline'}:${index}`}>
                                    {index > 0 ? ' -> ' : ''}
                                    {frame.symbol} ({locationLabel(frame.file, frame.line)})
                                    {frame.description ? ` - ${frame.description}` : ''}
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span>Call stack not determined</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function HunkGuidanceDetails({
    classification,
    compact = false,
}: {
    classification: HunkClassification;
    compact?: boolean;
}) {
    const comment = hunkGuidanceComment(classification);
    if (!comment && !classification.critical) return null;

    return (
        <div
            className={compact
                ? 'mt-1 min-w-0 flex-1 font-sans text-[10px] leading-snug text-[#57606a] dark:text-[#8b949e]'
                : 'border-y border-[#e0e0e0] bg-[#f8fafc] px-3 py-1.5 font-sans text-[11px] leading-snug text-[#57606a] dark:border-[#3c3c3c] dark:bg-[#1f252d] dark:text-[#8b949e]'}
            data-testid={compact ? 'collapsed-hunk-rich-guidance' : 'hunk-rich-guidance'}
        >
            {comment && (
                <div data-testid={compact ? `collapsed-${comment.testId}` : comment.testId}>
                    <span className="font-semibold text-[#24292f] dark:text-[#c9d1d9]">{comment.label}: </span>
                    <span>{comment.text}</span>
                </div>
            )}
            <CriticalEvidence classification={classification} compact={compact} />
        </div>
    );
}

function CollapsedHunkSummary({
    hunk,
    onExpand,
}: {
    hunk: HunkRange;
    onExpand: (hunkIndex: number) => void;
}) {
    const classification = hunk.classification;
    if (!classification) return null;

    return (
        <div
            className="whitespace-pre-wrap break-words border-y border-[#e0e0e0] bg-[#f0f4f8] px-2 py-1 text-[#0550ae] dark:border-[#3c3c3c] dark:bg-[#252b33] dark:text-[#79c0ff] cursor-default"
            data-collapsed-hunk-index={hunk.hunkIndex}
            data-testid="collapsed-hunk-summary"
        >
            <div className="flex items-center gap-2">
                <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classificationPillClass(classification)}`}
                >
                    {CATEGORY_LABELS[classification.category]}
                </span>
                {classification.critical && (
                    <span
                        className="inline-flex items-center rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                        title={classification.critical.impactSummary}
                        data-testid="collapsed-hunk-critical-marker"
                    >
                        ! Critical
                    </span>
                )}
                <span className="text-[10px] uppercase tracking-wide text-[#6e7681] dark:text-[#8b949e]">
                    {classification.intensity}
                </span>
                <span
                    className="min-w-0 flex-1 truncate text-[#24292f] dark:text-[#c9d1d9]"
                    title={classification.reason}
                >
                    {classification.reason}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[10px] text-[#6e7681] dark:text-[#8b949e]">
                    ~{hunk.changedLines} line{hunk.changedLines === 1 ? '' : 's'}
                </span>
                <button
                    type="button"
                    className="shrink-0 rounded border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] text-[#24292f] hover:bg-[#f3f4f6] dark:border-[#3c3c3c] dark:bg-[#1f2937] dark:text-[#c9d1d9] dark:hover:bg-[#2a3340]"
                    onClick={() => onExpand(hunk.hunkIndex)}
                    data-testid="collapsed-hunk-expand"
                >
                    Expand
                </button>
            </div>
            <HunkGuidanceDetails classification={classification} compact />
        </div>
    );
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
    // Generated/huge files skip highlight + word-level intra-line diff (fast path).
    const skipHighlight = useMemo(() => shouldSkipHighlight(fileName, lines.length), [fileName, lines.length]);
    // Word-level intra-line diff — skipped on the fast path (empty map).
    const intraLinePartsMap = useMemo(
        () => (skipHighlight ? new Map<number, IntraLinePart[]>() : buildIntraLinePartsMap(computeSideBySideLines(diffLines))),
        [diffLines, skipHighlight]
    );
    // Syntax highlighting computed ONCE (per-file block pass), not per-line/per-render.
    const highlightedHtml = useMemo(
        () => computeHighlightedHtml(diffLines, languages, skipHighlight),
        [diffLines, languages, skipHighlight]
    );
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

    const hunkByStart = useMemo(() => {
        const map = new Map<number, HunkRange>();
        for (const h of hunkRanges) map.set(h.startIdx, h);
        return map;
    }, [hunkRanges]);

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

    // ── Windowing (large files only) ────────────────────────────────────
    // Small diffs render eagerly (every row in the DOM) so existing behavior
    // and tests are unchanged. Beyond VIRTUALIZE_THRESHOLD the row list is
    // windowed: only viewport + overscan rows mount, bounding DOM-node count.
    const virtualized = lines.length > VIRTUALIZE_THRESHOLD;
    const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    useLayoutEffect(() => {
        const c = containerRef.current;
        if (!c) return;
        const se = getScrollableAncestor(c);
        setScrollEl(se);
        // Offset of the row list within the scroll element's content, so
        // scrollToIndex targets the right absolute position when the diff is
        // not the first thing inside the scroll container.
        setScrollMargin(c.getBoundingClientRect().top - se.getBoundingClientRect().top + se.scrollTop);
    }, [virtualized]);

    const rowVirtualizer = useVirtualizer({
        count: virtualized ? lines.length : 0,
        getScrollElement: () => scrollEl,
        estimateSize: () => DIFF_LINE_ESTIMATE_PX,
        overscan: 24,
        scrollMargin,
        // jsdom reports 0-height rects; fall back to the estimate so windowing
        // stays deterministic in tests while self-correcting in a real browser.
        measureElement: (el) => {
            const h = (el as HTMLElement).getBoundingClientRect?.().height;
            return h && h > 0 ? h : DIFF_LINE_ESTIMATE_PX;
        },
    });

    useImperativeHandle(ref, () => {
        // Windowed path: off-screen rows aren't in the DOM, so drive navigation
        // from diffLines geometry via the virtualizer's index→offset API.
        if (virtualized) {
            const editList = editStartIndexList(editStarts);
            const fileHeaders = fileHeaderIndexMap(diffLines);
            const scrollToEdit = (n: number) => {
                rowVirtualizer.scrollToIndex(editList[n], { align: 'center' });
            };
            return {
                scrollToNextHunk: () => {
                    if (editList.length === 0) return;
                    const next = (currentHunkIndexRef.current + 1) % editList.length;
                    currentHunkIndexRef.current = next;
                    scrollToEdit(next);
                },
                scrollToPrevHunk: () => {
                    if (editList.length === 0) return;
                    const start = currentHunkIndexRef.current === -1 ? editList.length : currentHunkIndexRef.current;
                    const prev = (start - 1 + editList.length) % editList.length;
                    currentHunkIndexRef.current = prev;
                    scrollToEdit(prev);
                },
                getHunkCount: () => editList.length,
                getCurrentHunkIndex: () => currentHunkIndexRef.current,
                scrollToHunk: (index: number) => {
                    if (index < 0 || index >= editList.length) return;
                    currentHunkIndexRef.current = index;
                    scrollToEdit(index);
                },
                scrollToFile: (filePath: string) => {
                    const idx = fileHeaders.get(filePath);
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
        };
    });

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
        // Reject selections that cross a file boundary. Derive this from diffLines
        // rather than querying mounted rows, so it stays correct when the row list
        // is windowed and intermediate meta rows are not in the DOM.
        for (let idx = minIdx; idx <= maxIdx && idx < diffLines.length; idx++) {
            const dl = diffLines[idx];
            if (dl.type === 'meta' && (dl.content.startsWith('diff --git') || dl.content.startsWith('diff '))) {
                clear();
                return;
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
    }, [enableComments, diffLines]);

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
            className="overflow-x-auto font-mono text-xs leading-tight text-[#1e1e1e] dark:text-[#cccccc] bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
            data-testid={testId}
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
                            {renderLineRow(vi.index)}
                        </div>
                    ))}
                </div>
            ) : (
                lines.map((_, i) => renderLineRow(i))
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

    function renderLineRow(i: number) {
                const line = lines[i];
                const { type, oldLine, newLine } = diffLines[i];
                if (skipIndices.has(i)) return null;
                const collapsedHunk = collapsedByStart.get(i);
                if (collapsedHunk && collapsedHunk.classification) {
                    return <CollapsedHunkSummary key={i} hunk={collapsedHunk} onExpand={expandHunk} />;
                }
                // AC-03: hunk that was filtered-out but manually expanded (shows badge + Collapse).
                const expandedHunk = expandedByStart.get(i);
                const hunk = hunkByStart.get(i);
                if ((type === 'added' || type === 'removed' || type === 'context') && line.length > 0) {
                    const content = line.slice(1);
                    const intraParts = (type === 'added' || type === 'removed') ? intraLinePartsMap.get(i) : undefined;
                    const markClass = type === 'removed'
                        ? 'bg-[#f97575] dark:bg-[#b91c1c] rounded-[2px]'
                        : 'bg-[#34c759] dark:bg-[#166534] rounded-[2px]';
                    // Highlighting is precomputed once (computeHighlightedHtml) instead of
                    // calling highlightLine(content, languages[i]) per-line on every render.
                    const html = intraParts ? null : highlightedHtml[i];
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
                const headerClassification = type === 'hunk-header'
                    ? expandedHunk?.classification ?? hunk?.classification
                    : undefined;
                const row = (
                    <div
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
                        {headerClassification && (
                            <>
                                <span
                                    className={`mx-1 inline-flex shrink-0 items-center self-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classificationPillClass(headerClassification)}`}
                                    title={headerClassification.reason}
                                    data-testid={expandedHunk ? 'expanded-hunk-badge' : 'hunk-classification-badge'}
                                >
                                    {CATEGORY_LABELS[headerClassification.category]}
                                </span>
                                {headerClassification.critical && (
                                    <span
                                        className="mx-1 inline-flex shrink-0 items-center self-center rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                                        title={headerClassification.critical.impactSummary}
                                        data-testid="hunk-critical-marker"
                                    >
                                        ! Critical
                                    </span>
                                )}
                                {expandedHunk && (
                                    <button
                                        type="button"
                                        className="mx-1 shrink-0 self-center rounded border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] text-[#24292f] hover:bg-[#f3f4f6] dark:border-[#3c3c3c] dark:bg-[#1f2937] dark:text-[#c9d1d9] dark:hover:bg-[#2a3340]"
                                        onClick={() => collapseHunk(expandedHunk.hunkIndex)}
                                        data-testid="expanded-hunk-collapse"
                                    >
                                        Collapse
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                );
                if (type === 'hunk-header' && headerClassification) {
                    return (
                        <Fragment key={i}>
                            {row}
                            <HunkGuidanceDetails classification={headerClassification} />
                        </Fragment>
                    );
                }
                return <Fragment key={i}>{row}</Fragment>;
    }
});

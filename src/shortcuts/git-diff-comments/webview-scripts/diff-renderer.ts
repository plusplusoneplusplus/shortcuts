/**
 * Diff renderer - renders side-by-side diff view and inline view
 */

import { getLanguageFromFilePath, highlightCode, splitHighlightedHtmlIntoLines } from '../../shared/highlighted-html-lines';
import { buildHunkText, hasLineNumberGap } from '../diff-utils';
import { getCommentsForLine, getIgnoreWhitespace, getState, getViewMode } from './state';
import { DiffComment, DiffLineType } from './types';

/**
 * Track diff line info for indicator bar
 */
interface DiffLineInfo {
    index: number;
    type: 'context' | 'addition' | 'deletion';
    hasComment: boolean;
    /** Line number in the old file (null if this is an addition) */
    oldLineNum: number | null;
    /** Line number in the new file (null if this is a deletion) */
    newLineNum: number | null;
}

/**
 * Store aligned diff info for indicator bar rendering
 */
let alignedDiffInfo: DiffLineInfo[] = [];

/**
 * Maps from file line number to aligned diff index
 * Key format: "old:lineNum" or "new:lineNum"
 */
let lineToIndexMap: Map<string, number> = new Map();

/**
 * Parse content into lines
 */
function parseLines(content: string): string[] {
    return content.split('\n');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Cache for highlighted lines
 * Includes content hashes to ensure cache validity when switching files
 */
interface HighlightedLinesCache {
    oldLines: string[];
    newLines: string[];
    language: string;
    /** Hash of old content to detect content changes */
    oldContentHash: string;
    /** Hash of new content to detect content changes */
    newContentHash: string;
}

let highlightedCache: HighlightedLinesCache | null = null;

/**
 * Simple hash function for content comparison
 * Uses a combination of length and sampled characters for fast comparison
 */
function hashContent(content: string): string {
    // Use content length + first 100 chars + last 100 chars + middle sample
    // This provides a fast and reliable check for content changes
    const len = content.length;
    const first = content.slice(0, 100);
    const last = content.slice(-100);
    const mid = len > 200 ? content.slice(Math.floor(len / 2) - 50, Math.floor(len / 2) + 50) : '';
    return `${len}:${first}:${mid}:${last}`;
}

/**
 * Get highlighted lines for old and new content
 * Uses caching to avoid re-highlighting on every render
 */
function getHighlightedLines(): { oldHighlighted: string[]; newHighlighted: string[] } {
    const state = getState();
    const language = getLanguageFromFilePath(state.filePath);
    const oldContentHash = hashContent(state.oldContent);
    const newContentHash = hashContent(state.newContent);

    // Check if we can use cached result
    // Must verify both language AND content match to avoid showing wrong file's content
    if (highlightedCache &&
        highlightedCache.language === language &&
        highlightedCache.oldContentHash === oldContentHash &&
        highlightedCache.newContentHash === newContentHash) {
        return {
            oldHighlighted: highlightedCache.oldLines,
            newHighlighted: highlightedCache.newLines
        };
    }

    // Highlight full content
    const oldHighlightedHtml = highlightCode(state.oldContent, language);
    const newHighlightedHtml = highlightCode(state.newContent, language);

    // Split into lines with balanced tags
    const oldHighlighted = splitHighlightedHtmlIntoLines(oldHighlightedHtml);
    const newHighlighted = splitHighlightedHtmlIntoLines(newHighlightedHtml);

    // Cache the result with content hashes for validation
    highlightedCache = {
        oldLines: oldHighlighted,
        newLines: newHighlighted,
        language,
        oldContentHash,
        newContentHash
    };

    return { oldHighlighted, newHighlighted };
}

/**
 * Invalidate the highlight cache (call when content changes)
 */
export function invalidateHighlightCache(): void {
    highlightedCache = null;
}

/**
 * Create a hunk header element (@@ ... @@) for split view (legacy, replaced by createHunkHeaderElement in 005)
 */
function createSplitHunkHeaderElement(text: string, side: 'old' | 'new'): HTMLElement {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'diff-line diff-line-hunk';

    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'hunk-gutter';
    gutterDiv.textContent = '···';
    lineDiv.appendChild(gutterDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'hunk-content';
    contentDiv.textContent = text;
    lineDiv.appendChild(contentDiv);

    return lineDiv;
}

/**
 * Create a hunk header element for inline view
 */
function createInlineHunkHeaderElement(text: string): HTMLElement {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'inline-diff-line diff-line-hunk';

    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'inline-line-gutter';
    // Empty line number spans for consistent gutter structure
    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'line-prefix';
    gutterDiv.appendChild(prefixSpan);
    const oldNumSpan = document.createElement('span');
    oldNumSpan.className = 'old-line-num';
    gutterDiv.appendChild(oldNumSpan);
    const newNumSpan = document.createElement('span');
    newNumSpan.className = 'new-line-num';
    gutterDiv.appendChild(newNumSpan);
    lineDiv.appendChild(gutterDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'hunk-content';
    contentDiv.textContent = text;
    lineDiv.appendChild(contentDiv);

    return lineDiv;
}

/**
 * Create a line element
 * @param highlightedContent - Pre-highlighted HTML content (if available)
 */
function createLineElement(
    lineNumber: number | null,
    content: string,
    type: DiffLineType,
    side: 'old' | 'new',
    comments: DiffComment[],
    highlightedContent?: string
): HTMLElement {
    const lineDiv = document.createElement('div');
    lineDiv.className = `diff-line diff-line-${type}`;

    if (lineNumber !== null) {
        lineDiv.dataset.lineNumber = String(lineNumber);
        lineDiv.dataset.side = side;
    }

    // Store original content for accurate extraction during save
    // This preserves whitespace that might be lost when extracting from DOM
    lineDiv.dataset.originalContent = content;

    // Line number gutter
    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'line-gutter';

    // Line number column
    const lineNumSpan = document.createElement('span');
    lineNumSpan.className = 'line-number';
    if (lineNumber !== null) {
        lineNumSpan.textContent = String(lineNumber);
    }
    gutterDiv.appendChild(lineNumSpan);

    // Prefix column (+/-/space)
    let prefix = '';
    if (type === 'addition') {
        prefix = '+';
        lineDiv.classList.add('line-added');
    } else if (type === 'deletion') {
        prefix = '-';
        lineDiv.classList.add('line-deleted');
    } else if (type === 'context') {
        prefix = ' ';
    }

    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'line-prefix';
    prefixSpan.textContent = prefix;
    gutterDiv.appendChild(prefixSpan);

    // Comment indicator (positioned absolutely via CSS)
    if (comments.length > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'comment-indicator';
        indicator.textContent = `💬${comments.length > 1 ? comments.length : ''}`;
        indicator.title = `${comments.length} comment${comments.length > 1 ? 's' : ''}`;
        gutterDiv.appendChild(indicator);
    }

    lineDiv.appendChild(gutterDiv);

    // Line content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'line-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'line-text hljs';
    // Use pre-highlighted content if available, otherwise escape plain text
    // For empty lines, use an empty string (CSS min-height handles visibility)
    // Don't use &nbsp; as it becomes a real space when extracted via textContent
    const htmlContent = highlightedContent !== undefined ? highlightedContent : escapeHtml(content);
    textSpan.innerHTML = htmlContent || '';
    if (!htmlContent) {
        // Add a class for empty lines so CSS can handle min-height
        textSpan.classList.add('empty-line');
    }
    contentDiv.appendChild(textSpan);

    lineDiv.appendChild(contentDiv);

    // Apply highlight for comments
    if (comments.length > 0) {
        const state = getState();
        const hasOpenComment = comments.some(c => c.status === 'open');
        const color = hasOpenComment
            ? state.settings.highlightColor
            : state.settings.resolvedHighlightColor;
        contentDiv.style.backgroundColor = color;
    }

    return lineDiv;
}

/**
 * Create an empty line element (for alignment)
 */
function createEmptyLineElement(): HTMLElement {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'diff-line diff-line-empty';

    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'line-gutter';
    // Add empty line number span for consistent structure
    const lineNumSpan = document.createElement('span');
    lineNumSpan.className = 'line-number';
    gutterDiv.appendChild(lineNumSpan);
    lineDiv.appendChild(gutterDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'line-content';
    contentDiv.innerHTML = '&nbsp;';
    lineDiv.appendChild(contentDiv);

    return lineDiv;
}

/**
 * Create a hunk separator header element showing the @@ range text.
 */
function createHunkHeaderElement(hunk: Hunk, viewMode: 'split' | 'inline'): HTMLElement {
    const container = document.createElement('div');
    container.className = `hunk-separator hunk-separator-${viewMode}`;

    const headerText = document.createElement('div');
    headerText.className = 'hunk-header-text';
    headerText.textContent = hunk.headerText;
    headerText.title = hunk.headerText;

    container.appendChild(headerText);
    return container;
}

/**
 * Create a collapsed section placeholder showing "Show N hidden lines".
 */
function createCollapsedSectionElement(collapsedCount: number, hunkIndex: number): HTMLElement {
    const container = document.createElement('div');
    container.className = 'collapsed-section';
    container.dataset.hunkIndex = String(hunkIndex);

    const textSpan = document.createElement('span');
    textSpan.className = 'collapsed-section-text';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.type = 'button';
    expandBtn.title = 'Show hidden lines';
    expandBtn.textContent = '⊞';

    textSpan.appendChild(expandBtn);
    textSpan.appendChild(document.createTextNode(` Show ${collapsedCount} hidden lines`));

    container.appendChild(textSpan);
    return container;
}

/**
 * Normalize a line for comparison when ignoring whitespace
 * Removes leading/trailing whitespace and collapses internal whitespace
 */
function normalizeLineForComparison(line: string): string {
    return line.trim().replace(/\s+/g, ' ');
}

/**
 * Check if two lines are equal, optionally ignoring whitespace
 */
function linesEqual(line1: string, line2: string, ignoreWhitespace: boolean): boolean {
    if (ignoreWhitespace) {
        return normalizeLineForComparison(line1) === normalizeLineForComparison(line2);
    }
    return line1 === line2;
}

/**
 * Check if the only difference between two lines is whitespace
 */
function isWhitespaceOnlyChange(oldLine: string, newLine: string): boolean {
    return normalizeLineForComparison(oldLine) === normalizeLineForComparison(newLine) &&
           oldLine !== newLine;
}

/**
 * Compute LCS (Longest Common Subsequence) for diff alignment
 */
function computeLCS(oldLines: string[], newLines: string[], ignoreWhitespace: boolean = false): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (linesEqual(oldLines[i - 1], newLines[j - 1], ignoreWhitespace)) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp;
}

/**
 * Backtrack LCS to get aligned diff
 */
interface AlignedLine {
    oldLine: string | null;
    newLine: string | null;
    oldLineNum: number | null;
    newLineNum: number | null;
    type: 'context' | 'deletion' | 'addition' | 'modified';
}

function backtrackLCS(
    oldLines: string[],
    newLines: string[],
    dp: number[][],
    ignoreWhitespace: boolean = false
): AlignedLine[] {
    const result: AlignedLine[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && linesEqual(oldLines[i - 1], newLines[j - 1], ignoreWhitespace)) {
            // Context line (unchanged or whitespace-only change when ignoring whitespace)
            result.unshift({
                oldLine: oldLines[i - 1],
                newLine: newLines[j - 1],
                oldLineNum: i,
                newLineNum: j,
                type: 'context'
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            // Addition
            result.unshift({
                oldLine: null,
                newLine: newLines[j - 1],
                oldLineNum: null,
                newLineNum: j,
                type: 'addition'
            });
            j--;
        } else if (i > 0) {
            // Deletion
            result.unshift({
                oldLine: oldLines[i - 1],
                newLine: null,
                oldLineNum: i,
                newLineNum: null,
                type: 'deletion'
            });
            i--;
        }
    }

    return result;
}

/**
 * A discrete hunk of diff lines with context boundaries.
 */
export interface Hunk {
    /** Unified diff header, e.g. "@@ -10,7 +12,9 @@" */
    headerText: string;
    /** The AlignedLine entries belonging to this hunk (context + changes) */
    lines: AlignedLine[];
    /** First old-side line number in this hunk (from first line with oldLineNum) */
    startOldLine: number;
    /** First new-side line number in this hunk (from first line with newLineNum) */
    startNewLine: number;
    /** Last old-side line number in this hunk */
    endOldLine: number;
    /** Last new-side line number in this hunk */
    endNewLine: number;
    /**
     * Number of aligned lines collapsed (not shown) between the previous hunk
     * and this one. 0 for the first hunk if it starts at the top of the file.
     */
    precedingCollapsedCount: number;
}

/**
 * Generate a unified diff hunk header string.
 */
export function generateHunkHeader(
    startOld: number,
    countOld: number,
    startNew: number,
    countNew: number
): string {
    return `@@ -${startOld},${countOld} +${startNew},${countNew} @@`;
}

/**
 * Partition an AlignedLine[] into discrete hunks with configurable context boundaries.
 * Returns [] if input is empty or contains no changes (all context).
 */
export function groupIntoHunks(aligned: AlignedLine[], contextLines: number = 3): Hunk[] {
    if (aligned.length === 0) {
        return [];
    }

    // Step 1: find indices of all non-context ("changed") lines
    const changedIndices: number[] = [];
    for (let i = 0; i < aligned.length; i++) {
        if (aligned[i].type !== 'context') {
            changedIndices.push(i);
        }
    }

    // No changes at all → return empty (entire file is context)
    if (changedIndices.length === 0) {
        return [];
    }

    // Step 2: build raw ranges — each changed index expanded by contextLines
    const ranges: [number, number][] = [];
    for (const idx of changedIndices) {
        const start = Math.max(0, idx - contextLines);
        const end = Math.min(aligned.length - 1, idx + contextLines);
        ranges.push([start, end]);
    }

    // Step 3: merge overlapping/adjacent ranges
    const merged: [number, number][] = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const prev = merged[merged.length - 1];
        const cur = ranges[i];
        if (cur[0] <= prev[1] + 1) {
            prev[1] = Math.max(prev[1], cur[1]);
        } else {
            merged.push(cur);
        }
    }

    // Step 4: convert merged ranges into Hunk objects
    const hunks: Hunk[] = [];
    let prevEnd = -1;

    for (const [start, end] of merged) {
        const lines = aligned.slice(start, end + 1);

        // Compute line-number bounds from the slice
        let startOldLine = 1;
        let startNewLine = 1;
        let endOldLine = 1;
        let endNewLine = 1;

        // First non-null oldLineNum / newLineNum
        for (const l of lines) {
            if (l.oldLineNum !== null) { startOldLine = l.oldLineNum; break; }
        }
        for (const l of lines) {
            if (l.newLineNum !== null) { startNewLine = l.newLineNum; break; }
        }
        // Last non-null oldLineNum / newLineNum
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].oldLineNum !== null) { endOldLine = lines[i].oldLineNum!; break; }
        }
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].newLineNum !== null) { endNewLine = lines[i].newLineNum!; break; }
        }

        // Count lines where oldLineNum/newLineNum is non-null
        const countOld = lines.filter(l => l.oldLineNum !== null).length;
        const countNew = lines.filter(l => l.newLineNum !== null).length;

        const headerText = generateHunkHeader(startOldLine, countOld, startNewLine, countNew);
        const precedingCollapsedCount = start - (prevEnd + 1);

        hunks.push({
            headerText,
            lines,
            startOldLine,
            startNewLine,
            endOldLine,
            endNewLine,
            precedingCollapsedCount
        });

        prevEnd = end;
    }

    return hunks;
}

/**
 * Render the diff view (dispatches to split or inline based on view mode)
 */
export function renderDiff(): void {
    const viewMode = getViewMode();
    if (viewMode === 'inline') {
        renderInlineDiff();
    } else {
        renderSplitDiff();
    }
}

/**
 * Render the split (side-by-side) diff view
 */
export function renderSplitDiff(): void {
    const state = getState();
    const ignoreWhitespace = getIgnoreWhitespace();
    const oldContainer = document.getElementById('old-content');
    const newContainer = document.getElementById('new-content');

    if (!oldContainer || !newContainer) {
        console.error('Diff containers not found');
        return;
    }

    // Clear existing content
    oldContainer.innerHTML = '';
    newContainer.innerHTML = '';

    // Reset aligned diff info for indicator bar
    alignedDiffInfo = [];
    lineToIndexMap = new Map();

    // Parse lines
    const oldLines = parseLines(state.oldContent);
    const newLines = parseLines(state.newContent);

    // Get highlighted lines
    const { oldHighlighted, newHighlighted } = getHighlightedLines();

    // Compute LCS for alignment (with optional whitespace ignoring)
    const dp = computeLCS(oldLines, newLines, ignoreWhitespace);
    const aligned = backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);

    // ── PHASE 1: Populate data structures for ALL aligned lines ──
    let lineIndex = 0;
    for (const line of aligned) {
        const oldComments = line.oldLineNum ? getCommentsForLine('old', line.oldLineNum) : [];
        const newComments = line.newLineNum ? getCommentsForLine('new', line.newLineNum) : [];
        const hasComment = oldComments.length > 0 || newComments.length > 0;

        alignedDiffInfo.push({
            index: lineIndex,
            type: line.type === 'context' ? 'context' : (line.type === 'addition' ? 'addition' : 'deletion'),
            hasComment,
            oldLineNum: line.oldLineNum,
            newLineNum: line.newLineNum
        });

        if (line.oldLineNum !== null) {
            lineToIndexMap.set(`old:${line.oldLineNum}`, lineIndex);
        }
        if (line.newLineNum !== null) {
            lineToIndexMap.set(`new:${line.newLineNum}`, lineIndex);
        }
        lineIndex++;
    }

    // ── PHASE 2: Hunk-based DOM rendering ──
    const hunks = groupIntoHunks(aligned, 3);

    for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
        const hunk = hunks[hunkIdx];

        // Collapsed section BEFORE this hunk
        if (hunk.precedingCollapsedCount > 0) {
            oldContainer.appendChild(createCollapsedSectionElement(hunk.precedingCollapsedCount, hunkIdx - 1));
            newContainer.appendChild(createCollapsedSectionElement(hunk.precedingCollapsedCount, hunkIdx - 1));
        }

        // Hunk header
        oldContainer.appendChild(createHunkHeaderElement(hunk, 'split'));
        newContainer.appendChild(createHunkHeaderElement(hunk, 'split'));

        // Render each line in the hunk
        for (const line of hunk.lines) {
            // Old side
            if (line.oldLine !== null && line.oldLineNum !== null) {
                const comments = getCommentsForLine('old', line.oldLineNum);
                const type: DiffLineType = line.type === 'context' ? 'context' : 'deletion';
                const highlightedContent = oldHighlighted[line.oldLineNum - 1];
                const lineEl = createLineElement(line.oldLineNum, line.oldLine, type, 'old', comments, highlightedContent);
                oldContainer.appendChild(lineEl);
            } else {
                oldContainer.appendChild(createEmptyLineElement());
            }

            // New side
            if (line.newLine !== null && line.newLineNum !== null) {
                const comments = getCommentsForLine('new', line.newLineNum);
                const type: DiffLineType = line.type === 'context' ? 'context' : 'addition';
                const highlightedContent = newHighlighted[line.newLineNum - 1];
                const lineEl = createLineElement(line.newLineNum, line.newLine, type, 'new', comments, highlightedContent);
                newContainer.appendChild(lineEl);
            } else {
                newContainer.appendChild(createEmptyLineElement());
            }
        }
    }

    // Trailing collapsed section after the last hunk
    if (hunks.length > 0) {
        const lastHunk = hunks[hunks.length - 1];
        // Find the index in aligned[] where the last hunk ends
        const lastLine = lastHunk.lines[lastHunk.lines.length - 1];
        let lastHunkEndIdx = aligned.length - 1;
        for (let i = aligned.length - 1; i >= 0; i--) {
            if (aligned[i] === lastLine) {
                lastHunkEndIdx = i;
                break;
            }
        }
        const trailingCount = aligned.length - lastHunkEndIdx - 1;
        if (trailingCount > 0) {
            oldContainer.appendChild(createCollapsedSectionElement(trailingCount, hunks.length - 1));
            newContainer.appendChild(createCollapsedSectionElement(trailingCount, hunks.length - 1));
        }
    }

    // Synchronize scroll between panes
    setupScrollSync(oldContainer, newContainer);

    // Render the indicator bar
    renderIndicatorBar();
}

/**
 * Create an inline line element (unified diff style)
 * @param highlightedContent - Pre-highlighted HTML content (if available)
 */
function createInlineLineElement(
    oldLineNum: number | null,
    newLineNum: number | null,
    content: string,
    type: DiffLineType,
    side: 'old' | 'new' | 'context',
    comments: DiffComment[],
    highlightedContent?: string
): HTMLElement {
    const lineDiv = document.createElement('div');
    lineDiv.className = `inline-diff-line inline-diff-line-${type}`;

    // Store original content for accurate extraction during save
    // This preserves whitespace that might be lost when extracting from DOM
    lineDiv.dataset.originalContent = content;

    // Store data attributes for selection/comments
    if (side === 'old' && oldLineNum !== null) {
        lineDiv.dataset.oldLineNumber = String(oldLineNum);
        lineDiv.dataset.side = 'old';
    } else if (side === 'new' && newLineNum !== null) {
        lineDiv.dataset.newLineNumber = String(newLineNum);
        lineDiv.dataset.side = 'new';
    } else if (side === 'context') {
        if (oldLineNum !== null) lineDiv.dataset.oldLineNumber = String(oldLineNum);
        if (newLineNum !== null) lineDiv.dataset.newLineNumber = String(newLineNum);
        lineDiv.dataset.side = 'context';
    }

    // Line number gutter (shows both old and new line numbers)
    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'inline-line-gutter';

    // Column 1: old line number
    const oldNumSpan = document.createElement('span');
    oldNumSpan.className = 'old-line-num';
    oldNumSpan.textContent = oldLineNum !== null ? String(oldLineNum) : '';
    gutterDiv.appendChild(oldNumSpan);

    // Column 2: new line number
    const newNumSpan = document.createElement('span');
    newNumSpan.className = 'new-line-num';
    newNumSpan.textContent = newLineNum !== null ? String(newLineNum) : '';
    gutterDiv.appendChild(newNumSpan);

    // Column 3: prefix (+/-/space)
    let prefix = '';
    if (type === 'addition') {
        prefix = '+';
    } else if (type === 'deletion') {
        prefix = '-';
    } else if (type === 'context') {
        prefix = ' ';
    }

    const prefixSpan = document.createElement('span');
    prefixSpan.className = 'line-prefix';
    prefixSpan.textContent = prefix;
    gutterDiv.appendChild(prefixSpan);

    // Comment indicator
    if (comments.length > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'comment-indicator';
        indicator.textContent = `💬${comments.length > 1 ? comments.length : ''}`;
        indicator.title = `${comments.length} comment${comments.length > 1 ? 's' : ''}`;
        gutterDiv.appendChild(indicator);
    }

    lineDiv.appendChild(gutterDiv);

    // Line content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'inline-line-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'line-text hljs';
    // Use pre-highlighted content if available, otherwise escape plain text
    // For empty lines, use an empty string (CSS min-height handles visibility)
    // Don't use &nbsp; as it becomes a real space when extracted via textContent
    const inlineHtmlContent = highlightedContent !== undefined ? highlightedContent : escapeHtml(content);
    textSpan.innerHTML = inlineHtmlContent || '';
    if (!inlineHtmlContent) {
        // Add a class for empty lines so CSS can handle min-height
        textSpan.classList.add('empty-line');
    }
    contentDiv.appendChild(textSpan);

    lineDiv.appendChild(contentDiv);

    // Apply highlight for comments
    if (comments.length > 0) {
        const state = getState();
        const hasOpenComment = comments.some(c => c.status === 'open');
        const color = hasOpenComment
            ? state.settings.highlightColor
            : state.settings.resolvedHighlightColor;
        contentDiv.style.backgroundColor = color;
    }

    return lineDiv;
}

/**
 * Render the inline (unified) diff view
 */
export function renderInlineDiff(): void {
    const state = getState();
    const ignoreWhitespace = getIgnoreWhitespace();
    const inlineContainer = document.getElementById('inline-content');

    if (!inlineContainer) {
        console.error('Inline diff container not found');
        return;
    }

    // Clear existing content
    inlineContainer.innerHTML = '';

    // Reset aligned diff info for indicator bar
    alignedDiffInfo = [];
    lineToIndexMap = new Map();

    // Parse lines
    const oldLines = parseLines(state.oldContent);
    const newLines = parseLines(state.newContent);

    // Get highlighted lines
    const { oldHighlighted, newHighlighted } = getHighlightedLines();

    // Compute LCS for alignment (with optional whitespace ignoring)
    const dp = computeLCS(oldLines, newLines, ignoreWhitespace);
    const aligned = backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);

    // Render in unified/inline style
    let lineIndex = 0;
    let prevOldLineNum: number | null = null;
    let prevNewLineNum: number | null = null;
    for (const line of aligned) {
        // Detect line number gaps and insert hunk header
        if (hasLineNumberGap(prevOldLineNum, prevNewLineNum, line.oldLineNum, line.newLineNum)) {
            const hunkText = buildHunkText(prevOldLineNum, prevNewLineNum, line.oldLineNum, line.newLineNum);
            inlineContainer.appendChild(createInlineHunkHeaderElement(hunkText));
        }

        if (line.type === 'context') {
            // Context line - show with both line numbers
            const comments = getCommentsForLine('new', line.newLineNum!);

            // Track diff info for indicator bar
            alignedDiffInfo.push({
                index: lineIndex,
                type: 'context',
                hasComment: comments.length > 0,
                oldLineNum: line.oldLineNum,
                newLineNum: line.newLineNum
            });

            // Build line number to index mapping
            if (line.oldLineNum !== null) {
                lineToIndexMap.set(`old:${line.oldLineNum}`, lineIndex);
            }
            if (line.newLineNum !== null) {
                lineToIndexMap.set(`new:${line.newLineNum}`, lineIndex);
            }

            lineIndex++;

            // For context, use the new version's highlighted content
            const highlightedContent = newHighlighted[line.newLineNum! - 1];
            const lineEl = createInlineLineElement(
                line.oldLineNum,
                line.newLineNum,
                line.newLine || line.oldLine || '',
                'context',
                'context',
                comments,
                highlightedContent
            );
            inlineContainer.appendChild(lineEl);
        } else if (line.type === 'deletion') {
            // Deletion - show old line
            const comments = getCommentsForLine('old', line.oldLineNum!);

            // Track diff info for indicator bar
            alignedDiffInfo.push({
                index: lineIndex,
                type: 'deletion',
                hasComment: comments.length > 0,
                oldLineNum: line.oldLineNum,
                newLineNum: null
            });

            // Build line number to index mapping
            if (line.oldLineNum !== null) {
                lineToIndexMap.set(`old:${line.oldLineNum}`, lineIndex);
            }

            lineIndex++;

            const highlightedContent = oldHighlighted[line.oldLineNum! - 1];
            const lineEl = createInlineLineElement(
                line.oldLineNum,
                null,
                line.oldLine || '',
                'deletion',
                'old',
                comments,
                highlightedContent
            );
            inlineContainer.appendChild(lineEl);
        } else if (line.type === 'addition') {
            // Addition - show new line
            const comments = getCommentsForLine('new', line.newLineNum!);

            // Track diff info for indicator bar
            alignedDiffInfo.push({
                index: lineIndex,
                type: 'addition',
                hasComment: comments.length > 0,
                oldLineNum: null,
                newLineNum: line.newLineNum
            });

            // Build line number to index mapping
            if (line.newLineNum !== null) {
                lineToIndexMap.set(`new:${line.newLineNum}`, lineIndex);
            }

            lineIndex++;

            const highlightedContent = newHighlighted[line.newLineNum! - 1];
            const lineEl = createInlineLineElement(
                null,
                line.newLineNum,
                line.newLine || '',
                'addition',
                'new',
                comments,
                highlightedContent
            );
            inlineContainer.appendChild(lineEl);
        }

        // Track previous line numbers for hunk detection
        if (line.oldLineNum !== null) prevOldLineNum = line.oldLineNum;
        if (line.newLineNum !== null) prevNewLineNum = line.newLineNum;
    }

    // Render the indicator bar
    renderIndicatorBar();
}

// Module-level scroll sync state
let scrollSyncInitialized = false;
let isSyncing = false;

/**
 * Setup synchronized scrolling between panes
 * Uses event delegation on the parent container to survive element replacements
 */
function setupScrollSync(oldContainer: HTMLElement, newContainer: HTMLElement): void {
    // Always set up fresh listeners since containers may have been replaced
    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
        if (isSyncing) return;
        isSyncing = true;
        target.scrollTop = source.scrollTop;
        // Use requestAnimationFrame to ensure smooth syncing
        requestAnimationFrame(() => {
            isSyncing = false;
        });
    };

    oldContainer.addEventListener('scroll', () => syncScroll(oldContainer, newContainer));
    newContainer.addEventListener('scroll', () => syncScroll(newContainer, oldContainer));
}

/**
 * Initialize scroll sync for split view
 * Call this after rendering or after view mode changes
 */
export function initializeScrollSync(): void {
    const oldContainer = document.getElementById('old-content');
    const newContainer = document.getElementById('new-content');

    if (oldContainer && newContainer) {
        setupScrollSync(oldContainer, newContainer);
    }
}

/**
 * Scroll to the first added or deleted line in the current view.
 * Used in full-file view mode to bring the first change into view on open.
 */
export function scrollToFirstChange(): void {
    const viewMode = getViewMode();

    if (viewMode === 'inline') {
        const inlineContainer = document.getElementById('inline-content');
        if (inlineContainer) {
            const firstChange = inlineContainer.querySelector<HTMLElement>(
                '.inline-diff-line-addition, .inline-diff-line-deletion'
            );
            if (firstChange) {
                firstChange.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    } else {
        // Split view — scroll new pane to first addition, fallback to first deletion in old pane
        const newContainer = document.getElementById('new-content');
        const oldContainer = document.getElementById('old-content');

        const firstAddition = newContainer?.querySelector<HTMLElement>('.line-added');
        if (firstAddition) {
            firstAddition.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        const firstDeletion = oldContainer?.querySelector<HTMLElement>('.line-deleted');
        if (firstDeletion) {
            firstDeletion.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

/**
 * Highlight a specific line (for showing comment location)
 * Works for both split and inline views
 */
export function highlightLine(side: 'old' | 'new', lineNumber: number): void {
    const viewMode = getViewMode();
    let lineEl: Element | null = null;

    if (viewMode === 'inline') {
        // Inline view: search by data-old-line-number or data-new-line-number
        const inlineContainer = document.getElementById('inline-content');
        if (inlineContainer) {
            const attr = side === 'old' ? 'data-old-line-number' : 'data-new-line-number';
            lineEl = inlineContainer.querySelector(`[${attr}="${lineNumber}"]`);
        }
    } else {
        // Split view: search in the appropriate pane
        const container = side === 'old'
            ? document.getElementById('old-content')
            : document.getElementById('new-content');

        if (container) {
            lineEl = container.querySelector(`[data-line-number="${lineNumber}"]`);
        }
    }

    if (lineEl) {
        lineEl.classList.add('highlighted');
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove highlight after animation
        setTimeout(() => {
            lineEl?.classList.remove('highlighted');
        }, 2000);
    }
}

/**
 * Re-render comments on existing lines (without full re-render)
 */
export function updateCommentIndicators(): void {
    const state = getState();
    const viewMode = getViewMode();

    if (viewMode === 'inline') {
        // Update inline view
        const inlineContainer = document.getElementById('inline-content');
        if (inlineContainer) {
            const lines = inlineContainer.querySelectorAll('.inline-diff-line');
            lines.forEach(lineEl => {
                const el = lineEl as HTMLElement;
                const side = el.dataset.side;
                let comments: DiffComment[] = [];

                if (side === 'old' && el.dataset.oldLineNumber) {
                    const lineNum = parseInt(el.dataset.oldLineNumber);
                    comments = getCommentsForLine('old', lineNum);
                } else if (side === 'new' && el.dataset.newLineNumber) {
                    const lineNum = parseInt(el.dataset.newLineNumber);
                    comments = getCommentsForLine('new', lineNum);
                } else if (side === 'context' && el.dataset.newLineNumber) {
                    const lineNum = parseInt(el.dataset.newLineNumber);
                    comments = getCommentsForLine('new', lineNum);
                }

                updateInlineLineCommentIndicator(el, comments, state);
            });
        }
    } else {
        // Update old side (split view)
        const oldContainer = document.getElementById('old-content');
        if (oldContainer) {
            const lines = oldContainer.querySelectorAll('.diff-line[data-line-number]');
            lines.forEach(lineEl => {
                const lineNum = parseInt(lineEl.getAttribute('data-line-number') || '0');
                const comments = getCommentsForLine('old', lineNum);
                updateLineCommentIndicator(lineEl as HTMLElement, comments, state);
            });
        }

        // Update new side (split view)
        const newContainer = document.getElementById('new-content');
        if (newContainer) {
            const lines = newContainer.querySelectorAll('.diff-line[data-line-number]');
            lines.forEach(lineEl => {
                const lineNum = parseInt(lineEl.getAttribute('data-line-number') || '0');
                const comments = getCommentsForLine('new', lineNum);
                updateLineCommentIndicator(lineEl as HTMLElement, comments, state);
            });
        }
    }

    // Update indicator bar to reflect comment changes
    updateIndicatorBarComments();
}

/**
 * Update comment indicator on a single line (split view)
 */
function updateLineCommentIndicator(
    lineEl: HTMLElement,
    comments: DiffComment[],
    state: ReturnType<typeof getState>
): void {
    const gutter = lineEl.querySelector('.line-gutter');
    const content = lineEl.querySelector('.line-content') as HTMLElement;

    if (!gutter || !content) return;

    // Remove existing indicator
    const existingIndicator = gutter.querySelector('.comment-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Add new indicator if there are comments
    if (comments.length > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'comment-indicator';
        indicator.textContent = `💬${comments.length > 1 ? comments.length : ''}`;
        indicator.title = `${comments.length} comment${comments.length > 1 ? 's' : ''}`;
        gutter.appendChild(indicator);

        // Update highlight
        const hasOpenComment = comments.some(c => c.status === 'open');
        content.style.backgroundColor = hasOpenComment
            ? state.settings.highlightColor
            : state.settings.resolvedHighlightColor;
    } else {
        // Remove highlight
        content.style.backgroundColor = '';
    }
}

/**
 * Update comment indicator on a single line (inline view)
 */
function updateInlineLineCommentIndicator(
    lineEl: HTMLElement,
    comments: DiffComment[],
    state: ReturnType<typeof getState>
): void {
    const gutter = lineEl.querySelector('.inline-line-gutter');
    const content = lineEl.querySelector('.inline-line-content') as HTMLElement;

    if (!gutter || !content) return;

    // Remove existing indicator
    const existingIndicator = gutter.querySelector('.comment-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Add new indicator if there are comments
    if (comments.length > 0) {
        const indicator = document.createElement('span');
        indicator.className = 'comment-indicator';
        indicator.textContent = `💬${comments.length > 1 ? comments.length : ''}`;
        indicator.title = `${comments.length} comment${comments.length > 1 ? 's' : ''}`;
        gutter.appendChild(indicator);

        // Update highlight
        const hasOpenComment = comments.some(c => c.status === 'open');
        content.style.backgroundColor = hasOpenComment
            ? state.settings.highlightColor
            : state.settings.resolvedHighlightColor;
    } else {
        // Remove highlight
        content.style.backgroundColor = '';
    }
}

/**
 * Render the diff indicator bar (minimap)
 * Shows colored marks for additions, deletions, and comments
 */
export function renderIndicatorBar(): void {
    const indicatorBarInner = document.getElementById('diff-indicator-bar-inner');
    if (!indicatorBarInner) return;

    // Clear existing marks (but keep viewport indicator)
    const existingMarks = indicatorBarInner.querySelectorAll('.diff-indicator-mark');
    existingMarks.forEach(mark => mark.remove());

    const totalLines = alignedDiffInfo.length;
    if (totalLines === 0) return;

    // Get the content container to calculate positions relative to scroll height
    const viewMode = getViewMode();
    let contentContainer: HTMLElement | null = null;

    if (viewMode === 'inline') {
        contentContainer = document.getElementById('inline-content');
    } else {
        contentContainer = document.getElementById('new-content');
    }

    if (!contentContainer) return;

    const barHeight = indicatorBarInner.clientHeight;
    const scrollHeight = contentContainer.scrollHeight;
    const clientHeight = contentContainer.clientHeight;

    // If content doesn't need scrolling, use simple percentage
    const useScrollRatio = scrollHeight > clientHeight;

    const lineElements = contentContainer.querySelectorAll(
        viewMode === 'inline' ? '.inline-diff-line' : '.diff-line'
    );

    // Helper to calculate mark position and height for a range of aligned indices.
    // In split view with hunk-based rendering, collapsed lines have no DOM element so the
    // 1:1 mapping between alignedDiffInfo indices and `.diff-line` elements is broken.
    // Always use percentage-based positioning in split view; use DOM-based positioning
    // only for inline view where every aligned line has a DOM element.
    const useDomPositioning = viewMode === 'inline' && useScrollRatio;

    const calculateMarkPosition = (startIdx: number, endIdx: number): { top: number; height: number } => {
        if (useDomPositioning && lineElements[startIdx]) {
            const startEl = lineElements[startIdx] as HTMLElement;
            const endEl = lineElements[endIdx] as HTMLElement;
            const lineTop = startEl.offsetTop;
            const endBottom = endEl.offsetTop + endEl.offsetHeight;
            const totalHeight = endBottom - lineTop;

            return {
                top: (lineTop / scrollHeight) * barHeight,
                height: Math.max((totalHeight / scrollHeight) * barHeight, 2)
            };
        } else {
            // Percentage-based calculation — treats the bar as a minimap of the full logical file
            return {
                top: (startIdx / totalLines) * barHeight,
                height: Math.max(((endIdx - startIdx + 1) / totalLines) * barHeight, 2)
            };
        }
    };

    // STEP 1: Render diff change marks (additions/deletions only, no comment styling)
    let i = 0;
    while (i < alignedDiffInfo.length) {
        const lineInfo = alignedDiffInfo[i];

        // Skip context lines for diff marks
        if (lineInfo.type === 'context') {
            i++;
            continue;
        }

        // Find consecutive lines of the same change type and track what types are present
        let endIndex = i;
        let hasAddition = lineInfo.type === 'addition';
        let hasDeletion = lineInfo.type === 'deletion';
        
        while (endIndex < alignedDiffInfo.length - 1) {
            const nextInfo = alignedDiffInfo[endIndex + 1];
            // Group additions and deletions together as "modified"
            const currentIsChange = lineInfo.type === 'addition' || lineInfo.type === 'deletion';
            const nextIsChange = nextInfo.type === 'addition' || nextInfo.type === 'deletion';

            if (currentIsChange && nextIsChange) {
                endIndex++;
                // Track what types are present in this group
                if (nextInfo.type === 'addition') hasAddition = true;
                if (nextInfo.type === 'deletion') hasDeletion = true;
            } else {
                break;
            }
        }

        const { top, height } = calculateMarkPosition(i, endIndex);

        // Create the mark element for diff changes
        const mark = document.createElement('div');
        mark.className = 'diff-indicator-mark';

        // Determine the mark type:
        // - If the group has both additions and deletions, it's a modification (blue)
        // - If only additions, show green
        // - If only deletions, show red
        if (hasAddition && hasDeletion) {
            mark.classList.add('modified');
        } else if (hasAddition) {
            mark.classList.add('addition');
        } else if (hasDeletion) {
            mark.classList.add('deletion');
        }

        mark.style.top = `${top}px`;
        mark.style.height = `${height}px`;
        mark.dataset.lineIndex = String(i);

        // Click to scroll to that position
        const clickIndex = i;
        mark.addEventListener('click', () => {
            scrollToLineIndex(clickIndex);
        });

        indicatorBarInner.appendChild(mark);

        i = endIndex + 1;
    }

    // STEP 2: Render comment marks based on actual selection ranges
    const state = getState();
    const visibleComments = state.settings.showResolved
        ? state.comments
        : state.comments.filter(c => c.status !== 'resolved');

    // Track which comments we've rendered to avoid duplicates
    const renderedComments = new Set<string>();

    for (const comment of visibleComments) {
        if (renderedComments.has(comment.id)) continue;
        renderedComments.add(comment.id);

        const selection = comment.selection;
        let startIdx: number | undefined;
        let endIdx: number | undefined;

        // Find the aligned indices for this comment's selection range
        if (selection.side === 'old' && selection.oldStartLine !== null && selection.oldEndLine !== null) {
            startIdx = lineToIndexMap.get(`old:${selection.oldStartLine}`);
            endIdx = lineToIndexMap.get(`old:${selection.oldEndLine}`);
        } else if (selection.side === 'new' && selection.newStartLine !== null && selection.newEndLine !== null) {
            startIdx = lineToIndexMap.get(`new:${selection.newStartLine}`);
            endIdx = lineToIndexMap.get(`new:${selection.newEndLine}`);
        }

        // Skip if we couldn't find the line indices
        if (startIdx === undefined || endIdx === undefined) continue;

        // Ensure startIdx <= endIdx
        if (startIdx > endIdx) {
            [startIdx, endIdx] = [endIdx, startIdx];
        }

        const { top, height } = calculateMarkPosition(startIdx, endIdx);

        // Create the comment mark element
        const mark = document.createElement('div');
        mark.className = 'diff-indicator-mark comment';
        mark.style.top = `${top}px`;
        mark.style.height = `${height}px`;
        mark.dataset.commentId = comment.id;
        mark.dataset.lineIndex = String(startIdx);

        // Click to scroll to the comment location
        const clickIdx = startIdx;
        mark.addEventListener('click', () => {
            scrollToLineIndex(clickIdx);
        });

        indicatorBarInner.appendChild(mark);
    }

    // Setup viewport indicator tracking
    setupViewportTracking();
}

/**
 * Scroll to a specific line index in the diff view.
 * In split view with hunk-based rendering, the target line may be inside a
 * collapsed section (no DOM element). Fall back to finding the nearest visible
 * `.diff-line` with a matching `data-line-number`.
 */
function scrollToLineIndex(index: number): void {
    const viewMode = getViewMode();
    let container: HTMLElement | null = null;
    let lineElements: NodeListOf<Element> | null = null;

    if (viewMode === 'inline') {
        container = document.getElementById('inline-content');
        lineElements = container?.querySelectorAll('.inline-diff-line') || null;

        if (container && lineElements && lineElements[index]) {
            lineElements[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
    } else {
        // Split view — line elements may not correspond 1:1 with aligned indices
        container = document.getElementById('new-content');

        if (container) {
            // Try to find by data-line-number attribute matching the target index's line number
            const info = alignedDiffInfo[index];
            if (info) {
                const lineNum = info.newLineNum ?? info.oldLineNum;
                if (lineNum !== null) {
                    const targetEl = container.querySelector<HTMLElement>(`[data-line-number="${lineNum}"]`);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return;
                    }
                }
            }

            // Fallback: try index-based lookup (works when all lines are visible)
            lineElements = container.querySelectorAll('.diff-line');
            if (lineElements && lineElements[index]) {
                lineElements[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

/**
 * Setup viewport indicator tracking
 */
let viewportTrackingInitialized = false;

function setupViewportTracking(): void {
    const viewMode = getViewMode();
    let container: HTMLElement | null = null;

    if (viewMode === 'inline') {
        container = document.getElementById('inline-content');
    } else {
        // For split view, use the new-content pane as reference
        container = document.getElementById('new-content');
    }

    if (!container) return;

    // Update viewport indicator on scroll
    const updateViewport = () => {
        const indicatorBarInner = document.getElementById('diff-indicator-bar-inner');
        const viewportIndicator = document.getElementById('diff-indicator-viewport');
        if (!indicatorBarInner || !viewportIndicator || !container) return;

        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const barHeight = indicatorBarInner.clientHeight;

        if (scrollHeight <= clientHeight) {
            // Content fits without scrolling
            viewportIndicator.style.display = 'none';
            return;
        }

        viewportIndicator.style.display = 'block';

        // Calculate viewport position and size
        const viewportTop = (scrollTop / scrollHeight) * barHeight;
        const viewportHeight = (clientHeight / scrollHeight) * barHeight;

        viewportIndicator.style.top = `${viewportTop}px`;
        viewportIndicator.style.height = `${Math.max(viewportHeight, 20)}px`;
    };

    // Remove old listener if exists
    container.removeEventListener('scroll', updateViewport);
    container.addEventListener('scroll', updateViewport);

    // Initial update
    updateViewport();
}

/**
 * Update indicator bar when comments change
 */
export function updateIndicatorBarComments(): void {
    // Update hasComment flag in alignedDiffInfo based on actual line numbers
    alignedDiffInfo.forEach((info) => {
        // Check if this line has comments using actual line numbers
        const oldComments = info.oldLineNum !== null ? getCommentsForLine('old', info.oldLineNum) : [];
        const newComments = info.newLineNum !== null ? getCommentsForLine('new', info.newLineNum) : [];
        info.hasComment = oldComments.length > 0 || newComments.length > 0;
    });

    // Re-render the indicator bar (which now handles comments based on selection ranges)
    renderIndicatorBar();
}


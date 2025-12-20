/**
 * Diff renderer - renders side-by-side diff view and inline view
 */

import { DiffComment, DiffLine, DiffLineType } from './types';
import { getCommentsForLine, getState, getViewMode, ViewMode } from './state';
import { getLanguageFromFilePath, highlightCode, splitHighlightedHtmlIntoLines } from './highlighted-html-lines';

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
 */
interface HighlightedLinesCache {
    oldLines: string[];
    newLines: string[];
    language: string;
}

let highlightedCache: HighlightedLinesCache | null = null;

/**
 * Get highlighted lines for old and new content
 * Uses caching to avoid re-highlighting on every render
 */
function getHighlightedLines(): { oldHighlighted: string[]; newHighlighted: string[] } {
    const state = getState();
    const language = getLanguageFromFilePath(state.filePath);

    // Check if we can use cached result
    if (highlightedCache && highlightedCache.language === language) {
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

    // Cache the result
    highlightedCache = {
        oldLines: oldHighlighted,
        newLines: newHighlighted,
        language
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

    // Line number gutter
    const gutterDiv = document.createElement('div');
    gutterDiv.className = 'line-gutter';

    if (lineNumber !== null) {
        gutterDiv.textContent = String(lineNumber);
    }

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
    contentDiv.className = 'line-content';

    // Add prefix for diff type
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
    contentDiv.appendChild(prefixSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'line-text hljs';
    // Use pre-highlighted content if available, otherwise escape plain text
    textSpan.innerHTML = (highlightedContent !== undefined ? highlightedContent : escapeHtml(content)) || '&nbsp;';
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
    lineDiv.appendChild(gutterDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'line-content';
    contentDiv.innerHTML = '&nbsp;';
    lineDiv.appendChild(contentDiv);

    return lineDiv;
}

/**
 * Compute LCS (Longest Common Subsequence) for diff alignment
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
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
    dp: number[][]
): AlignedLine[] {
    const result: AlignedLine[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            // Context line (unchanged)
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
    const oldContainer = document.getElementById('old-content');
    const newContainer = document.getElementById('new-content');

    if (!oldContainer || !newContainer) {
        console.error('Diff containers not found');
        return;
    }

    // Clear existing content
    oldContainer.innerHTML = '';
    newContainer.innerHTML = '';

    // Parse lines
    const oldLines = parseLines(state.oldContent);
    const newLines = parseLines(state.newContent);

    // Get highlighted lines
    const { oldHighlighted, newHighlighted } = getHighlightedLines();

    // Compute LCS for alignment
    const dp = computeLCS(oldLines, newLines);
    const aligned = backtrackLCS(oldLines, newLines, dp);

    // Render aligned lines
    for (const line of aligned) {
        // Old side
        if (line.oldLine !== null && line.oldLineNum !== null) {
            const comments = getCommentsForLine('old', line.oldLineNum);
            const type: DiffLineType = line.type === 'context' ? 'context' : 'deletion';
            // Get highlighted content for this line (0-indexed)
            const highlightedContent = oldHighlighted[line.oldLineNum - 1];
            const lineEl = createLineElement(
                line.oldLineNum,
                line.oldLine,
                type,
                'old',
                comments,
                highlightedContent
            );
            oldContainer.appendChild(lineEl);
        } else {
            // Empty line for alignment
            oldContainer.appendChild(createEmptyLineElement());
        }

        // New side
        if (line.newLine !== null && line.newLineNum !== null) {
            const comments = getCommentsForLine('new', line.newLineNum);
            const type: DiffLineType = line.type === 'context' ? 'context' : 'addition';
            // Get highlighted content for this line (0-indexed)
            const highlightedContent = newHighlighted[line.newLineNum - 1];
            const lineEl = createLineElement(
                line.newLineNum,
                line.newLine,
                type,
                'new',
                comments,
                highlightedContent
            );
            newContainer.appendChild(lineEl);
        } else {
            // Empty line for alignment
            newContainer.appendChild(createEmptyLineElement());
        }
    }

    // Synchronize scroll between panes
    setupScrollSync(oldContainer, newContainer);
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

    const oldNumSpan = document.createElement('span');
    oldNumSpan.className = 'old-line-num';
    oldNumSpan.textContent = oldLineNum !== null ? String(oldLineNum) : '';
    gutterDiv.appendChild(oldNumSpan);

    const newNumSpan = document.createElement('span');
    newNumSpan.className = 'new-line-num';
    newNumSpan.textContent = newLineNum !== null ? String(newLineNum) : '';
    gutterDiv.appendChild(newNumSpan);

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

    // Add prefix for diff type
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
    contentDiv.appendChild(prefixSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'line-text hljs';
    // Use pre-highlighted content if available, otherwise escape plain text
    textSpan.innerHTML = (highlightedContent !== undefined ? highlightedContent : escapeHtml(content)) || '&nbsp;';
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
    const inlineContainer = document.getElementById('inline-content');

    if (!inlineContainer) {
        console.error('Inline diff container not found');
        return;
    }

    // Clear existing content
    inlineContainer.innerHTML = '';

    // Parse lines
    const oldLines = parseLines(state.oldContent);
    const newLines = parseLines(state.newContent);

    // Get highlighted lines
    const { oldHighlighted, newHighlighted } = getHighlightedLines();

    // Compute LCS for alignment
    const dp = computeLCS(oldLines, newLines);
    const aligned = backtrackLCS(oldLines, newLines, dp);

    // Render in unified/inline style
    for (const line of aligned) {
        if (line.type === 'context') {
            // Context line - show with both line numbers
            const comments = getCommentsForLine('new', line.newLineNum!);
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
    }
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


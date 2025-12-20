/**
 * Diff renderer - renders side-by-side diff view
 */

import { DiffComment, DiffLine, DiffLineType } from './types';
import { getCommentsForLine, getState } from './state';

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
 * Create a line element
 */
function createLineElement(
    lineNumber: number | null,
    content: string,
    type: DiffLineType,
    side: 'old' | 'new',
    comments: DiffComment[]
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
    textSpan.className = 'line-text';
    textSpan.innerHTML = escapeHtml(content) || '&nbsp;';
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
 * Render the diff view
 */
export function renderDiff(): void {
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

    // Compute LCS for alignment
    const dp = computeLCS(oldLines, newLines);
    const aligned = backtrackLCS(oldLines, newLines, dp);

    // Render aligned lines
    for (const line of aligned) {
        // Old side
        if (line.oldLine !== null && line.oldLineNum !== null) {
            const comments = getCommentsForLine('old', line.oldLineNum);
            const type: DiffLineType = line.type === 'context' ? 'context' : 'deletion';
            const lineEl = createLineElement(
                line.oldLineNum,
                line.oldLine,
                type,
                'old',
                comments
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
            const lineEl = createLineElement(
                line.newLineNum,
                line.newLine,
                type,
                'new',
                comments
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
 * Setup synchronized scrolling between panes
 */
function setupScrollSync(oldContainer: HTMLElement, newContainer: HTMLElement): void {
    let isSyncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
        if (isSyncing) return;
        isSyncing = true;
        target.scrollTop = source.scrollTop;
        isSyncing = false;
    };

    oldContainer.addEventListener('scroll', () => syncScroll(oldContainer, newContainer));
    newContainer.addEventListener('scroll', () => syncScroll(newContainer, oldContainer));
}

/**
 * Highlight a specific line (for showing comment location)
 */
export function highlightLine(side: 'old' | 'new', lineNumber: number): void {
    const container = side === 'old' 
        ? document.getElementById('old-content')
        : document.getElementById('new-content');
    
    if (!container) return;

    const lineEl = container.querySelector(`[data-line-number="${lineNumber}"]`);
    if (lineEl) {
        lineEl.classList.add('highlighted');
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Remove highlight after animation
        setTimeout(() => {
            lineEl.classList.remove('highlighted');
        }, 2000);
    }
}

/**
 * Re-render comments on existing lines (without full re-render)
 */
export function updateCommentIndicators(): void {
    const state = getState();
    
    // Update old side
    const oldContainer = document.getElementById('old-content');
    if (oldContainer) {
        const lines = oldContainer.querySelectorAll('.diff-line[data-line-number]');
        lines.forEach(lineEl => {
            const lineNum = parseInt(lineEl.getAttribute('data-line-number') || '0');
            const comments = getCommentsForLine('old', lineNum);
            updateLineCommentIndicator(lineEl as HTMLElement, comments, state);
        });
    }

    // Update new side
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

/**
 * Update comment indicator on a single line
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


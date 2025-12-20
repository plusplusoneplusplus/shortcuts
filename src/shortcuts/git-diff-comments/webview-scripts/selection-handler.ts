/**
 * Selection handler for diff view
 * Tracks text selection across diff cells
 */

import { DiffSelection, DiffSide, SelectionState } from './types';
import { getState, setCurrentSelection } from './state';

/**
 * Get the current text selection in the diff view
 */
export function getCurrentSelection(): SelectionState | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        return null;
    }

    const range = selection.getRangeAt(0);
    if (!range) {
        return null;
    }

    // Find the containing diff line elements
    const startContainer = findDiffLineElement(range.startContainer);
    const endContainer = findDiffLineElement(range.endContainer);

    if (!startContainer || !endContainer) {
        return null;
    }

    // Check if this is inline view or split view
    const isInlineView = startContainer.classList.contains('inline-diff-line');

    // Get line numbers and side
    let startLineNum: number;
    let endLineNum: number;
    let side: DiffSide;

    if (isInlineView) {
        // Inline view: get line number based on side
        const startSide = startContainer.dataset.side;
        const endSide = endContainer.dataset.side;
        
        // Determine which side to use (prefer the side with line numbers)
        if (startSide === 'old' && startContainer.dataset.oldLineNumber) {
            startLineNum = parseInt(startContainer.dataset.oldLineNumber);
            side = 'old';
        } else if (startSide === 'new' && startContainer.dataset.newLineNumber) {
            startLineNum = parseInt(startContainer.dataset.newLineNumber);
            side = 'new';
        } else if (startSide === 'context') {
            // For context lines, prefer new line number
            startLineNum = parseInt(startContainer.dataset.newLineNumber || startContainer.dataset.oldLineNumber || '0');
            side = 'new';
        } else {
            return null;
        }
        
        // Get end line number
        if (endSide === 'old' && endContainer.dataset.oldLineNumber) {
            endLineNum = parseInt(endContainer.dataset.oldLineNumber);
        } else if (endSide === 'new' && endContainer.dataset.newLineNumber) {
            endLineNum = parseInt(endContainer.dataset.newLineNumber);
        } else if (endSide === 'context') {
            endLineNum = parseInt(endContainer.dataset.newLineNumber || endContainer.dataset.oldLineNumber || '0');
        } else {
            endLineNum = startLineNum;
        }
    } else {
        // Split view: use data-line-number and data-side
        startLineNum = parseInt(startContainer.dataset.lineNumber || '0');
        endLineNum = parseInt(endContainer.dataset.lineNumber || '0');
        side = startContainer.dataset.side as DiffSide;
    }

    if (!side || startLineNum === 0 || endLineNum === 0) {
        return null;
    }

    // Get selected text
    const selectedText = selection.toString();
    if (!selectedText.trim()) {
        return null;
    }

    // Calculate column positions
    const startColumn = getColumnOffset(range.startContainer, range.startOffset, startContainer);
    const endColumn = getColumnOffset(range.endContainer, range.endOffset, endContainer);

    return {
        side,
        startLine: Math.min(startLineNum, endLineNum),
        endLine: Math.max(startLineNum, endLineNum),
        startColumn,
        endColumn,
        selectedText
    };
}

/**
 * Find the parent diff line element (works for both split and inline views)
 */
function findDiffLineElement(node: Node): HTMLElement | null {
    let current: Node | null = node;
    
    while (current) {
        if (current instanceof HTMLElement) {
            // Check for split view line
            if (current.classList.contains('diff-line') && current.dataset.lineNumber) {
                return current;
            }
            // Check for inline view line
            if (current.classList.contains('inline-diff-line')) {
                return current;
            }
        }
        current = current.parentNode;
    }
    
    return null;
}

/**
 * Calculate column offset within a line (works for both split and inline views)
 */
function getColumnOffset(node: Node, offset: number, lineElement: HTMLElement): number {
    // Try to find line-text in either split or inline content
    const textContent = lineElement.querySelector('.line-text');
    if (!textContent) {
        return 1;
    }

    // If the node is within the text content, calculate offset
    if (textContent.contains(node)) {
        // Walk through text nodes to find the offset
        let totalOffset = 0;
        const walker = document.createTreeWalker(
            textContent,
            NodeFilter.SHOW_TEXT,
            null
        );

        let currentNode = walker.nextNode();
        while (currentNode) {
            if (currentNode === node) {
                return totalOffset + offset + 1; // 1-based
            }
            totalOffset += currentNode.textContent?.length || 0;
            currentNode = walker.nextNode();
        }
    }

    return 1;
}

/**
 * Convert SelectionState to DiffSelection
 */
export function toDiffSelection(state: SelectionState): DiffSelection {
    if (state.side === 'old') {
        return {
            side: 'old',
            oldStartLine: state.startLine,
            oldEndLine: state.endLine,
            newStartLine: null,
            newEndLine: null,
            startColumn: state.startColumn,
            endColumn: state.endColumn
        };
    } else {
        return {
            side: 'new',
            oldStartLine: null,
            oldEndLine: null,
            newStartLine: state.startLine,
            newEndLine: state.endLine,
            startColumn: state.startColumn,
            endColumn: state.endColumn
        };
    }
}

/**
 * Setup selection change listener
 */
export function setupSelectionListener(onSelectionChange: (selection: SelectionState | null) => void): void {
    document.addEventListener('selectionchange', () => {
        const selection = getCurrentSelection();
        setCurrentSelection(selection);
        onSelectionChange(selection);
    });
}

/**
 * Clear current selection
 */
export function clearSelection(): void {
    const selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
    }
    setCurrentSelection(null);
}

/**
 * Check if there's a valid selection
 */
export function hasValidSelection(): boolean {
    const selection = getCurrentSelection();
    return selection !== null && selection.selectedText.trim().length > 0;
}


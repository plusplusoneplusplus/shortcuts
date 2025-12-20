/**
 * Selection Utilities for Webviews
 * 
 * Common utilities for handling text selection in webview editors.
 */

/**
 * Base selection interface
 */
export interface BaseSelection {
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
}

/**
 * Get text content before a specific offset within a container
 * Used for calculating column positions in selections
 */
export function getTextBeforeOffset(
    container: HTMLElement,
    targetNode: Node,
    offset: number,
    skipClasses: string[] = ['inline-comment-bubble']
): string {
    let text = '';
    let found = false;

    function traverse(node: Node): void {
        if (found) return;

        if (node === targetNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += (node.textContent || '').substring(0, offset);
            }
            found = true;
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            // Skip specified non-content elements
            const shouldSkip = skipClasses.some(cls => el.classList?.contains(cls));
            if (!shouldSkip) {
                for (const child of node.childNodes) {
                    traverse(child);
                    if (found) break;
                }
            }
        }
    }

    traverse(container);
    return text;
}

/**
 * Find a parent element matching a condition
 */
export function findParentElement(
    node: Node,
    container: HTMLElement,
    predicate: (el: HTMLElement) => boolean
): HTMLElement | null {
    let current = node as Node | null;
    while (current && current !== container) {
        const el = current as HTMLElement;
        if (el.classList && predicate(el)) {
            return el;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Check if a selection is collapsed (no text selected)
 */
export function isSelectionCollapsed(): boolean {
    const selection = window.getSelection();
    return !selection || selection.isCollapsed;
}

/**
 * Get the current selection's text content
 */
export function getSelectedText(): string {
    const selection = window.getSelection();
    if (!selection) return '';
    return selection.toString();
}

/**
 * Clear the current selection
 */
export function clearSelection(): void {
    const selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
    }
}

/**
 * Check if there's a valid non-empty selection
 */
export function hasValidSelection(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        return false;
    }
    return selection.toString().trim().length > 0;
}

/**
 * Get the bounding rect of the current selection
 */
export function getSelectionRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }
    return selection.getRangeAt(0).getBoundingClientRect();
}

/**
 * Calculate column offset using tree walker
 * More efficient for large DOM trees
 */
export function calculateColumnOffset(
    node: Node,
    offset: number,
    textContentElement: HTMLElement
): number {
    if (!textContentElement.contains(node)) {
        return 1;
    }

    // Walk through text nodes to find the offset
    let totalOffset = 0;
    const walker = document.createTreeWalker(
        textContentElement,
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

    return 1;
}


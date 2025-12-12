/**
 * Selection handling for determining line/column positions in the editor
 */

import { CommentSelection } from '../types';

/**
 * Get selection position (line and column) from a Range
 */
export function getSelectionPosition(range: Range): CommentSelection | null {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    const editorWrapper = document.getElementById('editorWrapper')!;
    
    // Try to find regular line elements first
    let startLine = findLineElement(startContainer, editorWrapper);
    let endLine = findLineElement(endContainer, editorWrapper);
    
    let startLineNum: number | undefined;
    let endLineNum: number | undefined;
    let startColumn = range.startOffset + 1;
    let endColumn = range.endOffset + 1;
    
    // Check if selection is in a table
    const startCell = startContainer.nodeType === Node.TEXT_NODE 
        ? (startContainer.parentElement as HTMLElement)?.closest('td, th')
        : (startContainer as HTMLElement).closest?.('td, th');
    const endCell = endContainer.nodeType === Node.TEXT_NODE 
        ? (endContainer.parentElement as HTMLElement)?.closest('td, th')
        : (endContainer as HTMLElement).closest?.('td, th');
    
    if (startCell && endCell) {
        // Selection is within a table
        const tableStartLine = getLineFromTableCell(startCell as HTMLElement);
        const tableEndLine = getLineFromTableCell(endCell as HTMLElement);
        startLineNum = tableStartLine ?? undefined;
        endLineNum = tableEndLine ?? undefined;
        
        if (startLineNum && endLineNum) {
            // Calculate column based on text position within cell
            const startText = getTextBeforeOffset(startCell as HTMLElement, startContainer, range.startOffset);
            const endText = getTextBeforeOffset(endCell as HTMLElement, endContainer, range.endOffset);
            startColumn = startText.length + 1;
            endColumn = endText.length + 1;
            
            return {
                startLine: startLineNum,
                startColumn,
                endLine: endLineNum,
                endColumn
            };
        }
    }
    
    // Check if selection is in a code block
    const codeBlock = findBlockContainer(startContainer, editorWrapper);
    if (codeBlock && codeBlock.classList.contains('code-block')) {
        // For code blocks, use the code-line elements
        if (startLine && startLine.classList.contains('code-line')) {
            startLineNum = parseInt(startLine.dataset.line || '');
        }
        if (endLine && endLine.classList.contains('code-line')) {
            endLineNum = parseInt(endLine.dataset.line || '');
        }
        
        if (startLineNum && endLineNum) {
            // Calculate column based on position in the line
            const startText = getTextBeforeOffset(startLine!, startContainer, range.startOffset);
            const endText = getTextBeforeOffset(endLine!, endContainer, range.endOffset);
            startColumn = startText.length + 1;
            endColumn = endText.length + 1;
            
            return {
                startLine: startLineNum,
                startColumn,
                endLine: endLineNum,
                endColumn
            };
        }
    }
    
    // Standard line elements
    if (!startLine || !endLine) return null;
    
    startLineNum = parseInt(startLine.dataset.line || '');
    endLineNum = parseInt(endLine.dataset.line || '');
    
    if (!startLineNum || !endLineNum) return null;
    
    // Calculate column based on text position
    const startText = getTextBeforeOffset(startLine, startContainer, range.startOffset);
    const endText = getTextBeforeOffset(endLine, endContainer, range.endOffset);
    startColumn = startText.length + 1;
    endColumn = endText.length + 1;
    
    return {
        startLine: startLineNum,
        startColumn,
        endLine: endLineNum,
        endColumn
    };
}

/**
 * Find the parent line element or line context
 */
function findLineElement(node: Node, editorWrapper: HTMLElement): HTMLElement | null {
    let current = node as Node | null;
    while (current && current !== editorWrapper) {
        const el = current as HTMLElement;
        // Regular markdown line
        if (el.classList && (el.classList.contains('line-content') || el.classList.contains('line'))) {
            return el;
        }
        // Code block line
        if (el.classList && el.classList.contains('code-line')) {
            return el;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Find the block container (code block, table, or mermaid) for a node
 */
function findBlockContainer(node: Node, editorWrapper: HTMLElement): HTMLElement | null {
    let current = node as Node | null;
    while (current && current !== editorWrapper) {
        const el = current as HTMLElement;
        if (el.classList) {
            if (el.classList.contains('code-block') ||
                el.classList.contains('md-table-container') ||
                el.classList.contains('mermaid-container')) {
                return el;
            }
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Get line number from table cell
 */
function getLineFromTableCell(cell: HTMLElement): number | null {
    const container = cell.closest('.md-table-container') as HTMLElement;
    if (!container) return null;
    
    const tableStartLine = parseInt(container.dataset.startLine || '');
    const table = container.querySelector('.md-table');
    if (!table) return tableStartLine || null;
    
    const row = cell.closest('tr') as HTMLTableRowElement;
    if (!row) return tableStartLine || null;
    
    // Check if in header or body
    const isHeader = row.parentElement?.tagName === 'THEAD';
    
    if (isHeader) {
        return tableStartLine;
    }
    
    // For body rows, count the index within TBODY only
    let tbodyRowIndex = 0;
    if (row.parentElement) {
        const tbodyRows = row.parentElement.querySelectorAll('tr');
        for (let i = 0; i < tbodyRows.length; i++) {
            if (tbodyRows[i] === row) {
                tbodyRowIndex = i;
                break;
            }
        }
    }
    
    // Data rows: startLine + 2 (header + separator) + row index within tbody
    return tableStartLine + 2 + tbodyRowIndex;
}

/**
 * Get the text content before a specific offset within a container
 */
function getTextBeforeOffset(container: HTMLElement, targetNode: Node, offset: number): string {
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
            // Skip comment bubbles and other non-content elements
            if (!el.classList?.contains('inline-comment-bubble')) {
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


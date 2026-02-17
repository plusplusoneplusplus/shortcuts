/**
 * Cursor management utilities for the webview editor
 * 
 * This module contains pure functions for cursor position calculations.
 * These functions are designed to be testable in Node.js with mock DOM structures.
 */

/**
 * Cursor position with line and column
 */
export interface CursorPosition {
    /** 1-based line number */
    line: number;
    /** 0-based column (character offset within the line) */
    column: number;
}

/**
 * Text node reference for cursor restoration
 */
export interface TextNodeReference {
    node: MockNode;
    offset: number;
}

/**
 * Mock node interfaces for testing without DOM
 */
export interface MockNode {
    nodeType: number;
    textContent: string | null;
    parentNode: MockNode | null;
    childNodes: MockNode[];
    tagName?: string;
    classList?: {
        contains(className: string): boolean;
    };
    getAttribute?(attr: string): string | null;
    hasAttribute?(attr: string): boolean;
    length?: number;
}

/**
 * Node type constants (matching DOM constants)
 */
export const NODE_TYPES = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3
} as const;

/**
 * Calculate the column offset from the start of a line element to a target position.
 * This properly handles nested elements and skips non-content elements like comment bubbles.
 * 
 * @param lineElement - The line element to traverse
 * @param targetNode - The node where the cursor is positioned
 * @param targetOffset - The offset within the target node
 * @param skipClasses - Array of class names to skip (e.g., comment bubbles)
 * @returns The 0-based column offset
 */
export function calculateColumnOffset(
    lineElement: MockNode,
    targetNode: MockNode,
    targetOffset: number,
    skipClasses: string[] = ['inline-comment-bubble', 'gutter-icon']
): number {
    let offset = 0;
    let found = false;

    function traverse(node: MockNode): void {
        if (found) return;

        if (node === targetNode) {
            if (node.nodeType === NODE_TYPES.TEXT_NODE) {
                offset += targetOffset;
            }
            found = true;
            return;
        }

        if (node.nodeType === NODE_TYPES.TEXT_NODE) {
            const length = node.textContent?.length || 0;
            offset += length;
        } else if (node.nodeType === NODE_TYPES.ELEMENT_NODE) {
            // Check if we should skip this element
            if (node.classList && skipClasses.some(cls => node.classList!.contains(cls))) {
                return;
            }

            for (const child of node.childNodes) {
                traverse(child);
                if (found) break;
            }
        }
    }

    traverse(lineElement);
    return offset;
}

/**
 * Find the line element containing a node.
 * Walks up the DOM tree looking for elements with the 'line-content' class
 * and 'data-line' attribute.
 * 
 * @param node - The node to start from
 * @param editorElement - The editor wrapper element (stops search)
 * @returns The line element or null if not found
 */
export function findLineElement(
    node: MockNode,
    editorElement: MockNode
): MockNode | null {
    let current: MockNode | null = node;

    while (current && current !== editorElement) {
        if (current.nodeType === NODE_TYPES.ELEMENT_NODE) {
            if (current.classList?.contains('line-content') && current.hasAttribute?.('data-line')) {
                return current;
            }
        }
        current = current.parentNode;
    }

    return null;
}

/**
 * Get the line number from a line element.
 * 
 * @param lineElement - The line element with data-line attribute
 * @returns The 1-based line number or null if invalid
 */
export function getLineNumber(lineElement: MockNode): number | null {
    const lineAttr = lineElement.getAttribute?.('data-line');
    if (!lineAttr) return null;
    const lineNum = parseInt(lineAttr, 10);
    return isNaN(lineNum) ? null : lineNum;
}

/**
 * Find the text node and offset for a target column position.
 * Used for cursor restoration after re-renders.
 * 
 * @param lineElement - The line element to search within
 * @param targetColumn - The 0-based column offset to find
 * @param skipClasses - Array of class names to skip
 * @returns Object with target node and offset, or null if not found
 */
export function findTextNodeAtColumn(
    lineElement: MockNode,
    targetColumn: number,
    skipClasses: string[] = ['inline-comment-bubble', 'gutter-icon']
): { node: MockNode; offset: number } | null {
    let currentOffset = 0;
    let result: { node: MockNode; offset: number } | null = null;
    let lastTextNode: MockNode | null = null;
    let lastTextNodeLength = 0;

    function traverse(node: MockNode): void {
        if (result) return;

        if (node.nodeType === NODE_TYPES.TEXT_NODE) {
            const length = node.textContent?.length || 0;
            lastTextNode = node;
            lastTextNodeLength = length;

            if (currentOffset + length >= targetColumn) {
                // The target column is within this text node
                result = {
                    node,
                    offset: Math.min(targetColumn - currentOffset, length)
                };
                return;
            }
            currentOffset += length;
        } else if (node.nodeType === NODE_TYPES.ELEMENT_NODE) {
            // Check if we should skip this element
            if (node.classList && skipClasses.some(cls => node.classList!.contains(cls))) {
                return;
            }

            for (const child of node.childNodes) {
                traverse(child);
                if (result) break;
            }
        }
    }

    traverse(lineElement);

    // If target column is beyond content, return last text node at its end
    if (!result && lastTextNode) {
        result = {
            node: lastTextNode,
            offset: lastTextNodeLength
        };
    }

    return result;
}

/**
 * Calculate cursor position from a selection range.
 * This is the main function for getting cursor position during editing.
 * 
 * @param startContainer - The start container node of the selection
 * @param startOffset - The offset within the start container
 * @param editorElement - The editor wrapper element
 * @returns CursorPosition or null if cannot determine
 */
export function getCursorPositionFromSelection(
    startContainer: MockNode,
    startOffset: number,
    editorElement: MockNode
): CursorPosition | null {
    // Find the line element containing the cursor
    const lineElement = findLineElement(startContainer, editorElement);
    if (!lineElement) {
        return null;
    }

    // Get the line number
    const lineNumber = getLineNumber(lineElement);
    if (lineNumber === null) {
        return null;
    }

    // Calculate the column offset
    const column = calculateColumnOffset(lineElement, startContainer, startOffset);

    return { line: lineNumber, column };
}

/**
 * Adjust cursor position after content insertion.
 * When content is inserted, we need to update the cursor position
 * if the insertion point is before the current cursor.
 * 
 * @param cursor - The current cursor position
 * @param insertLine - The line where content was inserted
 * @param insertColumn - The column where content was inserted  
 * @param insertedLines - Array of lines that were inserted
 * @returns The adjusted cursor position
 */
export function adjustCursorAfterInsertion(
    cursor: CursorPosition,
    insertLine: number,
    insertColumn: number,
    insertedLines: string[]
): CursorPosition {
    // If insertion is after the cursor, no adjustment needed
    if (insertLine > cursor.line) {
        return cursor;
    }

    // If insertion is on a later line, no adjustment needed
    if (insertLine === cursor.line && insertColumn > cursor.column) {
        return cursor;
    }

    const numNewLines = insertedLines.length - 1;
    const lastLineLength = insertedLines[insertedLines.length - 1].length;

    if (insertLine < cursor.line) {
        // Insertion is on a previous line - just shift line numbers
        return {
            line: cursor.line + numNewLines,
            column: cursor.column
        };
    }

    // Insertion is on the same line, at or before cursor column
    if (numNewLines === 0) {
        // Single line insertion - just shift column
        return {
            line: cursor.line,
            column: cursor.column + lastLineLength
        };
    } else {
        // Multi-line insertion
        // Cursor moves to the new line position
        // Column is: (original column - insert column) + last line length
        const remainingColumn = cursor.column - insertColumn;
        return {
            line: cursor.line + numNewLines,
            column: lastLineLength + remainingColumn
        };
    }
}

/**
 * Adjust cursor position after content deletion.
 * When content is deleted, we need to update the cursor position
 * if the deletion range affects the cursor.
 * 
 * @param cursor - The current cursor position
 * @param deleteStartLine - Start line of deletion (1-based)
 * @param deleteStartColumn - Start column of deletion (0-based)
 * @param deleteEndLine - End line of deletion (1-based)
 * @param deleteEndColumn - End column of deletion (0-based)
 * @returns The adjusted cursor position
 */
export function adjustCursorAfterDeletion(
    cursor: CursorPosition,
    deleteStartLine: number,
    deleteStartColumn: number,
    deleteEndLine: number,
    deleteEndColumn: number
): CursorPosition {
    // If cursor is before deletion range, no adjustment needed
    if (cursor.line < deleteStartLine ||
        (cursor.line === deleteStartLine && cursor.column < deleteStartColumn)) {
        return cursor;
    }

    // If cursor is within deletion range, move to start of deletion
    if ((cursor.line > deleteStartLine ||
        (cursor.line === deleteStartLine && cursor.column >= deleteStartColumn)) &&
        (cursor.line < deleteEndLine ||
            (cursor.line === deleteEndLine && cursor.column <= deleteEndColumn))) {
        return {
            line: deleteStartLine,
            column: deleteStartColumn
        };
    }

    // Cursor is after deletion range
    const deletedLines = deleteEndLine - deleteStartLine;

    if (cursor.line === deleteEndLine) {
        // Cursor is on the same line as deletion end
        // Column needs adjustment: move left by the deleted portion
        const deletedColumns = deleteEndColumn - (cursor.line === deleteStartLine ? deleteStartColumn : 0);
        return {
            line: deleteStartLine,
            column: deleteStartColumn + (cursor.column - deleteEndColumn)
        };
    } else {
        // Cursor is on a later line
        return {
            line: cursor.line - deletedLines,
            column: cursor.column
        };
    }
}

/**
 * Validate a cursor position against content.
 * Ensures the cursor position is within valid bounds.
 * 
 * @param cursor - The cursor position to validate
 * @param lines - The content lines
 * @returns The validated (and possibly clamped) cursor position
 */
export function validateCursorPosition(
    cursor: CursorPosition,
    lines: string[]
): CursorPosition {
    if (lines.length === 0) {
        return { line: 1, column: 0 };
    }

    const line = Math.max(1, Math.min(cursor.line, lines.length));
    const lineContent = lines[line - 1] || '';
    const column = Math.max(0, Math.min(cursor.column, lineContent.length));

    return { line, column };
}

/**
 * Compare two cursor positions.
 * 
 * @param a - First cursor position
 * @param b - Second cursor position
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function compareCursorPositions(a: CursorPosition, b: CursorPosition): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.column - b.column;
}

/**
 * Check if a cursor position is within a range.
 * 
 * @param cursor - The cursor position to check
 * @param startLine - Start line of range (1-based)
 * @param startColumn - Start column of range (0-based)
 * @param endLine - End line of range (1-based)
 * @param endColumn - End column of range (0-based)
 * @returns True if cursor is within the range
 */
export function isCursorInRange(
    cursor: CursorPosition,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
): boolean {
    const start: CursorPosition = { line: startLine, column: startColumn };
    const end: CursorPosition = { line: endLine, column: endColumn };

    return compareCursorPositions(cursor, start) >= 0 &&
        compareCursorPositions(cursor, end) <= 0;
}

/**
 * Restore cursor position after content change (e.g. Undo/Redo).
 * Provides smarter clamping than simple validation:
 * - If line was removed, clamps to end of the last available line.
 * 
 * @param cursor - The previous cursor position
 * @param lines - The new content lines
 * @returns The adjusted cursor position
 */
export function restoreCursorAfterContentChange(
    cursor: CursorPosition,
    lines: string[],
    prevLineLength: number = 0,
    currentLineLength: number = 0
): CursorPosition {
    if (lines.length === 0) {
        return { line: 1, column: 0 };
    }

    let targetLine = cursor.line;
    let targetColumn = cursor.column;

    // If the original line doesn't exist, clamp to the last line
    // AND move to the end of that line (simulate "undoing a newline")
    if (targetLine > lines.length) {
        targetLine = lines.length;

        // If we have previous line length, we can calculate the exact position
        // This handles "Undo Newline" correctly:
        // "A|B" -> "A\nB". Cursor at Line 2, Col 0.
        // Undo -> "AB". Line 1.
        // We want cursor at Line 1, Col 1 (after "A").
        // prevLineLength = "A".length = 1.
        // cursor.column = 0.
        // New column = 1 + 0 = 1.
        targetColumn = prevLineLength + cursor.column;

        // Ensure valid bounds
        const lineContent = lines[targetLine - 1] || '';
        targetColumn = Math.min(targetColumn, lineContent.length);
    } else {
        // Line exists, validate column
        // Ensure column is at least 0
        targetColumn = Math.max(0, targetColumn);

        const lineContent = lines[targetLine - 1] || '';
        targetColumn = Math.min(targetColumn, lineContent.length);
    }

    return { line: targetLine, column: targetColumn };
}

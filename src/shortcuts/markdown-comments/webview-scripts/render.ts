/**
 * Main render function for the webview
 * 
 * Uses cursor-management module for cursor position preservation during re-renders.
 */

import { MarkdownComment } from '../types';
import { groupCommentsByAllCoveredLines } from '../webview-logic/comment-state';
import {
    CursorPosition,
    NODE_TYPES,
    restoreCursorAfterContentChange
} from '../webview-logic/cursor-management';
import { applyMarkdownHighlighting } from '../webview-logic/markdown-renderer';
import { applyCommentHighlightToRange, getHighlightColumnsForLine } from '../webview-logic/selection-utils';
import { parseCodeBlocks, renderCodeBlock, setupCodeBlockHandlers } from './code-block-handlers';
import { setupCommentInteractions } from './dom-handlers';
import { resolveImagePaths, setupImageHandlers } from './image-handlers';
import { renderMermaidContainer, renderMermaidDiagrams } from './mermaid-handlers';
import { state } from './state';
import { parseTables, renderTable, setupTableHandlers } from './table-handlers';

/** Classes to skip when calculating cursor positions */
const SKIP_CLASSES = ['inline-comment-bubble', 'gutter-icon'];

/**
 * Find the line element containing a node.
 * Adapted from cursor-management module for browser DOM.
 */
function findLineElement(node: Node, editorElement: HTMLElement): HTMLElement | null {
    let current: Node | null = node;

    while (current && current !== editorElement) {
        if (current.nodeType === NODE_TYPES.ELEMENT_NODE) {
            const el = current as HTMLElement;
            if (el.classList?.contains('line-content') && el.hasAttribute('data-line')) {
                return el;
            }
        }
        current = current.parentNode;
    }

    return null;
}

/**
 * Get line number from a line element.
 * Adapted from cursor-management module for browser DOM.
 */
function getLineNumber(lineElement: HTMLElement): number | null {
    const lineAttr = lineElement.getAttribute('data-line');
    if (!lineAttr) return null;
    const lineNum = parseInt(lineAttr, 10);
    return isNaN(lineNum) ? null : lineNum;
}

/**
 * Calculate the column offset from the start of a line element to a target position.
 * Adapted from cursor-management module for browser DOM using TreeWalker.
 */
function calculateColumnOffset(
    lineElement: HTMLElement,
    targetNode: Node,
    targetOffset: number
): number {
    let offset = 0;
    let found = false;
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);

    let currentNode: Text | null;
    while ((currentNode = walker.nextNode() as Text | null)) {
        // Check if we should skip this node
        const parent = currentNode.parentElement;
        if (parent && SKIP_CLASSES.some(cls => parent.closest(`.${cls}`))) {
            continue;
        }

        if (currentNode === targetNode) {
            found = true;
            return offset + targetOffset;
        }
        offset += currentNode.length;
    }

    // If target is an element node, count all text before it
    if (!found && targetNode.nodeType === NODE_TYPES.ELEMENT_NODE) {
        return offset;
    }

    return offset;
}

/**
 * Calculate cursor position based on character offset in the entire editor.
 * This is a fallback when the cursor is in a browser-created element (e.g., after Enter key).
 */
function getCursorPositionFromOffset(editorWrapper: HTMLElement, range: Range): CursorPosition | null {
    // Get all text content before the cursor
    const preRange = document.createRange();
    preRange.setStart(editorWrapper, 0);
    preRange.setEnd(range.startContainer, range.startOffset);

    const textBefore = preRange.toString();
    const lines = textBefore.split('\n');

    return {
        line: lines.length,
        column: lines[lines.length - 1].length
    };
}

/**
 * Get the current cursor position in the editor.
 * Uses cursor-management logic adapted for browser DOM.
 * Falls back to offset-based calculation for browser-created elements.
 */
function getCursorPosition(editorWrapper: HTMLElement): CursorPosition | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }

    const range = selection.getRangeAt(0);
    if (!editorWrapper.contains(range.startContainer)) {
        return null;
    }

    // Find the line element containing the cursor
    const lineElement = findLineElement(range.startContainer, editorWrapper);
    if (!lineElement) {
        // Fallback: cursor is in a browser-created element (e.g., after Enter key)
        // Calculate position based on character offset
        console.log('[Webview] Cursor in browser-created element, using offset-based calculation');
        return getCursorPositionFromOffset(editorWrapper, range);
    }

    // Get line number
    const line = getLineNumber(lineElement);
    if (line === null) {
        return getCursorPositionFromOffset(editorWrapper, range);
    }

    // Calculate column offset within the line
    const column = calculateColumnOffset(lineElement, range.startContainer, range.startOffset);

    return { line, column };
}

/**
 * Find the text node and offset for a target column position.
 * Adapted from cursor-management module for browser DOM.
 */
function findTextNodeAtColumn(
    lineElement: Element,
    targetColumn: number
): { node: Text; offset: number } | null {
    let currentOffset = 0;
    let result: { node: Text; offset: number } | null = null;
    let lastValidNode: Text | null = null;
    let lastValidNodeLength = 0;

    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    let currentNode: Text | null;

    while ((currentNode = walker.nextNode() as Text | null)) {
        // Skip nodes in elements we should ignore
        const parent = currentNode.parentElement;
        if (parent && SKIP_CLASSES.some(cls => parent.closest(`.${cls}`))) {
            continue;
        }

        lastValidNode = currentNode;
        lastValidNodeLength = currentNode.length;

        if (currentOffset + currentNode.length >= targetColumn) {
            result = {
                node: currentNode,
                offset: Math.min(targetColumn - currentOffset, currentNode.length)
            };
            break;
        }
        currentOffset += currentNode.length;
    }

    // If target column is beyond content, return last text node at its end
    if (!result && lastValidNode) {
        result = {
            node: lastValidNode,
            offset: lastValidNodeLength
        };
    }

    return result;
}

/**
 * Calculate the text length of a line element, skipping non-content elements
 * like comment bubbles and gutter icons.
 */
function getLineContentLength(lineElement: Element): number {
    let length = 0;
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    let currentNode: Text | null;

    while ((currentNode = walker.nextNode() as Text | null)) {
        const parent = currentNode.parentElement;
        if (parent && SKIP_CLASSES.some(cls => parent.closest(`.${cls}`))) {
            continue;
        }
        length += currentNode.length;
    }
    return length;
}

/**
 * Restore cursor position after re-render.
 * Uses cursor-management logic adapted for browser DOM.
 * Handles cases where content has changed and original position may be invalid.
 */
function restoreCursorPosition(
    editorWrapper: HTMLElement,
    position: CursorPosition,
    totalLines: number,
    contentLines: string[],
    prevLineLength: number = 0,
    currentLineLength: number = 0
): void {
    // Validate and adjust position if content has changed
    // Use the smart restoration logic from cursor-management
    const adjustedPosition = restoreCursorAfterContentChange(
        position,
        contentLines,
        prevLineLength,
        currentLineLength
    );

    const targetLine = adjustedPosition.line;
    let targetColumn = adjustedPosition.column;

    const lineElement = editorWrapper.querySelector(`.line-content[data-line="${targetLine}"]`);
    if (!lineElement) {
        // Fallback: try to set cursor at the beginning of the editor
        const firstLine = editorWrapper.querySelector('.line-content[data-line="1"]');
        if (firstLine) {
            const target = findTextNodeAtColumn(firstLine, 0);
            if (target) {
                try {
                    const range = document.createRange();
                    range.setStart(target.node, target.offset);
                    range.collapse(true);
                    const selection = window.getSelection();
                    if (selection) {
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                } catch (e) {
                    console.warn('[Webview] Could not restore cursor position to fallback:', e);
                }
            }
        }
        return;
    }

    // Validate column - clamp to line length if necessary
    const lineContent = lineElement.textContent || '';
    if (targetColumn > lineContent.length) {
        targetColumn = lineContent.length;
    }

    const target = findTextNodeAtColumn(lineElement, targetColumn);
    if (!target) {
        return;
    }

    try {
        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.collapse(true);

        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } catch (e) {
        // Ignore errors in setting cursor position
        console.warn('[Webview] Could not restore cursor position:', e);
    }
}

/**
 * Main render function - renders the editor content with markdown highlighting,
 * code blocks, tables, and comments
 * 
 * @param isExternalChange - True if this render is triggered by an external change (undo/redo)
 */
export function render(isExternalChange: boolean = false): void {
    const editorWrapper = document.getElementById('editorWrapper')!;

    // For external changes, try to restore cursor position by clamping to valid bounds
    const cursorPosition = getCursorPosition(editorWrapper);

    // Capture lengths of current and previous lines to help with smart restoration
    let currentLineLength = 0;
    let prevLineLength = 0;

    if (cursorPosition) {
        const currentLineEl = editorWrapper.querySelector(`.line-content[data-line="${cursorPosition.line}"]`);
        if (currentLineEl) {
            currentLineLength = getLineContentLength(currentLineEl);
        }

        if (cursorPosition.line > 1) {
            const prevLineEl = editorWrapper.querySelector(`.line-content[data-line="${cursorPosition.line - 1}"]`);
            if (prevLineEl) {
                prevLineLength = getLineContentLength(prevLineEl);
            }
        }
    }
    const openCount = document.getElementById('openCount')!;
    const resolvedCount = document.getElementById('resolvedCount')!;

    // Log for debugging
    if (isExternalChange) {
        console.log('[Webview] External change detected, skipping cursor save/restore');
    }

    const lines = state.currentContent.split('\n');
    const commentsMap = groupCommentsByAllCoveredLines(state.comments);
    const codeBlocks = parseCodeBlocks(state.currentContent);
    const tables = parseTables(state.currentContent);

    // Create a map of lines that are part of code blocks
    const codeBlockLines = new Map<number, typeof codeBlocks[0]>();
    codeBlocks.forEach(block => {
        for (let i = block.startLine; i <= block.endLine; i++) {
            codeBlockLines.set(i, block);
        }
    });

    // Create a map of lines that are part of tables
    const tableLines = new Map<number, typeof tables[0]>();
    tables.forEach(table => {
        for (let i = table.startLine; i < table.endLine; i++) {
            tableLines.set(i, table);
        }
    });

    let html = '';
    let inCodeBlock = false;
    let currentCodeBlockLang: string | null = null;
    let skipUntilLine = 0;

    // Helper function to generate line numbers HTML for a block
    function generateBlockLineNumbers(
        startLine: number,
        endLine: number,
        commentsMap: Map<number, MarkdownComment[]>
    ): string {
        let lineNumsHtml = '';
        for (let i = startLine; i <= endLine; i++) {
            const blockLineComments = commentsMap.get(i) || [];
            const blockHasComments = blockLineComments.filter(c =>
                state.settings.showResolved || c.status !== 'resolved'
            ).length > 0;
            const blockGutterIcon = blockHasComments
                ? '<span class="gutter-icon" title="Click to view comments">💬</span>'
                : '';
            lineNumsHtml += '<div class="line-number">' + blockGutterIcon + i + '</div>';
        }
        return lineNumsHtml;
    }

    lines.forEach((line, index) => {
        const lineNum = index + 1;

        // Skip lines that are part of a rendered code/mermaid/table block
        if (lineNum <= skipUntilLine) {
            return;
        }

        const lineComments = commentsMap.get(lineNum) || [];
        const visibleComments = lineComments.filter(c =>
            state.settings.showResolved || c.status !== 'resolved'
        );

        const hasComments = visibleComments.length > 0;
        const gutterIcon = hasComments
            ? '<span class="gutter-icon" title="Click to view comments">💬</span>'
            : '';

        // Check if this line starts a code block
        const block = codeBlocks.find(b => b.startLine === lineNum);
        if (block) {
            const blockLineNums = generateBlockLineNumbers(block.startLine, block.endLine, commentsMap);
            const blockContent = block.isMermaid
                ? renderMermaidContainer(block, commentsMap)
                : renderCodeBlock(block, commentsMap);

            // Line numbers are not editable
            html += '<div class="line-row block-row">' +
                '<div class="line-number-column" contenteditable="false">' + blockLineNums + '</div>' +
                '<div class="line-content block-content">' + blockContent + '</div>' +
                '</div>';

            skipUntilLine = block.endLine;
            return;
        }

        // Check if this line starts a table
        const table = tables.find(t => t.startLine === lineNum);
        if (table) {
            const tableLineNums = generateBlockLineNumbers(table.startLine, table.endLine - 1, commentsMap);
            const tableContent = renderTable(table, commentsMap);

            // Line numbers are not editable
            html += '<div class="line-row block-row">' +
                '<div class="line-number-column" contenteditable="false">' + tableLineNums + '</div>' +
                '<div class="line-content block-content">' + tableContent + '</div>' +
                '</div>';

            skipUntilLine = table.endLine - 1;
            return;
        }

        // Apply markdown highlighting
        const result = applyMarkdownHighlighting(line, lineNum, inCodeBlock, currentCodeBlockLang);
        inCodeBlock = result.inCodeBlock;
        currentCodeBlockLang = result.codeBlockLang;

        let lineHtml = result.html || '&nbsp;';

        // Apply comment highlights to specific text ranges
        // Sort comments by startColumn descending to apply from right to left
        const sortedComments = [...visibleComments].sort((a, b) => {
            const aCol = a.selection.startLine === lineNum ? a.selection.startColumn : 1;
            const bCol = b.selection.startLine === lineNum ? b.selection.startColumn : 1;
            return bCol - aCol;
        });

        sortedComments.forEach(comment => {
            const statusClass = comment.status === 'resolved' ? 'resolved' : '';
            // Get the comment type class (e.g., 'ai-suggestion', 'ai-clarification')
            const typeClass = comment.type && comment.type !== 'user' ? comment.type : '';
            const { startCol, endCol } = getHighlightColumnsForLine(
                comment.selection,
                lineNum,
                line.length
            );

            lineHtml = applyCommentHighlightToRange(
                lineHtml,
                line,
                startCol,
                endCol,
                comment.id,
                statusClass,
                typeClass
            );
        });

        // Create row-based layout with line number and content together
        // Line numbers are not editable
        html += '<div class="line-row">' +
            '<div class="line-number" contenteditable="false">' + gutterIcon + lineNum + '</div>' +
            '<div class="line-content" data-line="' + lineNum + '">' + lineHtml + '</div>' +
            '</div>';
    });

    editorWrapper.innerHTML = html;

    // Update stats
    const open = state.comments.filter(c => c.status === 'open').length;
    const resolved = state.comments.filter(c => c.status === 'resolved').length;
    openCount.textContent = String(open);
    resolvedCount.textContent = String(resolved);

    // Setup click handlers for commented text and gutter icons
    setupCommentInteractions();

    // Setup code block handlers
    setupCodeBlockHandlers();

    // Render mermaid diagrams
    renderMermaidDiagrams();

    // Setup table handlers
    setupTableHandlers();

    // Setup image handlers
    setupImageHandlers();

    // Resolve image paths
    resolveImagePaths();

    // Restore cursor position after re-render
    // Note: For external changes (undo/redo), cursorPosition is null,
    // so the browser/contenteditable will handle cursor placement naturally
    if (cursorPosition) {
        // Use setTimeout to ensure DOM is fully updated before restoring cursor
        const totalLines = lines.length;
        setTimeout(() => {
            restoreCursorPosition(
                editorWrapper,
                cursorPosition,
                totalLines,
                lines,
                prevLineLength,
                currentLineLength
            );
        }, 0);
    }
}


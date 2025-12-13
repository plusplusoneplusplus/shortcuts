/**
 * Content extraction utilities for the webview editor
 * 
 * This module contains pure functions for extracting plain text content
 * from the contenteditable editor DOM. These functions handle the various
 * DOM mutations that browsers create during editing (br, div, p elements).
 * 
 * These functions are designed to be testable in Node.js with mock DOM structures.
 */

import { MockNode, NODE_TYPES } from './cursor-management';

/**
 * Result of content extraction including line-by-line breakdown
 */
export interface ContentExtractionResult {
    /** The extracted plain text content */
    content: string;
    /** Array of individual lines */
    lines: string[];
    /** Line mapping from DOM elements (for debugging) */
    lineMap: Map<number, string>;
}

/**
 * Context for processing content extraction
 */
export interface ExtractionContext {
    /** Current list of extracted lines */
    lines: string[];
    /** Whether we're currently inside a line-content element */
    insideLineContent: boolean;
    /** Set of class names to skip during extraction */
    skipClasses: Set<string>;
}

/**
 * Default classes to skip during content extraction
 */
export const DEFAULT_SKIP_CLASSES = new Set([
    'inline-comment-bubble',
    'gutter-icon',
    'line-number',
    'line-number-column'
]);

/**
 * Create a new extraction context
 */
export function createExtractionContext(
    skipClasses: Set<string> = DEFAULT_SKIP_CLASSES
): ExtractionContext {
    return {
        lines: [],
        insideLineContent: false,
        skipClasses
    };
}

/**
 * Check if an element should be skipped during extraction
 */
export function shouldSkipElement(node: MockNode, skipClasses: Set<string>): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    if (!node.classList) return false;
    
    for (const cls of skipClasses) {
        if (node.classList.contains(cls)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if a node is a block element that typically creates new lines
 */
export function isBlockElement(node: MockNode): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'div' || tag === 'p') return true;
    if (node.classList?.contains('line-row')) return true;
    if (node.classList?.contains('block-row')) return true;
    
    return false;
}

/**
 * Check if a node is a line-content element (our rendered line elements)
 */
export function isLineContentElement(node: MockNode): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    return Boolean(node.classList?.contains('line-content')) && 
           Boolean(node.hasAttribute?.('data-line'));
}

/**
 * Check if a node is a line-row wrapper element
 */
export function isLineRowElement(node: MockNode): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    return Boolean(node.classList?.contains('line-row')) || 
           Boolean(node.classList?.contains('block-row'));
}

/**
 * Check if a node is a block-content element (code blocks, tables)
 */
export function isBlockContentElement(node: MockNode): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    return Boolean(node.classList?.contains('block-content'));
}

/**
 * Check if a node is a BR element
 */
export function isBrElement(node: MockNode): boolean {
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) return false;
    return (node.tagName || '').toLowerCase() === 'br';
}

/**
 * Process a text node and add its content to the context
 */
export function processTextNode(node: MockNode, context: ExtractionContext): void {
    const text = node.textContent || '';
    if (context.lines.length === 0) {
        context.lines.push(text);
    } else {
        context.lines[context.lines.length - 1] += text;
    }
}

/**
 * Add a new line to the context
 */
export function addNewLine(context: ExtractionContext): void {
    context.lines.push('');
}

/**
 * Extract text from a block-content element (code blocks, tables)
 * This handles pre/code elements and table reconstructions
 */
export function extractBlockText(node: MockNode): string {
    // For pre/code blocks, get the text content
    const tagName = (node.tagName || '').toLowerCase();
    if (tagName === 'pre' || tagName === 'code') {
        return node.textContent || '';
    }

    // Check for table
    if (node.classList?.contains('md-table-container') || 
        node.classList?.contains('md-table')) {
        return extractTableText(node);
    }

    // Fallback: just get text content
    return node.textContent || '';
}

/**
 * Extract text from a table and reconstruct markdown format
 */
export function extractTableText(tableNode: MockNode): string {
    const rows: string[] = [];
    
    // Simple extraction - in real DOM we'd traverse tr/td/th
    // For mock testing, we'll use textContent
    // This is a simplified version; the actual DOM handler would be more complex
    return tableNode.textContent || '';
}

/**
 * Check if a BR element is followed by meaningful content
 */
export function hasMeaningfulContentAfterBr(node: MockNode): boolean {
    // Find next sibling
    const parent = node.parentNode;
    if (!parent) return false;
    
    const siblings = parent.childNodes;
    let foundNode = false;
    
    for (const sibling of siblings) {
        if (sibling === node) {
            foundNode = true;
            continue;
        }
        if (!foundNode) continue;
        
        // Check if this sibling has content
        if (sibling.nodeType === NODE_TYPES.TEXT_NODE) {
            const text = sibling.textContent?.trim();
            if (text && text.length > 0) return true;
        } else if (sibling.nodeType === NODE_TYPES.ELEMENT_NODE) {
            return true;
        }
    }
    
    return false;
}

/**
 * Process a single node for content extraction
 * This is the core recursive function that handles all node types
 */
export function processNode(
    node: MockNode, 
    context: ExtractionContext,
    isFirstChild: boolean = false
): void {
    // Handle text nodes
    if (node.nodeType === NODE_TYPES.TEXT_NODE) {
        processTextNode(node, context);
        return;
    }

    // Handle element nodes
    if (node.nodeType !== NODE_TYPES.ELEMENT_NODE) {
        return;
    }

    // Skip elements that should be ignored
    if (shouldSkipElement(node, context.skipClasses)) {
        return;
    }

    // Handle BR elements
    if (isBrElement(node)) {
        // Inside line-content, BR elements are typically browser artifacts
        // We only add a new line if there's meaningful content after the BR
        if (!context.insideLineContent) {
            addNewLine(context);
        } else if (hasMeaningfulContentAfterBr(node)) {
            addNewLine(context);
        }
        return;
    }

    // Handle line-content elements (our rendered lines)
    if (isLineContentElement(node)) {
        // Start a new line for each line-content element
        if (context.lines.length === 0 || 
            context.lines[context.lines.length - 1] !== '' || 
            !isFirstChild) {
            addNewLine(context);
        }
        
        // Process children with insideLineContent = true
        const previousInsideLineContent = context.insideLineContent;
        context.insideLineContent = true;
        
        let childIndex = 0;
        for (const child of node.childNodes) {
            processNode(child, context, childIndex === 0);
            childIndex++;
        }
        
        context.insideLineContent = previousInsideLineContent;
        return;
    }

    // Handle line-row elements (just process children)
    if (isLineRowElement(node)) {
        let childIndex = 0;
        for (const child of node.childNodes) {
            processNode(child, context, childIndex === 0);
            childIndex++;
        }
        return;
    }

    // Handle block-content elements (code blocks, tables)
    if (isBlockContentElement(node)) {
        const blockText = extractBlockText(node);
        if (blockText) {
            const blockLines = blockText.split('\n');
            blockLines.forEach((line, idx) => {
                if (idx === 0 && context.lines.length > 0 && 
                    context.lines[context.lines.length - 1] === '') {
                    context.lines[context.lines.length - 1] = line;
                } else {
                    context.lines.push(line);
                }
            });
        }
        return;
    }

    // Handle other block elements (div, p created by contenteditable)
    if (isBlockElement(node)) {
        if (context.insideLineContent) {
            // Inside line-content, block elements mean user pressed Enter
            if (context.lines.length > 0 && 
                context.lines[context.lines.length - 1] !== '') {
                addNewLine(context);
            }
        } else if (context.lines.length > 0 && 
                   context.lines[context.lines.length - 1] !== '' && 
                   !isFirstChild) {
            addNewLine(context);
        }
    }

    // Process children for all other elements
    let childIndex = 0;
    for (const child of node.childNodes) {
        processNode(child, context, childIndex === 0);
        childIndex++;
    }
}

/**
 * Extract plain text content from an editor wrapper element
 * This is the main entry point for content extraction
 * 
 * @param editorWrapper - The root editor element
 * @param skipClasses - Optional set of classes to skip
 * @returns ContentExtractionResult with extracted content
 */
export function extractPlainTextContent(
    editorWrapper: MockNode,
    skipClasses: Set<string> = DEFAULT_SKIP_CLASSES
): ContentExtractionResult {
    const context = createExtractionContext(skipClasses);
    
    processNode(editorWrapper, context, true);
    
    // Post-process: handle nbsp placeholders for empty lines
    const processedLines = context.lines.map(line => {
        if (line === '\u00a0') {
            return '';
        }
        return line;
    });
    
    return {
        content: processedLines.join('\n'),
        lines: processedLines,
        lineMap: new Map()
    };
}

/**
 * Apply a content change (insertion) and return the updated content
 * This is useful for simulating edits in tests
 * 
 * @param originalLines - Array of original content lines
 * @param insertLine - Line number to insert at (1-based)
 * @param insertColumn - Column to insert at (0-based)
 * @param insertText - Text to insert
 * @returns Updated lines array
 */
export function applyInsertion(
    originalLines: string[],
    insertLine: number,
    insertColumn: number,
    insertText: string
): string[] {
    if (originalLines.length === 0) {
        return insertText.split('\n');
    }

    // Clone the array
    const lines = [...originalLines];
    
    // Validate line number
    const lineIndex = Math.max(0, Math.min(insertLine - 1, lines.length - 1));
    const line = lines[lineIndex] || '';
    
    // Validate column
    const col = Math.max(0, Math.min(insertColumn, line.length));
    
    // Split the insert text into lines
    const insertLines = insertText.split('\n');
    
    if (insertLines.length === 1) {
        // Simple single-line insertion
        lines[lineIndex] = line.slice(0, col) + insertText + line.slice(col);
    } else {
        // Multi-line insertion
        const before = line.slice(0, col);
        const after = line.slice(col);
        
        // First inserted line gets appended to before
        const firstLine = before + insertLines[0];
        
        // Last inserted line gets prepended to after
        const lastLine = insertLines[insertLines.length - 1] + after;
        
        // Middle lines are added as-is
        const middleLines = insertLines.slice(1, -1);
        
        // Replace the original line with all new lines
        lines.splice(lineIndex, 1, firstLine, ...middleLines, lastLine);
    }
    
    return lines;
}

/**
 * Apply a content deletion and return the updated content
 * 
 * @param originalLines - Array of original content lines
 * @param startLine - Start line of deletion (1-based)
 * @param startColumn - Start column of deletion (0-based)
 * @param endLine - End line of deletion (1-based)
 * @param endColumn - End column of deletion (0-based)
 * @returns Updated lines array
 */
export function applyDeletion(
    originalLines: string[],
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
): string[] {
    if (originalLines.length === 0) {
        return [];
    }

    // Clone the array
    const lines = [...originalLines];
    
    // Validate positions
    const startLineIndex = Math.max(0, Math.min(startLine - 1, lines.length - 1));
    const endLineIndex = Math.max(0, Math.min(endLine - 1, lines.length - 1));
    
    const startLineContent = lines[startLineIndex] || '';
    const endLineContent = lines[endLineIndex] || '';
    
    const startCol = Math.max(0, Math.min(startColumn, startLineContent.length));
    const endCol = Math.max(0, Math.min(endColumn, endLineContent.length));
    
    if (startLineIndex === endLineIndex) {
        // Single line deletion
        lines[startLineIndex] = 
            startLineContent.slice(0, startCol) + 
            endLineContent.slice(endCol);
    } else {
        // Multi-line deletion
        const newLine = startLineContent.slice(0, startCol) + endLineContent.slice(endCol);
        lines.splice(startLineIndex, endLineIndex - startLineIndex + 1, newLine);
    }
    
    return lines;
}

/**
 * Get the total character count of content
 */
export function getTotalCharacterCount(lines: string[]): number {
    // Characters in lines plus newlines between them
    return lines.reduce((sum, line) => sum + line.length, 0) + 
           Math.max(0, lines.length - 1);
}

/**
 * Convert line/column position to absolute character offset
 */
export function positionToOffset(
    lines: string[],
    line: number,
    column: number
): number {
    let offset = 0;
    
    for (let i = 0; i < line - 1 && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for newline
    }
    
    if (line > 0 && line <= lines.length) {
        offset += Math.min(column, lines[line - 1].length);
    }
    
    return offset;
}

/**
 * Convert absolute character offset to line/column position
 */
export function offsetToPosition(
    lines: string[],
    offset: number
): { line: number; column: number } {
    let remainingOffset = offset;
    
    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length;
        
        if (remainingOffset <= lineLength) {
            return { line: i + 1, column: remainingOffset };
        }
        
        remainingOffset -= lineLength + 1; // +1 for newline
    }
    
    // Beyond content - return end position
    if (lines.length === 0) {
        return { line: 1, column: 0 };
    }
    
    return {
        line: lines.length,
        column: lines[lines.length - 1].length
    };
}

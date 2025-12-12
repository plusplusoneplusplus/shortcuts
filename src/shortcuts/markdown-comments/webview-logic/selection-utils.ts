/**
 * Selection utilities for line number calculations and DOM operations
 * 
 * This module contains pure functions for selection position calculations.
 * These functions are testable in Node.js and used in the webview.
 */

import { CommentSelection } from '../types';

/**
 * Selection position with selected text
 */
export interface SelectionPositionWithText extends CommentSelection {
    selectedText: string;
}

/**
 * Calculate column indices from 1-based columns to 0-based string indices
 * 
 * @param lineContent - The plain text content of the line
 * @param startCol - 1-based start column
 * @param endCol - 1-based end column
 * @returns Object with 0-based start and end indices
 */
export function calculateColumnIndices(
    lineContent: string,
    startCol: number,
    endCol: number
): { startIdx: number; endIdx: number; isValid: boolean } {
    const startIdx = Math.max(0, startCol - 1);
    const endIdx = Math.min(lineContent.length, endCol - 1);

    return {
        startIdx,
        endIdx,
        isValid: startIdx < endIdx && startIdx < lineContent.length
    };
}

/**
 * Determine the column range to highlight for a comment on a specific line
 * 
 * @param selection - The comment's selection
 * @param lineNumber - The current line number
 * @param lineLength - The length of the line content
 * @returns Start and end columns for this line
 */
export function getHighlightColumnsForLine(
    selection: CommentSelection,
    lineNumber: number,
    lineLength: number
): { startCol: number; endCol: number } {
    if (selection.startLine === selection.endLine && selection.startLine === lineNumber) {
        // Single line comment - highlight specific range
        return {
            startCol: selection.startColumn,
            endCol: selection.endColumn
        };
    } else if (selection.startLine === lineNumber) {
        // First line of multi-line comment
        return {
            startCol: selection.startColumn,
            endCol: lineLength + 1
        };
    } else if (selection.endLine === lineNumber) {
        // Last line of multi-line comment
        return {
            startCol: 1,
            endCol: selection.endColumn
        };
    } else if (lineNumber > selection.startLine && lineNumber < selection.endLine) {
        // Middle line of multi-line comment
        return {
            startCol: 1,
            endCol: lineLength + 1
        };
    }
    // Fallback - shouldn't happen
    return {
        startCol: 1,
        endCol: lineLength + 1
    };
}

/**
 * Create a mapping from plain text positions to HTML positions
 * Used to correctly apply highlights to HTML content
 * 
 * @param htmlContent - The HTML string to map
 * @returns Object with arrays mapping plain text positions to HTML positions
 */
export function createPlainToHtmlMapping(
    htmlContent: string
): { plainToHtmlStart: number[]; plainToHtmlEnd: number[]; plainLength: number } {
    const plainToHtmlStart: number[] = [];
    const plainToHtmlEnd: number[] = [];
    let plainPos = 0;
    let htmlPos = 0;
    let inTag = false;
    
    while (htmlPos < htmlContent.length) {
        const char = htmlContent[htmlPos];
        
        if (char === '<') {
            inTag = true;
            htmlPos++;
        } else if (char === '>') {
            inTag = false;
            htmlPos++;
        } else if (inTag) {
            htmlPos++;
        } else if (char === '&') {
            // HTML entity - find the end
            const entityEnd = htmlContent.indexOf(';', htmlPos);
            if (entityEnd > htmlPos && entityEnd - htmlPos <= 10) {
                // Valid entity
                if (plainToHtmlStart[plainPos] === undefined) {
                    plainToHtmlStart[plainPos] = htmlPos;
                }
                plainToHtmlEnd[plainPos] = entityEnd + 1;
                plainPos++;
                htmlPos = entityEnd + 1;
            } else {
                // Treat & as regular character
                if (plainToHtmlStart[plainPos] === undefined) {
                    plainToHtmlStart[plainPos] = htmlPos;
                }
                plainToHtmlEnd[plainPos] = htmlPos + 1;
                plainPos++;
                htmlPos++;
            }
        } else {
            // Regular character
            if (plainToHtmlStart[plainPos] === undefined) {
                plainToHtmlStart[plainPos] = htmlPos;
            }
            plainToHtmlEnd[plainPos] = htmlPos + 1;
            plainPos++;
            htmlPos++;
        }
    }
    
    return { plainToHtmlStart, plainToHtmlEnd, plainLength: plainPos };
}

/**
 * Apply comment highlight span to a specific character range in HTML content
 * This handles HTML tags and HTML entities by mapping character positions
 * 
 * @param htmlContent - The HTML content to wrap
 * @param plainText - The original plain text (for position reference)
 * @param startCol - 1-based start column
 * @param endCol - 1-based end column
 * @param commentId - The comment ID for data attribute
 * @param statusClass - CSS class for comment status
 * @returns HTML with highlight span applied
 */
export function applyCommentHighlightToRange(
    htmlContent: string,
    plainText: string,
    startCol: number,
    endCol: number,
    commentId: string,
    statusClass: string
): string {
    // Convert 1-based columns to 0-based indices
    const startIdx = Math.max(0, startCol - 1);
    const endIdx = Math.min(plainText.length, endCol - 1);
    
    // If the range is invalid or empty, wrap the entire line
    if (startIdx >= endIdx || startIdx >= plainText.length) {
        return wrapWithCommentSpan(htmlContent, commentId, statusClass);
    }
    
    const { plainToHtmlStart, plainToHtmlEnd, plainLength } = createPlainToHtmlMapping(htmlContent);
    
    // Handle edge case where plain text is shorter than expected
    if (plainToHtmlStart[startIdx] === undefined) {
        return wrapWithCommentSpan(htmlContent, commentId, statusClass);
    }
    
    // Get HTML positions
    const htmlStartPos = plainToHtmlStart[startIdx];
    // For end position, we need the position AFTER the last character
    const lastCharIdx = Math.min(endIdx - 1, plainLength - 1);
    let htmlEndPos = plainToHtmlEnd[lastCharIdx] !== undefined 
        ? plainToHtmlEnd[lastCharIdx] 
        : htmlContent.length;
    
    // Find tag boundaries - we need to be careful not to split HTML tags
    const { adjustedStart, adjustedEnd } = adjustTagBoundaries(
        htmlContent, 
        htmlStartPos, 
        htmlEndPos
    );
    
    // Build the result
    const before = htmlContent.substring(0, adjustedStart);
    const highlighted = htmlContent.substring(adjustedStart, adjustedEnd);
    const after = htmlContent.substring(adjustedEnd);
    
    return before + wrapWithCommentSpan(highlighted, commentId, statusClass) + after;
}

/**
 * Wrap content with a comment highlight span
 */
function wrapWithCommentSpan(content: string, commentId: string, statusClass: string): string {
    return `<span class="commented-text ${statusClass}" data-comment-id="${commentId}">${content}</span>`;
}

/**
 * Adjust start and end positions to not split HTML tags
 */
function adjustTagBoundaries(
    htmlContent: string,
    htmlStartPos: number,
    htmlEndPos: number
): { adjustedStart: number; adjustedEnd: number } {
    let adjustedStart = htmlStartPos;
    let adjustedEnd = htmlEndPos;
    
    // Check if we're inside a tag and adjust
    // Look backwards from start to see if we need to include opening tag
    let depth = 0;
    for (let i = htmlStartPos - 1; i >= 0; i--) {
        if (htmlContent[i] === '>') {
            // Check if this is an opening tag (not closing)
            const tagStart = htmlContent.lastIndexOf('<', i);
            if (tagStart >= 0) {
                const tagContent = htmlContent.substring(tagStart, i + 1);
                if (!tagContent.startsWith('</')) {
                    // This is an opening tag, we should include it
                    adjustedStart = tagStart;
                    depth++;
                }
            }
            break;
        }
    }
    
    // Look forward from end to include closing tags
    for (let i = htmlEndPos; i < htmlContent.length && depth > 0; i++) {
        if (htmlContent[i] === '<' && htmlContent[i + 1] === '/') {
            // Find the end of this closing tag
            const tagEnd = htmlContent.indexOf('>', i);
            if (tagEnd >= 0) {
                adjustedEnd = tagEnd + 1;
                depth--;
            }
        } else if (htmlContent[i] === '<' && htmlContent[i + 1] !== '/') {
            // Another opening tag, increase depth
            depth++;
        }
    }
    
    return { adjustedStart, adjustedEnd };
}


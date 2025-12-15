/**
 * Comment state management utilities
 * 
 * This module contains pure functions for managing comment state.
 * These functions are testable in Node.js and are used both:
 * 1. In Node.js for unit testing
 * 2. In the webview (browser) by importing into the bundled script
 */

import { CommentSelection, CommentStatus, MarkdownComment } from '../types';

/**
 * Filter comments by status
 * 
 * @param comments - Array of comments to filter
 * @param showResolved - Whether to include resolved comments
 * @returns Filtered array of comments
 */
export function filterCommentsByStatus(
    comments: MarkdownComment[],
    showResolved: boolean
): MarkdownComment[] {
    if (showResolved) {
        return comments;
    }
    return comments.filter(c => c.status !== 'resolved');
}

/**
 * Sort comments by their starting line number
 * 
 * @param comments - Array of comments to sort
 * @returns New sorted array (original not modified)
 */
export function sortCommentsByLine(comments: MarkdownComment[]): MarkdownComment[] {
    return [...comments].sort((a, b) => {
        if (a.selection.startLine !== b.selection.startLine) {
            return a.selection.startLine - b.selection.startLine;
        }
        return a.selection.startColumn - b.selection.startColumn;
    });
}

/**
 * Sort comments by column position (descending, for right-to-left application)
 * 
 * @param comments - Array of comments to sort
 * @returns New sorted array (original not modified)
 */
export function sortCommentsByColumnDescending(comments: MarkdownComment[]): MarkdownComment[] {
    return [...comments].sort((a, b) => b.selection.startColumn - a.selection.startColumn);
}

/**
 * Group comments by their starting line number
 * 
 * @param comments - Array of comments to group
 * @returns Map from line number to array of comments on that line
 */
export function groupCommentsByLine(comments: MarkdownComment[]): Map<number, MarkdownComment[]> {
    const map = new Map<number, MarkdownComment[]>();

    for (const comment of comments) {
        const line = comment.selection.startLine;
        const existing = map.get(line) || [];
        existing.push(comment);
        map.set(line, existing);
    }

    return map;
}

/**
 * Group comments by all lines they cover (not just starting line)
 * 
 * This is essential for multi-line comments where highlighting needs to appear
 * on every line the comment spans, not just the first line.
 * 
 * @param comments - Array of comments to group
 * @returns Map from line number to array of comments covering that line
 */
export function groupCommentsByAllCoveredLines(comments: MarkdownComment[]): Map<number, MarkdownComment[]> {
    const map = new Map<number, MarkdownComment[]>();

    for (const comment of comments) {
        const startLine = comment.selection.startLine;
        const endLine = comment.selection.endLine;

        // Add the comment to every line it covers
        for (let line = startLine; line <= endLine; line++) {
            const existing = map.get(line) || [];
            existing.push(comment);
            map.set(line, existing);
        }
    }

    return map;
}

/**
 * Get comments for a specific line, optionally filtered by visibility
 * 
 * @param lineNum - The 1-based line number
 * @param commentsMap - Map from line numbers to comments
 * @param showResolved - Whether to include resolved comments
 * @returns Array of comments for the line
 */
export function getCommentsForLine(
    lineNum: number,
    commentsMap: Map<number, MarkdownComment[]>,
    showResolved: boolean
): MarkdownComment[] {
    const lineComments = commentsMap.get(lineNum) || [];
    return filterCommentsByStatus(lineComments, showResolved);
}

/**
 * Check if a block of lines has any visible comments
 * 
 * @param startLine - Start line (1-based, inclusive)
 * @param endLine - End line (1-based, inclusive)
 * @param commentsMap - Map from line numbers to comments
 * @param showResolved - Whether to include resolved comments
 * @returns True if the block has visible comments
 */
export function blockHasComments(
    startLine: number,
    endLine: number,
    commentsMap: Map<number, MarkdownComment[]>,
    showResolved: boolean = true
): boolean {
    for (let line = startLine; line <= endLine; line++) {
        const lineComments = getCommentsForLine(line, commentsMap, showResolved);
        if (lineComments.length > 0) {
            return true;
        }
    }
    return false;
}

/**
 * Count comments by status
 * 
 * @param comments - Array of comments to count
 * @returns Object with counts for each status
 */
export function countCommentsByStatus(
    comments: MarkdownComment[]
): { open: number; resolved: number; pending: number } {
    let open = 0;
    let resolved = 0;
    let pending = 0;

    for (const comment of comments) {
        switch (comment.status) {
            case 'open':
                open++;
                break;
            case 'resolved':
                resolved++;
                break;
            case 'pending':
                pending++;
                break;
        }
    }

    return { open, resolved, pending };
}

/**
 * Find a comment by ID
 * 
 * @param comments - Array of comments to search
 * @param commentId - The comment ID to find
 * @returns The comment if found, undefined otherwise
 */
export function findCommentById(
    comments: MarkdownComment[],
    commentId: string
): MarkdownComment | undefined {
    return comments.find(c => c.id === commentId);
}

/**
 * Update a comment's status
 * 
 * @param comments - Array of comments
 * @param commentId - The ID of the comment to update
 * @param status - The new status
 * @returns New array with the updated comment
 */
export function updateCommentStatus(
    comments: MarkdownComment[],
    commentId: string,
    status: CommentStatus
): MarkdownComment[] {
    return comments.map(c => {
        if (c.id === commentId) {
            return {
                ...c,
                status,
                updatedAt: new Date().toISOString()
            };
        }
        return c;
    });
}

/**
 * Update a comment's text
 * 
 * @param comments - Array of comments
 * @param commentId - The ID of the comment to update
 * @param commentText - The new comment text
 * @returns New array with the updated comment
 */
export function updateCommentText(
    comments: MarkdownComment[],
    commentId: string,
    commentText: string
): MarkdownComment[] {
    return comments.map(c => {
        if (c.id === commentId) {
            return {
                ...c,
                comment: commentText,
                updatedAt: new Date().toISOString()
            };
        }
        return c;
    });
}

/**
 * Delete a comment by ID
 * 
 * @param comments - Array of comments
 * @param commentId - The ID of the comment to delete
 * @returns New array without the deleted comment
 */
export function deleteComment(
    comments: MarkdownComment[],
    commentId: string
): MarkdownComment[] {
    return comments.filter(c => c.id !== commentId);
}

/**
 * Resolve all open comments
 * 
 * @param comments - Array of comments
 * @returns New array with all open comments marked as resolved
 */
export function resolveAllComments(comments: MarkdownComment[]): MarkdownComment[] {
    const now = new Date().toISOString();
    return comments.map(c => {
        if (c.status === 'open') {
            return {
                ...c,
                status: 'resolved' as CommentStatus,
                updatedAt: now
            };
        }
        return c;
    });
}

/**
 * Check if a comment selection spans the given line
 * 
 * @param selection - Comment selection with line/column info
 * @param lineNumber - 1-based line number to check
 * @returns Object indicating if the line is covered and the column range
 */
export function getSelectionCoverageForLine(
    selection: CommentSelection,
    lineNumber: number
): { isCovered: boolean; startColumn: number; endColumn: number } {
    if (lineNumber < selection.startLine || lineNumber > selection.endLine) {
        return { isCovered: false, startColumn: 0, endColumn: 0 };
    }

    let startColumn = 1;
    let endColumn = Infinity; // Will be clamped to line length

    if (selection.startLine === selection.endLine && selection.startLine === lineNumber) {
        // Single line selection
        startColumn = selection.startColumn;
        endColumn = selection.endColumn;
    } else if (lineNumber === selection.startLine) {
        // First line of multi-line selection
        startColumn = selection.startColumn;
    } else if (lineNumber === selection.endLine) {
        // Last line of multi-line selection
        endColumn = selection.endColumn;
    }
    // Middle lines use full line (startColumn=1, endColumn=Infinity)

    return { isCovered: true, startColumn, endColumn };
}


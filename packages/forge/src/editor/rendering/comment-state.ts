/**
 * Pure comment-state helpers, used by Node.js unit tests and by the webview
 * through the bundled script.
 */

import { CommentSelection, CommentStatus, MarkdownComment } from '../types';

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
 * @returns New sorted array (original not modified)
 */
export function sortCommentsByColumnDescending(comments: MarkdownComment[]): MarkdownComment[] {
    return [...comments].sort((a, b) => b.selection.startColumn - a.selection.startColumn);
}

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
 * @param lineNum - The 1-based line number
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
 * @param startLine - Start line (1-based, inclusive)
 * @param endLine - End line (1-based, inclusive)
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

export function findCommentById(
    comments: MarkdownComment[],
    commentId: string
): MarkdownComment | undefined {
    return comments.find(c => c.id === commentId);
}

/**
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
 * @returns New array without the deleted comment
 */
export function deleteComment(
    comments: MarkdownComment[],
    commentId: string
): MarkdownComment[] {
    return comments.filter(c => c.id !== commentId);
}

/**
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
 * @param lineNumber - 1-based line number to check
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


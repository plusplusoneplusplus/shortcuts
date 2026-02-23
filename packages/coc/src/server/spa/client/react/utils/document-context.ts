/**
 * Pure utility for extracting document context around a comment selection.
 *
 * Ported from src/shortcuts/markdown-comments/ask-ai-context-utils.ts —
 * same algorithm, but returns only the fields needed by the client-side
 * AI request payload (selectedText / startLine / endLine live on the comment).
 */

import type { TaskComment } from '../../task-comments-types';

export interface DocumentContext {
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    filePath?: string;
}

/**
 * Extract document context around the given comment's selection range.
 *
 * @param rawContent  Full markdown content of the file.
 * @param comment     The comment whose selection range defines the context window.
 * @param contextRadius  Number of lines before/after the selection to include (default 5).
 */
export function extractDocumentContext(
    rawContent: string,
    comment: TaskComment | null | undefined,
    contextRadius = 5,
): DocumentContext {
    if (!comment) {
        return { surroundingLines: '', nearestHeading: null, allHeadings: [] };
    }

    const lines = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lineCount = Math.max(lines.length, 1);
    const startLine = Math.min(Math.max(comment.selection.startLine, 1), lineCount);
    const endLine = Math.min(Math.max(comment.selection.endLine, startLine), lineCount);

    // Heading scan — same regex as ask-ai-context-utils.ts
    const headingRe = /^(#{1,6})\s+(.+)$/;
    const allHeadings: string[] = [];
    let nearestHeading: string | null = null;
    lines.forEach((line, i) => {
        const m = line.match(headingRe);
        if (!m) return;
        allHeadings.push(m[2].trim());
        if (i + 1 <= startLine) nearestHeading = m[2].trim();
    });

    // Surrounding lines — exclude the selection range
    const ctxStart = Math.max(0, startLine - 1 - contextRadius);
    const ctxEnd = Math.min(lines.length, endLine + contextRadius);
    const surrounding: string[] = [];
    for (let i = ctxStart; i < ctxEnd; i++) {
        const lineNo = i + 1;
        if (lineNo >= startLine && lineNo <= endLine) continue;
        surrounding.push(lines[i]);
    }

    return { surroundingLines: surrounding.join('\n'), nearestHeading, allHeadings };
}

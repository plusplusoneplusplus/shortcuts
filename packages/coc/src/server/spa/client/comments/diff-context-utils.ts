/**
 * Diff Context Utilities
 *
 * Shared helpers for building context strings from diff selections.
 * Used by both "Ask AI" and "Copy as Context" flows.
 */

import type { DiffCommentSelection } from './diff-comment-types';

export interface BuildDiffContextParams {
    selectedText: string;
    selection: DiffCommentSelection;
    commitHash?: string;
    filePath?: string;
}

/**
 * Build a formatted context string from a diff selection.
 *
 * Output format:
 * ```
 * Context from code review:
 * - Commit: <hash>           ← only when commitHash is provided
 * - File: <filePath>         ← only when filePath is provided
 * - Lines <start>-<end>:
 * ```
 * <selected diff text>
 * ```
 * ```
 */
export function buildDiffContext(params: BuildDiffContextParams): string {
    const { selectedText, selection, commitHash, filePath } = params;
    const lineRange = (selection.newLineStart && selection.newLineEnd)
        ? `${selection.newLineStart}-${selection.newLineEnd}`
        : `${selection.diffLineStart}-${selection.diffLineEnd}`;
    return [
        'Context from code review:',
        ...(commitHash ? [`- Commit: ${commitHash}`] : []),
        ...(filePath ? [`- File: ${filePath}`] : []),
        `- Lines ${lineRange}:`,
        '```',
        selectedText,
        '```',
        '',
        '',
    ].join('\n');
}

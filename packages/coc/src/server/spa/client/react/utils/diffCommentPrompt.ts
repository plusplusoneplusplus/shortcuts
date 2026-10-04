/**
 * diffCommentPrompt — the resolve prompt built from diff comments on one file.
 *
 * The comment sidebar's "Copy all comments as prompt" and the per-card Copy /
 * Send-to-chat actions share this formatter, so a one-comment list and a single
 * card produce the same text.
 */

import type { DiffComment } from '../../../comments/diff-comment-types';

/** The file and ref range the comments belong to. */
export interface DiffCommentPromptContext {
    filePath: string;
    oldRef: string;
    newRef: string;
}

export function formatDiffCommentsPrompt(
    context: DiffCommentPromptContext,
    comments: readonly DiffComment[],
): string {
    const commentsBlock = comments
        .map((c, i) =>
            `### Comment ${i + 1} (id: ${c.id}, status: ${c.status})\n` +
            `Lines ${c.selection.diffLineStart}–${c.selection.diffLineEnd} (${c.selection.side})\n` +
            `Selected code:\n\`\`\`\n${c.selectedText}\n\`\`\`\n` +
            `Comment: ${c.comment}`
        )
        .join('\n\n');

    const refRange = context.newRef === 'working-tree'
        ? `working tree changes`
        : `${context.oldRef} → ${context.newRef}`;

    return (
        `You are reviewing a git diff for file: ${context.filePath}\n` +
        `Diff range: ${refRange}\n\n` +
        `The following ${comments.length} comment(s) have been added to the diff:\n\n` +
        `${commentsBlock}\n\n` +
        `Please address these comments.`
    );
}

/** The resolve prompt for one comment, using the comment's own file and refs. */
export function formatDiffCommentPrompt(comment: DiffComment): string {
    return formatDiffCommentsPrompt(comment.context, [comment]);
}

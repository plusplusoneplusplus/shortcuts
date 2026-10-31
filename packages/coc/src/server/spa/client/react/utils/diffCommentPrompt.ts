/**
 * diffCommentPrompt — the resolve prompt built from diff comments on one file.
 *
 * The comment sidebar's "Copy all comments as prompt" and the per-card Copy /
 * Send-to-chat actions share this formatter, so a one-comment list and a single
 * card produce the same text.
 */

import { isLineDiffComment, type DiffComment } from '../../comments/diff-comment-types';

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
            (isLineDiffComment(c)
                ? `Lines ${c.selection.diffLineStart}–${c.selection.diffLineEnd} (${c.selection.side})\n` +
                  `Selected code:\n\`\`\`\n${c.selectedText}\n\`\`\`\n`
                : `Location: whole file\n`) +
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

/** The review an aggregated comment list belongs to. */
export type ReviewCommentScope =
    | { kind: 'commit'; hash: string }
    | { kind: 'working-tree' }
    | { kind: 'branch-range'; label: string };

/** Human-readable file location of a diff comment, e.g. `new lines 12–14` or `whole file`. */
export function diffCommentLocation(comment: DiffComment): string {
    if (!isLineDiffComment(comment)) return 'whole file';
    const s = comment.selection;
    const removed = s.side === 'removed';
    const start = removed ? s.oldLineStart : s.newLineStart;
    const end = (removed ? s.oldLineEnd : s.newLineEnd) ?? start;
    const fileSide = removed ? 'old' : 'new';
    if (start === undefined) return `diff lines ${s.diffLineStart}–${s.diffLineEnd} (${s.side})`;
    return start === end || end === undefined
        ? `${fileSide} line ${start} (${s.side})`
        : `${fileSide} lines ${start}–${end} (${s.side})`;
}

function reviewLabel(scope: ReviewCommentScope): string {
    switch (scope.kind) {
        case 'commit': return `commit ${scope.hash} (diff ${scope.hash}^ → ${scope.hash})`;
        case 'working-tree': return 'the pending working-tree changes (staged and unstaged)';
        case 'branch-range': return `the branch changes of ${scope.label}`;
    }
}

function fence(text: string): string {
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const marks = '`'.repeat(longest + 1);
    return `${marks}\n${text}\n${marks}`;
}

/** Comments a copied resolve prompt carries: everything not yet resolved. */
export function unresolvedReviewComments(comments: readonly DiffComment[]): DiffComment[] {
    return comments.filter(c => c.status !== 'resolved');
}

/** Groups comments by repo-relative file path (sorted), ordered by location inside a file. */
export function groupDiffCommentsByFile<T extends DiffComment>(comments: readonly T[]): [string, T[]][] {
    const byFile = new Map<string, T[]>();
    for (const c of comments) {
        const list = byFile.get(c.context.filePath) ?? [];
        list.push(c);
        byFile.set(c.context.filePath, list);
    }
    // Whole-file comments sort before line comments.
    const line = (c: DiffComment) => isLineDiffComment(c)
        ? c.selection.newLineStart ?? c.selection.oldLineStart ?? c.selection.diffLineStart : -1;
    return [...byFile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, list]) => [filePath, [...list].sort((a, b) => line(a) - line(b))]);
}

/**
 * The resolve prompt for every unresolved comment of one review (commit, branch
 * range or working tree), grouped by file. Resolved comments are left out and
 * counted, never silently dropped.
 */
export function formatReviewCommentsPrompt(scope: ReviewCommentScope, comments: readonly DiffComment[]): string {
    const included = unresolvedReviewComments(comments);
    const skipped = comments.length - included.length;
    const groups = groupDiffCommentsByFile(included);
    let n = 0;
    const sections = groups.map(([filePath, list]) => {
        const blocks = list.map(c => {
            const stage = scope.kind === 'working-tree'
                ? `Changes: ${c.context.oldRef === 'HEAD' ? 'staged' : 'unstaged'}\n` : '';
            return `### Comment ${++n} (id: ${c.id}, status: ${c.status})\n` +
                `File: ${filePath}\n` +
                `Location: ${diffCommentLocation(c)}\n` + stage +
                (c.selectedText ? `Selected code:\n${fence(c.selectedText)}\n` : '') +
                `Comment:\n${c.comment}`;
        });
        return `## File: ${filePath} (${list.length} comment(s))\n\n${blocks.join('\n\n')}`;
    });
    return (
        `You are reviewing ${reviewLabel(scope)}.\n` +
        `Resolve the following ${included.length} unresolved review comment(s) across ${groups.length} file(s). ` +
        `File paths are relative to the repository root.` +
        (skipped ? ` ${skipped} resolved comment(s) are not included.` : '') +
        `\n\n${sections.join('\n\n')}\n\n` +
        `Please address each comment in the code. Do not change unrelated code.`
    );
}

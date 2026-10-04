import { describe, it, expect } from 'vitest';
import { formatDiffCommentPrompt, formatDiffCommentsPrompt } from '../../../../src/server/spa/client/react/utils/diffCommentPrompt';
import type { DiffComment } from '../../../../src/server/spa/client/comments/diff-comment-types';

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'c1',
        context: { repositoryId: 'repo-1', filePath: 'src/a.ts', oldRef: 'abc123^', newRef: 'abc123' },
        selection: { diffLineStart: 4, diffLineEnd: 6, side: 'added', newLineStart: 2, newLineEnd: 4, startColumn: 0, endColumn: 3 },
        selectedText: 'const x = 1;',
        comment: 'Rename x',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('diffCommentPrompt', () => {
    it('formats one comment with file, refs, id, status, lines, side, code, text and instructions', () => {
        expect(formatDiffCommentPrompt(makeComment())).toBe(
            'You are reviewing a git diff for file: src/a.ts\n' +
            'Diff range: abc123^ → abc123\n\n' +
            'The following 1 comment(s) have been added to the diff:\n\n' +
            '### Comment 1 (id: c1, status: open)\n' +
            'Lines 4–6 (added)\n' +
            'Selected code:\n```\nconst x = 1;\n```\n' +
            'Comment: Rename x\n\n' +
            'Please address these comments.',
        );
    });

    it('matches the list prompt for a one-comment list', () => {
        const c = makeComment();
        expect(formatDiffCommentPrompt(c)).toBe(formatDiffCommentsPrompt(c.context, [c]));
    });

    it('labels working-tree comments and keeps the resolved status', () => {
        const c = makeComment({
            status: 'resolved',
            context: { repositoryId: 'repo-1', filePath: 'src/b.ts', oldRef: 'INDEX', newRef: 'working-tree' },
        });
        const prompt = formatDiffCommentPrompt(c);
        expect(prompt).toContain('file: src/b.ts\nDiff range: working tree changes');
        expect(prompt).toContain('status: resolved');
    });

    it('includes only the given comment', () => {
        const prompt = formatDiffCommentPrompt(makeComment());
        expect(prompt).not.toContain('Comment 2');
    });
});

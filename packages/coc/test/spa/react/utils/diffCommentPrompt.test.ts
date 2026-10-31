import { describe, it, expect } from 'vitest';
import { diffCommentLocation, formatDiffCommentPrompt, formatDiffCommentsPrompt, formatReviewCommentsPrompt, groupDiffCommentsByFile } from '../../../../src/server/spa/client/react/utils/diffCommentPrompt';
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

describe('formatReviewCommentsPrompt', () => {
    it('formats a commit review grouped by file with locations and exact text', () => {
        const comments = [
            makeComment({ id: 'b1', context: { repositoryId: 'repo-1', filePath: 'src/b.ts', oldRef: 'abc123^', newRef: 'abc123' }, comment: 'Line one.\nLine two.' }),
            makeComment({ id: 'a2', selection: { diffLineStart: 9, diffLineEnd: 9, side: 'removed', oldLineStart: 30, oldLineEnd: 30, startColumn: 0, endColumn: 1 }, selectedText: 'old()', comment: 'Why remove this?' }),
            makeComment({ id: 'a1' }),
            makeComment({ id: 'r1', status: 'resolved', comment: 'done already' }),
        ];
        expect(formatReviewCommentsPrompt({ kind: 'commit', hash: 'abc123' }, comments)).toBe(
            'You are reviewing commit abc123 (diff abc123^ → abc123).\n' +
            'Resolve the following 3 unresolved review comment(s) across 2 file(s). File paths are relative to the repository root. 1 resolved comment(s) are not included.\n\n' +
            '## File: src/a.ts (2 comment(s))\n\n' +
            '### Comment 1 (id: a1, status: open)\nFile: src/a.ts\nLocation: new lines 2–4 (added)\n' +
            'Selected code:\n```\nconst x = 1;\n```\nComment:\nRename x\n\n' +
            '### Comment 2 (id: a2, status: open)\nFile: src/a.ts\nLocation: old line 30 (removed)\n' +
            'Selected code:\n```\nold()\n```\nComment:\nWhy remove this?\n\n' +
            '## File: src/b.ts (1 comment(s))\n\n' +
            '### Comment 3 (id: b1, status: open)\nFile: src/b.ts\nLocation: new lines 2–4 (added)\n' +
            'Selected code:\n```\nconst x = 1;\n```\nComment:\nLine one.\nLine two.\n\n' +
            'Please address each comment in the code. Do not change unrelated code.',
        );
    });

    it('keeps orphaned (location lost) comments and falls back to diff lines', () => {
        const prompt = formatReviewCommentsPrompt({ kind: 'branch-range', label: 'feat' }, [
            makeComment({ status: 'orphaned', selection: { diffLineStart: 3, diffLineEnd: 5, side: 'context', startColumn: 0, endColumn: 1 } }),
        ]);
        expect(prompt).toContain('You are reviewing the branch changes of feat.');
        expect(prompt).toContain('status: orphaned');
        expect(prompt).toContain('Location: diff lines 3–5 (context)');
    });

    it('uses a longer fence when the selected code contains backticks', () => {
        const prompt = formatReviewCommentsPrompt({ kind: 'commit', hash: 'abc123' }, [makeComment({ selectedText: 'a ``` b' })]);
        expect(prompt).toContain('````\na ``` b\n````');
    });
});

describe('groupDiffCommentsByFile', () => {
    it('sorts files by path and comments by line', () => {
        const at = (id: string, filePath: string, line: number) => makeComment({
            id, context: { repositoryId: 'r', filePath, oldRef: 'a', newRef: 'b' },
            selection: { diffLineStart: line, diffLineEnd: line, side: 'added', newLineStart: line, newLineEnd: line, startColumn: 0, endColumn: 1 },
        });
        const groups = groupDiffCommentsByFile([at('z', 'z.ts', 1), at('a9', 'a.ts', 9), at('a1', 'a.ts', 1)]);
        expect(groups.map(([file, list]) => [file, list.map(c => c.id)])).toEqual([['a.ts', ['a1', 'a9']], ['z.ts', ['z']]]);
    });
});

describe('file-level comments', () => {
    const fileComment = makeComment({ id: 'f1', scope: 'file', selection: undefined, selectedText: '', comment: 'Split this file' });

    it('formats as the whole file with no line or selected code', () => {
        const prompt = formatDiffCommentPrompt(fileComment);
        expect(prompt).toContain('### Comment 1 (id: f1, status: open)\nLocation: whole file\nComment: Split this file');
        expect(prompt).not.toContain('Lines');
        expect(prompt).not.toContain('Selected code');
        expect(diffCommentLocation(fileComment)).toBe('whole file');
    });

    it('sorts before line comments of the same file in review prompts', () => {
        const prompt = formatReviewCommentsPrompt({ kind: 'commit', hash: 'abc123' }, [makeComment({ id: 'l1' }), fileComment]);
        expect(prompt.indexOf('id: f1')).toBeLessThan(prompt.indexOf('id: l1'));
        expect(prompt).toContain('File: src/a.ts\nLocation: whole file\nComment:\nSplit this file');
    });
});

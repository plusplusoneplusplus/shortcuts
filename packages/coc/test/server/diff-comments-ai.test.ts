import { describe, it, expect } from 'vitest';
import { buildMultiFileBatchResolvePrompt, renderCommentBlock } from '../../src/server/diff-comments-ai';
import type { DiffComment } from '@plusplusoneplusplus/forge';

function makeDiffComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'c1',
        context: {
            repositoryId: 'repo1',
            filePath: 'src/app.ts',
            oldRef: 'abc123^',
            newRef: 'abc123',
        },
        selection: {
            diffLineStart: 10,
            diffLineEnd: 12,
            side: 'right',
            oldLineStart: 8,
            oldLineEnd: 10,
            newLineStart: 9,
            newLineEnd: 11,
            startColumn: 0,
            endColumn: 20,
        },
        selectedText: 'const x = 1;',
        comment: 'This should be a let',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    } as DiffComment;
}

describe('renderCommentBlock', () => {
    it('renders basic comment fields', () => {
        const comment = makeDiffComment({ id: 'c10', selectedText: 'let x', comment: 'Use const' });
        const block = renderCommentBlock(comment, 0);

        expect(block).toContain('### Comment 1');
        expect(block).toContain('`c10`');
        expect(block).toContain('"let x"');
        expect(block).toContain('"Use const"');
    });

    it('includes diff line number when present', () => {
        const comment = makeDiffComment({ selection: { diffLineStart: 42, diffLineEnd: 44, side: 'right', oldLineStart: 0, oldLineEnd: 0, newLineStart: 0, newLineEnd: 0, startColumn: 0, endColumn: 0 } as DiffComment['selection'] });
        const block = renderCommentBlock(comment, 2);

        expect(block).toContain('### Comment 3 (Diff line 42)');
    });

    it('includes author, tags, aiResponse, and replies', () => {
        const comment = makeDiffComment({
            author: 'alice',
            tags: ['bug', 'p1'],
            aiResponse: 'Looks fine',
            replies: [{ text: 'Thanks', author: 'bob', createdAt: '2024-01-01' }],
        });
        const block = renderCommentBlock(comment, 0);

        expect(block).toContain('**Author**: alice');
        expect(block).toContain('bug, p1');
        expect(block).toContain('Looks fine');
        expect(block).toContain('bob: Thanks');
    });
});

describe('buildMultiFileBatchResolvePrompt', () => {
    it('generates prompt with multiple files', () => {
        const entries = [
            {
                filePath: 'src/a.ts',
                comments: [makeDiffComment({ id: 'a1', comment: 'Fix A' })],
            },
            {
                filePath: 'src/b.ts',
                comments: [makeDiffComment({ id: 'b1', comment: 'Fix B' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'abc^', 'abc');

        expect(result).toContain('### File 1: `src/a.ts`');
        expect(result).toContain('### File 2: `src/b.ts`');
        expect(result).toContain('`a1`');
        expect(result).toContain('`b1`');
    });

    it('generates prompt with single file', () => {
        const entries = [
            {
                filePath: 'src/only.ts',
                comments: [makeDiffComment({ id: 'o1' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'ref1', 'ref2');

        expect(result).toContain('### File 1: `src/only.ts`');
        expect(result).toContain('`o1`');
        expect(result).not.toContain('### File 2');
    });

    it('filters to open comments only', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [
                    makeDiffComment({ id: 'open1', status: 'open' }),
                    makeDiffComment({ id: 'resolved1', status: 'resolved' }),
                ],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).toContain('`open1`');
        expect(result).not.toContain('`resolved1`');
    });

    it('returns empty string when no open comments', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment({ id: 'r1', status: 'resolved' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');
        expect(result).toBe('');
    });

    it('includes oldRef/newRef in prompt', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'deadbeef^', 'deadbeef');

        expect(result).toContain('`deadbeef^`');
        expect(result).toContain('`deadbeef`');
        expect(result).toContain('deadbeef^` to `deadbeef`');
    });

    it('does NOT include diff content', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).not.toContain('```diff');
        expect(result).not.toContain('Diff Content');
    });

    it('includes cross-file instruction', () => {
        const entries = [
            {
                filePath: 'src/x.ts',
                comments: [makeDiffComment()],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).toContain('cross-file relationships');
        expect(result).toContain('resolve_comment(commentId, summary)');
    });

    it('skips files with only resolved comments', () => {
        const entries = [
            {
                filePath: 'src/all-resolved.ts',
                comments: [makeDiffComment({ id: 'r1', status: 'resolved' })],
            },
            {
                filePath: 'src/has-open.ts',
                comments: [makeDiffComment({ id: 'o1', status: 'open' })],
            },
        ];
        const result = buildMultiFileBatchResolvePrompt(entries, 'a', 'b');

        expect(result).not.toContain('all-resolved.ts');
        expect(result).toContain('has-open.ts');
        expect(result).toContain('### File 1: `src/has-open.ts`');
    });
});

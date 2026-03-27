import { describe, it, expect } from 'vitest';
import { buildDiffBatchResolvePrompt } from '../../src/server/diff-comments-ai';
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

describe('buildDiffBatchResolvePrompt', () => {
    const diffContent = `--- a/src/app.ts
+++ b/src/app.ts
@@ -8,3 +9,3 @@
-const x = 0;
+const x = 1;
 const y = 2;`;

    it('includes diff content and ref range in prompt', () => {
        const comments = [makeDiffComment()];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'abc123^', 'abc123');

        expect(result).toContain('`src/app.ts`');
        expect(result).toContain('abc123^ → abc123');
        expect(result).toContain('```diff');
        expect(result).toContain(diffContent);
    });

    it('includes all comment fields', () => {
        const comments = [makeDiffComment({
            id: 'c42',
            selectedText: 'const x = 1;',
            comment: 'Should be let',
            author: 'alice',
            tags: ['nit', 'readability'],
            aiResponse: 'Previous AI said something',
            replies: [{ text: 'I agree', author: 'bob', createdAt: '2024-01-01' }],
        })];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'abc123^', 'abc123');

        expect(result).toContain('`c42`');
        expect(result).toContain('"const x = 1;"');
        expect(result).toContain('"Should be let"');
        expect(result).toContain('alice');
        expect(result).toContain('nit, readability');
        expect(result).toContain('Previous AI said something');
        expect(result).toContain('bob: I agree');
    });

    it('only includes open comments', () => {
        const comments = [
            makeDiffComment({ id: 'open1', status: 'open' }),
            makeDiffComment({ id: 'resolved1', status: 'resolved' }),
            makeDiffComment({ id: 'open2', status: 'open' }),
        ];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'a', 'b');

        expect(result).toContain('`open1`');
        expect(result).toContain('`open2`');
        expect(result).not.toContain('`resolved1`');
    });

    it('returns empty string for no open comments', () => {
        const comments = [
            makeDiffComment({ id: 'r1', status: 'resolved' }),
        ];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'a', 'b');
        expect(result).toBe('');
    });

    it('returns empty string for empty array', () => {
        const result = buildDiffBatchResolvePrompt([], diffContent, 'src/app.ts', 'a', 'b');
        expect(result).toBe('');
    });

    it('sorts comments by diffLineStart', () => {
        const comments = [
            makeDiffComment({ id: 'later', selection: { diffLineStart: 50, diffLineEnd: 52, side: 'right', oldLineStart: 0, oldLineEnd: 0, newLineStart: 0, newLineEnd: 0, startColumn: 0, endColumn: 0 } as DiffComment['selection'] }),
            makeDiffComment({ id: 'earlier', selection: { diffLineStart: 5, diffLineEnd: 7, side: 'left', oldLineStart: 0, oldLineEnd: 0, newLineStart: 0, newLineEnd: 0, startColumn: 0, endColumn: 0 } as DiffComment['selection'] }),
        ];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'a', 'b');

        const earlierIdx = result.indexOf('`earlier`');
        const laterIdx = result.indexOf('`later`');
        expect(earlierIdx).toBeLessThan(laterIdx);
    });

    it('includes resolve_comment instruction', () => {
        const comments = [makeDiffComment()];
        const result = buildDiffBatchResolvePrompt(comments, diffContent, 'src/app.ts', 'a', 'b');

        expect(result).toContain('resolve_comment(commentId, summary)');
        expect(result).toContain('Do NOT call `resolve_comment` for comments you cannot address');
    });
});

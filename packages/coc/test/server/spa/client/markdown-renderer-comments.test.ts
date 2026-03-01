/**
 * Tests for comment highlight injection in renderMarkdownToHtml.
 *
 * Verifies that passing `comments` via `RenderOptions` produces
 * `<span class="commented-text" data-comment-id="...">` wrappers
 * at correct positions using line/column coordinates.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml, type RenderCommentInfo } from '../../../../src/server/spa/client/markdown-renderer';

describe('renderMarkdownToHtml — comment highlights', () => {
    // ----------------------------------------------------------------
    // No comments (backward compat)
    // ----------------------------------------------------------------
    describe('no comments', () => {
        it('produces unchanged output when comments option is omitted', () => {
            const md = 'Hello world\nSecond line';
            const withoutOpt = renderMarkdownToHtml(md);
            const withEmptyOpt = renderMarkdownToHtml(md, { comments: [] });
            const withUndefined = renderMarkdownToHtml(md, { comments: undefined });

            expect(withoutOpt).toBe(withEmptyOpt);
            expect(withoutOpt).toBe(withUndefined);
            expect(withoutOpt).not.toContain('commented-text');
            expect(withoutOpt).not.toContain('data-comment-id');
        });
    });

    // ----------------------------------------------------------------
    // Single-line partial highlight
    // ----------------------------------------------------------------
    describe('single-line partial highlight', () => {
        it('wraps the correct substring based on column coordinates', () => {
            // "Hello world" — highlight "world" (columns 7-11, 1-based)
            const md = 'Hello world';
            const comments: RenderCommentInfo[] = [{
                id: 'c1',
                selection: { startLine: 1, startColumn: 7, endLine: 1, endColumn: 12 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="c1"');
            expect(html).toContain('commented-text');
            // The highlighted span should contain the word "world"
            expect(html).toMatch(/<span class="commented-text" data-comment-id="c1">.*world.*<\/span>/);
        });

        it('wraps text at the start of a line', () => {
            const md = 'Hello world';
            const comments: RenderCommentInfo[] = [{
                id: 'c-start',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="c-start"');
            expect(html).toContain('commented-text');
        });
    });

    // ----------------------------------------------------------------
    // Multi-line comment
    // ----------------------------------------------------------------
    describe('multi-line comment', () => {
        it('highlights all covered lines of a multi-line comment', () => {
            const md = 'Line one\nLine two\nLine three';
            const comments: RenderCommentInfo[] = [{
                id: 'multi',
                selection: { startLine: 1, startColumn: 6, endLine: 2, endColumn: 9 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });

            // Both line 1 and line 2 should have highlight spans
            const matches = html.match(/data-comment-id="multi"/g);
            expect(matches).not.toBeNull();
            expect(matches!.length).toBe(2);

            // Line 3 should NOT have a highlight
            const line3Match = html.match(/data-line="3"[^>]*>.*data-comment-id="multi"/);
            expect(line3Match).toBeNull();
        });
    });

    // ----------------------------------------------------------------
    // Overlapping comments (non-overlapping columns)
    // ----------------------------------------------------------------
    describe('overlapping comments on same line', () => {
        it('produces separate spans for two non-overlapping comments on the same line', () => {
            // "Hello beautiful world" — two comments, different ranges
            const md = 'Hello beautiful world';
            const comments: RenderCommentInfo[] = [
                {
                    id: 'c-hello',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
                    status: 'open',
                },
                {
                    id: 'c-world',
                    selection: { startLine: 1, startColumn: 17, endLine: 1, endColumn: 22 },
                    status: 'open',
                },
            ];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="c-hello"');
            expect(html).toContain('data-comment-id="c-world"');
        });
    });

    // ----------------------------------------------------------------
    // Resolved comment styling
    // ----------------------------------------------------------------
    describe('resolved comment styling', () => {
        it('adds "resolved" class to a resolved comment span', () => {
            const md = 'Some text here';
            const comments: RenderCommentInfo[] = [{
                id: 'resolved-1',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                status: 'resolved',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('commented-text resolved');
            expect(html).toContain('data-comment-id="resolved-1"');
        });

        it('does not add "resolved" class to an open comment', () => {
            const md = 'Some text here';
            const comments: RenderCommentInfo[] = [{
                id: 'open-1',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).not.toContain('commented-text resolved');
            expect(html).toContain('class="commented-text"');
        });
    });

    // ----------------------------------------------------------------
    // Frontmatter-stripped content alignment
    // ----------------------------------------------------------------
    describe('frontmatter-stripped content', () => {
        it('aligns line numbers correctly after frontmatter stripping', () => {
            const md = '---\ntitle: Test\nstatus: pending\n---\n\n# Heading\n\nBody text here';
            // After stripping, "# Heading" is on rendered line 1, "Body text here" is on line 3
            // But the comments should reference lines in the *stripped* content.
            // The renderer strips frontmatter first, then processes the remaining text.
            // So line 1 after strip = "# Heading" (with possible leading blank), etc.
            const stripped = md.replace(/^---\n[\s\S]*?\n---\n*/, '');
            const strippedLines = stripped.split('\n');

            // Find which line "Body text here" is on in the stripped content
            const bodyLineIdx = strippedLines.findIndex(l => l === 'Body text here');
            const bodyLineNum = bodyLineIdx + 1; // 1-based

            const comments: RenderCommentInfo[] = [{
                id: 'body-comment',
                selection: {
                    startLine: bodyLineNum,
                    startColumn: 1,
                    endLine: bodyLineNum,
                    endColumn: 15,
                },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments, stripFrontmatter: true });
            expect(html).toContain('data-comment-id="body-comment"');
            expect(html).not.toContain('title: Test');
        });
    });

    // ----------------------------------------------------------------
    // Comment on markdown-formatted line
    // ----------------------------------------------------------------
    describe('comment on formatted text', () => {
        it('injects highlight into a line with bold formatting', () => {
            const md = 'This is **bold** text';
            // Highlight "bold" — columns 11-14 in the plain text
            const comments: RenderCommentInfo[] = [{
                id: 'fmt-comment',
                selection: { startLine: 1, startColumn: 11, endLine: 1, endColumn: 15 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="fmt-comment"');
            expect(html).toContain('commented-text');
        });

        it('injects highlight into a heading line', () => {
            const md = '# My Heading';
            // Highlight "Heading" (columns 6-12 of plain text "# My Heading")
            const comments: RenderCommentInfo[] = [{
                id: 'heading-comment',
                selection: { startLine: 1, startColumn: 6, endLine: 1, endColumn: 13 },
                status: 'open',
            }];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="heading-comment"');
        });
    });

    // ----------------------------------------------------------------
    // Comments on lines outside structural blocks are NOT applied
    // ----------------------------------------------------------------
    describe('comments on structural block lines', () => {
        it('does not crash when a comment targets a code block line', () => {
            const md = '```js\nconst x = 1;\n```';
            const comments: RenderCommentInfo[] = [{
                id: 'code-comment',
                selection: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 13 },
                status: 'open',
            }];

            // Should not throw; code block lines are skipped in line-by-line loop
            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('code-block');
            // The highlight won't appear because code blocks use renderCodeBlock
            // This is expected behavior (deferred to follow-up)
        });
    });

    // ----------------------------------------------------------------
    // Multiple comments on different lines
    // ----------------------------------------------------------------
    describe('multiple comments on different lines', () => {
        it('highlights each comment on its respective line', () => {
            const md = 'First line\nSecond line\nThird line';
            const comments: RenderCommentInfo[] = [
                {
                    id: 'c-first',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
                    status: 'open',
                },
                {
                    id: 'c-third',
                    selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 6 },
                    status: 'resolved',
                },
            ];

            const html = renderMarkdownToHtml(md, { comments });
            expect(html).toContain('data-comment-id="c-first"');
            expect(html).toContain('data-comment-id="c-third"');
            // c-first should be open (no resolved class)
            expect(html).toMatch(/class="commented-text"[^>]*data-comment-id="c-first"/);
            // c-third should be resolved
            expect(html).toMatch(/class="commented-text resolved"[^>]*data-comment-id="c-third"/);
        });
    });
});

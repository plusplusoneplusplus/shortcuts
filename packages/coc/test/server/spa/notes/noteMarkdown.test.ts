import { describe, it, expect } from 'vitest';
import {
    htmlToMarkdown,
    htmlToMarkdownWithComments,
} from '../../../../src/server/spa/client/react/repos/notes/noteMarkdown';
import type { ExportCommentThread } from '../../../../src/server/spa/client/react/repos/notes/noteMarkdown';

describe('htmlToMarkdownWithComments', () => {
    it('returns same output as htmlToMarkdown when no threads', () => {
        const html = '<p>Hello world</p>';
        expect(htmlToMarkdownWithComments(html, {})).toBe(htmlToMarkdown(html));
    });

    it('appends open threads as Comments section', () => {
        const html = '<p>Hello</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1',
                status: 'open',
                anchor: { quotedText: 'Hello' },
                comments: [
                    { author: 'Alice', content: 'Needs revision', createdAt: '2025-01-01' },
                ],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('## Comments');
        expect(result).toContain('> **On:** "Hello"');
        expect(result).toContain('> Needs revision');
    });

    it('appends resolved threads under Resolved heading with strikethrough', () => {
        const html = '<p>Done</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1',
                status: 'resolved',
                anchor: { quotedText: 'Done' },
                comments: [
                    { author: 'Bob', content: 'LGTM', createdAt: '2025-01-01' },
                ],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('### Resolved');
        expect(result).toContain('> ~~"Done"~~');
    });

    it('renders both open and resolved sections', () => {
        const html = '<p>Mixed</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1', status: 'open',
                anchor: { quotedText: 'open-text' },
                comments: [{ author: 'A', content: 'open comment', createdAt: '' }],
            },
            t2: {
                id: 't2', status: 'resolved',
                anchor: { quotedText: 'resolved-text' },
                comments: [{ author: 'B', content: 'resolved comment', createdAt: '' }],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('## Comments');
        expect(result).toContain('### Resolved');
        const commentsIdx = result.indexOf('## Comments');
        const resolvedIdx = result.indexOf('### Resolved');
        expect(commentsIdx).toBeLessThan(resolvedIdx);
    });
});

describe('htmlToMarkdown — comment span stripping', () => {
    it('strips data-comment-id spans and preserves inner text', () => {
        const html = '<p>Hello <span data-comment-id="c1">world</span>!</p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('Hello world!');
        expect(md).not.toContain('data-comment-id');
        expect(md).not.toContain('<span');
    });
});

import { describe, it, expect } from 'vitest';
import {
    htmlToMarkdown,
    htmlToMarkdownWithComments,
    markdownToHtml,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import type { ExportCommentThread } from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

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

describe('note cross-links — markdownToHtml', () => {
    it('converts [[note:path]] to a note-link span', () => {
        const html = markdownToHtml('See [[note:My Notebook/Notes.md]]');
        expect(html).toContain('class="note-link"');
        expect(html).toContain('data-note-path="My Notebook/Notes.md"');
        expect(html).toContain('>Notes<');
    });

    it('converts [[note:path#heading]] to a note-link span with heading', () => {
        const html = markdownToHtml('See [[note:Features/Page.md#my-heading]]');
        expect(html).toContain('data-note-path="Features/Page.md"');
        expect(html).toContain('data-note-heading="my-heading"');
        expect(html).toContain('>Page § my-heading<');
    });

    it('converts [[label|note:path]] with a custom label', () => {
        const html = markdownToHtml('See [[My Custom Label|note:Features/Page.md]]');
        expect(html).toContain('data-note-path="Features/Page.md"');
        expect(html).toContain('>My Custom Label<');
    });

    it('handles multiple note links in one line', () => {
        const html = markdownToHtml('Link [[note:A.md]] and [[note:B.md]] here');
        const matches = html.match(/class="note-link"/g);
        expect(matches).toHaveLength(2);
    });

    it('handles note link inside a paragraph alongside other content', () => {
        const html = markdownToHtml('Before **bold** [[note:File.md]] after');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('class="note-link"');
    });
});

describe('note cross-links — htmlToMarkdown', () => {
    it('converts note-link span back to [[note:path]]', () => {
        const html = '<p>See <span class="note-link" data-note-path="My Notebook/Notes.md">Notes</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('[[note:My Notebook/Notes.md]]');
        expect(md).not.toContain('<span');
    });

    it('converts note-link span with heading back to [[note:path#heading]]', () => {
        const html = '<p><span class="note-link" data-note-path="Page.md" data-note-heading="intro">Page § intro</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('[[note:Page.md#intro]]');
    });

    it('preserves note-link without heading (no trailing #)', () => {
        const html = '<p><span class="note-link" data-note-path="File.md">File</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toBe('[[note:File.md]]\n');
        expect(md).not.toContain('#');
    });
});

describe('note cross-links — round-trip', () => {
    it('round-trips [[note:path]]', () => {
        const original = 'See [[note:My Notebook/Notes.md]] for details';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips [[note:path#heading]]', () => {
        const original = 'Check [[note:Features/Page.md#setup]]';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips multiple note links in mixed content', () => {
        const original = 'First [[note:A.md]] and second [[note:B.md#intro]] done';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });
});

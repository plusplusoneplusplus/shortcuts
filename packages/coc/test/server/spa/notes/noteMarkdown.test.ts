import { describe, it, expect } from 'vitest';
import {
    htmlToMarkdown,
    htmlToMarkdownWithComments,
    markdownToHtml,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import type { ExportCommentThread } from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    NOTE_LINK_PASTE_RE,
    noteLinkLabel,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteLinkExtension';

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

describe('noteLinkLabel', () => {
    it('strips .md and returns basename', () => {
        expect(noteLinkLabel('My Notebook/Notes.md')).toBe('Notes');
    });

    it('returns basename without extension for simple path', () => {
        expect(noteLinkLabel('File.md')).toBe('File');
    });

    it('appends heading with § separator', () => {
        expect(noteLinkLabel('Page.md', 'intro')).toBe('Page § intro');
    });

    it('returns path as-is when no slash and no .md', () => {
        expect(noteLinkLabel('readme')).toBe('readme');
    });

    it('ignores null heading', () => {
        expect(noteLinkLabel('File.md', null)).toBe('File');
    });
});

describe('NOTE_LINK_PASTE_RE — paste regex regression', () => {
    function allMatches(text: string) {
        const re = new RegExp(NOTE_LINK_PASTE_RE.source, NOTE_LINK_PASTE_RE.flags);
        const results: Array<{ full: string; path: string; heading?: string }> = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            results.push({ full: m[0], path: m[1], heading: m[2] || undefined });
        }
        return results;
    }

    it('matches [[note:path]]', () => {
        const matches = allMatches('See [[note:My Notebook/Notes.md]] here');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('My Notebook/Notes.md');
        expect(matches[0].heading).toBeUndefined();
    });

    it('matches [[note:path#heading]]', () => {
        const matches = allMatches('See [[note:Page.md#setup]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('Page.md');
        expect(matches[0].heading).toBe('setup');
    });

    it('matches [[label|note:path]]', () => {
        const matches = allMatches('[[Custom Label|note:Features/Page.md]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('Features/Page.md');
    });

    it('matches multiple links in one text', () => {
        const matches = allMatches('Link [[note:A.md]] and [[note:B.md#heading]] done');
        expect(matches).toHaveLength(2);
        expect(matches[0].path).toBe('A.md');
        expect(matches[1].path).toBe('B.md');
        expect(matches[1].heading).toBe('heading');
    });

    it('does not match plain brackets without note: prefix', () => {
        const matches = allMatches('See [[some text]] here');
        expect(matches).toHaveLength(0);
    });

    it('does not match incomplete syntax [[note:', () => {
        const matches = allMatches('See [[note:unclosed here');
        expect(matches).toHaveLength(0);
    });

    it('matches path with spaces', () => {
        const matches = allMatches('[[note:New Features/My Notes.md]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('New Features/My Notes.md');
    });

    it('matches heading with hyphens', () => {
        const matches = allMatches('[[note:Page.md#my-long-heading]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].heading).toBe('my-long-heading');
    });
});

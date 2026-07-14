import { describe, it, expect } from 'vitest';
import {
    buildImageMarkdown,
    insertTextAtSelection,
    markdownToRichEditorHtml,
    richEditorHtmlToMarkdown,
    parseNoteFrontMatter,
} from '../../../../src/server/spa/client/react/shared/markdown-document/markdownRichConversion';
import type { MarkdownDocumentIO } from '../../../../src/server/spa/client/react/shared/markdown-document/MarkdownDocumentIO';

// Deterministic I/O stub — only the URL builders are exercised by conversion.
const io: MarkdownDocumentIO = {
    loadContent: async () => ({ content: '', path: '', mtime: 0 }),
    saveContent: async () => ({ path: '', updated: true, mtime: 0 }),
    uploadImage: async () => ({ path: '' }),
    imageApiUrl: (wsId, relPath, root) =>
        `/api/ws/${wsId}/image?path=${encodeURIComponent(relPath)}${root ? `&root=${encodeURIComponent(root)}` : ''}`,
    localImageApiUrl: (wsId, absPath) =>
        `/api/ws/${wsId}/local?path=${encodeURIComponent(absPath)}`,
};

describe('markdownToRichEditorHtml', () => {
    it('returns the full markdown as the body when there is no front matter', () => {
        const markdown = '# Title\n\nHello world';
        const result = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1' });
        expect(result.frontMatter.kind).toBe('none');
        expect(result.body).toBe(markdown);
        expect(result.html).toContain('Hello world');
    });

    it('strips valid front matter and converts only the body', () => {
        const markdown = '---\ntitle: My Note\nstatus: done\n---\n\n# Body Heading\n\nBody text';
        const result = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1' });
        expect(result.frontMatter.kind).toBe('valid');
        expect(result.body).toBe('# Body Heading\n\nBody text');
        expect(result.html).toContain('Body Heading');
        expect(result.html).not.toContain('title:');
    });

    it('falls back to the full markdown when front matter is invalid', () => {
        const markdown = '---\nfoo: [1, 2\n---\n\nBody text';
        const result = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1' });
        expect(result.frontMatter.kind).toBe('invalid');
        expect(result.body).toBe(markdown);
    });

    it('rewrites relative .attachments image URLs through io.imageApiUrl', () => {
        const markdown = '![alt](.attachments/pic.png)';
        const result = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1', root: 'notes' });
        expect(result.html).toContain(io.imageApiUrl('ws1', '.attachments/pic.png', 'notes'));
    });

    it('rewrites absolute local image URLs through io.localImageApiUrl', () => {
        const markdown = '![chart](/home/user/chart.png)';
        const result = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1' });
        expect(result.html).toContain(io.localImageApiUrl('ws1', '/home/user/chart.png'));
    });
});

describe('richEditorHtmlToMarkdown', () => {
    it('serializes plain HTML with no front matter', () => {
        const result = richEditorHtmlToMarkdown({
            html: '<p>Hello world</p>',
            frontMatter: { kind: 'none' },
        });
        expect(result).toBe('Hello world\n');
    });

    it('re-attaches the original front matter block ahead of the edited body', () => {
        const parsed = parseNoteFrontMatter('---\ntitle: X\n---\n\nold body');
        expect(parsed.kind).toBe('valid');
        const result = richEditorHtmlToMarkdown({ html: '<p>new body</p>', frontMatter: parsed });
        expect(result.startsWith('---')).toBe(true);
        expect(result).toContain('title: X');
        expect(result).toContain('new body');
    });

    it('rewrites API image URLs back to their relative source form', () => {
        const html = '<p><img src="/api/workspaces/ws1/notes/image?path=.attachments%2Fpic.png" alt="a"></p>';
        const result = richEditorHtmlToMarkdown({ html, frontMatter: { kind: 'none' } });
        expect(result).toContain('![a](.attachments/pic.png)');
    });

    it('round-trips a document with front matter without losing metadata', () => {
        const markdown = '---\ntitle: T\n---\n\nHello';
        const { html, frontMatter, body } = markdownToRichEditorHtml({ markdown, io, workspaceId: 'ws1' });
        expect(body).toBe('Hello');
        const saved = richEditorHtmlToMarkdown({ html, frontMatter });
        expect(saved.startsWith('---')).toBe(true);
        expect(saved).toContain('title: T');
        expect(saved).toContain('Hello');
    });
});

describe('buildImageMarkdown', () => {
    it('builds a markdown image tag from a filename and path', () => {
        expect(buildImageMarkdown('pic.png', '.attachments/x.png')).toBe('![pic.png](.attachments/x.png)');
    });

    it('tolerates an empty filename (blank alt text)', () => {
        expect(buildImageMarkdown('', '.attachments/x.png')).toBe('![](.attachments/x.png)');
    });
});

describe('insertTextAtSelection', () => {
    it('replaces the selected range', () => {
        expect(insertTextAtSelection('abcdef', 2, 4, 'XY')).toBe('abXYef');
    });

    it('inserts at the caret when start equals end', () => {
        expect(insertTextAtSelection('abc', 3, 3, 'Z')).toBe('abcZ');
    });

    it('inserts at the start of the document', () => {
        expect(insertTextAtSelection('abc', 0, 0, 'Z')).toBe('Zabc');
    });
});

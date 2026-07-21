/**
 * Tests for image URL rewriting functions in noteMarkdown.
 */

import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
    rewriteImageSrcToApi,
    rewriteImageSrcToRelative,
} from '../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

describe('Image URL rewriting', () => {
    // ========================================================================
    // rewriteImageSrcToApi
    // ========================================================================

    describe('rewriteImageSrcToApi', () => {
        it('should rewrite .attachments/ src to API URL', () => {
            const html = '<p>Hello</p><img src=".attachments/abc-123.png" alt="screenshot">';
            const result = rewriteImageSrcToApi(html, 'my-ws');
            expect(result).toContain(
                'src="/api/workspaces/my-ws/notes/image?path=.attachments%2Fabc-123.png"'
            );
            expect(result).toContain('alt="screenshot"');
        });

        it('should handle multiple images', () => {
            const html = '<img src=".attachments/a.png"><p>text</p><img src=".attachments/b.jpg">';
            const result = rewriteImageSrcToApi(html, 'ws-1');
            expect(result).toContain('path=.attachments%2Fa.png');
            expect(result).toContain('path=.attachments%2Fb.jpg');
        });

        it('should not rewrite external image URLs', () => {
            const html = '<img src="https://example.com/photo.png">';
            const result = rewriteImageSrcToApi(html, 'ws-1');
            expect(result).toBe(html);
        });

        it('should not rewrite non-attachment relative paths', () => {
            const html = '<img src="images/photo.png">';
            const result = rewriteImageSrcToApi(html, 'ws-1');
            expect(result).toBe(html);
        });

        it('should handle empty HTML', () => {
            expect(rewriteImageSrcToApi('', 'ws-1')).toBe('');
        });

        it('should encode workspace IDs with special characters', () => {
            const html = '<img src=".attachments/test.png">';
            const result = rewriteImageSrcToApi(html, 'ws/special');
            expect(result).toContain('/api/workspaces/ws%2Fspecial/notes/image');
        });
    });

    // ========================================================================
    // rewriteImageSrcToRelative
    // ========================================================================

    describe('rewriteImageSrcToRelative', () => {
        it('should rewrite API URLs back to relative paths', () => {
            const md = '![screenshot](/api/workspaces/my-ws/notes/image?path=.attachments%2Fabc-123.png)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![screenshot](.attachments/abc-123.png)');
        });

        it('should handle multiple image references', () => {
            const md = '![a](/api/workspaces/ws/notes/image?path=.attachments%2Fa.png)\n\n![b](/api/workspaces/ws/notes/image?path=.attachments%2Fb.jpg)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toContain('![a](.attachments/a.png)');
            expect(result).toContain('![b](.attachments/b.jpg)');
        });

        it('should not modify external URLs', () => {
            const md = '![photo](https://example.com/photo.png)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe(md);
        });

        it('should handle empty string', () => {
            expect(rewriteImageSrcToRelative('')).toBe('');
        });

        it('should handle empty alt text', () => {
            const md = '![](/api/workspaces/ws/notes/image?path=.attachments%2Ftest.png)';
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![](.attachments/test.png)');
        });
    });

    // ========================================================================
    // rewriteImageSrcToApi — absolute paths
    // ========================================================================

    describe('rewriteImageSrcToApi — absolute paths', () => {
        it('should rewrite Windows absolute path to local-image API URL', () => {
            const html = '<img src="C:\\src\\repo\\chart.png" alt="chart">';
            const result = rewriteImageSrcToApi(html, 'my-ws');
            expect(result).toContain('/api/workspaces/my-ws/notes/local-image?path=');
            expect(result).toContain(encodeURIComponent('C:\\src\\repo\\chart.png'));
            expect(result).toContain('alt="chart"');
        });

        it('should rewrite Windows forward-slash path', () => {
            const html = '<img src="C:/src/repo/chart.png">';
            const result = rewriteImageSrcToApi(html, 'ws-1');
            expect(result).toContain('/api/workspaces/ws-1/notes/local-image?path=');
            expect(result).toContain(encodeURIComponent('C:/src/repo/chart.png'));
        });

        it('should rewrite Unix absolute path to local-image API URL', () => {
            const html = '<img src="/home/user/repo/chart.png">';
            const result = rewriteImageSrcToApi(html, 'ws-1');
            expect(result).toContain('/api/workspaces/ws-1/notes/local-image?path=');
            expect(result).toContain(encodeURIComponent('/home/user/repo/chart.png'));
        });

        it('should not double-rewrite /api/ paths', () => {
            const html = '<img src="/api/workspaces/ws/notes/image?path=.attachments%2Ftest.png">';
            const result = rewriteImageSrcToApi(html, 'ws');
            // Should remain unchanged — /api/ prefix guard prevents double-rewrite
            expect(result).toBe(html);
        });

        it('should handle mixed .attachments and absolute paths', () => {
            const html = '<img src=".attachments/a.png"><img src="C:\\repo\\b.png">';
            const result = rewriteImageSrcToApi(html, 'ws');
            expect(result).toContain('/notes/image?path=');
            expect(result).toContain('/notes/local-image?path=');
        });

        it('should still pass through external URLs unchanged', () => {
            const html = '<img src="https://example.com/photo.png">';
            const result = rewriteImageSrcToApi(html, 'ws');
            expect(result).toBe(html);
        });
    });

    // ========================================================================
    // rewriteImageSrcToRelative — local-image URLs
    // ========================================================================

    describe('rewriteImageSrcToRelative — local-image URLs', () => {
        it('should rewrite local-image API URL back to Windows absolute path', () => {
            const md = `![chart](/api/workspaces/ws/notes/local-image?path=${encodeURIComponent('C:\\src\\repo\\chart.png')})`;
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![chart](C:\\src\\repo\\chart.png)');
        });

        it('should rewrite local-image API URL back to Unix absolute path', () => {
            const md = `![chart](/api/workspaces/ws/notes/local-image?path=${encodeURIComponent('/home/user/chart.png')})`;
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![chart](/home/user/chart.png)');
        });

        it('should rewrite local-image HTML img tags back to absolute paths', () => {
            const md = `<img src="/api/workspaces/ws/notes/local-image?path=${encodeURIComponent('C:\\repo\\img.png')}" width="300" />`;
            const result = rewriteImageSrcToRelative(md);
            expect(result).toContain('src="C:\\repo\\img.png"');
            expect(result).toContain('width="300"');
        });

        it('should handle mixed .attachments and local-image URLs', () => {
            const md = [
                '![a](/api/workspaces/ws/notes/image?path=.attachments%2Fa.png)',
                `![b](/api/workspaces/ws/notes/local-image?path=${encodeURIComponent('C:\\repo\\b.png')})`,
            ].join('\n');
            const result = rewriteImageSrcToRelative(md);
            expect(result).toContain('![a](.attachments/a.png)');
            expect(result).toContain('![b](C:\\repo\\b.png)');
        });

        it('should handle empty alt text for local-image', () => {
            const md = `![](/api/workspaces/ws/notes/local-image?path=${encodeURIComponent('/opt/img.png')})`;
            const result = rewriteImageSrcToRelative(md);
            expect(result).toBe('![](/opt/img.png)');
        });
    });

    // ========================================================================
    // Markdown round-trip with absolute-path images
    // ========================================================================

    describe('Markdown round-trip with absolute-path images', () => {
        it('should round-trip a Windows absolute path through HTML conversion', () => {
            const originalMd = 'Text\n\n![chart](C:\\src\\repo\\chart.png)\n\nMore text\n';

            const html = markdownToHtml(originalMd);
            expect(html).toContain('<img');

            const rewrittenHtml = rewriteImageSrcToApi(html, 'test-ws');
            expect(rewrittenHtml).toContain('/api/workspaces/test-ws/notes/local-image');

            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('![chart](C:\\src\\repo\\chart.png)');
            expect(savedMd).toContain('Text');
            expect(savedMd).toContain('More text');
        });

        it('should round-trip a Unix absolute path through HTML conversion', () => {
            const originalMd = '![img](/home/user/photo.png)\n';

            const html = markdownToHtml(originalMd);
            const rewrittenHtml = rewriteImageSrcToApi(html, 'ws');
            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('![img](/home/user/photo.png)');
        });

        it('should round-trip mixed .attachments and absolute paths', () => {
            const originalMd = '![a](.attachments/a.png)\n\n![b](C:\\repo\\b.png)\n';

            const html = markdownToHtml(originalMd);
            const rewrittenHtml = rewriteImageSrcToApi(html, 'ws');
            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('![a](.attachments/a.png)');
            expect(savedMd).toContain('![b](C:\\repo\\b.png)');
        });
    });

    // ========================================================================
    // Markdown round-trip with PDF embeds
    // ========================================================================

    describe('Markdown round-trip with PDF embeds', () => {
        it('should round-trip a .pdf attachment through HTML conversion', () => {
            const originalMd = 'Doc\n\n![Sample PDF](.attachments/sample.pdf)\n\nMore\n';

            const html = markdownToHtml(originalMd);
            expect(html).toContain('class="md-pdf-embed"');
            expect(html).toContain('data-pdf-url=".attachments/sample.pdf"');

            const rewrittenHtml = rewriteImageSrcToApi(html, 'test-ws');
            expect(rewrittenHtml).toContain('data-pdf-url="/api/workspaces/test-ws/notes/image?path=');

            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('![Sample PDF](.attachments/sample.pdf)');
            expect(savedMd).toContain('Doc');
            expect(savedMd).toContain('More');
        });
    });
});

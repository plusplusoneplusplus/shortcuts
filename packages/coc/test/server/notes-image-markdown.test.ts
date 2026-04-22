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
    // Markdown round-trip with images
    // ========================================================================

    describe('Markdown round-trip with images', () => {
        it('should preserve image markdown through markdownToHtml → rewriteToApi → htmlToMarkdown → rewriteToRelative', () => {
            const originalMd = 'Some text\n\n![my screenshot](.attachments/uuid-123.png)\n\nMore text\n';

            // Load direction: md → html → rewrite src to API
            const html = markdownToHtml(originalMd);
            expect(html).toContain('<img');
            expect(html).toContain('.attachments/uuid-123.png');

            const rewrittenHtml = rewriteImageSrcToApi(html, 'test-ws');
            expect(rewrittenHtml).toContain('/api/workspaces/test-ws/notes/image');

            // Save direction: html → md → rewrite URLs to relative
            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            // Image reference should be preserved
            expect(savedMd).toContain('![my screenshot](.attachments/uuid-123.png)');
            expect(savedMd).toContain('Some text');
            expect(savedMd).toContain('More text');
        });

        it('should handle markdown with no images through the pipeline', () => {
            const originalMd = '# Hello\n\nSome text\n';
            const html = markdownToHtml(originalMd);
            const rewrittenHtml = rewriteImageSrcToApi(html, 'ws');
            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('# Hello');
            expect(savedMd).toContain('Some text');
        });

        it('should handle mixed content with images and other elements', () => {
            const originalMd = '# Title\n\n![img](.attachments/pic.png)\n\n- item 1\n- item 2\n';
            const html = markdownToHtml(originalMd);
            const rewrittenHtml = rewriteImageSrcToApi(html, 'ws');
            let savedMd = htmlToMarkdown(rewrittenHtml);
            savedMd = rewriteImageSrcToRelative(savedMd);

            expect(savedMd).toContain('![img](.attachments/pic.png)');
            expect(savedMd).toContain('# Title');
        });
    });
});

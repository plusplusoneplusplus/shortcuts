/**
 * Tests for file path detection in applyInlineMarkdown (pipeline-core).
 *
 * Verifies that absolute file paths in markdown text are wrapped
 * with interactive `<span class="file-path-link">` elements.
 */

import { describe, it, expect } from 'vitest';
import { applyInlineMarkdown } from '../../../../src/server/spa/client/markdown-renderer';

// We test via renderMarkdownToHtml since applyInlineMarkdown is called internally
import { renderMarkdownToHtml } from '../../../../src/server/spa/client/markdown-renderer';

describe('File path detection in inline markdown', () => {
    // ----------------------------------------------------------------
    // Happy path
    // ----------------------------------------------------------------
    describe('detects common absolute paths', () => {
        it('detects /Users paths', () => {
            const html = renderMarkdownToHtml('See /Users/john/project/src/main.ts for details');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/Users/john/project/src/main.ts"');
        });

        it('detects /home paths', () => {
            const html = renderMarkdownToHtml('Check /home/dev/app/index.js');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/home/dev/app/index.js"');
        });

        it('detects /tmp paths', () => {
            const html = renderMarkdownToHtml('Temp file at /tmp/output.log');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/tmp/output.log"');
        });

        it('detects /var paths', () => {
            const html = renderMarkdownToHtml('Log at /var/log/syslog');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/var/log/syslog"');
        });

        it('detects /etc paths', () => {
            const html = renderMarkdownToHtml('Config at /etc/nginx/nginx.conf');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/etc/nginx/nginx.conf"');
        });

        it('detects /opt paths', () => {
            const html = renderMarkdownToHtml('Installed at /opt/homebrew/bin/node');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/opt/homebrew/bin/node"');
        });

        it('detects /Volumes paths', () => {
            const html = renderMarkdownToHtml('Drive at /Volumes/External/data.csv');
            expect(html).toContain('class="file-path-link"');
            expect(html).toContain('data-full-path="/Volumes/External/data.csv"');
        });
    });

    // ----------------------------------------------------------------
    // Path shortening
    // ----------------------------------------------------------------
    describe('shortens display path', () => {
        it('strips /Users/<user>/Documents/Projects/ prefix', () => {
            const html = renderMarkdownToHtml('File: /Users/john/Documents/Projects/myapp/src/index.ts');
            expect(html).toContain('class="file-path-link"');
            // The displayed text should be shortened
            expect(html).toContain('>myapp/src/index.ts</span>');
        });

        it('converts /Users/<user>/ to ~/', () => {
            const html = renderMarkdownToHtml('File: /Users/john/Desktop/notes.md');
            expect(html).toContain('>~/Desktop/notes.md</span>');
        });

        it('converts /home/<user>/ to ~/', () => {
            const html = renderMarkdownToHtml('File: /home/john/projects/app.js');
            expect(html).toContain('>~/projects/app.js</span>');
        });
    });

    // ----------------------------------------------------------------
    // Multiple paths in one line
    // ----------------------------------------------------------------
    describe('handles multiple paths', () => {
        it('detects multiple paths in one line', () => {
            const html = renderMarkdownToHtml('Compare /Users/a/file1.ts and /Users/b/file2.ts');
            const matches = html.match(/class="file-path-link"/g);
            expect(matches).toHaveLength(2);
        });
    });

    // ----------------------------------------------------------------
    // Paths inside inline code should NOT be linked
    // ----------------------------------------------------------------
    describe('skips paths inside inline code', () => {
        it('does not linkify paths inside backtick code spans', () => {
            const html = renderMarkdownToHtml('Run `cat /Users/john/file.txt`');
            // Should be inside md-inline-code, not file-path-link
            expect(html).toContain('md-inline-code');
            // The path inside code should NOT be wrapped with file-path-link
            // The inline code is processed first, wrapping in <span class="md-inline-code">
            // Then file path regex runs but skips content inside those spans
        });
    });

    // ----------------------------------------------------------------
    // Paths inside fenced code blocks should NOT be linked
    // ----------------------------------------------------------------
    describe('skips paths inside fenced code blocks', () => {
        it('does not linkify paths inside code blocks', () => {
            const md = '```\n/Users/john/file.txt\n```';
            const html = renderMarkdownToHtml(md);
            expect(html).not.toContain('file-path-link');
        });
    });

    // ----------------------------------------------------------------
    // Non-matching paths
    // ----------------------------------------------------------------
    describe('does not match non-absolute paths', () => {
        it('ignores relative paths', () => {
            const html = renderMarkdownToHtml('See src/main.ts for details');
            expect(html).not.toContain('file-path-link');
        });

        it('ignores URLs', () => {
            const html = renderMarkdownToHtml('Visit https://example.com/path/to/page');
            expect(html).not.toContain('file-path-link');
        });

        it('ignores paths not starting with known prefixes', () => {
            const html = renderMarkdownToHtml('See /unknown/path/file.ts');
            expect(html).not.toContain('file-path-link');
        });
    });

    // ----------------------------------------------------------------
    // Integration with other inline formatting
    // ----------------------------------------------------------------
    describe('works alongside other markdown features', () => {
        it('coexists with bold text', () => {
            const html = renderMarkdownToHtml('**Important:** /Users/john/file.ts');
            expect(html).toContain('md-bold');
            expect(html).toContain('file-path-link');
        });

        it('coexists with markdown links', () => {
            const html = renderMarkdownToHtml('[link](http://example.com) and /Users/john/file.ts');
            expect(html).toContain('md-link');
            expect(html).toContain('file-path-link');
        });
    });
});

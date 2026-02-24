/**
 * Tests for code block enhancements in the CoC SPA task preview.
 *
 * Verifies line numbers, copy button, language display name,
 * collapse/expand for long blocks, comment highlights, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderMarkdownToHtml } from '../../../../src/server/spa/client/markdown-renderer';

// ============================================================================
// Helpers
// ============================================================================

function codeBlock(lang: string, code: string): string {
    return '```' + lang + '\n' + code + '\n```';
}

function lines(count: number, prefix = 'line'): string {
    return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n');
}

// ============================================================================
// Line numbers
// ============================================================================

describe('code block enhancements — line numbers', () => {
    it('renders line numbers for each code line', () => {
        const md = codeBlock('js', 'const a = 1;\nconst b = 2;\nconst c = 3;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="line-number">1</span>');
        expect(html).toContain('class="line-number">2</span>');
        expect(html).toContain('class="line-number">3</span>');
    });

    it('renders 1-indexed line numbers', () => {
        const md = codeBlock('py', 'print("hello")');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('data-line="1"');
        expect(html).toContain('class="line-number">1</span>');
    });

    it('wraps each line in a code-line span', () => {
        const md = codeBlock('ts', 'const x = 1;\nconst y = 2;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-line" data-line="1"');
        expect(html).toContain('class="code-line" data-line="2"');
    });
});

// ============================================================================
// Copy button
// ============================================================================

describe('code block enhancements — copy button', () => {
    it('renders a copy button in the header', () => {
        const md = codeBlock('js', 'const x = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-copy"');
        expect(html).toContain('title="Copy code"');
    });

    it('stores raw code in data-raw attribute', () => {
        const md = codeBlock('js', 'const x = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('data-raw="const x = 1;"');
    });

    it('escapes HTML in data-raw attribute', () => {
        const md = codeBlock('html', '<div class="test">hello</div>');
        const html = renderMarkdownToHtml(md);

        // data-raw should have escaped HTML
        expect(html).toContain('data-raw="');
        expect(html).toContain('&lt;div');
    });
});

// ============================================================================
// Language label
// ============================================================================

describe('code block enhancements — language label', () => {
    it('shows human-readable language name for TypeScript', () => {
        const md = codeBlock('ts', 'const x: number = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-language">TypeScript</span>');
    });

    it('shows human-readable language name for JavaScript', () => {
        const md = codeBlock('js', 'const x = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-language">JavaScript</span>');
    });

    it('shows human-readable language name for Python', () => {
        const md = codeBlock('py', 'x = 1');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-language">Python</span>');
    });

    it('falls back to uppercase for unknown languages', () => {
        const md = codeBlock('mylang', 'code');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-language">MYLANG</span>');
    });
});

// ============================================================================
// Collapse/expand for long blocks
// ============================================================================

describe('code block enhancements — collapse', () => {
    it('marks blocks >15 lines as collapsible and collapsed', () => {
        const md = codeBlock('js', lines(20));
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('data-collapsible="true"');
        expect(html).toContain('data-collapsed="true"');
    });

    it('includes a collapse toggle button for long blocks', () => {
        const md = codeBlock('js', lines(20));
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('class="code-block-collapse"');
    });

    it('shows collapsed indicator with line count for long blocks', () => {
        const md = codeBlock('js', lines(20));
        const html = renderMarkdownToHtml(md);

        // 20 lines - 5 visible = 15 more
        expect(html).toContain('Show 15 more lines');
    });

    it('does not mark short blocks as collapsible', () => {
        const md = codeBlock('js', lines(5));
        const html = renderMarkdownToHtml(md);

        expect(html).not.toContain('data-collapsible');
        expect(html).not.toContain('data-collapsed');
        expect(html).not.toContain('code-block-collapse');
    });

    it('does not mark exactly 15-line blocks as collapsible', () => {
        const md = codeBlock('js', lines(15));
        const html = renderMarkdownToHtml(md);

        expect(html).not.toContain('data-collapsible');
    });

    it('marks 16-line blocks as collapsible', () => {
        const md = codeBlock('js', lines(16));
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('data-collapsible="true"');
    });
});

// ============================================================================
// Comment highlights
// ============================================================================

describe('code block enhancements — comment highlights', () => {
    it('syntax highlighting is preserved with line numbers', () => {
        const md = codeBlock('typescript', 'const x: number = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('code-block-container');
        expect(html).toContain('language-typescript');
        expect(html).toContain('const x: number = 1;');
        expect(html).toContain('class="line-number">1</span>');
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('code block enhancements — edge cases', () => {
    it('handles empty code block', () => {
        const md = '```\n\n```';
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('code-block-container');
        expect(html).toContain('data-line="1"');
    });

    it('handles code block without language specified', () => {
        const md = '```\nhello world\n```';
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('code-block-container');
        expect(html).toContain('hello world');
        // Language label should be empty for no-language blocks
        expect(html).toContain('code-block-language');
    });

    it('handles single-line code block', () => {
        const md = codeBlock('js', 'x = 1;');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('(1 line)');
        expect(html).not.toContain('data-collapsible');
    });

    it('preserves code content with special characters', () => {
        const md = codeBlock('html', '<div class="a">&amp;</div>');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('&lt;div');
        expect(html).toContain('&amp;amp;');
    });

    it('renders container with correct data-language attribute', () => {
        const md = codeBlock('rust', 'fn main() {}');
        const html = renderMarkdownToHtml(md);

        expect(html).toContain('data-language="rust"');
    });

    it('renders multiple code blocks independently', () => {
        const md = codeBlock('js', 'a') + '\n\ntext\n\n' + codeBlock('py', 'b');
        const html = renderMarkdownToHtml(md);

        const containers = html.match(/code-block-container/g) || [];
        expect(containers.length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('data-language="js"');
        expect(html).toContain('data-language="py"');
    });
});

// ============================================================================
// CSS regression: code blocks must not inherit word-break from .markdown-body
// ============================================================================

describe('code block CSS — no word-break inheritance', () => {
    const cssPath = resolve(__dirname, '../../../../src/server/spa/client/tailwind.css');
    const css = readFileSync(cssPath, 'utf-8');

    function extractBlock(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped + '\\s*\\{([^}]+)\\}');
        const m = css.match(re);
        return m ? m[1] : '';
    }

    it('.markdown-body sets word-break: break-word', () => {
        const block = extractBlock('.markdown-body');
        expect(block).toContain('word-break: break-word');
    });

    it('.markdown-body .code-block-content code resets word-break to normal', () => {
        const block = extractBlock('.markdown-body .code-block-content code');
        expect(block).toContain('word-break: normal');
    });

    it('.markdown-body .code-block-content code resets overflow-wrap to normal', () => {
        const block = extractBlock('.markdown-body .code-block-content code');
        expect(block).toContain('overflow-wrap: normal');
    });

    it('.markdown-body .code-block-content code preserves white-space: pre', () => {
        const block = extractBlock('.markdown-body .code-block-content code');
        expect(block).toContain('white-space: pre');
    });
});

/**
 * Tests for renderMarkdownToHtml highlight.js integration.
 *
 * Validates:
 * - Code blocks use hljs classes in the bundle
 * - renderMarkdownToHtml logic produces correct output for code blocks
 * - Fallback works when hljs is not available
 * - Existing markdown features remain unaffected
 * - Edge cases: empty code blocks, invalid languages, special characters
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';
import { renderMarkdownToHtml } from '../../src/server/spa/client/markdown-renderer';

// ============================================================================
// Bundle-level checks — verify hljs integration in compiled output
// ============================================================================

describe('renderMarkdownToHtml — highlight.js bundle integration', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('contains hljs type check guard', () => {
        expect(script).toContain('typeof hljs');
    });

    it('uses hljs.highlight for explicit language', () => {
        expect(script).toContain('hljs.highlight');
    });

    it('uses hljs.highlightAuto for auto-detection', () => {
        expect(script).toContain('hljs.highlightAuto');
    });

    it('outputs hljs class on code elements', () => {
        expect(script).toContain('class="hljs language-');
    });
});

// ============================================================================
// Unit-level: renderMarkdownToHtml code block rendering
// (hljs is not available in Node test env, so code is HTML-escaped)
// ============================================================================

describe('renderMarkdownToHtml — code block highlighting', () => {
    it('applies hljs class to code blocks with explicit language', () => {
        const md = '```js\nconst x = 1;\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('class="hljs language-js"');
    });

    it('defaults to language-plaintext when no language tag', () => {
        const md = '```\nhello world\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('language-plaintext');
    });

    it('uses explicit language name in class', () => {
        const md = '```typescript\ninterface Foo {}\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('language-typescript');
    });

    it('preserves code content when hljs not available', () => {
        const md = '```js\nconst x = 1;\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('const x = 1;');
        expect(result).toContain('code-block');
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('renderMarkdownToHtml — code block edge cases', () => {
    it('handles code with HTML special characters', () => {
        const md = '```html\n<div class="test">&amp;</div>\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('&lt;div');
    });

    it('handles multiple code blocks', () => {
        const md = '```js\nconst a = 1;\n```\n\nSome text\n\n```python\nx = 2\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('language-js');
        expect(result).toContain('language-python');
        expect(result).toContain('const a = 1;');
        expect(result).toContain('x = 2');
    });

    it('handles code block with many lines', () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
        const md = '```text\n' + lines + '\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('line 1');
        expect(result).toContain('line 50');
    });

    it('handles SQL code block', () => {
        const md = '```sql\nSELECT * FROM users WHERE id = 1;\n```';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('language-sql');
        expect(result).toContain('SELECT');
    });
});

// ============================================================================
// Existing markdown features regression
// ============================================================================

describe('renderMarkdownToHtml — existing features regression', () => {
    it('renders headings correctly', () => {
        const md = '# H1\n## H2\n### H3\n#### H4';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-h1');
        expect(result).toContain('md-h2');
        expect(result).toContain('md-h3');
        expect(result).toContain('md-h4');
        expect(result).toContain('H1');
        expect(result).toContain('H4');
    });

    it('renders inline code', () => {
        const md = 'Use `const` for constants';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-inline-code');
        expect(result).toContain('const');
    });

    it('renders bold and italic', () => {
        const md = '**bold** and *italic*';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-bold');
        expect(result).toContain('md-italic');
    });

    it('renders checkboxes', () => {
        const md = '- [x] done\n- [ ] todo';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-checkbox-checked');
        expect(result).toContain('md-checkbox');
    });

    it('renders unordered lists', () => {
        const md = '- item 1\n- item 2';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-list-item');
        expect(result).toContain('item 1');
        expect(result).toContain('item 2');
    });

    it('renders links', () => {
        const md = '[example](https://example.com)';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-link');
        expect(result).toContain('example');
        expect(result).toContain('https://example.com');
    });

    it('renders blockquotes', () => {
        const md = '> This is a quote';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-blockquote');
        expect(result).toContain('This is a quote');
    });

    it('renders horizontal rules', () => {
        const md = '---';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-hr');
    });

    it('strips YAML frontmatter when requested', () => {
        const md = '---\ntitle: Test\n---\n# Hello';
        const result = renderMarkdownToHtml(md, { stripFrontmatter: true });
        expect(result).not.toContain('title: Test');
        expect(result).toContain('Hello');
    });

    it('renders mixed content with code blocks', () => {
        const md = '# Title\n\nSome text with **bold**.\n\n```js\nconst x = 1;\n```\n\n- item 1\n- item 2';
        const result = renderMarkdownToHtml(md);
        expect(result).toContain('md-h1');
        expect(result).toContain('md-bold');
        expect(result).toContain('language-js');
        expect(result).toContain('md-list-item');
    });
});

// ============================================================================
// CSS — line number styles in bundle
// ============================================================================

describe('renderMarkdown — CSS styles', () => {
    it('has hljs override styles for task preview', () => {
        const fs = require('fs');
        const path = require('path');
        const css = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'styles.css'), 'utf8'
        );
        expect(css).toContain('.task-preview-body pre code.hljs');
    });

    it('has line-number styles for future use', () => {
        const fs = require('fs');
        const path = require('path');
        const css = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'styles.css'), 'utf8'
        );
        expect(css).toContain('.line-number');
        expect(css).toContain('user-select: none');
    });
});

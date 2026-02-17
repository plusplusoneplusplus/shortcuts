/**
 * Tests for markdown-renderer.ts
 *
 * Unit tests for the shared SPA markdown rendering module that delegates
 * to pipeline-core's rendering and parsing functions. Tests run in Node
 * (no JSDOM), verifying HTML output from markdown input.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml } from '../../../../src/server/spa/client/markdown-renderer';

describe('renderMarkdownToHtml', () => {
    // ----------------------------------------------------------------
    // Empty / edge cases
    // ----------------------------------------------------------------
    describe('empty and edge-case input', () => {
        it('returns empty string for empty input', () => {
            expect(renderMarkdownToHtml('')).toBe('');
        });

        it('returns empty string for undefined-ish input', () => {
            expect(renderMarkdownToHtml(null as any)).toBe('');
            expect(renderMarkdownToHtml(undefined as any)).toBe('');
        });

        it('renders a single line of plain text', () => {
            const html = renderMarkdownToHtml('Hello world');
            expect(html).toContain('Hello world');
            expect(html).toContain('data-line="1"');
        });
    });

    // ----------------------------------------------------------------
    // Headings
    // ----------------------------------------------------------------
    describe('headings', () => {
        it('renders h1 through h6 with anchor IDs', () => {
            const md = '# Title\n## Subtitle\n### Section\n#### Sub-section';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-h1');
            expect(html).toContain('md-h2');
            expect(html).toContain('md-h3');
            expect(html).toContain('md-h4');
            expect(html).toContain('data-anchor-id=');
        });

        it('generates correct anchor ID for heading text', () => {
            const html = renderMarkdownToHtml('# My Heading');
            expect(html).toContain('data-anchor-id="my-heading"');
        });
    });

    // ----------------------------------------------------------------
    // Inline formatting
    // ----------------------------------------------------------------
    describe('inline formatting', () => {
        it('renders bold text', () => {
            const html = renderMarkdownToHtml('This is **bold** text');
            expect(html).toContain('md-bold');
            expect(html).toContain('bold');
        });

        it('renders italic text', () => {
            const html = renderMarkdownToHtml('This is *italic* text');
            expect(html).toContain('md-italic');
            expect(html).toContain('italic');
        });

        it('renders inline code', () => {
            const html = renderMarkdownToHtml('Use `console.log()` here');
            expect(html).toContain('md-inline-code');
            expect(html).toContain('console.log()');
        });

        it('renders links', () => {
            const html = renderMarkdownToHtml('[Google](https://google.com)');
            expect(html).toContain('md-link');
            expect(html).toContain('Google');
            expect(html).toContain('https://google.com');
        });
    });

    // ----------------------------------------------------------------
    // Lists
    // ----------------------------------------------------------------
    describe('lists', () => {
        it('renders unordered list items', () => {
            const md = '- Item one\n- Item two\n- Item three';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-list-item');
            expect(html).toContain('md-list-marker');
            expect(html).toContain('Item one');
            expect(html).toContain('Item two');
        });

        it('renders ordered list items', () => {
            const md = '1. First\n2. Second\n3. Third';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-list-item');
            expect(html).toContain('First');
            expect(html).toContain('Second');
        });

        it('renders task checkboxes', () => {
            const md = '- [x] Done task\n- [ ] Pending task';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-checkbox-checked');
            expect(html).toContain('md-checkbox');
            expect(html).toContain('Done task');
            expect(html).toContain('Pending task');
        });
    });

    // ----------------------------------------------------------------
    // Code blocks
    // ----------------------------------------------------------------
    describe('code blocks', () => {
        it('renders a fenced code block', () => {
            const md = '```javascript\nconst x = 1;\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('code-block');
            expect(html).toContain('language-javascript');
            expect(html).toContain('const x = 1;');
        });

        it('renders a code block without language', () => {
            const md = '```\nhello\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('code-block');
            expect(html).toContain('hello');
        });

        it('renders multiple code blocks', () => {
            const md = '```js\na\n```\n\nSome text\n\n```py\nb\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('language-js');
            expect(html).toContain('language-py');
        });

        it('preserves code content in code blocks', () => {
            const md = '```\n<div>HTML</div>\n```';
            const html = renderMarkdownToHtml(md);

            // HTML should be escaped inside code blocks
            expect(html).toContain('&lt;div&gt;');
        });

        it('applies highlight callback when hljs is not available', () => {
            // hljs is not defined in Node test environment, so renderCodeBlock
            // falls back to escapeHtml. Verify it still renders.
            const md = '```typescript\nconst y: number = 2;\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('const y: number = 2;');
            expect(html).toContain('code-block');
        });
    });

    // ----------------------------------------------------------------
    // Tables
    // ----------------------------------------------------------------
    describe('tables', () => {
        it('renders a simple markdown table', () => {
            const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('<th');
            expect(html).toContain('<td');
            expect(html).toContain('Name');
            expect(html).toContain('Alice');
            expect(html).toContain('30');
        });

        it('renders table with alignment', () => {
            const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-table');
            expect(html).toContain('align-center');
            expect(html).toContain('align-right');
        });
    });

    // ----------------------------------------------------------------
    // Mermaid blocks
    // ----------------------------------------------------------------
    describe('mermaid blocks', () => {
        it('renders a mermaid block as a container', () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-container');
            expect(html).toContain('Mermaid Diagram');
            expect(html).toContain('A --&gt; B');
        });
    });

    // ----------------------------------------------------------------
    // Blockquotes
    // ----------------------------------------------------------------
    describe('blockquotes', () => {
        it('renders blockquote lines', () => {
            const html = renderMarkdownToHtml('> This is a quote');
            expect(html).toContain('md-blockquote');
            expect(html).toContain('This is a quote');
        });
    });

    // ----------------------------------------------------------------
    // Horizontal rules
    // ----------------------------------------------------------------
    describe('horizontal rules', () => {
        it('renders horizontal rules', () => {
            const html = renderMarkdownToHtml('---');
            expect(html).toContain('md-hr');
        });

        it('renders asterisk horizontal rules', () => {
            const html = renderMarkdownToHtml('***');
            expect(html).toContain('md-hr');
        });
    });

    // ----------------------------------------------------------------
    // Frontmatter
    // ----------------------------------------------------------------
    describe('YAML frontmatter stripping', () => {
        it('strips YAML frontmatter when option is enabled', () => {
            const md = '---\ntitle: Hello\nstatus: pending\n---\n\n# Content';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(html).not.toContain('title: Hello');
            expect(html).not.toContain('status: pending');
            expect(html).toContain('Content');
        });

        it('preserves YAML frontmatter when option is disabled', () => {
            const md = '---\ntitle: Hello\n---\n\n# Content';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: false });

            // When not stripping, the frontmatter --- lines will be rendered
            // (possibly as horizontal rules or plain text)
            expect(html).toContain('title: Hello');
        });

        it('preserves frontmatter by default', () => {
            const md = '---\ntitle: Test\n---\n\n# Heading';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('title: Test');
        });
    });

    // ----------------------------------------------------------------
    // HTML escaping
    // ----------------------------------------------------------------
    describe('HTML escaping', () => {
        it('escapes HTML entities in regular text', () => {
            const html = renderMarkdownToHtml('Use <script> tags carefully & use "quotes"');
            expect(html).toContain('&lt;script&gt;');
            expect(html).toContain('&amp;');
        });

        it('escapes HTML in headings', () => {
            const html = renderMarkdownToHtml('# Title with <br> tag');
            expect(html).toContain('&lt;br&gt;');
        });
    });

    // ----------------------------------------------------------------
    // Line wrapping structure
    // ----------------------------------------------------------------
    describe('line structure', () => {
        it('wraps each line in a div with data-line attribute', () => {
            const md = 'Line one\nLine two\nLine three';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('data-line="1"');
            expect(html).toContain('data-line="2"');
            expect(html).toContain('data-line="3"');
        });

        it('adds anchor id to heading lines', () => {
            const html = renderMarkdownToHtml('# Hello World');
            expect(html).toContain('id="hello-world"');
        });
    });

    // ----------------------------------------------------------------
    // Mixed content
    // ----------------------------------------------------------------
    describe('mixed content rendering', () => {
        it('renders a document with headings, lists, code, and tables', () => {
            const md = [
                '# Title',
                '',
                'Some **bold** text.',
                '',
                '- Item 1',
                '- Item 2',
                '',
                '```js',
                'console.log("hi");',
                '```',
                '',
                '| Col1 | Col2 |',
                '| --- | --- |',
                '| A | B |',
            ].join('\n');

            const html = renderMarkdownToHtml(md);

            expect(html).toContain('md-h1');
            expect(html).toContain('md-bold');
            expect(html).toContain('md-list-item');
            expect(html).toContain('code-block');
            expect(html).toContain('md-table');
        });
    });
});

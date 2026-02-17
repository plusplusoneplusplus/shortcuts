/**
 * Tests for renderMarkdown highlight.js integration.
 *
 * Validates:
 * - Code blocks use hljs classes in the bundle
 * - renderMarkdown logic produces correct output for code blocks
 * - Fallback works when hljs is not available
 * - Existing markdown features remain unaffected
 * - Edge cases: empty code blocks, invalid languages, special characters
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Bundle-level checks — verify hljs integration in compiled output
// ============================================================================

describe('renderMarkdown — highlight.js bundle integration', () => {
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

    it('falls back gracefully in catch block', () => {
        // The catch block assigns the plain trimmedCode as fallback
        expect(script).toContain('highlighted = trimmedCode');
    });
});

// ============================================================================
// Unit-level: renderMarkdown logic (extracted & self-contained)
// ============================================================================

/**
 * Minimal copy of escapeHtmlClient for test isolation.
 * The real one lives in client/utils.ts which has window side-effects.
 */
function escapeHtmlClient(str: string | null | undefined): string {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Re-implementation of renderMarkdown for unit testing, matching the
 * source in packages/coc/src/server/spa/client/tasks.ts.
 * This avoids importing the client module (which has browser globals).
 */
function renderMarkdown(md: string, mockHljs?: {
    highlight: (code: string, opts: { language: string }) => { value: string };
    highlightAuto: (code: string) => { value: string; language: string };
}): string {
    // Strip YAML frontmatter
    let text = md.replace(/^---\n[\s\S]*?\n---\n*/, '');

    // Escape HTML first
    text = escapeHtmlClient(text);

    // Code blocks (``` ... ```) — apply highlight.js syntax highlighting
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        const trimmedCode = code.trimEnd();
        const language = lang || 'plaintext';

        let highlighted: string;
        try {
            if (mockHljs) {
                if (lang) {
                    highlighted = mockHljs.highlight(trimmedCode, { language }).value;
                } else {
                    highlighted = mockHljs.highlightAuto(trimmedCode).value;
                }
            } else {
                highlighted = trimmedCode;
            }
        } catch {
            highlighted = trimmedCode;
        }

        return '<pre><code class="hljs language-' + language + '">' + highlighted + '</code></pre>';
    });

    // Inline code
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Headings
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    text = text.replace(/^---$/gm, '<hr>');

    // Bold and italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Checkboxes
    text = text.replace(/^(\s*)- \[x\] (.+)$/gm, '$1<div class="task-checkbox checked">&#9745; $2</div>');
    text = text.replace(/^(\s*)- \[ \] (.+)$/gm, '$1<div class="task-checkbox">&#9744; $2</div>');

    // Unordered lists
    text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Blockquotes
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs
    text = text.replace(/^(?!<[a-z])((?!<\/)[^\n]+)$/gm, '<p>$1</p>');

    // Clean up empty paragraphs
    text = text.replace(/<p>\s*<\/p>/g, '');

    return text;
}

// ============================================================================
// Code block rendering — hljs integration
// ============================================================================

describe('renderMarkdown — code block highlighting', () => {
    const mockHljs = {
        highlight: (code: string, opts: { language: string }) => ({
            value: `<span class="hljs-keyword">${code}</span>`,
        }),
        highlightAuto: (code: string) => ({
            value: `<span class="hljs-auto">${code}</span>`,
            language: 'javascript',
        }),
    };

    it('applies hljs class to code blocks with explicit language', () => {
        const md = '```js\nconst x = 1;\n```';
        const result = renderMarkdown(md, mockHljs);
        expect(result).toContain('class="hljs language-js"');
    });

    it('calls hljs.highlight for explicit language', () => {
        const md = '```python\ndef foo(): pass\n```';
        const result = renderMarkdown(md, mockHljs);
        expect(result).toContain('<span class="hljs-keyword">');
        expect(result).toContain('language-python');
    });

    it('calls hljs.highlightAuto when no language specified', () => {
        const md = '```\nconst x = 1;\n```';
        const result = renderMarkdown(md, mockHljs);
        expect(result).toContain('<span class="hljs-auto">');
        expect(result).toContain('language-plaintext');
    });

    it('defaults to language-plaintext when no language tag', () => {
        const md = '```\nhello world\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('language-plaintext');
    });

    it('uses explicit language name in class', () => {
        const md = '```typescript\ninterface Foo {}\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('language-typescript');
    });

    it('preserves code content when hljs not available', () => {
        const md = '```js\nconst x = 1;\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('const x = 1;');
        expect(result).toContain('<pre><code');
    });
});

// ============================================================================
// Fallback and error handling
// ============================================================================

describe('renderMarkdown — hljs error fallback', () => {
    const throwingHljs = {
        highlight: () => { throw new Error('Unknown language'); },
        highlightAuto: () => { throw new Error('Auto-detect failed'); },
    };

    it('falls back to plain text when highlight throws', () => {
        const md = '```invalidlang\nsome code\n```';
        const result = renderMarkdown(md, throwingHljs);
        expect(result).toContain('<pre><code');
        expect(result).toContain('some code');
    });

    it('falls back to plain text when highlightAuto throws', () => {
        const md = '```\nsome code\n```';
        const result = renderMarkdown(md, throwingHljs);
        expect(result).toContain('<pre><code');
        expect(result).toContain('some code');
    });

    it('still wraps in hljs class on fallback', () => {
        const md = '```badlang\ncode\n```';
        const result = renderMarkdown(md, throwingHljs);
        expect(result).toContain('class="hljs language-badlang"');
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('renderMarkdown — code block edge cases', () => {
    it('handles empty code block', () => {
        const md = '```js\n\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('<pre><code class="hljs language-js">');
        expect(result).toContain('</code></pre>');
    });

    it('handles code with HTML special characters', () => {
        const md = '```html\n<div class="test">&amp;</div>\n```';
        const result = renderMarkdown(md);
        // HTML was escaped first, so < becomes &lt; etc.
        expect(result).toContain('&lt;div');
        expect(result).toContain('&amp;amp;');
    });

    it('handles multiple code blocks', () => {
        const md = '```js\nconst a = 1;\n```\n\nSome text\n\n```python\nx = 2\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('language-js');
        expect(result).toContain('language-python');
        expect(result).toContain('const a = 1;');
        expect(result).toContain('x = 2');
    });

    it('handles code block with many lines', () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
        const md = '```text\n' + lines + '\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('line 1');
        expect(result).toContain('line 50');
    });

    it('handles SQL code block', () => {
        const md = '```sql\nSELECT * FROM users WHERE id = 1;\n```';
        const result = renderMarkdown(md);
        expect(result).toContain('language-sql');
        expect(result).toContain('SELECT');
    });
});

// ============================================================================
// Existing markdown features regression
// ============================================================================

describe('renderMarkdown — existing features regression', () => {
    it('renders headings correctly', () => {
        const md = '# H1\n## H2\n### H3\n#### H4';
        const result = renderMarkdown(md);
        expect(result).toContain('<h1>H1</h1>');
        expect(result).toContain('<h2>H2</h2>');
        expect(result).toContain('<h3>H3</h3>');
        expect(result).toContain('<h4>H4</h4>');
    });

    it('renders inline code unchanged', () => {
        const md = 'Use `const` for constants';
        const result = renderMarkdown(md);
        expect(result).toContain('<code>const</code>');
    });

    it('renders bold and italic', () => {
        const md = '**bold** and *italic* and ***both***';
        const result = renderMarkdown(md);
        expect(result).toContain('<strong>bold</strong>');
        expect(result).toContain('<em>italic</em>');
        expect(result).toContain('<strong><em>both</em></strong>');
    });

    it('renders checkboxes', () => {
        const md = '- [x] done\n- [ ] todo';
        const result = renderMarkdown(md);
        expect(result).toContain('task-checkbox checked');
        expect(result).toContain('task-checkbox"');
    });

    it('renders unordered lists', () => {
        const md = '- item 1\n- item 2';
        const result = renderMarkdown(md);
        expect(result).toContain('<ul>');
        expect(result).toContain('<li>item 1</li>');
        expect(result).toContain('<li>item 2</li>');
    });

    it('renders links', () => {
        const md = '[example](https://example.com)';
        const result = renderMarkdown(md);
        expect(result).toContain('<a href="https://example.com" target="_blank" rel="noopener">example</a>');
    });

    it('renders blockquotes', () => {
        const md = '> This is a quote';
        const result = renderMarkdown(md);
        expect(result).toContain('<blockquote>This is a quote</blockquote>');
    });

    it('renders horizontal rules', () => {
        const md = '---';
        const result = renderMarkdown(md);
        expect(result).toContain('<hr>');
    });

    it('strips YAML frontmatter', () => {
        const md = '---\ntitle: Test\n---\n# Hello';
        const result = renderMarkdown(md);
        expect(result).not.toContain('title: Test');
        expect(result).toContain('<h1>Hello</h1>');
    });

    it('renders mixed content with code blocks', () => {
        const md = '# Title\n\nSome text with **bold**.\n\n```js\nconst x = 1;\n```\n\n- item 1\n- item 2';
        const result = renderMarkdown(md);
        expect(result).toContain('<h1>Title</h1>');
        expect(result).toContain('<strong>bold</strong>');
        expect(result).toContain('class="hljs language-js"');
        expect(result).toContain('<li>item 1</li>');
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

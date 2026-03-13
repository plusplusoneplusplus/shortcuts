/**
 * Tests for chatMarkdownToHtml — the marked-based renderer for chat messages.
 */

import { describe, it, expect } from 'vitest';
import { chatMarkdownToHtml, toContentHtml } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';

describe('chatMarkdownToHtml', () => {
    // --- Empty / whitespace ---

    it('returns empty string for empty input', () => {
        expect(chatMarkdownToHtml('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
        expect(chatMarkdownToHtml('   \n  ')).toBe('');
    });

    it('returns empty string for undefined-ish input', () => {
        expect(chatMarkdownToHtml(null as any)).toBe('');
        expect(chatMarkdownToHtml(undefined as any)).toBe('');
    });

    // --- Headers ---

    it('renders h1', () => {
        const html = chatMarkdownToHtml('# Title');
        expect(html).toContain('<h1');
        expect(html).toContain('Title');
    });

    it('renders h3', () => {
        const html = chatMarkdownToHtml('### Subtitle');
        expect(html).toContain('<h3');
        expect(html).toContain('Subtitle');
    });

    // --- Bold and italic ---

    it('renders bold text with <strong>', () => {
        const html = chatMarkdownToHtml('This is **bold** text');
        expect(html).toContain('<strong>bold</strong>');
    });

    it('renders italic text with <em>', () => {
        const html = chatMarkdownToHtml('This is *italic* text');
        expect(html).toContain('<em>italic</em>');
    });

    // --- Lists ---

    it('renders unordered list', () => {
        const html = chatMarkdownToHtml('- item one\n- item two');
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>');
        expect(html).toContain('item one');
        expect(html).toContain('item two');
    });

    it('renders ordered list', () => {
        const html = chatMarkdownToHtml('1. first\n2. second');
        expect(html).toContain('<ol>');
        expect(html).toContain('<li>');
        expect(html).toContain('first');
    });

    // --- Code ---

    it('renders inline code', () => {
        const html = chatMarkdownToHtml('Use `console.log`');
        expect(html).toContain('<code>console.log</code>');
    });

    it('renders fenced code block with <pre><code>', () => {
        const html = chatMarkdownToHtml('```js\nconst x = 1;\n```');
        expect(html).toContain('<pre>');
        expect(html).toContain('<code');
        expect(html).toContain('const x = 1;');
    });

    // --- Angle brackets (the HTML_LIKE_RE bypass bug) ---

    it('renders content with Array<string> as markdown, not raw text', () => {
        const html = chatMarkdownToHtml('Use `Array<string>` for the type');
        expect(html).toContain('<code>');
        expect(html).toContain('Array&lt;string&gt;');
    });

    it('renders content with generic XML-like patterns as markdown', () => {
        const html = chatMarkdownToHtml('The `<div>` element is **important**');
        expect(html).toContain('<strong>important</strong>');
        expect(html).toContain('<code>');
    });

    // --- Paragraphs ---

    it('renders paragraphs for double newlines', () => {
        const html = chatMarkdownToHtml('First paragraph\n\nSecond paragraph');
        expect(html).toContain('<p>First paragraph</p>');
        expect(html).toContain('<p>Second paragraph</p>');
    });

    it('renders <br> for single newlines (breaks: true)', () => {
        const html = chatMarkdownToHtml('Line one\nLine two');
        expect(html).toContain('<br');
    });

    // --- Blockquote ---

    it('renders blockquote', () => {
        const html = chatMarkdownToHtml('> A quote');
        expect(html).toContain('<blockquote>');
        expect(html).toContain('A quote');
    });

    // --- Links ---

    it('renders links with <a>', () => {
        const html = chatMarkdownToHtml('[Click me](https://example.com)');
        expect(html).toContain('<a');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('Click me');
    });

    it('opens https links in a new tab with rel=noopener', () => {
        const html = chatMarkdownToHtml('[Example](https://example.com)');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('opens http links in a new tab with rel=noopener', () => {
        const html = chatMarkdownToHtml('[Local](http://localhost:3000)');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('opens mailto links in a new tab with rel=noopener', () => {
        const html = chatMarkdownToHtml('[Email](mailto:user@example.com)');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('does not add target="_blank" to anchor links', () => {
        const html = chatMarkdownToHtml('[Section](#section-id)');
        expect(html).not.toContain('target="_blank"');
        expect(html).toContain('href="#section-id"');
    });

    it('preserves title attribute on external links', () => {
        const html = chatMarkdownToHtml('[Docs](https://docs.example.com "Documentation")');
        expect(html).toContain('title="Documentation"');
        expect(html).toContain('target="_blank"');
    });

    // --- Tables ---

    it('renders tables', () => {
        const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
        const html = chatMarkdownToHtml(md);
        expect(html).toContain('<table>');
        expect(html).toContain('<th>');
        expect(html).toContain('<td>');
    });

    // --- Horizontal rule ---

    it('renders horizontal rule', () => {
        const html = chatMarkdownToHtml('Above\n\n---\n\nBelow');
        expect(html).toContain('<hr');
    });

    // --- File path linkification ---

    it('linkifies Windows file paths in user messages', () => {
        const html = chatMarkdownToHtml('Use the impl skill. D:\\projects\\shortcuts\\.vscode\\tasks\\coc\\tasks\\enqueue-dialog-paste-image.plan.md');
        expect(html).toContain('class="file-path-link"');
        expect(html).toContain('data-full-path=');
    });

    it('preserves .vscode segment in Windows backslash paths (markdown escape bug)', () => {
        const html = chatMarkdownToHtml('D:\\projects\\shortcuts\\.vscode\\tasks\\coc\\misc\\hover-create-result.plan.md');
        expect(html).toContain('class="file-path-link"');
        // The \.vscode backslash-dot must NOT be eaten by markdown escaping
        expect(html).toContain('shortcuts/.vscode');
        expect(html).not.toContain('shortcuts.vscode');
    });

    it('preserves multiple dot-prefixed segments in Windows paths', () => {
        const html = chatMarkdownToHtml('C:\\Users\\user\\.config\\.app\\file.json');
        expect(html).toContain('class="file-path-link"');
        expect(html).toContain('user/.config/.app');
        expect(html).not.toContain('user.config');
    });

    it('preserves .vscode segment in forward-slash paths (no markdown escaping issue)', () => {
        const html = chatMarkdownToHtml('File: D:/projects/shortcuts/data/repos/abc/tasks/coc/chat');
        expect(html).toContain('class="file-path-link"');
        // Forward-slash paths must keep the /.vscode/ segment intact
        expect(html).toContain('shortcuts/data/repos');
        expect(html).not.toContain('shortcuts.vscode');
    });

    it('normalizes normal Windows paths without dot segments', () => {
        const html = chatMarkdownToHtml('D:\\projects\\shortcuts\\src\\index.ts');
        expect(html).toContain('class="file-path-link"');
        expect(html).toContain('D:/projects/shortcuts/src/index.ts');
    });

    it('does not corrupt non-path content when normalizing Windows paths', () => {
        const html = chatMarkdownToHtml('This is **bold** and D:\\projects\\.vscode\\foo.md is a file');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('projects/.vscode/foo.md');
    });

    it('linkifies Unix file paths', () => {
        const html = chatMarkdownToHtml('Edit /Users/alice/projects/foo/bar.ts please');
        expect(html).toContain('class="file-path-link"');
        expect(html).toContain('data-full-path="');
        expect(html).toContain('/Users/alice/projects/foo/bar.ts');
    });

    it('does not linkify paths inside code blocks', () => {
        const html = chatMarkdownToHtml('```\n/Users/alice/test.ts\n```');
        expect(html).not.toContain('file-path-link');
    });

    it('does not linkify paths inside inline code', () => {
        const html = chatMarkdownToHtml('Run `C:\\tools\\build.exe` to compile');
        expect(html).not.toContain('file-path-link');
    });

    // --- Complex AI response ---

    it('renders a complex AI response with mixed elements', () => {
        const md = [
            '### Analysis',
            '',
            'The function uses `Array<string>` for parameters.',
            '',
            '**Key points:**',
            '',
            '1. First item',
            '2. Second item',
            '',
            '```typescript',
            'function foo(items: Array<string>): void {',
            '  console.log(items);',
            '}',
            '```',
            '',
            '> Note: This is important.',
        ].join('\n');

        const html = chatMarkdownToHtml(md);
        expect(html).toContain('<h3');
        expect(html).toContain('<strong>Key points:</strong>');
        expect(html).toContain('<ol>');
        expect(html).toContain('<pre>');
        expect(html).toContain('<blockquote>');
        // Should NOT contain raw ** markers
        expect(html).not.toContain('**Key points:**');
    });

    it('escapes raw HTML tags instead of passing them through', () => {
        const html = chatMarkdownToHtml('<div>injected</div>');
        expect(html).not.toContain('<div>');
        expect(html).toContain('&lt;div&gt;');
    });

    it('does not double-escape angle brackets in placeholder text', () => {
        const html = chatMarkdownToHtml('Use the <chosen-folder> path');
        expect(html).toContain('&lt;chosen-folder&gt;');
        expect(html).not.toContain('&amp;lt;');
    });
});

describe('toContentHtml (user prompt renderer)', () => {
    it('renders markdown in user content', () => {
        const html = toContentHtml('**bold** and _italic_');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<em>italic</em>');
    });

    it('escapes pasted HTML sections as plain text', () => {
        const html = toContentHtml('<section>\n<h1>Title</h1>\n</section>');
        // Tags must not be rendered as HTML elements
        expect(html).not.toContain('<section>');
        expect(html).not.toContain('<h1>');
        // They should appear as escaped entities
        expect(html).toContain('&lt;section&gt;');
        expect(html).toContain('&lt;h1&gt;');
    });

    it('escapes inline HTML tags pasted into a prompt', () => {
        const html = toContentHtml('can you fix <div class="foo">this</div> please');
        expect(html).not.toContain('<div');
        expect(html).toContain('&lt;div');
    });

    it('renders empty string for empty input', () => {
        expect(toContentHtml('')).toBe('');
    });

    it('still linkifies file paths in user content', () => {
        const html = toContentHtml('look at D:/projects/shortcuts/src/index.ts');
        expect(html).toContain('class="file-path-link"');
    });

    it('does not double-escape angle brackets in placeholders', () => {
        const html = toContentHtml('Use the <chosen-folder> for output');
        // Should render as single-escaped entity, not &amp;lt;
        expect(html).toContain('&lt;chosen-folder&gt;');
        expect(html).not.toContain('&amp;lt;');
        expect(html).not.toContain('&amp;gt;');
    });

    it('does not double-escape generic type annotations', () => {
        const html = toContentHtml('The type is Map<string, number>');
        expect(html).toContain('&lt;string');
        expect(html).not.toContain('&amp;');
    });
});

/**
 * Tests for chatMarkdownToHtml — the marked-based renderer for chat messages.
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';
import { chatMarkdownToHtml, toContentHtml, normalizeMarkdownLinkUrls, parseExcalidrawLink, parseCanvasEmbedLink } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';

afterEach(() => {
    cleanup();
    delete (globalThis as any).mermaid;
});

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
        expect(html).toContain('class="language-js"');
        expect(html).toContain('const x = 1;');
    });

    it('renders mermaid fences as diagram containers instead of raw code blocks', () => {
        const html = chatMarkdownToHtml('```mermaid\nflowchart TD\n  A --> B\n```');
        expect(html).toContain('class="mermaid-container"');
        expect(html).toContain('class="mermaid-source"');
        expect(html).toContain('flowchart TD');
        expect(html).not.toContain('language-mermaid');
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

    it('embeds local HTML files referenced via image syntax (drops the <img>)', () => {
        const html = chatMarkdownToHtml('![Chart](outputs/chart.html)', 'ws1', { htmlEmbedEnabled: true });
        expect(html).toContain('class="md-html-embed"');
        expect(html).toContain('data-html-path="outputs/chart.html"');
        expect(html).toContain('data-embed-height="600"');
        // Image syntax should NOT produce an <img> for embeddable HTML files.
        expect(html).not.toContain('<img');
        expect(html).not.toContain('chat-inline-image');
    });

    it('does not embed local HTML files referenced via link syntax', () => {
        const html = chatMarkdownToHtml('[Chart](outputs/chart.html)', 'ws1', { htmlEmbedEnabled: true });
        expect(html).toContain('href="outputs/chart.html"');
        expect(html).not.toContain('md-html-embed');
    });

    it('falls back to <img> when image syntax targets HTML but embed is disabled', () => {
        const html = chatMarkdownToHtml('![Chart](outputs/chart.html)', 'ws1');
        expect(html).not.toContain('md-html-embed');
        expect(html).toContain('<img');
    });

    it('does not embed non-HTML local images or remote HTML via image syntax', () => {
        const nonHtml = chatMarkdownToHtml('![Data](outputs/data.png)', 'ws1', { htmlEmbedEnabled: true });
        const remote = chatMarkdownToHtml('![Remote](https://example.com/chart.html)', 'ws1', { htmlEmbedEnabled: true });
        expect(nonHtml).not.toContain('md-html-embed');
        expect(nonHtml).toContain('<img');
        expect(remote).not.toContain('md-html-embed');
        expect(remote).toContain('<img');
        expect(remote).toContain('src="https://example.com/chart.html"');
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

    it('preserves line breaks inside XML-like tag blocks', () => {
        const html = chatMarkdownToHtml('<rule>\nBe concise.\nUse clear language.\n</rule>');
        expect(html).toContain('&lt;rule&gt;');
        expect(html).toContain('<br>');
        expect(html).toContain('Be concise.');
        expect(html).toContain('Use clear language.');
    });

    it('preserves multiline content inside pasted HTML sections in user messages', () => {
        const html = toContentHtml('<section>\nLine one\nLine two\n</section>');
        expect(html).not.toContain('<section>');
        expect(html).toContain('&lt;section&gt;');
        expect(html).toContain('<br>');
        expect(html).toContain('Line one');
        expect(html).toContain('Line two');
    });

    it('does not double-escape angle brackets in placeholder text', () => {
        const html = chatMarkdownToHtml('Use the <chosen-folder> path');
        expect(html).toContain('&lt;chosen-folder&gt;');
        expect(html).not.toContain('&amp;lt;');
    });
});

describe('MarkdownView mermaid integration', () => {
    it('initializes mermaid containers rendered by chatMarkdownToHtml', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        (globalThis as any).mermaid = {
            initialize: vi.fn(),
            run,
        };

        const html = chatMarkdownToHtml('```mermaid\nflowchart TD\n  A --> B\n```');
        const { container } = render(React.createElement(MarkdownView, { html }));

        await waitFor(() => expect(run).toHaveBeenCalled());
        const mermaidContainer = container.querySelector('.mermaid-container');
        expect(mermaidContainer).toHaveAttribute('data-mermaid-ready', '1');
        expect(container.querySelector('.task-mermaid-viewport')).not.toBeNull();
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

describe('normalizeMarkdownLinkUrls', () => {
    it('normalizes backslashes in image syntax with Windows path containing spaces', () => {
        const input = '![html](C:\\Users\\Yiheng Tao\\.copilot\\foo\\bar.html)';
        const result = normalizeMarkdownLinkUrls(input);
        // Backslashes replaced, space causes angle-bracket wrapping
        expect(result).toBe('![html](<C:/Users/Yiheng Tao/.copilot/foo/bar.html>)');
    });

    it('normalizes backslashes in image syntax with Windows path without spaces', () => {
        const input = '![img](C:\\Users\\Bob\\output.png)';
        const result = normalizeMarkdownLinkUrls(input);
        expect(result).toBe('![img](C:/Users/Bob/output.png)');
    });

    it('normalizes backslashes in link syntax with Windows path containing spaces', () => {
        const input = '[open](C:\\Users\\Yiheng Tao\\notes\\plan.md)';
        const result = normalizeMarkdownLinkUrls(input);
        expect(result).toBe('[open](<C:/Users/Yiheng Tao/notes/plan.md>)');
    });

    it('does not modify non-Windows URLs', () => {
        const input = '[x](https://example.com/a b)';
        const result = normalizeMarkdownLinkUrls(input);
        expect(result).toBe(input);
    });

    it('does not modify relative paths', () => {
        const input = '![img](./outputs/chart.html)';
        const result = normalizeMarkdownLinkUrls(input);
        expect(result).toBe(input);
    });
});

describe('chatMarkdownToHtml — Windows paths with spaces in links', () => {
    it('renders image with Windows path containing a space as HTML embed', () => {
        const html = chatMarkdownToHtml(
            '![html](C:\\Users\\Yiheng Tao\\.copilot\\foo\\bar.html)',
            'ws1',
            { htmlEmbedEnabled: true },
        );
        expect(html).toContain('class="md-html-embed"');
        expect(html).toContain('data-html-path="C:/Users/Yiheng Tao/.copilot/foo/bar.html"');
    });

    it('renders image with Windows path containing a space as proxied img', () => {
        const html = chatMarkdownToHtml(
            '![screenshot](C:\\Users\\Yiheng Tao\\.copilot\\screenshot.png)',
            'ws1',
        );
        expect(html).toContain('<img');
        expect(html).toContain('src="/api/workspaces/ws1/files/image?path=');
        expect(html).toContain(encodeURIComponent('C:/Users/Yiheng Tao/.copilot/screenshot.png'));
    });

    it('renders link with Windows path containing a space', () => {
        const html = chatMarkdownToHtml('[open](C:\\Users\\Yiheng Tao\\notes\\plan.md)');
        expect(html).toContain('<a');
        expect(html).toContain('href="C:/Users/Yiheng Tao/notes/plan.md"');
        expect(html).toContain('open</a>');
    });

    it('renders image with Windows path without spaces (unchanged behavior)', () => {
        const html = chatMarkdownToHtml('![img](C:\\Users\\Bob\\file.png)', 'ws1');
        expect(html).toContain('<img');
        expect(html).toContain('src="/api/workspaces/ws1/files/image?path=');
        expect(html).toContain(encodeURIComponent('C:/Users/Bob/file.png'));
    });

    it('does not alter external image URLs', () => {
        const html = chatMarkdownToHtml('![x](https://example.com/x.png)');
        expect(html).toContain('src="https://example.com/x.png"');
    });

    it('does not alter non-Windows link URLs with spaces', () => {
        // Non-Windows URLs with spaces are left to marked's native handling
        const html = chatMarkdownToHtml('[x](https://example.com/a%20b)');
        expect(html).toContain('href="https://example.com/a%20b"');
    });
});

describe('chatMarkdownToHtml — image rendering', () => {
    // --- HTTP images ---

    it('renders external http image with img tag and chat-inline-image class', () => {
        const html = chatMarkdownToHtml('![alt text](https://example.com/image.png)');
        expect(html).toContain('<img');
        expect(html).toContain('src="https://example.com/image.png"');
        expect(html).toContain('alt="alt text"');
        expect(html).toContain('class="chat-inline-image"');
    });

    it('adds loading=lazy to external images', () => {
        const html = chatMarkdownToHtml('![pic](https://cdn.example.com/photo.jpg)');
        expect(html).toContain('loading="lazy"');
    });

    it('includes onerror fallback on external images', () => {
        const html = chatMarkdownToHtml('![pic](https://cdn.example.com/photo.jpg)');
        expect(html).toContain('onerror=');
        expect(html).toContain('chat-inline-image--error');
    });

    it('preserves title attribute on external images', () => {
        const html = chatMarkdownToHtml('![alt](https://example.com/img.png "My Title")');
        expect(html).toContain('title="My Title"');
    });

    // --- Local path images (no wsId) ---

    it('renders local path image with data-local-path when no wsId provided', () => {
        const html = chatMarkdownToHtml('![screenshot](/tmp/screenshot.png)');
        expect(html).toContain('data-local-path="/tmp/screenshot.png"');
        expect(html).not.toContain('src=');
    });

    it('renders Windows local path with data-local-path', () => {
        const html = chatMarkdownToHtml('![img](C:/Users/user/output.png)');
        expect(html).toContain('data-local-path=');
        expect(html).not.toContain('src=');
    });

    // --- Local path images (with wsId) ---

    it('rewrites local path to proxy URL when wsId is provided', () => {
        const html = chatMarkdownToHtml('![screenshot](/tmp/screenshot.png)', 'my-workspace');
        expect(html).toContain('src="/api/workspaces/my-workspace/files/image?path=');
        expect(html).not.toContain('data-local-path=');
    });

    it('URL-encodes path in proxy URL', () => {
        const html = chatMarkdownToHtml('![img](/tmp/my-file.png)', 'ws1');
        expect(html).toContain(encodeURIComponent('/tmp/my-file.png'));
    });

    it('URL-encodes wsId in proxy URL', () => {
        const html = chatMarkdownToHtml('![img](/tmp/img.png)', 'my ws/id');
        expect(html).toContain('/api/workspaces/' + encodeURIComponent('my ws/id') + '/files/image');
    });

    it('includes onerror fallback on rewritten local image', () => {
        const html = chatMarkdownToHtml('![img](/tmp/img.png)', 'ws1');
        expect(html).toContain('onerror=');
        expect(html).toContain('chat-inline-image--error');
    });

    it('does not rewrite external https images even when wsId provided', () => {
        const html = chatMarkdownToHtml('![pic](https://example.com/img.png)', 'ws1');
        expect(html).toContain('src="https://example.com/img.png"');
        expect(html).not.toContain('/files/image');
    });
});

// =====================================================================
// parseExcalidrawLink
// =====================================================================

describe('parseExcalidrawLink', () => {
    it('parses a valid excalidraw link', () => {
        const result = parseExcalidrawLink('excalidraw://ws-abc123/architecture.excalidraw');
        expect(result).toEqual({
            workspaceId: 'ws-abc123',
            diagramPath: 'architecture.excalidraw',
        });
    });

    it('parses with encoded characters', () => {
        const result = parseExcalidrawLink('excalidraw://ws-1/my%20diagram.excalidraw');
        expect(result).toEqual({
            workspaceId: 'ws-1',
            diagramPath: 'my diagram.excalidraw',
        });
    });

    it('returns null for non-excalidraw URLs', () => {
        expect(parseExcalidrawLink('https://example.com/foo')).toBeNull();
        expect(parseExcalidrawLink('file:///tmp/foo')).toBeNull();
    });

    it('returns null for malformed excalidraw links', () => {
        expect(parseExcalidrawLink('excalidraw://')).toBeNull();
        expect(parseExcalidrawLink('excalidraw:///missing-ws')).toBeNull();
        expect(parseExcalidrawLink('excalidraw://ws-only')).toBeNull();
    });

    it('is case-insensitive for the protocol', () => {
        const result = parseExcalidrawLink('EXCALIDRAW://ws-1/test.excalidraw');
        expect(result).toEqual({
            workspaceId: 'ws-1',
            diagramPath: 'test.excalidraw',
        });
    });
});

// =====================================================================
// Excalidraw embed in chatMarkdownToHtml
// =====================================================================

describe('chatMarkdownToHtml — excalidraw embeds', () => {
    it('converts markdown link with excalidraw:// to placeholder div when enabled', () => {
        const html = chatMarkdownToHtml(
            'Here is a diagram: [Architecture](excalidraw://ws-1/arch.excalidraw)',
            undefined,
            { excalidrawEmbedEnabled: true },
        );
        expect(html).toContain('class="md-excalidraw-embed"');
        expect(html).toContain('data-ws-id="ws-1"');
        expect(html).toContain('data-diagram-path="arch.excalidraw"');
    });

    it('does not create placeholder when excalidraw embed is disabled', () => {
        const html = chatMarkdownToHtml(
            'Here is [diagram](excalidraw://ws-1/arch.excalidraw)',
            undefined,
            { excalidrawEmbedEnabled: false },
        );
        expect(html).not.toContain('md-excalidraw-embed');
        // Should render as a regular link
        expect(html).toContain('excalidraw://ws-1/arch.excalidraw');
    });

    it('converts bare excalidraw:// URL in text to placeholder when enabled', () => {
        const html = chatMarkdownToHtml(
            'I created the diagram: excalidraw://ws-2/flow.excalidraw',
            undefined,
            { excalidrawEmbedEnabled: true },
        );
        expect(html).toContain('class="md-excalidraw-embed"');
        expect(html).toContain('data-ws-id="ws-2"');
        expect(html).toContain('data-diagram-path="flow.excalidraw"');
    });

    it('does not convert bare excalidraw URL when disabled', () => {
        const html = chatMarkdownToHtml(
            'Link: excalidraw://ws-2/flow.excalidraw',
            undefined,
            { excalidrawEmbedEnabled: false },
        );
        expect(html).not.toContain('md-excalidraw-embed');
    });

    it('handles multiple excalidraw links in the same message', () => {
        const html = chatMarkdownToHtml(
            'First: [A](excalidraw://ws-1/a.excalidraw) and second: [B](excalidraw://ws-1/b.excalidraw)',
            undefined,
            { excalidrawEmbedEnabled: true },
        );
        const matches = html.match(/md-excalidraw-embed/g);
        expect(matches).toHaveLength(2);
        expect(html).toContain('data-diagram-path="a.excalidraw"');
        expect(html).toContain('data-diagram-path="b.excalidraw"');
    });
});

// =====================================================================
// parseCanvasEmbedLink
// =====================================================================

describe('parseCanvasEmbedLink', () => {
    it('parses a valid canvas marker', () => {
        expect(parseCanvasEmbedLink('canvas://arch-1a2b3c')).toEqual({ canvasId: 'arch-1a2b3c' });
    });

    it('is case-insensitive for the protocol', () => {
        expect(parseCanvasEmbedLink('CANVAS://diagram-42')).toEqual({ canvasId: 'diagram-42' });
    });

    it('returns null for other URL schemes', () => {
        expect(parseCanvasEmbedLink('https://example.com/foo')).toBeNull();
        expect(parseCanvasEmbedLink('excalidraw://ws-1/a.excalidraw')).toBeNull();
    });

    it('returns null for malformed markers', () => {
        expect(parseCanvasEmbedLink('canvas://')).toBeNull();
        expect(parseCanvasEmbedLink('canvas://has/slash')).toBeNull();
        expect(parseCanvasEmbedLink('canvas://-bad-start')).toBeNull();
        expect(parseCanvasEmbedLink('canvas://has space')).toBeNull();
    });
});

// =====================================================================
// Generic canvas embed markers in chatMarkdownToHtml
// =====================================================================

describe('chatMarkdownToHtml — canvas embeds', () => {
    it('converts a markdown link with canvas:// to a placeholder div stamped with the workspace', () => {
        const html = chatMarkdownToHtml(
            'Here is the diagram: [Architecture](canvas://arch-1)',
            'ws-1',
            { excalidrawEmbedEnabled: true },
        );
        expect(html).toContain('class="md-canvas-embed"');
        expect(html).toContain('data-canvas-id="arch-1"');
        expect(html).toContain('data-ws-id="ws-1"');
    });

    it('converts a bare canvas:// marker in text to a placeholder div', () => {
        const html = chatMarkdownToHtml(
            'I created the diagram: canvas://flow-2',
            'ws-9',
            { excalidrawEmbedEnabled: true },
        );
        expect(html).toContain('class="md-canvas-embed"');
        expect(html).toContain('data-canvas-id="flow-2"');
        expect(html).toContain('data-ws-id="ws-9"');
    });

    it('does not create a placeholder when the embed feature is disabled', () => {
        const html = chatMarkdownToHtml(
            'See canvas://arch-1 here',
            'ws-1',
            { excalidrawEmbedEnabled: false },
        );
        expect(html).not.toContain('md-canvas-embed');
        expect(html).toContain('canvas://arch-1');
    });

    it('round-trips the write_canvas embed marker into an inline placeholder', () => {
        // Mirrors what write_canvas returns for an excalidraw canvas: canvas://<id>.
        const canvasId = 'sequence-diagram-7';
        const embed = `canvas://${canvasId}`;
        const html = chatMarkdownToHtml(`Done — ${embed}`, 'ws-1', { excalidrawEmbedEnabled: true });
        expect(html).toContain(`data-canvas-id="${canvasId}"`);
        expect(html).toContain('data-ws-id="ws-1"');
    });

    it('handles multiple canvas markers in the same message', () => {
        const html = chatMarkdownToHtml(
            'First: [A](canvas://a-1) and second: [B](canvas://b-2)',
            'ws-1',
            { excalidrawEmbedEnabled: true },
        );
        const matches = html.match(/md-canvas-embed/g);
        expect(matches).toHaveLength(2);
        expect(html).toContain('data-canvas-id="a-1"');
        expect(html).toContain('data-canvas-id="b-2"');
    });
});

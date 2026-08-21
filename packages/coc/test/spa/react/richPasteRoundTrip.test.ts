/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { pasteHtmlToMarkdown } from '../../../src/server/spa/client/react/shared/pasteHtmlToMarkdown';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';

// AC-03 regression guard: rich HTML pasted into the composer is converted to
// markdown (AC-01), sent as a plain string, and that same string renders
// formatted in the user bubble (AC-02). No intermediate contract carries HTML.

const RICH_HTML = [
    '<h2>Release notes</h2>',
    '<p>This build is <b>stable</b> and <em>fast</em>.</p>',
    '<ul><li>fixed the <code>parser</code></li><li>see <a href="https://example.com/changelog">changelog</a></li></ul>',
    '<pre>npm install\nnpm test</pre>',
].join('');

const PLAIN_FALLBACK = 'Release notes\nThis build is stable and fast.\nfixed the parser\nsee changelog\nnpm install\nnpm test';

describe('rich paste round trip (paste → markdown string → bubble html)', () => {
    it('preserves headings, emphasis, lists, links, inline and fenced code', () => {
        const markdown = pasteHtmlToMarkdown(RICH_HTML, PLAIN_FALLBACK);
        expect(markdown).not.toBeNull();

        // The wire payload stays a plain markdown string with no HTML tags.
        expect(markdown).toContain('## Release notes');
        expect(markdown).toContain('**stable**');
        expect(markdown).toContain('*fast*');
        expect(markdown).toContain('- fixed the `parser`');
        expect(markdown).toContain('[changelog](https://example.com/changelog)');
        expect(markdown).toContain('```\nnpm install\nnpm test\n```');
        expect(markdown).not.toMatch(/<[a-z]+[ >]/i);

        const html = chatMarkdownToHtml(markdown as string);
        expect(html).toContain('Release notes</h2>');
        expect(html).toContain('<strong>stable</strong>');
        expect(html).toContain('<em>fast</em>');
        expect(html).toContain('<li>fixed the <code>parser</code></li>');
        expect(html).toContain('<a href="https://example.com/changelog"');
        expect(html).toContain('<pre><code>npm install\nnpm test');
    });

    it('never lets pasted script content execute: markup survives only as escaped text', () => {
        const markdown = pasteHtmlToMarkdown(
            '<p>look &lt;script&gt;alert(1)&lt;/script&gt; here</p>',
            'look <script>alert(1)</script> here',
        );
        // Whether conversion or the plain fallback wins, render the result.
        const html = chatMarkdownToHtml(markdown ?? 'look <script>alert(1)</script> here');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('plain text pastes stay byte-identical through the round trip fallback', () => {
        const plain = 'just two lines\nno formatting at all';
        expect(pasteHtmlToMarkdown('<span>just two lines\nno formatting at all</span>', plain)).toBeNull();
        // breaks:true keeps the two lines as separate rendered lines.
        expect(chatMarkdownToHtml(plain)).toContain('just two lines<br>no formatting at all');
    });
});

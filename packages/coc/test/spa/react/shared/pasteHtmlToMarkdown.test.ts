/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { pasteHtmlToMarkdown } from '../../../../src/server/spa/client/react/shared/pasteHtmlToMarkdown';

describe('pasteHtmlToMarkdown', () => {
    it('converts bold, italic and strikethrough', () => {
        const md = pasteHtmlToMarkdown(
            '<p>Hello <b>bold</b>, <em>italic</em> and <s>gone</s></p>',
            'Hello bold, italic and gone',
        );
        expect(md).toBe('Hello **bold**, *italic* and ~~gone~~');
    });

    it('converts headings', () => {
        const md = pasteHtmlToMarkdown(
            '<h2>Section title</h2><p>Body text</p>',
            'Section title\nBody text',
        );
        expect(md).toBe('## Section title\n\nBody text');
    });

    it('converts nested lists', () => {
        const md = pasteHtmlToMarkdown(
            '<ul><li>one<ul><li>one-a</li><li>one-b</li></ul></li><li>two</li></ul>',
            'one\none-a\none-b\ntwo',
        );
        expect(md).toContain('- one');
        expect(md).toContain('    - one-a');
        expect(md).toContain('    - one-b');
        expect(md).toContain('- two');
    });

    it('converts ordered lists', () => {
        const md = pasteHtmlToMarkdown(
            '<ol><li>first</li><li>second</li></ol>',
            'first\nsecond',
        );
        expect(md).toBe('1. first\n2. second');
    });

    it('converts links', () => {
        const md = pasteHtmlToMarkdown(
            '<p>See <a href="https://example.com/docs">the docs</a> now</p>',
            'See the docs now',
        );
        expect(md).toBe('See [the docs](https://example.com/docs) now');
    });

    it('converts inline code', () => {
        const md = pasteHtmlToMarkdown(
            '<p>Call <code>doWork()</code> here</p>',
            'Call doWork() here',
        );
        expect(md).toBe('Call `doWork()` here');
    });

    it('converts pre>code to a fenced code block', () => {
        const md = pasteHtmlToMarkdown(
            '<pre><code>const a = 1;\nconst b = 2;</code></pre>',
            'const a = 1;\nconst b = 2;',
        );
        expect(md).toBe('```\nconst a = 1;\nconst b = 2;\n```');
    });

    it('converts bare pre (no code child) to a fenced code block', () => {
        const md = pasteHtmlToMarkdown(
            '<pre>$ npm test\nall green\n</pre>',
            '$ npm test\nall green',
        );
        expect(md).toBe('```\n$ npm test\nall green\n```');
    });

    it('converts blockquotes', () => {
        const md = pasteHtmlToMarkdown(
            '<blockquote><p>quoted wisdom</p></blockquote>',
            'quoted wisdom',
        );
        expect(md).toBe('> quoted wisdom');
    });

    it('converts tables to GFM pipe tables', () => {
        const md = pasteHtmlToMarkdown(
            '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>'
            + '<tbody><tr><td>Ada</td><td>36</td></tr><tr><td>Alan</td><td>41</td></tr></tbody></table>',
            'Name Age\nAda 36\nAlan 41',
        );
        expect(md).toBe(
            '| Name | Age |\n| --- | --- |\n| Ada | 36 |\n| Alan | 41 |',
        );
    });

    it('emits a separator for td-only tables (no thead)', () => {
        const md = pasteHtmlToMarkdown(
            '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
            'a b\nc d',
        );
        expect(md).toBe('| a | b |\n| --- | --- |\n| c | d |');
    });

    it('drops inline images', () => {
        const md = pasteHtmlToMarkdown(
            '<p>before <img src="https://example.com/x.png" alt="pic"> <b>after</b></p>',
            'before after',
        );
        expect(md).not.toContain('x.png');
        expect(md).toContain('**after**');
    });

    it('strips script and style content', () => {
        const md = pasteHtmlToMarkdown(
            '<style>.x{color:red}</style><script>alert(1)</script><p><b>safe</b></p>',
            'safe',
        );
        expect(md).toBe('**safe**');
    });

    it('returns null when there is no html flavor', () => {
        expect(pasteHtmlToMarkdown('', 'plain')).toBeNull();
        expect(pasteHtmlToMarkdown('   ', 'plain')).toBeNull();
    });

    it('returns null for a trivial span wrapper around plain text', () => {
        expect(
            pasteHtmlToMarkdown(
                '<meta charset="utf-8"><span style="color: rgb(36, 41, 47)">just some text</span>',
                'just some text',
            ),
        ).toBeNull();
    });

    it('returns null for multi-line editor pastes that only wrap plain lines', () => {
        // VS Code-style clipboard HTML: one div per line, colored spans inside.
        expect(
            pasteHtmlToMarkdown(
                '<div><span style="color:#d4d4d4">line one</span></div>'
                + '<div><span style="color:#d4d4d4">line two</span></div>',
                'line one\nline two',
            ),
        ).toBeNull();
    });

    it('returns null when markdown differs from plain text only by escapes', () => {
        // Turndown escapes `*` etc.; that alone is not meaningful markup.
        expect(
            pasteHtmlToMarkdown(
                '<div>const a = 1 * 2;</div>',
                'const a = 1 * 2;',
            ),
        ).toBeNull();
    });

    it('normalizes non-breaking spaces to regular spaces', () => {
        const md = pasteHtmlToMarkdown(
            '<p><b>bold</b>&nbsp;text</p>',
            'bold text',
        );
        expect(md).toBe('**bold** text');
    });
});

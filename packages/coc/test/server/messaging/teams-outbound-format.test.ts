import { describe, expect, it } from 'vitest';
import { escapeTeamsMarkdown, formatTeamsOutbound, teamsCodeSpan } from '../../../src/server/messaging/teams-outbound-format';

describe('formatTeamsOutbound', () => {
    it('renders repository rows as ordered Teams HTML without Markdown delimiters', () => {
        const html = formatTeamsOutbound(
            '**Agents / Repos** (2):\n1. **Alpha** — `C:\\repo\\alpha`\n2. **Beta** — `/repo/beta`',
            'markdown',
        );
        expect(html).toBe(
            '<p>CoC · <strong>Agents / Repos</strong> (2):</p>' +
            '<ol><li><strong>Alpha</strong> — <code>C:\\repo\\alpha</code></li>' +
            '<li><strong>Beta</strong> — <code>/repo/beta</code></li></ol>',
        );
    });

    it('keeps prose, paragraphs, emphasis, lists, and fenced code readable', () => {
        const html = formatTeamsOutbound(
            'First line\nsecond *line*\n\n- item\n- **another**\n\n```ts\nconst value = "<tag> &";\n```',
            'markdown',
        );
        expect(html).toContain('<p>CoC · First line<br>second <em>line</em></p>');
        expect(html).toContain('<ul><li>item</li><li><strong>another</strong></li></ul>');
        expect(html).toContain('<pre><code>const value = &quot;&lt;tag&gt; &amp;&quot;;</code></pre>');
        expect(html).not.toContain('<tag>');
    });

    it('escapes hostile names, paths, inline HTML, and attribute contents', () => {
        const html = formatTeamsOutbound(
            '**Agents / Repos** (1):\n1. **<img src=x onerror=alert(1)>** — ' +
            '`C:\\<script>alert(1)</script>`\n' +
            '[docs](https://example.org/?q="bad"&x=1) <svg onload=alert(1)>',
            'markdown',
        );
        expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
        expect(html).toContain('<code>C:\\&lt;script&gt;alert(1)&lt;/script&gt;</code>');
        expect(html).toContain('<a href="https://example.org/?q=&quot;bad&quot;&amp;x=1">docs</a>');
        expect(html).toContain('&lt;svg onload=alert(1)&gt;');
        expect(html).not.toMatch(/<(?:img|script|svg)\b/i);
    });

    it('preserves backticks inside paths and neutralizes Markdown inside repository names', () => {
        const name = '**[click](javascript:alert(1))';
        const path = '`C:\\repo\\`danger`';
        const html = formatTeamsOutbound(
            `1. **${escapeTeamsMarkdown(name)}** — ${teamsCodeSpan(path)}`,
            'markdown',
        );
        expect(html).toContain('<strong>**[click](javascript:alert(1))</strong>');
        expect(html).toContain('<code>`C:\\repo\\`danger`</code>');
        expect(html).not.toContain('<a ');
    });

    it.each([
        '[unsafe](javascript:alert(1))',
        '[unsafe](data:text/html,hi)',
        '[unsafe](file:///secret)',
        '[unsafe](//example.org/path)',
        '[unsafe](https://safe.invalid/" onclick="alert(1))',
    ])('never emits an unsafe link for %s', markdown => {
        const html = formatTeamsOutbound(markdown, 'markdown');
        expect(html).not.toMatch(/href="(?:javascript:|data:|file:|\/\/)/i);
        expect(html).not.toMatch(/<[^>]*\sonclick=/);
    });

    it('retains safe links and preformatted relay HTML without escaping it twice', () => {
        expect(formatTeamsOutbound('[docs](https://example.org/a?x=1&y=2)', 'markdown'))
            .toContain('<a href="https://example.org/a?x=1&amp;y=2">docs</a>');
        expect(formatTeamsOutbound('[email](mailto:help@example.org)', 'markdown'))
            .toContain('<a href="mailto:help@example.org">email</a>');
        expect(formatTeamsOutbound('A &amp; B', 'markdown')).toBe('<p>CoC · A &amp; B</p>');
        const relay = '<p><strong>Request opaque · Part 1/1</strong></p><p>A &amp; B</p>';
        expect(formatTeamsOutbound(relay, 'html')).toBe(
            '<p>CoC · <strong>Request opaque · Part 1/1</strong></p><p>A &amp; B</p>',
        );
    });

    it.each(['markdown', 'html'] as const)('keeps short %s answers and attribution on one line', source => {
        const answer = '6 outgoing commits — up 1 since your last check';
        const html = formatTeamsOutbound(source === 'html' ? `<p>${answer}</p>` : answer, source);
        expect(html).toBe(`<p>CoC · ${answer}</p>`);
        expect(html.match(/CoC · /g)).toHaveLength(1);
    });

    it.each([
        ['# Summary', '<p>CoC · <strong>Summary</strong></p>'],
        ['- first\n- second', '<ul><li>CoC · first</li><li>second</li></ul>'],
        ['2. first\n3. second', '<ol start="2"><li>CoC · first</li><li>second</li></ol>'],
        ['> quoted', '<p>CoC · quoted</p>'],
        ['```ts\nx < y\n```', '<p>CoC · AI-generated response</p><pre><code>x &lt; y</code></pre>'],
        ['', '<p>CoC · (No answer provided.)</p>'],
        [' \n ', '<p>CoC · (No answer provided.)</p>'],
    ])('attributes Markdown block %j without corrupting its shape', (text, expected) => {
        expect(formatTeamsOutbound(text, 'markdown')).toBe(expected);
    });

    it.each([
        ['<h2>Summary</h2>', '<h2>CoC · Summary</h2>'],
        ['<ul><li><p>First</p></li><li>Second</li></ul>',
            '<ul><li><p>CoC · First</p></li><li>Second</li></ul>'],
        ['<div><blockquote><p>A &amp; B</p></blockquote></div>',
            '<div><blockquote><p>CoC · A &amp; B</p></blockquote></div>'],
        ['\n<br><p></p><p>Short</p>', '<p>CoC · Short</p>'],
        ['<pre><code>&lt;x&gt;</code></pre>',
            '<p>CoC · AI-generated response</p><pre><code>&lt;x&gt;</code></pre>'],
        ['<div><pre><code>x</code></pre></div>',
            '<p>CoC · AI-generated response</p><div><pre><code>x</code></pre></div>'],
        ['<strong>Short</strong>', '<p>CoC · <strong>Short</strong></p>'],
        ['', '<p>CoC · (No answer provided.)</p>'],
    ])('preserves HTML block %j with exactly one attribution', (text, expected) => {
        const html = formatTeamsOutbound(text, 'html');
        expect(html).toBe(expected);
        expect(html.match(/CoC · /g)).toHaveLength(1);
    });
});

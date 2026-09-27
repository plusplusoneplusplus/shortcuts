import { describe, expect, it } from 'vitest';
import { formatTeamsAnswerChunks, TEAMS_ANSWER_MAX_BYTES } from '../../../src/server/messaging/teams-answer-format';

const size = (text: string) => Buffer.byteLength(text, 'utf8');

function content(parts: string[]): string {
    return parts.map(part => part.replace(/^<p><strong>Request [\w-]+ · Part \d+\/\d+<\/strong><\/p>/, '')).join('');
}

function visible(html: string): string {
    return html.replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function expectValid(parts: string[], label: string): void {
    expect(parts.length).toBeGreaterThan(0);
    parts.forEach((part, index) => {
        expect(part.startsWith(`<p><strong>Request ${label} · Part ${index + 1}/${parts.length}</strong></p>`)).toBe(true);
        expect(size(part)).toBeLessThanOrEqual(TEAMS_ANSWER_MAX_BYTES);
        expect(part).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
        expect(part).not.toMatch(/&(?:amp|lt|gt|quot|#39)(?!;)/);
        const tags = part.match(/<\/?(?:p|strong|em|code|pre|a|br)\b[^>]*>/g) ?? [];
        const open: string[] = [];
        for (const tag of tags) {
            if (tag === '<br>') continue;
            const name = tag.match(/^<\/?(\w+)/)![1];
            if (tag.startsWith('</')) expect(open.pop()).toBe(name);
            else open.push(name);
        }
        expect(open).toEqual([]);
    });
}

describe('formatTeamsAnswerChunks', () => {
    it('formats paragraphs, headings, lists, links, and code without discarding content', () => {
        const answer = '## Summary\nFirst & <safe> line\n\n- one\n2. two\n' +
            '[docs](https://example.org/a?x=1&y=2) and `C:\\work\\repo` and **bold** *em*\n' +
            '```ts\nconst x = "<script>";\nconst y = 2;\n```';
        const parts = formatTeamsAnswerChunks(answer, 'req_12');
        expectValid(parts, 'req_12');
        const html = content(parts);
        expect(html).toContain('<strong>Summary</strong>');
        expect(html).toContain('<p>- one</p>');
        expect(html).toContain('<p>2. two</p>');
        expect(html).toContain('<a href="https://example.org/a?x=1&amp;y=2">docs</a>');
        expect(html).toContain('<code>C:\\work\\repo</code>');
        expect(html).toContain('<pre><code>const x = &quot;&lt;script&gt;&quot;;\nconst y = 2;</code></pre>');
        expect(visible(html)).toContain('First & <safe> line');
    });

    it('escapes hostile markup, labels, attributes, and unsafe link destinations', () => {
        const answer = '<script>alert("x")</script> & <img src=x onerror=bad()>\n' +
            '[click](javascript:alert(1)) [safe](https://example.org/"onclick="evil)';
        const html = content(formatTeamsAnswerChunks(answer, 'opaque-2'));
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&lt;img src=x onerror=bad()&gt;');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('href="javascript:');
        expect(visible(html)).toContain('[click](javascript:alert(1))');
        expect(() => formatTeamsAnswerChunks('okay', '<img src=x>')).toThrow(TypeError);
        expect(() => formatTeamsAnswerChunks('okay', 'private prompt text')).toThrow(TypeError);
        expect(() => formatTeamsAnswerChunks('okay', '')).toThrow(TypeError);
    });

    it('handles an empty answer and unmatched code fences visibly', () => {
        expect(visible(content(formatTeamsAnswerChunks(' \n ', 'r1')))).toBe('(No answer provided.)');
        expect(visible(content(formatTeamsAnswerChunks('```txt\nhello <x>', 'r1'))))
            .toBe('```txt\nhello <x>');
    });

    it('splits at paragraph boundaries when possible and includes the last part', () => {
        const lines = Array.from({ length: 180 }, (_, i) => `Paragraph ${i}: ${'word '.repeat(28)}`);
        const parts = formatTeamsAnswerChunks(lines.join('\n'), 'r7');
        expect(parts.length).toBeGreaterThan(1);
        expectValid(parts, 'r7');
        expect(visible(content(parts))).toBe(lines.join(''));
        expect(parts.at(-1)).toContain('Paragraph 179:');
    });

    it('splits a long unbroken grapheme stream after escaping, without corrupting its order', () => {
        const sequence = '👩‍💻e\u0301<&\\"\'';
        const answer = sequence.repeat(3200);
        const parts = formatTeamsAnswerChunks(answer, 'r8');
        expect(parts.length).toBeGreaterThan(2);
        expectValid(parts, 'r8');
        expect(visible(content(parts))).toBe(answer);
        const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(answer),
            ({ index }) => index));
        boundaries.add(answer.length);
        let offset = 0;
        for (const part of parts) {
            offset += visible(content([part])).length;
            expect(boundaries.has(offset)).toBe(true);
        }
    });

    it('keeps long fenced code and Windows backslashes, including the very last bytes', () => {
        const code = ('C:\\project\\x <tag> & 👨‍👩‍👦\n').repeat(1600) + 'last\\line';
        const parts = formatTeamsAnswerChunks(`\`\`\`txt\n${code}\n\`\`\``, 'r9');
        expectValid(parts, 'r9');
        expect(parts.length).toBeGreaterThan(1);
        expect(visible(content(parts))).toBe(code);
        for (const part of parts.slice(0, -1)) {
            expect(visible(content([part])).endsWith('\n')).toBe(true);
        }
        expect(parts.at(-1)).toContain('last\\line');
    });

    it('delivers one long mixed-content answer in order without truncating its final code', () => {
        const first = 'Text & <script> 👩‍💻 C:\\repo\\file '.repeat(900);
        const answer = `${first}\n[documentation](https://example.org/path?a=1&b=2)\n` +
            '```ts\nconst last = "C:\\repo\\last 👩‍💻";\n```';
        const parts = formatTeamsAnswerChunks(answer, 'mixed');
        expect(parts.length).toBeGreaterThan(1);
        expectValid(parts, 'mixed');
        const html = content(parts);
        expect(html).not.toContain('<script>');
        expect(html).toContain('<a href="https://example.org/path?a=1&amp;b=2">documentation</a>');
        expect(visible(html)).toBe(first + 'documentation' + 'const last = "C:\\repo\\last 👩‍💻";');
        expect(parts.at(-1)).toContain('last 👩‍💻');
    });

    it('reserves room for numbering at a digit rollover', () => {
        const answer = Array.from({ length: 11 }, (_, i) => `row${i}:${'&'.repeat(3900)}`).join('\n');
        const parts = formatTeamsAnswerChunks(answer, 'r10');
        expectValid(parts, 'r10');
        expect(parts.length).toBeGreaterThanOrEqual(11);
        expect(visible(content(parts))).toBe(answer.replace(/\n/g, ''));
    });

    it('is deterministic for safe opaque labels and does not include prompt text in headers', () => {
        const answer = 'secret question?';
        const first = formatTeamsAnswerChunks(answer, 'request-1');
        expect(first).toEqual(formatTeamsAnswerChunks(answer, 'request-1'));
        expect(first[0]).toMatch(/^<p><strong>Request request-1 · Part 1\/1<\/strong><\/p>/);
        expect(formatTeamsAnswerChunks(answer, 'request-2')[0]).not.toBe(first[0]);
    });
});

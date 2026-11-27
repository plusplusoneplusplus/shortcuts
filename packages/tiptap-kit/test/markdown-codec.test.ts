import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { createMarkdownCodec, type MarkdownCodecExtension } from '../src/markdown/index.js';
import { mathMarkdownExtension } from '../src/math/index.js';

const { markdownToHtml, htmlToMarkdown } = createMarkdownCodec();
const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md));

describe('createMarkdownCodec (built-in rules)', () => {
    it('returns empty strings for empty input and an empty document', () => {
        expect(markdownToHtml('')).toBe('');
        expect(htmlToMarkdown('')).toBe('');
        expect(htmlToMarkdown('<p></p>')).toBe('');
    });

    it('turns GFM task lists into Tiptap task-list markup and back', () => {
        const html = markdownToHtml('- [x] done\n- [ ] todo');
        expect(html).toContain('<ul data-type="taskList">');
        expect(html).toContain('<li data-type="taskItem" data-checked="true">done</li>');
        expect(htmlToMarkdown(html)).toBe('- [x] done\n- [ ] todo\n');
    });

    it('round-trips highlight, strikethrough, sup/sub and text style', () => {
        expect(roundTrip('a ==b== c ~~d~~ x<sup>2</sup> H<sub>2</sub>O\n')).toBe(
            'a ==b== c ~~d~~ x<sup>2</sup> H<sub>2</sub>O\n',
        );
        expect(roundTrip('<span style="color:#e03131">red</span>\n')).toBe('<span style="color:#e03131">red</span>\n');
    });

    it('drops style declarations it does not persist', () => {
        expect(markdownToHtml('<span style="position:fixed; color:#e03131">x</span>')).toContain(
            '<span style="color:#e03131">x</span>',
        );
    });

    it('round-trips a GFM table and keeps a sized table as raw HTML', () => {
        expect(roundTrip('| a | b |\n| --- | ---: |\n| 1 | 2 |\n')).toBe('| a | b |\n| --- | ---: |\n| 1 | 2 |\n');
        const md = htmlToMarkdown('<table><tbody><tr><th colwidth="120">a</th></tr><tr><td>1</td></tr></tbody></table>');
        expect(md).toContain('<table><colgroup><col width="120"></colgroup>');
    });

    it('keeps empty paragraphs, indented lists and Mermaid fences', () => {
        expect(htmlToMarkdown('<p>a</p><p></p><p>b</p>')).toBe('a\n\n<p>&nbsp;</p>\n\nb\n');
        expect(markdownToHtml('a\n\n<p>&nbsp;</p>\n\nb')).toContain('<p></p>');
        expect(htmlToMarkdown('<ul data-indent="2"><li>x</li></ul>')).toContain('<ul data-indent="2"><li>x</li></ul>');
        expect(roundTrip('```mermaid\ngraph TD\n```\n')).toBe('```mermaid\ngraph TD\n```\n');
    });

    it('strips the trailing newline marked adds inside code blocks', () => {
        expect(markdownToHtml('```\nx\n```')).toContain('<pre><code>x</code></pre>');
    });

    it('leaves the global marked instance unconfigured', () => {
        createMarkdownCodec({ extensions: [{ name: 'x', marked: { breaks: true } }] });
        expect(marked.parse('a\nb')).toBe('<p>a\nb</p>\n');
    });
});

describe('createMarkdownCodec extensions', () => {
    const shout: MarkdownCodecExtension = {
        name: 'shout',
        marked: {
            extensions: [{
                name: 'shout',
                level: 'inline',
                start: (src: string) => src.indexOf('!!'),
                tokenizer(src: string) {
                    const m = /^!!(\w+)!!/.exec(src);
                    return m ? { type: 'shout', raw: m[0], text: m[1] } : undefined;
                },
                renderer: (token) => `<span data-shout="${token.text}">${token.text}</span>`,
            }],
        },
        turndownRules(turndown) {
            turndown.addRule('shout', {
                filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-shout'),
                replacement: (_content, node) => `!!${(node as HTMLElement).getAttribute('data-shout')}!!`,
            });
        },
    };

    it('adds host syntax on both sides', () => {
        const codec = createMarkdownCodec({ extensions: [shout] });
        const html = codec.markdownToHtml('say !!hi!!');
        expect(html).toContain('<span data-shout="hi">hi</span>');
        expect(codec.htmlToMarkdown(html)).toBe('say !!hi!!\n');
        expect(createMarkdownCodec().markdownToHtml('say !!hi!!')).not.toContain('data-shout');
    });

    it('checks host rules before the built-in text-style span rule', () => {
        const codec = createMarkdownCodec({ extensions: [shout] });
        expect(codec.htmlToMarkdown('<p><span data-shout="hi" style="color:#e03131">hi</span></p>')).toBe('!!hi!!\n');
    });

    it('runs parse and serialize wrappers outermost-first and skips them for empty input', () => {
        const calls: string[] = [];
        const wrap = (name: string): MarkdownCodecExtension => ({
            name,
            parse(md, next) {
                calls.push(`parse:${name}`);
                return next(md);
            },
            serialize(html, next) {
                calls.push(`serialize:${name}`);
                return `${next(html)}<!-- ${name} -->\n`;
            },
        });
        const codec = createMarkdownCodec({ extensions: [wrap('outer'), wrap('inner')] });
        codec.markdownToHtml('x');
        expect(codec.htmlToMarkdown('<p>x</p>')).toBe('x\n<!-- inner -->\n<!-- outer -->\n');
        expect(calls).toEqual(['parse:outer', 'parse:inner', 'serialize:outer', 'serialize:inner']);
        calls.length = 0;
        codec.htmlToMarkdown('<p></p>');
        codec.markdownToHtml('');
        expect(calls).toEqual([]);
    });
});

describe('mathMarkdownExtension', () => {
    const codec = createMarkdownCodec({ extensions: [mathMarkdownExtension] });

    it('round-trips every delimiter form byte for byte', () => {
        for (const md of ['a $x^2$ b\n', 'a \\(x\\) b\n', '$$\n\\int f\n$$\n', '\\[\nx\n\\]\n']) {
            expect(codec.htmlToMarkdown(codec.markdownToHtml(md))).toBe(md);
        }
    });

    it('keeps an indented display formula as a raw placeholder', () => {
        const md = codec.htmlToMarkdown('<div data-math="display" data-tex="x" data-delim="double-dollar" data-indent="1">x</div>');
        expect(md).toContain('<div data-math="display" data-tex="x" data-delim="double-dollar" data-indent="1">x</div>');
    });
});

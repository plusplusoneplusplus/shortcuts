import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkdownToHtml, renderSourceModeToHtml } from '../../../src/server/spa/client/diff/markdown-renderer';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
import { markdownToHtml, htmlToMarkdown } from '../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';

afterEach(cleanup);

const renderers = [
    { name: 'chat', renderMarkdown: chatMarkdownToHtml },
    { name: 'shared preview', renderMarkdown: renderMarkdownToHtml },
];
const variants = ['<br>', '<br/>', '<br />', '<BR>'];

function table(cell: string, header = 'Heading'): string {
    return `| ${header} | Value |\n| :---: | ---: |\n| ${cell} | 42 |`;
}

function parseHtml(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
}

describe.each(renderers)('$name table line breaks', ({ renderMarkdown }) => {
    it.each(variants)('renders multiple cell lines with %s in headers and body', (br) => {
        const root = parseHtml(renderMarkdown(table(`one${br}two${br}three`, `First${br}Last`)));
        expect(root.querySelector('th')?.innerHTML).toBe('First<br>Last');
        expect(root.querySelector('td')?.innerHTML).toBe('one<br>two<br>three');
        expect(root.querySelectorAll('thead th')).toHaveLength(2);
        expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(root.querySelectorAll('tbody td')).toHaveLength(2);
    });

    it('preserves formatting that spans a break and formatting on each line', () => {
        const root = parseHtml(renderMarkdown(table(
            '**bold<br>continued**<br/>*italic*<br />~~removed~~<br>[docs<br>more](https://example.com)<br>`code`',
        )));
        const cell = root.querySelector('td')!;
        expect(cell.querySelectorAll('br')).toHaveLength(6);
        expect(cell.querySelector('strong, .md-bold')?.querySelector('br')).not.toBeNull();
        expect(cell.querySelector('em, .md-italic')?.textContent).toContain('italic');
        expect(cell.querySelector('del, .md-strike')?.textContent).toContain('removed');
        expect(cell.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
        expect(cell.querySelector('a br')).not.toBeNull();
        expect(cell.querySelector('code, .md-inline-code')?.textContent).toContain('code');
    });

    it.each(variants)('keeps escaped and code %s literal', (br) => {
        const escaped = br.replace('<', '&lt;').replace('>', '&gt;');
        const root = parseHtml(renderMarkdown(table(`\\${br} ${escaped} \`${br}\` \`\`${br}\`\``)));
        const cell = root.querySelector('td')!;
        expect(cell.querySelector('br')).toBeNull();
        expect(cell.querySelector('code, .md-inline-code')?.textContent).toContain(br);
        expect(cell.textContent).toContain(br);
    });

    it('keeps table-like fenced code literal', () => {
        const root = parseHtml(renderMarkdown(`\`\`\`text\n${table('one<br>two<br/>three<br />four')}\n\`\`\``));
        expect(root.querySelector('table')).toBeNull();
        expect(root.querySelector('br')).toBeNull();
        expect(root.textContent).toContain('one<br>two<br/>three<br />four');
    });

    it('keeps unsafe HTML and attributed or malformed break tags inert', () => {
        const source = '<script>alert(1)</script> <img src=x onerror=alert(1)> <svg onload=alert(1)></svg> ' +
            '<br onclick=alert(1)> <br style="color:red"> <br data-x="<br>"> </br> <br//> <break> ' +
            '<!-- <br> --> <code>literal<br></code> <pre>literal<br/></pre>';
        const root = parseHtml(renderMarkdown(table(source)));
        const cell = root.querySelector('td')!;
        expect(cell.querySelector('script, img, svg, br, break')).toBeNull();
        expect(cell.textContent).toBe(source);
    });

    it('does not replace code or attribute contents when a real break is also present', () => {
        const root = parseHtml(renderMarkdown(table(
            '`<br>`<br><span title="<br>">literal</span><br/>xCOCHTMLBREAKx0x',
        )));
        const cell = root.querySelector('td')!;
        expect(cell.querySelectorAll('br')).toHaveLength(2);
        expect(cell.querySelector('code, .md-inline-code')?.textContent).toContain('<br>');
        expect(cell.querySelector('span[title]')).toBeNull();
        expect(cell.textContent).toContain('<span title="<br>">literal</span>');
        expect(cell.textContent).toContain('xCOCHTMLBREAKx0x');
    });

    it('preserves existing link rendering when a title contains literal break markup', () => {
        const link = '[docs](https://example.com/path "<br>")';
        const original = parseHtml(renderMarkdown(table(link))).querySelector('td')!.innerHTML;
        const root = parseHtml(renderMarkdown(table(`${link}<br>next`)));
        const cell = root.querySelector('td')!;
        expect(cell.querySelectorAll('br')).toHaveLength(1);
        expect(cell.innerHTML).toBe(`${original}<br>next`);
        expect(cell.querySelector('a br')).toBeNull();
    });

    it('retains breaks, alignment and accessibility when tables upgrade and wrap', () => {
        const md = table('**one<br>two**<br/>`<br />`', 'Head<br>line') +
            '\n| a | 1 |\n| b | 2 |\n| c | 3 |\n| d | 4 |';
        const { container } = render(<MarkdownView html={renderMarkdown(md)} tableWrapToggle />);
        const interactive = container.querySelector('.interactive-table')!;
        const cell = interactive.querySelector('tbody td')!;
        expect(cell.querySelectorAll('br')).toHaveLength(2);
        expect(cell.querySelector('code, .md-inline-code')?.textContent).toContain('<br />');
        expect(interactive.querySelector('thead th br')).not.toBeNull();
        expect(interactive.querySelectorAll('thead th')).toHaveLength(2);
        expect(interactive.querySelectorAll('tbody tr')).toHaveLength(5);
        const classes = Array.from(interactive.querySelectorAll('th, td'), c => c.className);
        const toggle = interactive.querySelector('button[aria-pressed]')!;
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(Array.from(interactive.querySelectorAll('th, td'), c => c.className)).toEqual(classes);
        expect(interactive.querySelectorAll('tbody td br')).toHaveLength(2);
    });
});

it('keeps the Markdown source view literal', () => {
    const root = parseHtml(renderSourceModeToHtml(table('one<br>two<br/>three<br />four')));
    expect(root.querySelector('table, br')).toBeNull();
    expect(root.textContent).toContain('one<br>two<br/>three<br />four');
});

it('supports safe breaks in inert chat content without enabling HTML', () => {
    for (const workspaceId of ['ws-a', 'ws-b']) {
        const root = parseHtml(chatMarkdownToHtml(table('one<br>two<img src=x onerror=alert(1)>'), workspaceId, { inert: true }));
        expect(root.querySelector('td')?.querySelectorAll('br')).toHaveLength(1);
        expect(root.querySelector('img')).toBeNull();
    }
});

describe('notes rich editor line breaks', () => {
    it.each(variants)('already renders %s and saves cell breaks for shared previews', (br) => {
        const html = markdownToHtml(table(`one${br}two${br}three`));
        expect(parseHtml(html).querySelector('td')?.innerHTML).toBe('one<br>two<br>three');
        const saved = htmlToMarkdown(html);
        expect(saved).toContain('one<br>two<br>three');
        for (const { renderMarkdown } of renderers) {
            expect(parseHtml(renderMarkdown(saved)).querySelector('td')?.innerHTML).toBe('one<br>two<br>three');
        }
    });
});

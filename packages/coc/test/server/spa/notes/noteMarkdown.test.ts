import { describe, it, expect } from 'vitest';
import {
    htmlToMarkdown,
    htmlToMarkdownWithComments,
    markdownToHtml,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import type { ExportCommentThread } from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    NOTE_LINK_PASTE_RE,
    noteLinkLabel,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteLinkExtension';

describe('htmlToMarkdownWithComments', () => {
    it('returns same output as htmlToMarkdown when no threads', () => {
        const html = '<p>Hello world</p>';
        expect(htmlToMarkdownWithComments(html, {})).toBe(htmlToMarkdown(html));
    });

    it('appends open threads as Comments section', () => {
        const html = '<p>Hello</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1',
                status: 'open',
                anchor: { quotedText: 'Hello' },
                comments: [
                    { author: 'Alice', content: 'Needs revision', createdAt: '2025-01-01' },
                ],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('## Comments');
        expect(result).toContain('> **On:** "Hello"');
        expect(result).toContain('> Needs revision');
    });

    it('appends resolved threads under Resolved heading with strikethrough', () => {
        const html = '<p>Done</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1',
                status: 'resolved',
                anchor: { quotedText: 'Done' },
                comments: [
                    { author: 'Bob', content: 'LGTM', createdAt: '2025-01-01' },
                ],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('### Resolved');
        expect(result).toContain('> ~~"Done"~~');
    });

    it('renders both open and resolved sections', () => {
        const html = '<p>Mixed</p>';
        const threads: Record<string, ExportCommentThread> = {
            t1: {
                id: 't1', status: 'open',
                anchor: { quotedText: 'open-text' },
                comments: [{ author: 'A', content: 'open comment', createdAt: '' }],
            },
            t2: {
                id: 't2', status: 'resolved',
                anchor: { quotedText: 'resolved-text' },
                comments: [{ author: 'B', content: 'resolved comment', createdAt: '' }],
            },
        };
        const result = htmlToMarkdownWithComments(html, threads);
        expect(result).toContain('## Comments');
        expect(result).toContain('### Resolved');
        const commentsIdx = result.indexOf('## Comments');
        const resolvedIdx = result.indexOf('### Resolved');
        expect(commentsIdx).toBeLessThan(resolvedIdx);
    });
});

describe('htmlToMarkdown — comment span stripping', () => {
    it('strips data-comment-id spans and preserves inner text', () => {
        const html = '<p>Hello <span data-comment-id="c1">world</span>!</p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('Hello world!');
        expect(md).not.toContain('data-comment-id');
        expect(md).not.toContain('<span');
    });
});

describe('note cross-links — markdownToHtml', () => {
    it('converts [[note:path]] to a note-link span', () => {
        const html = markdownToHtml('See [[note:My Notebook/Notes.md]]');
        expect(html).toContain('class="note-link"');
        expect(html).toContain('data-note-path="My Notebook/Notes.md"');
        expect(html).toContain('>Notes<');
    });

    it('converts [[note:path#heading]] to a note-link span with heading', () => {
        const html = markdownToHtml('See [[note:Features/Page.md#my-heading]]');
        expect(html).toContain('data-note-path="Features/Page.md"');
        expect(html).toContain('data-note-heading="my-heading"');
        expect(html).toContain('>Page § my-heading<');
    });

    it('converts [[label|note:path]] with a custom label', () => {
        const html = markdownToHtml('See [[My Custom Label|note:Features/Page.md]]');
        expect(html).toContain('data-note-path="Features/Page.md"');
        expect(html).toContain('>My Custom Label<');
    });

    it('handles multiple note links in one line', () => {
        const html = markdownToHtml('Link [[note:A.md]] and [[note:B.md]] here');
        const matches = html.match(/class="note-link"/g);
        expect(matches).toHaveLength(2);
    });

    it('handles note link inside a paragraph alongside other content', () => {
        const html = markdownToHtml('Before **bold** [[note:File.md]] after');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('class="note-link"');
    });
});

describe('note cross-links — htmlToMarkdown', () => {
    it('converts note-link span back to [[note:path]]', () => {
        const html = '<p>See <span class="note-link" data-note-path="My Notebook/Notes.md">Notes</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('[[note:My Notebook/Notes.md]]');
        expect(md).not.toContain('<span');
    });

    it('converts note-link span with heading back to [[note:path#heading]]', () => {
        const html = '<p><span class="note-link" data-note-path="Page.md" data-note-heading="intro">Page § intro</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('[[note:Page.md#intro]]');
    });

    it('preserves note-link without heading (no trailing #)', () => {
        const html = '<p><span class="note-link" data-note-path="File.md">File</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toBe('[[note:File.md]]\n');
        expect(md).not.toContain('#');
    });
});

describe('note cross-links — round-trip', () => {
    it('round-trips [[note:path]]', () => {
        const original = 'See [[note:My Notebook/Notes.md]] for details';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips [[note:path#heading]]', () => {
        const original = 'Check [[note:Features/Page.md#setup]]';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips multiple note links in mixed content', () => {
        const original = 'First [[note:A.md]] and second [[note:B.md#intro]] done';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });
});

describe('noteLinkLabel', () => {
    it('strips .md and returns basename', () => {
        expect(noteLinkLabel('My Notebook/Notes.md')).toBe('Notes');
    });

    it('returns basename without extension for simple path', () => {
        expect(noteLinkLabel('File.md')).toBe('File');
    });

    it('appends heading with § separator', () => {
        expect(noteLinkLabel('Page.md', 'intro')).toBe('Page § intro');
    });

    it('returns path as-is when no slash and no .md', () => {
        expect(noteLinkLabel('readme')).toBe('readme');
    });

    it('ignores null heading', () => {
        expect(noteLinkLabel('File.md', null)).toBe('File');
    });
});

describe('NOTE_LINK_PASTE_RE — paste regex regression', () => {
    function allMatches(text: string) {
        const re = NOTE_LINK_PASTE_RE();
        const results: Array<{ full: string; path: string; heading?: string }> = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            results.push({ full: m[0], path: m[1], heading: m[2] || undefined });
        }
        return results;
    }

    it('matches [[note:path]]', () => {
        const matches = allMatches('See [[note:My Notebook/Notes.md]] here');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('My Notebook/Notes.md');
        expect(matches[0].heading).toBeUndefined();
    });

    it('matches [[note:path#heading]]', () => {
        const matches = allMatches('See [[note:Page.md#setup]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('Page.md');
        expect(matches[0].heading).toBe('setup');
    });

    it('matches [[label|note:path]]', () => {
        const matches = allMatches('[[Custom Label|note:Features/Page.md]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('Features/Page.md');
    });

    it('matches multiple links in one text', () => {
        const matches = allMatches('Link [[note:A.md]] and [[note:B.md#heading]] done');
        expect(matches).toHaveLength(2);
        expect(matches[0].path).toBe('A.md');
        expect(matches[1].path).toBe('B.md');
        expect(matches[1].heading).toBe('heading');
    });

    it('does not match plain brackets without note: prefix', () => {
        const matches = allMatches('See [[some text]] here');
        expect(matches).toHaveLength(0);
    });

    it('does not match incomplete syntax [[note:', () => {
        const matches = allMatches('See [[note:unclosed here');
        expect(matches).toHaveLength(0);
    });

    it('matches path with spaces', () => {
        const matches = allMatches('[[note:New Features/My Notes.md]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].path).toBe('New Features/My Notes.md');
    });

    it('matches heading with hyphens', () => {
        const matches = allMatches('[[note:Page.md#my-long-heading]]');
        expect(matches).toHaveLength(1);
        expect(matches[0].heading).toBe('my-long-heading');
    });

    it('returns independent regex instances for repeated paste handling', () => {
        const first = NOTE_LINK_PASTE_RE();
        const second = NOTE_LINK_PASTE_RE();

        expect(first.exec('[[note:A.md]]')?.[1]).toBe('A.md');
        expect(first.lastIndex).toBeGreaterThan(0);
        expect(second.exec('[[note:B.md]]')?.[1]).toBe('B.md');
    });
});

describe('table cells — in-cell line breaks', () => {
    // The real save path feeds Tiptap's `getHTML()` into htmlToMarkdown, and
    // Tiptap emits a single <tbody> with <th> header cells and <p>-wrapped cell
    // content (no <thead>). These fixtures mirror that shape.
    const tiptapTable = (rows: string[][]): string => {
        const body = rows
            .map((cols, r) =>
                '<tr>' +
                cols
                    .map((c) =>
                        r === 0
                            ? `<th><p>${c}</p></th>`
                            : `<td><p>${c}</p></td>`,
                    )
                    .join('') +
                '</tr>',
            )
            .join('');
        return `<table><tbody>${body}</tbody></table>`;
    };

    it('preserves an in-cell <br> on save instead of collapsing it to a space', () => {
        const html = tiptapTable([
            ['Day', 'Plan'],
            ['Mon', 'Fly out<br>Check in'],
        ]);
        const md = htmlToMarkdown(html);
        expect(md).toContain('| Mon | Fly out<br>Check in |');
        expect(md).not.toContain('Fly out Check in');
    });

    it('round-trips a <br>-containing cell through markdownToHtml → htmlToMarkdown', () => {
        // Literal Markdown source (task requirement #1): the <br> must survive a
        // parse-then-reserialize pass rather than flattening to a space.
        const source = '| Day | Plan |\n| --- | --- |\n| Mon | Fly out<br>Check in |\n';
        const md = htmlToMarkdown(markdownToHtml(source));
        expect(md).toContain('Fly out<br>Check in');
        expect(md).not.toContain('Fly out Check in');
    });

    it('keeps the <br> token idempotent across repeated save cycles', () => {
        // <br> → \n (lineBreak rule) → <br> (tableCell rule): the break token is
        // stable, so re-saving an already-saved cell never loses or duplicates it.
        const source = '| Day | Plan |\n| --- | --- |\n| Mon | Fly out<br>Check in |\n';
        const once = htmlToMarkdown(markdownToHtml(source));
        const twice = htmlToMarkdown(markdownToHtml(once));
        expect(once).toContain('Fly out<br>Check in');
        expect(twice).toContain('Fly out<br>Check in');
        // No accumulation of stray break tokens on the cell.
        expect(twice.match(/<br>/g)?.length).toBe(1);
    });

    it('collapses multi-paragraph cell content to a single <br>-joined line', () => {
        // A pipe-table cell must be one physical line; two paragraphs join with <br>.
        const html =
            '<table><tbody>' +
            '<tr><th><p>Day</p></th><th><p>Plan</p></th></tr>' +
            '<tr><td><p>Mon</p></td><td><p>Fly out</p><p>Check in</p></td></tr>' +
            '</tbody></table>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('| Mon | Fly out<br>Check in |');
        const cellRow = md.split('\n').find((l) => l.includes('Fly out'));
        expect(cellRow).toBeDefined();
        // Still a single table row: exactly three pipes (leading, middle, trailing).
        expect(cellRow!.match(/\|/g)?.length).toBe(3);
    });

    it('trims edge breaks so a leading/trailing hard break leaves no stray <br>', () => {
        const html =
            '<table><tbody>' +
            '<tr><th><p>H</p></th></tr>' +
            '<tr><td><p><br>value<br></p></td></tr>' +
            '</tbody></table>';
        const md = htmlToMarkdown(html);
        const cellRow = md.split('\n').find((l) => l.includes('value'));
        expect(cellRow).toBeDefined();
        expect(cellRow!).toContain('| value |');
        expect(cellRow!).not.toContain('<br>');
    });

    it('leaves a plain single-line table cell unchanged', () => {
        const html = tiptapTable([
            ['A', 'B'],
            ['1', '2'],
        ]);
        const md = htmlToMarkdown(html);
        expect(md).toContain('| A | B |');
        expect(md).toContain('| 1 | 2 |');
        expect(md).not.toContain('<br>');
    });
});

// Regression guard for the DOM-implementation gap that broke shard 3: turndown runs
// against the real browser DOM in the app but against domino here under Node, and
// domino's querySelector returns `undefined` for a miss where the browser returns
// `null`. Any `querySelector(...) !== null` check therefore silently inverts under
// Node — it matched everything. These cases pin the *routing decision* (pipe table vs
// raw HTML block, code fence vs mermaid fence) in the environment where that gap is
// observable; the jsdom suite cannot catch a regression here.
describe('DOM-implementation robustness (querySelector miss is undefined under domino)', () => {
    it('keeps a plain table on the GFM pipe path instead of the raw-HTML path', () => {
        const html =
            '<table><tbody>' +
            '<tr><th><p>A</p></th><th><p>B</p></th></tr>' +
            '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
            '</tbody></table>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('| A | B |');
        expect(md).not.toContain('<table>');
    });

    it('still routes a table with per-cell state to the raw-HTML path', () => {
        const html =
            '<table><tbody>' +
            '<tr><th data-bg="yellow"><p>A</p></th></tr>' +
            '<tr><td><p>1</p></td></tr>' +
            '</tbody></table>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('<table>');
        expect(md).toContain('data-bg="yellow"');
    });

    it('leaves a non-mermaid code block as a plain fence with its content intact', () => {
        const md = htmlToMarkdown('<pre><code class="language-js">const x = 1;</code></pre>');
        expect(md).toContain('const x = 1;');
        expect(md).not.toContain('```mermaid');
    });

    it('still routes a mermaid code block to a mermaid fence', () => {
        const md = htmlToMarkdown('<pre><code class="language-mermaid">graph TD;</code></pre>');
        expect(md).toContain('```mermaid');
        expect(md).toContain('graph TD;');
    });
});

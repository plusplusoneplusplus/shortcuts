/**
 * pasteHtmlToMarkdown — convert a clipboard `text/html` flavor to markdown
 * source for the chat composer paste path.
 *
 * A leaner chat-specific turndown config than the notes editor's
 * (noteMarkdown.ts): no map/PDF embeds, comment spans, resizable images or
 * text-style spans — just the constructs chat messages can express as
 * markdown (bold/italic/strikethrough, headings, lists, links, inline code,
 * fenced code blocks, blockquotes, tables). Inline images are dropped
 * (image paste is handled out-of-band as attachments).
 *
 * The output is markdown TEXT inserted into the contentEditable as plain
 * text; pasted HTML never reaches the DOM unescaped.
 */

import TurndownService from 'turndown';

let singleton: TurndownService | null = null;

function tableRowChildren(parent: Element): Element[] {
    return Array.from(parent.children).filter(child => child.nodeName === 'TR');
}

function tableCellChildren(row: Element): Element[] {
    return Array.from(row.children).filter(
        child => child.nodeName === 'TH' || child.nodeName === 'TD',
    );
}

/** Every <tr> under a table in document order, sectioned or not. */
function allTableRows(table: Element): Element[] {
    const rows: Element[] = [];
    for (const child of Array.from(table.children)) {
        if (child.nodeName === 'TR') rows.push(child);
        else if (
            child.nodeName === 'THEAD' ||
            child.nodeName === 'TBODY' ||
            child.nodeName === 'TFOOT'
        ) {
            rows.push(...tableRowChildren(child));
        }
    }
    return rows;
}

function getTurndown(): TurndownService {
    if (singleton) return singleton;

    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
        hr: '---',
    });

    // Robustness: never let script/style/metadata text leak into the markdown.
    turndown.remove(['script', 'style', 'noscript', 'title', 'meta', 'link']);

    // <br> → plain \n (chat renders with breaks: true; avoids trailing-space
    // hard-break syntax in the composer).
    turndown.addRule('lineBreak', {
        filter: 'br',
        replacement() {
            return '\n';
        },
    });

    // Tight list markers (`- item` / `1. item`) instead of turndown's
    // three-space default (`-   item`) so the composer shows clean markdown
    // source. Same shape as turndown's built-in listItem rule otherwise.
    turndown.addRule('listItem', {
        filter: 'li',
        replacement(content, node, options) {
            const body = content
                .replace(/^\n+/, '')
                .replace(/\n+$/, '\n')
                .replace(/\n/gm, '\n    ');
            let prefix = `${options.bulletListMarker} `;
            const parent = node.parentNode as Element | null;
            if (parent && parent.nodeName === 'OL') {
                const start = parent.getAttribute('start');
                const index = Array.prototype.indexOf.call(parent.children, node);
                prefix = `${start ? Number(start) + index : index + 1}. `;
            }
            const needsTrailingNewline =
                node.nextSibling && !/\n$/.test(body);
            return prefix + body + (needsTrailingNewline ? '\n' : '');
        },
    });

    turndown.addRule('strikethrough', {
        filter: ['del', 's'],
        replacement(content) {
            return `~~${content}~~`;
        },
    });

    // Inline <img> in pasted HTML is dropped — image paste is already handled
    // out-of-band as attachments.
    turndown.addRule('dropImage', {
        filter: 'img',
        replacement() {
            return '';
        },
    });

    // <pre> without <code> (terminal output, some code viewers) → fenced block.
    turndown.addRule('preWithoutCode', {
        filter(node) {
            if (node.nodeName !== 'PRE') return false;
            return !(node as Element).querySelector?.('code');
        },
        replacement(_content, node) {
            const text = (node.textContent ?? '').replace(/\n$/, '');
            return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
        },
    });

    // GFM pipe tables (lean version of the noteMarkdown rules).
    turndown.addRule('tableCell', {
        filter: ['th', 'td'],
        replacement(content) {
            // A pipe-table cell must be one physical line.
            const cell = content.trim().replace(/\n+/g, '<br>');
            return `| ${cell.replace(/\|/g, '\\|')} `;
        },
    });

    turndown.addRule('tableRow', {
        filter: 'tr',
        replacement(content, node) {
            const row = `${content}|\n`;
            const el = node as Element;
            const table = el.closest?.('table');
            const isFirst = table ? allTableRows(table)[0] === el : false;
            if (!isFirst) return row;
            const separator =
                tableCellChildren(el).map(() => '| --- ').join('') + '|\n';
            return row + separator;
        },
    });

    turndown.addRule('tableSectionPassthrough', {
        filter: ['thead', 'tbody', 'tfoot'],
        replacement(content) {
            return content;
        },
    });

    turndown.addRule('table', {
        filter: 'table',
        replacement(content) {
            const normalized = content.trim().replace(/\n{2,}/g, '\n');
            return `\n\n${normalized}\n\n`;
        },
    });

    singleton = turndown;
    return turndown;
}

/**
 * Normalize text for the "is this markup meaningful?" comparison: strip
 * turndown's backslash escapes and collapse all whitespace. When the
 * converted markdown and the plain-text flavor are equal under this
 * normalization, the HTML carried no formatting markdown can express
 * (e.g. a colored-span wrapper from a code editor) and the plain-text
 * paste path should win.
 */
function normalizeForComparison(text: string): string {
    return text
        .replace(/\\([\\`*_{}[\]()#+\-.!~|>=])/g, '$1')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Convert a clipboard HTML flavor to markdown.
 *
 * Returns `null` when the plain-text paste path should be used instead:
 * no/blank HTML, conversion failure, or trivial markup whose markdown
 * equals the plain-text flavor.
 */
export function pasteHtmlToMarkdown(html: string, plainText: string): string | null {
    if (!html || !html.trim()) return null;
    let markdown: string;
    try {
        markdown = getTurndown().turndown(html);
    } catch {
        return null;
    }
    markdown = markdown.replace(/\u00a0/g, ' ').trim();
    if (!markdown) return null;
    if (normalizeForComparison(markdown) === normalizeForComparison(plainText)) {
        return null;
    }
    return markdown;
}

/**
 * noteMarkdown — Markdown ↔ HTML conversion utilities for the Tiptap editor.
 *
 * markdownToHtml: marked (GFM) → HTML with Tiptap-compatible task-list attributes.
 * htmlToMarkdown: Tiptap HTML → markdown via turndown with custom task-list rules.
 */

import { marked } from 'marked';
import TurndownService from 'turndown';

// ── marked configuration ────────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: false });

// ── turndown singleton ──────────────────────────────────────────────────────

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});

// Strikethrough: <del> / <s> → ~~text~~
turndown.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement(content) {
        return `~~${content}~~`;
    },
});

// Task list container: pass through children, don't wrap in extra markup
turndown.addRule('taskList', {
    filter(node) {
        return (
            node.nodeName === 'UL' &&
            node.getAttribute('data-type') === 'taskList'
        );
    },
    replacement(_content, node) {
        // Process children manually to preserve task item rules
        let out = '';
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1) {
                out += turndown.turndown((child as Element).outerHTML) + '\n';
            }
        }
        return out;
    },
});

// Task list item: serialize to `- [x] ` or `- [ ] `
turndown.addRule('taskItem', {
    filter(node) {
        return (
            node.nodeName === 'LI' &&
            node.getAttribute('data-type') === 'taskItem'
        );
    },
    replacement(_content, node) {
        const checked = node.getAttribute('data-checked') === 'true';
        const prefix = checked ? '- [x] ' : '- [ ] ';
        // Get inner text content, stripping the leading checkbox if present
        let inner = '';
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1) {
                const el = child as Element;
                // Skip checkbox inputs, process other content
                if (el.nodeName === 'INPUT') continue;
                // For label or paragraph wrappers, get their text
                if (el.nodeName === 'LABEL' || el.nodeName === 'DIV' || el.nodeName === 'P') {
                    inner += el.textContent ?? '';
                } else {
                    inner += turndown.turndown(el.outerHTML);
                }
            } else if (child.nodeType === 3) {
                inner += child.textContent ?? '';
            }
        }
        return prefix + inner.trim();
    },
});

// GFM table: <table>/<thead>/<tbody>/<tr>/<th>/<td> → pipe-table markdown
turndown.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement(content) {
        const cell = content.replace(/\n+/g, ' ').trim();
        const escaped = cell.replace(/\|/g, '\\|');
        return `| ${escaped} `;
    },
});

turndown.addRule('tableRow', {
    filter: 'tr',
    replacement(content, node) {
        const row = `${content}|\n`;
        if (node.parentNode && node.parentNode.nodeName === 'THEAD') {
            const cells = Array.from(node.querySelectorAll('th'));
            const separators = cells.map((th) => {
                const style = (th as Element).getAttribute('style') ?? '';
                const align = style.match(/text-align:\s*(\w+)/i)?.[1] ?? '';
                if (align === 'center') return '| :---: ';
                if (align === 'right') return '| ---: ';
                return '| --- ';
            });
            const separator = separators.join('') + '|\n';
            return row + separator;
        }
        return row;
    },
});

turndown.addRule('tableSectionPassthrough', {
    filter: ['thead', 'tbody'],
    replacement(content) {
        return content;
    },
});

turndown.addRule('table', {
    filter: 'table',
    replacement(content) {
        return `\n\n${content.trim()}\n\n`;
    },
});

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a markdown string to HTML suitable for Tiptap's `setContent()`.
 *
 * Task lists (`- [x]` / `- [ ]`) are post-processed into Tiptap-compatible
 * `<ul data-type="taskList">` / `<li data-type="taskItem" data-checked>` markup.
 */
export function markdownToHtml(md: string): string {
    if (!md) return '';
    const html = marked.parse(md) as string;
    return postProcessTaskLists(html);
}

/**
 * Convert Tiptap HTML (from `editor.getHTML()`) back to markdown.
 *
 * Returns an empty string for empty/blank documents.
 * Non-empty output always ends with a single trailing newline.
 */
export function htmlToMarkdown(html: string): string {
    if (!html) return '';
    // Tiptap returns `<p></p>` for an empty document
    if (/^<p>\s*<\/p>$/i.test(html.trim())) return '';
    let md = turndown.turndown(html);
    // Ensure single trailing newline
    md = md.replace(/\n*$/, '\n');
    return md;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Post-process HTML from `marked` to convert standard GFM task-list markup
 * into Tiptap-compatible data attributes.
 *
 * marked renders:
 *   `<ul>\n<li><input type="checkbox" checked="" disabled=""> done</li>\n</ul>`
 *
 * We convert to:
 *   `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label>...</label></li></ul>`
 */
function postProcessTaskLists(html: string): string {
    // Detect <li> containing <input type="checkbox"> — these are task items
    const taskItemRe =
        /<li>\s*<input\s+[^>]*type="checkbox"[^>]*>([\s\S]*?)<\/li>/gi;

    let result = html;
    let hasTaskItems = false;

    result = result.replace(taskItemRe, (_match, content: string) => {
        hasTaskItems = true;
        // Determine checked state from the original input
        const isChecked = /checked/i.test(_match);
        return `<li data-type="taskItem" data-checked="${isChecked}">${content.trim()}</li>`;
    });

    if (hasTaskItems) {
        // Wrap parent <ul> of task items with data-type="taskList"
        // We find <ul> elements that directly contain taskItem <li> elements
        result = result.replace(
            /<ul>([\s\S]*?<li data-type="taskItem"[\s\S]*?)<\/ul>/gi,
            '<ul data-type="taskList">$1</ul>',
        );
    }

    return result;
}

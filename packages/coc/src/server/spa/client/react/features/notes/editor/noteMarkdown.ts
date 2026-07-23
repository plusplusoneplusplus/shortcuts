/**
 * noteMarkdown — Markdown ↔ HTML conversion utilities for the Tiptap editor.
 *
 * markdownToHtml: marked (GFM) → HTML with Tiptap-compatible task-list attributes.
 * htmlToMarkdown: Tiptap HTML → markdown via turndown with custom task-list rules.
 */

import { marked } from 'marked';
import TurndownService from 'turndown';
import { isEmbeddableMapUrl, isPdfUrl } from '@plusplusoneplusplus/forge/editor/rendering';
import { mathNodeMarkedExtension } from './mathNodeMarked';
import { wrapMathDelimiters, type MathDelimiter } from '../../../../shared/math/mathTokenizer';
import { clampIndent, parseIndentAttr } from './extensions/indentShared';

// ── marked configuration ────────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: true });

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function decodeBasicHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function plainLinkLabel(renderedText: string, fallback: string): string {
    const withoutTags = renderedText.replace(/<[^>]*>/g, '');
    return decodeBasicHtmlEntities(withoutTags).trim() || fallback;
}

function escapeMarkdownLinkLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderDefaultLink(href: string, title: string | null | undefined, text: string): string {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    return `<a href="${escapeAttr(href ?? '')}"${titleAttr}>${text}</a>`;
}

const mapLinkRenderer: marked.MarkedExtension = {
    renderer: {
        link(href: string, title: string | null | undefined, text: string): string {
            if (isEmbeddableMapUrl(href)) {
                const label = plainLinkLabel(text, href);
                return `<div class="md-map-embed" data-map-url="${escapeAttr(href)}" data-map-label="${escapeAttr(label)}"></div>`;
            }
            return renderDefaultLink(href, title, text);
        },
    },
};
marked.use(mapLinkRenderer);

// `.pdf` image embeds (`![label](x.pdf)`) render as an inline PDF placeholder
// div that the PdfBlock node view picks up. Non-pdf images fall back to marked's
// default `<img>` renderer (returning `false` triggers the default).
const pdfImageRenderer: marked.MarkedExtension = {
    renderer: {
        image(href: string, _title: string | null | undefined, text: string): string | false {
            if (isPdfUrl(href)) {
                const label = plainLinkLabel(text, 'PDF');
                return `<div class="md-pdf-embed" data-pdf-url="${escapeAttr(href)}" data-pdf-label="${escapeAttr(label)}"></div>`;
            }
            return false;
        },
    },
};
marked.use(pdfImageRenderer);

// Add [[note:...]] wiki-link syntax support to marked
const noteLinkExtension: marked.MarkedExtension = {
    extensions: [
        {
            name: 'noteLink',
            level: 'inline' as const,
            start(src: string) {
                return src.indexOf('[[note:');
            },
            tokenizer(src: string) {
                // [[label|note:path#heading]] or [[note:path#heading]]
                const match = /^\[\[(?:([^\]|]+)\|)?note:([^\]#]+?)(?:#([^\]]*))?\]\]/.exec(src);
                if (match) {
                    return {
                        type: 'noteLink',
                        raw: match[0],
                        label: match[1] || '',
                        path: match[2],
                        heading: match[3] || '',
                    };
                }
                return undefined;
            },
            renderer(token: { label: string; path: string; heading: string }) {
                const basename = token.path.split('/').pop()?.replace(/\.md$/i, '') ?? token.path;
                const displayLabel = token.label || (token.heading ? `${basename} § ${token.heading}` : basename);
                const headingAttr = token.heading ? ` data-note-heading="${token.heading}"` : '';
                return `<span class="note-link" data-note-path="${token.path}"${headingAttr}>${displayLabel}</span>`;
            },
        },
    ],
};
marked.use(noteLinkExtension);

// Add file-path reference syntax support to marked
// Detects paths like `tasks/coc/foo.plan.md` and wraps them in <span class="file-ref-link">
const filePathExtension: marked.MarkedExtension = {
    extensions: [
        {
            name: 'filePathRef',
            level: 'inline' as const,
            start(src: string) {
                // Look for the start of a path segment (word char or dot)
                const m = /[a-zA-Z0-9_.]/.exec(src);
                return m ? m.index : -1;
            },
            tokenizer(src: string) {
                // Must not be inside a URL (preceded by :// or @ or # or " or ')
                // Requires at least one `/` and a known extension
                const match = /^([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.(?:md|ts|tsx|js|jsx|json|yaml|yml|txt|py|go|sh|rs|css|html))(?=[^/a-zA-Z0-9_.-]|$)/.exec(src);
                if (!match) return undefined;
                return {
                    type: 'filePathRef',
                    raw: match[0],
                    filePath: match[1],
                };
            },
            renderer(token: { filePath: string }) {
                return `<span class="file-ref-link" data-file-path="${token.filePath}">${token.filePath}</span>`;
            },
        },
    ],
};
marked.use(filePathExtension);

// Add ==highlight== syntax support to marked
const highlightExtension: marked.MarkedExtension = {
    extensions: [
        {
            name: 'highlight',
            level: 'inline' as const,
            start(src: string) {
                return src.indexOf('==');
            },
            tokenizer(src: string) {
                const match = /^==([^=]+)==/.exec(src);
                if (match) {
                    return {
                        type: 'highlight',
                        raw: match[0],
                        text: match[1],
                        tokens: [],
                    };
                }
                return undefined;
            },
            renderer(token: { text: string }) {
                return `<mark>${token.text}</mark>`;
            },
        },
    ],
};
marked.use(highlightExtension);

// Math: parse the four TeX delimiter forms into editable Tiptap formula
// placeholders (`<span/div data-math=… data-tex=… data-delim=…>`). The rendered
// KaTeX lives only in the runtime NodeView — never in the persisted Markdown.
marked.use(mathNodeMarkedExtension);

// ── turndown singleton ──────────────────────────────────────────────────────

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});

// Line breaks: <br> → plain \n (avoids trailing-space hard-break syntax on save)
turndown.addRule('lineBreak', {
    filter: 'br',
    replacement() {
        return '\n';
    },
});

// Strikethrough: <del> / <s> → ~~text~~
turndown.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement(content) {
        return `~~${content}~~`;
    },
});

// Highlight: <mark> → ==text==
turndown.addRule('highlight', {
    filter: 'mark',
    replacement(content) {
        return `==${content}==`;
    },
});

// Images with a width or a nonzero indent: preserve as an HTML <img> tag so the
// dimensions and/or the indent level round-trip (standard `![]()` syntax carries
// neither). A plain, level-0, unsized image still serializes as `![alt](src)`.
turndown.addRule('resizableImage', {
    filter(node) {
        return (
            node.nodeName === 'IMG' &&
            (node.hasAttribute('width') || parseIndentAttr(node as HTMLElement) > 0)
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const src = el.getAttribute('src') ?? '';
        const alt = el.getAttribute('alt') ?? '';
        const width = el.getAttribute('width') ?? '';
        const indent = parseIndentAttr(el);
        const altAttr = alt ? ` alt="${alt}"` : '';
        const widthAttr = width ? ` width="${width}"` : '';
        const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
        return `<img src="${src}"${altAttr}${widthAttr}${indentAttr} />`;
    },
});

// Google Maps embeds serialize back to ordinary markdown links. A nonzero indent
// has no link syntax, so an indented map is emitted as a raw HTML placeholder div
// carrying `data-indent` that marked passes through and MapBlock re-parses.
turndown.addRule('mapEmbed', {
    filter(node) {
        return (
            node.nodeName === 'DIV' &&
            (node as Element).classList.contains('md-map-embed') &&
            node.hasAttribute('data-map-url')
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const url = el.getAttribute('data-map-url') ?? '';
        if (!url) return '';
        const label = el.getAttribute('data-map-label')?.trim() || url;
        const indent = parseIndentAttr(el);
        if (indent > 0) {
            return `\n\n<div class="md-map-embed" data-map-url="${escapeAttr(url)}" data-map-label="${escapeAttr(label)}" data-indent="${indent}"></div>\n\n`;
        }
        return `[${escapeMarkdownLinkLabel(label)}](${url})`;
    },
});

// PDF embeds serialize back to markdown image syntax (`![label](url)`).
// Empty level-0 placeholder divs are pre-converted to <img> by
// serializePdfEmbedPlaceholders (turndown skips blank block nodes); an indented
// embed is instead kept as a non-blank div by that helper so this rule fires and
// re-emits it as a raw HTML placeholder carrying `data-indent`.
turndown.addRule('pdfEmbed', {
    filter(node) {
        return (
            node.nodeName === 'DIV' &&
            (node as Element).classList.contains('md-pdf-embed') &&
            node.hasAttribute('data-pdf-url')
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const url = el.getAttribute('data-pdf-url') ?? '';
        if (!url) return '';
        const label = el.getAttribute('data-pdf-label')?.trim() || 'PDF';
        const indent = parseIndentAttr(el);
        if (indent > 0) {
            return `\n\n<div class="md-pdf-embed" data-pdf-url="${escapeAttr(url)}" data-pdf-label="${escapeAttr(label)}" data-indent="${indent}"></div>\n\n`;
        }
        return `![${escapeMarkdownLinkLabel(label)}](${url})`;
    },
});

// Comment spans: strip wrapper, keep inner text
turndown.addRule('commentSpan', {
    filter(node) {
        return (
            node.nodeName === 'SPAN' &&
            node.hasAttribute('data-comment-id')
        );
    },
    replacement(content) {
        return content;
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
        const isInThead = node.parentNode && node.parentNode.nodeName === 'THEAD';
        const thCells = Array.from(node.querySelectorAll('th'));

        let needsSeparator = isInThead || thCells.length > 0;

        // td-only tables (e.g. pasted content): first row still needs a GFM separator
        if (!needsSeparator && node.parentNode) {
            const firstTr = Array.from(node.parentNode.childNodes).find(c => c.nodeName === 'TR');
            needsSeparator = firstTr === node;
        }

        if (needsSeparator) {
            const cells = thCells.length > 0 ? thCells : Array.from(node.querySelectorAll('td'));
            const separators = cells.map((cell) => {
                const style = (cell as Element).getAttribute('style') ?? '';
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
        const normalized = content.trim().replace(/\n{2,}/g, '\n');
        return `\n\n${normalized}\n\n`;
    },
});

// Mermaid fenced code block: <pre><code class="language-mermaid">…</code></pre> → ```mermaid\n…\n```
// Registered last so it wins over turndown's built-in fenced-code rule for mermaid blocks.
turndown.addRule('mermaidCode', {
    filter(node) {
        if (node.nodeName !== 'PRE') return false;
        const code = (node as Element).querySelector('code.language-mermaid');
        return code !== null;
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const code = el.querySelector('code.language-mermaid');
        const text = code?.textContent ?? '';
        const indent = parseIndentAttr(el);
        if (indent > 0) {
            // Indent has no fenced-code syntax, so emit a raw <pre> HTML block
            // carrying `data-indent`; marked passes it through and MermaidBlock
            // re-parses the `code.language-mermaid` and the indent level.
            return `\n\n<pre data-indent="${indent}"><code class="language-mermaid">${escapeHtmlText(text)}</code></pre>\n\n`;
        }
        return `\`\`\`mermaid\n${text}\n\`\`\``;
    },
});

// Note-link spans: <span class="note-link" data-note-path="..." data-note-heading="..."> → [[note:...]]
turndown.addRule('noteLink', {
    filter(node) {
        return (
            node.nodeName === 'SPAN' &&
            (node as Element).classList.contains('note-link') &&
            node.hasAttribute('data-note-path')
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const path = el.getAttribute('data-note-path') ?? '';
        const heading = el.getAttribute('data-note-heading') ?? '';
        return heading ? `[[note:${path}#${heading}]]` : `[[note:${path}]]`;
    },
});

// File-path reference spans: <span class="file-ref-link" data-file-path="..."> → plain text path
turndown.addRule('filePathRef', {
    filter(node) {
        return (
            node.nodeName === 'SPAN' &&
            (node as Element).classList.contains('file-ref-link') &&
            node.hasAttribute('data-file-path')
        );
    },
    replacement(_content, node) {
        return (node as HTMLElement).getAttribute('data-file-path') ?? '';
    },
});

// Math formula nodes: rebuild the exact original delimited source from the
// node's stored delimiter + TeX. Because the TeX is preserved verbatim in
// `data-tex`, an unedited formula round-trips byte-for-byte, and no rendered
// KaTeX/MathML is ever serialized into the Markdown source.
function mathDelimiterFromNode(node: HTMLElement, fallback: MathDelimiter): MathDelimiter {
    const raw = node.getAttribute('data-delim');
    if (raw === 'dollar' || raw === 'double-dollar' || raw === 'paren' || raw === 'bracket') {
        return raw;
    }
    return fallback;
}

turndown.addRule('mathInline', {
    filter(node) {
        return (
            node.nodeName === 'SPAN' &&
            (node as Element).getAttribute('data-math') === 'inline'
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const tex = el.getAttribute('data-tex') ?? '';
        return wrapMathDelimiters(mathDelimiterFromNode(el, 'dollar'), tex);
    },
});

turndown.addRule('mathDisplay', {
    filter(node) {
        return (
            node.nodeName === 'DIV' &&
            (node as Element).getAttribute('data-math') === 'display'
        );
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const tex = el.getAttribute('data-tex') ?? '';
        const delim = mathDelimiterFromNode(el, 'double-dollar');
        const indent = parseIndentAttr(el);
        if (indent > 0) {
            // Delimited `$$…$$` source has no indent metadata, so emit a raw HTML
            // placeholder div carrying `data-indent` (plus the exact TeX/delimiter);
            // marked passes it through and MathDisplay re-parses all three.
            return `\n\n<div data-math="display" data-tex="${escapeAttr(tex)}" data-delim="${delim}" data-indent="${indent}">${escapeHtmlText(tex)}</div>\n\n`;
        }
        return `\n\n${wrapMathDelimiters(delim, tex)}\n\n`;
    },
});

// Aligned or indented paragraphs/headings: no standard markdown syntax exists, so
// these are serialized as raw HTML blocks that `marked` will pass through unchanged.
// Handles paragraphs and headings (H1–H3) that carry a non-default text-align style
// or a data-indent attribute.
function hasAlignOrIndent(el: HTMLElement): boolean {
    const style = el.getAttribute('style') ?? '';
    const indent = el.getAttribute('data-indent');
    const hasNonDefaultAlign =
        /text-align/i.test(style) && !/text-align:\s*left\b/i.test(style);
    const hasIndent = indent != null && indent !== '0' && indent !== '';
    return hasNonDefaultAlign || hasIndent;
}

turndown.addRule('alignedOrIndentedBlock', {
    filter(node) {
        const tag = node.nodeName;
        if (!['P', 'H1', 'H2', 'H3'].includes(tag)) return false;
        return hasAlignOrIndent(node as HTMLElement);
    },
    replacement(_content, node) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const attrs: string[] = [];
        const style = el.getAttribute('style');
        if (style) attrs.push(`style="${style}"`);
        const indent = el.getAttribute('data-indent');
        if (indent && indent !== '0') attrs.push(`data-indent="${indent}"`);
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
        // Use innerHTML so inline formatting (bold, italic, etc.) is preserved
        const inner = el.innerHTML;
        return `\n\n<${tag}${attrStr}>${inner}</${tag}>\n\n`;
    },
});

// Empty paragraphs (from pressing Enter multiple times) → `&nbsp;` placeholder line.
// Required because turndown drops `<p></p>` and CommonMark collapses blank lines, so
// without a placeholder consecutive empty paragraphs vanish in the markdown round-trip.
// Matches `<p></p>` (after preprocessEmptyParagraphs upgrades it to `<p><br></p>`),
// `<p><br></p>`, and `<p>&nbsp;</p>` so re-saving an unchanged note is idempotent.
turndown.addRule('emptyParagraph', {
    filter(node) {
        if (node.nodeName !== 'P') return false;
        const text = (node.textContent ?? '').replace(/ /g, '').trim();
        if (text !== '') return false;
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1 && (child as Element).nodeName !== 'BR') return false;
        }
        return true;
    },
    replacement() {
        // Emit raw-HTML passthrough rather than `&nbsp;` text — marked's inline
        // tokenizer (with our file-path/note-link/highlight extensions registered)
        // escapes the `&` in `&nbsp;` to `&amp;` on reload, breaking the round-trip.
        // `<p>&nbsp;</p>` as a raw HTML block sidesteps inline tokenization entirely.
        return '\n\n<p>&nbsp;</p>\n\n';
    },
});

// ── Pre-processing helpers ──────────────────────────────────────────────────

/**
 * Unwrap single-<p> list items so turndown produces tight lists.
 *
 * Tiptap always wraps list item content in <p> tags, even for tight lists.
 * Turndown interprets <li><p>...</p></li> as a loose list, adding blank lines.
 * This strips the <p> wrapper when it's the sole child of <li>.
 */
function unwrapSingleParagraphListItems(html: string): string {
    return html.replace(
        /<li>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<\/li>/gi,
        (_match, inner: string) => `<li>${inner}</li>`,
    );
}

function getHtmlAttr(attrs: string, name: string): string {
    const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
    const match = re.exec(attrs);
    return match ? decodeBasicHtmlEntities(match[2]) : '';
}

function serializeMapEmbedPlaceholders(html: string): string {
    return html.replace(
        /<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bmd-map-embed\b[^"']*\1)([^>]*)>\s*<\/div>/gi,
        (_match, _quote: string, attrs: string) => {
            const url = getHtmlAttr(attrs, 'data-map-url');
            if (!url) return '';
            const label = getHtmlAttr(attrs, 'data-map-label').trim() || url;
            const indent = clampIndent(parseInt(getHtmlAttr(attrs, 'data-indent') || '0', 10) || 0);
            if (indent > 0) {
                // Keep the embed as a non-blank md-map-embed div (turndown drops
                // blank block nodes) so the `mapEmbed` rule fires and preserves
                // the indent as raw HTML rather than a plain link.
                return `<div class="md-map-embed" data-map-url="${escapeAttr(url)}" data-map-label="${escapeAttr(label)}" data-indent="${indent}">${escapeHtmlText(label)}</div>`;
            }
            return `<p><a href="${escapeAttr(url)}">${escapeHtmlText(label)}</a></p>`;
        },
    );
}

// Convert empty PDF placeholder divs to <img> tags before turndown runs.
// Turndown treats an empty block <div> as blank and skips custom rules, so the
// atom node's `<div class="md-pdf-embed"></div>` must become a non-blank element;
// the default <img> rule then serializes it to `![label](url)`.
function serializePdfEmbedPlaceholders(html: string): string {
    return html.replace(
        /<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bmd-pdf-embed\b[^"']*\1)([^>]*)>\s*<\/div>/gi,
        (_match, _quote: string, attrs: string) => {
            const url = getHtmlAttr(attrs, 'data-pdf-url');
            if (!url) return '';
            const label = getHtmlAttr(attrs, 'data-pdf-label').trim() || 'PDF';
            const indent = clampIndent(parseInt(getHtmlAttr(attrs, 'data-indent') || '0', 10) || 0);
            if (indent > 0) {
                // Keep the embed as a non-blank md-pdf-embed div (turndown drops
                // blank block nodes) so the `pdfEmbed` rule fires and preserves the
                // indent as raw HTML. Routing through <img>/`![]()` would lose both
                // the indent AND the pdf type (a raw <img> reloads as an image).
                return `<div class="md-pdf-embed" data-pdf-url="${escapeAttr(url)}" data-pdf-label="${escapeAttr(label)}" data-indent="${indent}">${escapeHtmlText(label)}</div>`;
            }
            return `<img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" />`;
        },
    );
}

// Normalize visually-empty paragraphs to `<p><br></p>` so turndown's blank-node
// check doesn't drop them before the emptyParagraph rule runs. JS `\s` includes
// the NBSP character, so a `<p>&nbsp;</p>` (round-tripped placeholder) is also
// treated as blank by turndown — handle both shapes here.
function preprocessEmptyParagraphs(html: string): string {
    return html.replace(/<p>\s*<\/p>|<p>(?:&nbsp;|&#160;|&#xA0;)\s*<\/p>/gi, '<p><br></p>');
}

// Convert `<p>&nbsp;</p>` (and literal NBSP form) back to `<p></p>` after marked,
// so Tiptap loads a clean empty paragraph instead of one with a stray NBSP character
// that the user would have to delete before typing.
function stripNbspParagraphPlaceholders(html: string): string {
    return html.replace(/<p>(?:&nbsp;| )\s*<\/p>/gi, '<p></p>');
}

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
    return stripNbspParagraphPlaceholders(postProcessTaskLists(html));
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
    let md = turndown.turndown(
        preprocessEmptyParagraphs(
            unwrapSingleParagraphListItems(
                serializePdfEmbedPlaceholders(serializeMapEmbedPlaceholders(html)),
            ),
        ),
    );
    // Ensure single trailing newline
    md = md.replace(/\n*$/, '\n');
    return md;
}

/**
 * Thread shape expected by the export function.
 * Matches the CommentThread type from the comments system.
 */
export interface ExportCommentThread {
    id: string;
    status: 'open' | 'resolved';
    anchor: { quotedText: string };
    comments: { author: string; content: string; createdAt: string }[];
}

/**
 * Convert Tiptap HTML to markdown with comment threads appended as
 * a footnote-style "Comments" section.
 *
 * - Open threads render as blockquotes under `## Comments`
 * - Resolved threads render under `### Resolved` with strikethrough
 * - If no threads exist, output is identical to `htmlToMarkdown`.
 */
export function htmlToMarkdownWithComments(
    html: string,
    threads: Record<string, ExportCommentThread>,
): string {
    const md = htmlToMarkdown(html);
    if (!threads || Object.keys(threads).length === 0) return md;

    const open = Object.values(threads).filter(t => t.status === 'open');
    const resolved = Object.values(threads).filter(t => t.status === 'resolved');

    let result = md.trimEnd() + '\n';

    if (open.length > 0) {
        result += '\n---\n\n## Comments\n\n';
        for (const thread of open) {
            result += `> **On:** "${thread.anchor.quotedText}"\n`;
            for (const c of thread.comments) {
                result += `> ${c.content}\n`;
            }
            result += '\n';
        }
    }

    if (resolved.length > 0) {
        result += '\n### Resolved\n\n';
        for (const thread of resolved) {
            result += `> ~~"${thread.anchor.quotedText}"~~\n`;
            for (const c of thread.comments) {
                result += `> ${c.content}\n`;
            }
            result += '\n';
        }
    }

    return result;
}

// ── Image URL rewriting ─────────────────────────────────────────────────────

/**
 * Rewrite relative `.attachments/...` image paths and absolute local file paths
 * in HTML to API-served URLs.
 * Called after `markdownToHtml()` when loading content into the editor.
 *
 * Converts: `<img src=".attachments/uuid.png">`
 * To:       `<img src="/api/workspaces/<wsId>/notes/image?path=.attachments/uuid.png">`
 *
 * Also converts absolute paths:
 * `<img src="C:\src\repo\chart.png">` or `<img src="/home/user/chart.png">`
 * To: `<img src="/api/workspaces/<wsId>/notes/local-image?path=...">`
 */
export function rewriteImageSrcToApi(html: string, workspaceId: string): string {
    if (!html) return html;
    const apiPrefix = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=`;
    const localApiPrefix = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/local-image?path=`;

    // 1) Rewrite .attachments/ relative paths
    let result = html.replace(
        /(<img\s[^>]*?)src="(\.attachments\/[^"]+)"/gi,
        (_match, prefix: string, relPath: string) => {
            return `${prefix}src="${apiPrefix}${encodeURIComponent(relPath)}"`;
        },
    );

    // 2) Rewrite Windows absolute paths (e.g. C:\foo\bar.png)
    //    marked.js may percent-encode backslashes, so decode first to normalize
    result = result.replace(
        /(<img\s[^>]*?)src="([A-Za-z]:[^"]+)"/gi,
        (_match, prefix: string, absPath: string) => {
            const decoded = decodeURIComponent(absPath);
            return `${prefix}src="${localApiPrefix}${encodeURIComponent(decoded)}"`;
        },
    );

    // 3) Rewrite Unix absolute paths (skip /api/ to avoid double-rewriting)
    result = result.replace(
        /(<img\s[^>]*?)src="(\/(?!api\/)[^"]+)"/gi,
        (_match, prefix: string, absPath: string) => {
            const decoded = decodeURIComponent(absPath);
            return `${prefix}src="${localApiPrefix}${encodeURIComponent(decoded)}"`;
        },
    );

    // 4) Rewrite .attachments/ (and .images/) relative paths inside PDF embed
    //    placeholders so the inline <iframe> resolves through the notes image API.
    result = result.replace(
        /data-pdf-url="((?:\.attachments|\.images)\/[^"]+)"/gi,
        (_match, relPath: string) => {
            return `data-pdf-url="${apiPrefix}${encodeURIComponent(relPath)}"`;
        },
    );

    return result;
}

/**
 * Rewrite API-served image URLs back to relative `.attachments/...` paths
 * and local-image API URLs back to their original absolute paths.
 * Called before `htmlToMarkdown()` when saving editor content.
 *
 * Converts: `![alt](/api/workspaces/<wsId>/notes/image?path=.attachments/uuid.png)`
 * To:       `![alt](.attachments/uuid.png)`
 *
 * Converts: `![alt](/api/workspaces/<wsId>/notes/local-image?path=C%3A%5Csrc%5Cchart.png)`
 * To:       `![alt](C:\src\chart.png)`
 */
export function rewriteImageSrcToRelative(markdown: string): string {
    if (!markdown) return markdown;

    // Standard markdown images: ![alt](/api/workspaces/.../image?path=...)
    let result = markdown.replace(
        /!\[([^\]]*)\]\(\/api\/workspaces\/[^/]+\/notes\/image\?path=([^)]+)\)/g,
        (_match, alt: string, encodedPath: string) => {
            return `![${alt}](${decodeURIComponent(encodedPath)})`;
        },
    );
    // HTML <img> tags with API URLs (from resized images)
    result = result.replace(
        /<img\s([^>]*?)src="\/api\/workspaces\/[^/]+\/notes\/image\?path=([^"]+)"([^>]*?)\/?\s*>/gi,
        (_match, before: string, encodedPath: string, after: string) => {
            return `<img ${before}src="${decodeURIComponent(encodedPath)}"${after} />`;
        },
    );

    // Standard markdown images: ![alt](/api/workspaces/.../local-image?path=...)
    result = result.replace(
        /!\[([^\]]*)\]\(\/api\/workspaces\/[^/]+\/notes\/local-image\?path=([^)]+)\)/g,
        (_match, alt: string, encodedPath: string) => {
            return `![${alt}](${decodeURIComponent(encodedPath)})`;
        },
    );
    // HTML <img> tags with local-image API URLs (from resized images)
    result = result.replace(
        /<img\s([^>]*?)src="\/api\/workspaces\/[^/]+\/notes\/local-image\?path=([^"]+)"([^>]*?)\/?\s*>/gi,
        (_match, before: string, encodedPath: string, after: string) => {
            return `<img ${before}src="${decodeURIComponent(encodedPath)}"${after} />`;
        },
    );

    // Raw HTML PDF embed placeholders (indented pdfBlock) carrying an API image
    // URL → relative `.attachments/` path, mirroring rewriteImageSrcToApi so the
    // persisted Markdown never contains a workspace-specific API URL.
    result = result.replace(
        /data-pdf-url="\/api\/workspaces\/[^/]+\/notes\/image\?path=([^"]+)"/gi,
        (_match, encodedPath: string) => {
            return `data-pdf-url="${decodeURIComponent(encodedPath)}"`;
        },
    );

    return result;
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
        // Wrap parent <ul> of task items with data-type="taskList".
        // Use a lookahead so we only tag <ul> whose immediate first child is a
        // taskItem — this avoids cross-boundary matches that would incorrectly
        // tag a preceding regular bullet list when both lists appear in the
        // same HTML fragment.
        result = result.replace(
            /<ul>\s*(?=<li data-type="taskItem")/gi,
            '<ul data-type="taskList">',
        );
    }

    return result;
}

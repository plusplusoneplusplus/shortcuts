/**
 * Markdown codec extensions for the map and PDF embeds, for tiptap-kit's
 * `createMarkdownCodec`:
 *
 * - `[label](<Google Maps embed URL>)` ↔ a `div.md-map-embed` that `MapBlock` parses.
 * - `![label](x.pdf)` ↔ a `div.md-pdf-embed` that `PdfBlock` parses.
 *
 * An indent, a PDF height or a collapsed PDF has no Markdown syntax, so those
 * embeds are saved as raw placeholder divs.
 */
import type TurndownService from 'turndown';
import type { MarkedExtension } from 'marked';
import {
    escapeAttr,
    escapeMarkdownLinkLabel,
    getHtmlAttr,
    plainLinkLabel,
    type MarkdownCodecExtension,
} from '@plusplusoneplusplus/tiptap-kit/markdown';
import { escapeHtmlText } from '@plusplusoneplusplus/tiptap-kit/html';
import { clampIndent, parseIndentAttr } from '@plusplusoneplusplus/tiptap-kit/indent';
import { isEmbeddableMapUrl, isPdfUrl } from '../urls/index.js';
import { clampPdfHeight, parsePdfHeightAttr } from '../pdf/pdfHeight.js';
import { pdfLabelFromMarkdown } from '../pdf/pdfLabel.js';

// ── Maps ────────────────────────────────────────────────────────────────────

function renderDefaultLink(href: string, title: string | null | undefined, text: string): string {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    return `<a href="${escapeAttr(href ?? '')}"${titleAttr}>${text}</a>`;
}

const mapLinkRenderer: MarkedExtension = {
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

function addMapRules(turndown: TurndownService): void {
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
}

/** Google Maps embed links ↔ `MapBlock` placeholders. */
export const mapMarkdownExtension: MarkdownCodecExtension = {
    name: 'map-embed',
    marked: mapLinkRenderer,
    turndownRules: addMapRules,
    serialize: (html, next) => next(serializeMapEmbedPlaceholders(html)),
};

// ── PDFs ────────────────────────────────────────────────────────────────────

// `.pdf` image embeds (`![label](x.pdf)`) render as an inline PDF placeholder
// div that the PdfBlock node view picks up. Non-pdf images fall back to marked's
// default `<img>` renderer (returning `false` triggers the default).
const pdfImageRenderer: MarkedExtension = {
    renderer: {
        image(href: string, _title: string | null | undefined, text: string): string | false {
            if (isPdfUrl(href)) {
                // The Markdown source may escape punctuation in the label
                // (Turndown writes `_` as `\_`). Decode those escapes so the
                // stored `data-pdf-label` — and therefore the visible title — is
                // the literal filename, never `OSDI\_2026...`.
                const label = pdfLabelFromMarkdown(plainLinkLabel(text, 'PDF'));
                return `<div class="md-pdf-embed" data-pdf-url="${escapeAttr(href)}" data-pdf-label="${escapeAttr(label)}"></div>`;
            }
            return false;
        },
    },
};

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
            const rawHeight = getHtmlAttr(attrs, 'data-pdf-height');
            const height = rawHeight ? clampPdfHeight(parseInt(rawHeight, 10) || 0) : null;
            const collapsed = getHtmlAttr(attrs, 'data-pdf-collapsed') === 'true';
            if (indent > 0 || height != null || collapsed) {
                // Keep the embed as a non-blank md-pdf-embed div (turndown drops
                // blank block nodes) so the `pdfEmbed` rule fires and preserves the
                // indent, height and/or collapsed flag as raw HTML. Routing through
                // <img>/`![]()` would lose both the attributes AND the pdf type (a
                // raw <img> reloads as an image).
                const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
                const heightAttr = height != null ? ` data-pdf-height="${height}"` : '';
                const collapsedAttr = collapsed ? ' data-pdf-collapsed="true"' : '';
                return `<div class="md-pdf-embed" data-pdf-url="${escapeAttr(url)}" data-pdf-label="${escapeAttr(label)}"${indentAttr}${heightAttr}${collapsedAttr}>${escapeHtmlText(label)}</div>`;
            }
            return `<img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" />`;
        },
    );
}

function addPdfRules(turndown: TurndownService): void {
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
            const height = parsePdfHeightAttr(el);
            const collapsed = el.getAttribute('data-pdf-collapsed') === 'true';
            // `![]()` cannot carry an indent, a height or a collapsed flag — any of
            // them forces the raw `<div>` form so the attribute survives the next save.
            if (indent > 0 || height != null || collapsed) {
                const indentAttr = indent > 0 ? ` data-indent="${indent}"` : '';
                const heightAttr = height != null ? ` data-pdf-height="${height}"` : '';
                const collapsedAttr = collapsed ? ' data-pdf-collapsed="true"' : '';
                return `\n\n<div class="md-pdf-embed" data-pdf-url="${escapeAttr(url)}" data-pdf-label="${escapeAttr(label)}"${indentAttr}${heightAttr}${collapsedAttr}></div>\n\n`;
            }
            return `![${escapeMarkdownLinkLabel(label)}](${url})`;
        },
    });
}

/** `.pdf` image embeds ↔ `PdfBlock` placeholders. */
export const pdfMarkdownExtension: MarkdownCodecExtension = {
    name: 'pdf-embed',
    marked: pdfImageRenderer,
    turndownRules: addPdfRules,
    serialize: (html, next) => next(serializePdfEmbedPlaceholders(html)),
};

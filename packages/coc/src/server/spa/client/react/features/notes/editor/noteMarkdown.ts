/**
 * noteMarkdown — the Notes Markdown ↔ HTML codec.
 *
 * The generic conversion lives in tiptap-kit's `createMarkdownCodec`. This file
 * adds the Notes syntax on top: map and PDF embeds, `[[note:…]]` links, bare
 * file-path references, Quick Ask side notes, TeX math and code-fence language
 * aliases. It also keeps the comment export and the image URL rewriting.
 */

import type TurndownService from 'turndown';
import type { MarkedExtension } from 'marked';
import { isEmbeddableMapUrl, isPdfUrl } from '@plusplusoneplusplus/forge/editor/rendering';
import { mathMarkdownExtension } from '@plusplusoneplusplus/tiptap-kit/math';
import {
    createMarkdownCodec,
    escapeAttr,
    escapeMarkdownLinkLabel,
    getHtmlAttr,
    plainLinkLabel,
    type MarkdownCodecExtension,
} from '@plusplusoneplusplus/tiptap-kit/markdown';
import { escapeHtmlText } from '@plusplusoneplusplus/tiptap-kit/html';
import { clampIndent, parseIndentAttr } from '@plusplusoneplusplus/tiptap-kit/indent';
import { resolveCodeLanguage } from './extensions/notesLowlight';
import { clampPdfHeight, parsePdfHeightAttr } from './extensions/pdfHeightShared';
import { pdfLabelFromMarkdown } from './pdfLabel';
import {
    appendQaFootnoteDefs,
    extractQaFootnoteDefs,
    injectQaAnswers,
    QA_SIDENOTE_REF_CLASS,
    qaFootnoteMarkedExtension,
} from './extensions/sidenoteFootnote';

// ── Map and PDF embeds ──────────────────────────────────────────────────────

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

function addEmbedRules(turndown: TurndownService): void {
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

const embedMarkdown: MarkdownCodecExtension = {
    name: 'embeds',
    marked: [mapLinkRenderer, pdfImageRenderer],
    turndownRules: addEmbedRules,
    serialize: (html, next) => next(serializePdfEmbedPlaceholders(serializeMapEmbedPlaceholders(html))),
};

// ── Note links ──────────────────────────────────────────────────────────────

// Add [[note:...]] wiki-link syntax support to marked
const noteLinkExtension: MarkedExtension = {
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
            renderer(token) {
                const basename = token.path.split('/').pop()?.replace(/\.md$/i, '') ?? token.path;
                const displayLabel = token.label || (token.heading ? `${basename} § ${token.heading}` : basename);
                const headingAttr = token.heading ? ` data-note-heading="${token.heading}"` : '';
                return `<span class="note-link" data-note-path="${token.path}"${headingAttr}>${displayLabel}</span>`;
            },
        },
    ],
};

const noteLinkMarkdown: MarkdownCodecExtension = {
    name: 'noteLink',
    marked: noteLinkExtension,
    turndownRules(turndown) {
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
    },
};

// ── File-path references ────────────────────────────────────────────────────

// Add file-path reference syntax support to marked
// Detects paths like `tasks/coc/foo.plan.md` and wraps them in <span class="file-ref-link">
const filePathExtension: MarkedExtension = {
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
                // Never inside a link label: marked lexes the label char by
                // char, so a URL label like https://www.x.com/a/b.html would
                // match at `www.` and split into a file-ref chip.
                if ((this as { lexer?: { state?: { inLink?: boolean } } }).lexer?.state?.inLink) {
                    return undefined;
                }
                // Requires at least one `/` and a known extension
                const match = /^([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.(?:md|ts|tsx|js|jsx|json|yaml|yml|txt|py|go|sh|rs|css|html))(?=[^/a-zA-Z0-9_.-]|$)/.exec(src);
                if (!match) return undefined;
                return {
                    type: 'filePathRef',
                    raw: match[0],
                    filePath: match[1],
                };
            },
            renderer(token) {
                return `<span class="file-ref-link" data-file-path="${token.filePath}">${token.filePath}</span>`;
            },
        },
    ],
};

const filePathMarkdown: MarkdownCodecExtension = {
    name: 'filePathRef',
    marked: filePathExtension,
    turndownRules(turndown) {
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
    },
};

// ── Quick Ask side notes ────────────────────────────────────────────────────

// Reference markers (`[^qa-<id>]`) parse to a bare marker span. The answers sit
// in a definition block at the file bottom: it is split out before parsing and
// folded into the markers after, then rebuilt from the marker spans on save.
const qaSidenoteMarkdown: MarkdownCodecExtension = {
    name: 'qaSidenote',
    marked: qaFootnoteMarkedExtension,
    turndownRules(turndown) {
        // Quick Ask side-note reference marker: <span class="qa-sidenote-ref" data-qa-id="..."> → [^qa-...].
        // The answer/question live in the definition block appended by appendQaFootnoteDefs (htmlToMarkdown),
        // so this rule only re-emits the inline marker; the leaf content (✨) is discarded.
        turndown.addRule('qaSidenoteRef', {
            filter(node) {
                return (
                    node.nodeName === 'SPAN' &&
                    (node as Element).classList.contains(QA_SIDENOTE_REF_CLASS) &&
                    node.hasAttribute('data-qa-id')
                );
            },
            replacement(_content, node) {
                const id = (node as HTMLElement).getAttribute('data-qa-id') ?? '';
                return id ? `[^qa-${id}]` : '';
            },
        });
    },
    parse(md, next) {
        const { body, defs } = extractQaFootnoteDefs(md);
        return injectQaAnswers(next(body), defs);
    },
    serialize: (html, next) => appendQaFootnoteDefs(next(html), html),
};

// ── Code fence languages ────────────────────────────────────────────────────

// marked emits a fenced code block's info-string verbatim as the `<code>`
// class (```` ```ts ```` → `<code class="language-ts">`). CodeBlockLowlight only
// highlights a block whose `language` attribute is one of the 16 registered
// grammar names, so a fence written with an alias (`ts`, `py`, `sh`, `yml`, …)
// would otherwise load unhighlighted. Rewrite each fence class to its resolved
// canonical grammar name before Tiptap parses the HTML (AC-03).
//
// Only rewrite when `resolveCodeLanguage` returns a registered name that differs
// from the token as written. Anything it can't resolve — an unknown language, or
// `language-mermaid` (routed to the MermaidBlock node) — is left untouched, so
// unknown fences stay plain and mermaid handling is unaffected.
function resolveFencedCodeLanguages(html: string): string {
    return html.replace(
        /(<pre><code class=")language-([^"]+)(">)/gi,
        (match, prefix: string, token: string, suffix: string) => {
            const resolved = resolveCodeLanguage(token);
            if (!resolved || resolved === token.toLowerCase()) return match;
            return `${prefix}language-${resolved}${suffix}`;
        },
    );
}

const codeLanguageMarkdown: MarkdownCodecExtension = {
    name: 'codeLanguage',
    parse: (md, next) => resolveFencedCodeLanguages(next(md)),
};

// ── Public API ──────────────────────────────────────────────────────────────

const codec = createMarkdownCodec({
    extensions: [
        qaSidenoteMarkdown,
        embedMarkdown,
        noteLinkMarkdown,
        filePathMarkdown,
        mathMarkdownExtension,
        codeLanguageMarkdown,
    ],
});

/** Convert a Note's Markdown to HTML for Tiptap's `setContent()`. */
export function markdownToHtml(md: string): string {
    return codec.markdownToHtml(md);
}

/**
 * Convert Tiptap HTML (from `editor.getHTML()`) back to markdown.
 *
 * Returns an empty string for empty/blank documents.
 * Non-empty output always ends with a single trailing newline.
 */
export function htmlToMarkdown(html: string): string {
    return codec.htmlToMarkdown(html);
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
        /data-pdf-url="((?:\.attachments|\.images|\.papers)\/[^"]+)"/gi,
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
 *
 * On a REMOTE clone the load-side rewrite emits an absolute URL against that
 * clone's origin (`http://host:4000/api/workspaces/...`), so every pattern here
 * accepts an optional `scheme://host` prefix — otherwise the origin would be
 * baked into the persisted Markdown.
 */
export function rewriteImageSrcToRelative(markdown: string): string {
    if (!markdown) return markdown;

    // Standard markdown images: ![alt](/api/workspaces/.../image?path=...)
    let result = markdown.replace(
        /!\[([^\]]*)\]\((?:https?:\/\/[^/"\s)]+)?\/api\/workspaces\/[^/]+\/notes\/image\?path=([^)]+)\)/g,
        (_match, alt: string, encodedPath: string) => {
            return `![${alt}](${decodeURIComponent(encodedPath)})`;
        },
    );
    // HTML <img> tags with API URLs (from resized images)
    result = result.replace(
        /<img\s([^>]*?)src="(?:https?:\/\/[^/"\s)]+)?\/api\/workspaces\/[^/]+\/notes\/image\?path=([^"]+)"([^>]*?)\/?\s*>/gi,
        (_match, before: string, encodedPath: string, after: string) => {
            return `<img ${before}src="${decodeURIComponent(encodedPath)}"${after} />`;
        },
    );

    // Standard markdown images: ![alt](/api/workspaces/.../local-image?path=...)
    result = result.replace(
        /!\[([^\]]*)\]\((?:https?:\/\/[^/"\s)]+)?\/api\/workspaces\/[^/]+\/notes\/local-image\?path=([^)]+)\)/g,
        (_match, alt: string, encodedPath: string) => {
            return `![${alt}](${decodeURIComponent(encodedPath)})`;
        },
    );
    // HTML <img> tags with local-image API URLs (from resized images)
    result = result.replace(
        /<img\s([^>]*?)src="(?:https?:\/\/[^/"\s)]+)?\/api\/workspaces\/[^/]+\/notes\/local-image\?path=([^"]+)"([^>]*?)\/?\s*>/gi,
        (_match, before: string, encodedPath: string, after: string) => {
            return `<img ${before}src="${decodeURIComponent(encodedPath)}"${after} />`;
        },
    );

    // Raw HTML PDF embed placeholders (indented pdfBlock) carrying an API image
    // URL → relative `.attachments/` path, mirroring rewriteImageSrcToApi so the
    // persisted Markdown never contains a workspace-specific API URL.
    result = result.replace(
        /data-pdf-url="(?:https?:\/\/[^/"\s)]+)?\/api\/workspaces\/[^/]+\/notes\/image\?path=([^"]+)"/gi,
        (_match, encodedPath: string) => {
            return `data-pdf-url="${decodeURIComponent(encodedPath)}"`;
        },
    );

    return result;
}

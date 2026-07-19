/**
 * Layer A — pure serializer for the canvas → self-contained HTML export.
 *
 * Given a fully-prepared input (body already rendered, assets already inlined,
 * diagrams already rasterized to SVG by the upstream adapters), assemble the
 * final standalone document. This module is intentionally:
 *   - Node-safe: no DOM, no `document`, no `fetch`. It only imports
 *     `highlight.js`, whose core `highlight()` is pure and runs in Node.
 *   - Deterministic: no `Date.now()` / `Math.random()`. The same input yields a
 *     byte-identical document, so the output can be asserted exactly in tests.
 *
 * It enforces the portability contract by construction:
 *   - every `<img>` src is a resolved `data:` URI or a self-contained
 *     placeholder — never a proxy URL, `.attachments/` path, or absolute path;
 *   - all CSS is inlined; no `<link rel=stylesheet>` / external `<script src>`;
 *   - the original source is embedded in a non-rendering `<script>` that a
 *     malicious `</script>` in the source cannot break out of.
 */

import hljs from 'highlight.js';
import {
    BASE_CSS,
    HLJS_THEME_CSS,
    KATEX_EXPORT_OVERRIDES_CSS,
    BROKEN_IMAGE_PLACEHOLDER,
} from './styles';
import type {
    BuildCanvasHtmlDocumentInput,
    BuildCanvasHtmlDocumentResult,
    CanvasHtmlExportType,
} from './types';

/** Escape text for HTML text/attribute contexts (attrs are always double-quoted). */
function escapeHtml(value: string | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Neutralize the only sequences that can terminate a raw-text `<script>`
 * element, so an embedded source that literally contains `</script>` (or a
 * comment opener) cannot break out of the document. Breakout-safe by design;
 * a recovering reader reverses `<\/` → `</`.
 */
function escapeScriptText(text: string): string {
    return String(text ?? '')
        .replace(/<\/(script)/gi, '<\\/$1')
        .replace(/<!--/g, '<\\!--');
}

/** MIME type for the embedded source script, by canvas type. */
function sourceScriptType(type: CanvasHtmlExportType): string {
    switch (type) {
        case 'markdown':
            return 'text/markdown';
        case 'excalidraw':
        case 'extension':
            return 'application/json';
        case 'code':
        default:
            return 'text/plain';
    }
}

const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');

function readAttr(tag: string, name: string): string {
    const m = tag.match(ATTR_RE(name));
    if (!m) return '';
    return m[2] ?? m[3] ?? '';
}

/**
 * Rewrite every `<img>` in `html` to a self-contained form: an already-inlined
 * `data:` src is kept, a ref present in `assets` is swapped for its data URI,
 * and anything unresolved becomes the broken-image placeholder (with a
 * warning). App-only attributes (`data-local-path`, `onerror`, `loading`) are
 * dropped so no local path or proxy URL survives.
 */
function rewriteImages(
    html: string,
    assets: Map<string, string>,
    warnings: string[],
): string {
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
        const src = readAttr(tag, 'src');
        const localPath = readAttr(tag, 'data-local-path');
        const alt = readAttr(tag, 'alt');
        const title = readAttr(tag, 'title');

        let resolved: string | null = null;
        if (src.startsWith('data:')) {
            resolved = src; // already inlined — leave intact
        } else if (src && assets.has(src)) {
            resolved = assets.get(src) ?? null;
        } else if (localPath && assets.has(localPath)) {
            resolved = assets.get(localPath) ?? null;
        }

        const attrs: string[] = [];
        if (resolved) {
            attrs.push(`src="${escapeHtml(resolved)}"`);
        } else {
            warnings.push(
                `Unresolved image reference "${src || localPath || '(none)'}" — replaced with placeholder.`,
            );
            attrs.push(`src="${escapeHtml(BROKEN_IMAGE_PLACEHOLDER)}"`);
            attrs.push('class="canvas-export__broken-image"');
        }
        if (alt) attrs.push(`alt="${escapeHtml(alt)}"`);
        if (title) attrs.push(`title="${escapeHtml(title)}"`);
        return `<img ${attrs.join(' ')}>`;
    });
}

/**
 * Render a code canvas body as a highlighted `<pre><code>` block. Uses
 * highlight.js when the language is registered (its output escapes HTML in the
 * code); otherwise falls back to an escaped plain block. Never throws.
 */
function renderCodeBody(
    source: string,
    language: string | undefined,
    warnings: string[],
): string {
    const lang = (language ?? '').trim();
    let inner: string;
    let cls = 'hljs';
    if (lang && hljs.getLanguage(lang)) {
        try {
            inner = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
            cls = `hljs language-${escapeHtml(lang)}`;
        } catch {
            inner = escapeHtml(source);
            cls = `hljs language-${escapeHtml(lang)}`;
            warnings.push(`Failed to highlight code as "${lang}"; embedded as plain text.`);
        }
    } else {
        inner = escapeHtml(source);
        if (lang) cls = `hljs language-${escapeHtml(lang)}`;
    }
    return `<pre><code class="${cls}">${inner}</code></pre>`;
}

/**
 * Build a self-contained, portable HTML document from a fully-prepared canvas
 * export input. Pure and deterministic — safe to call in Node and in tests.
 */
export function buildCanvasHtmlDocument(
    input: BuildCanvasHtmlDocumentInput,
): BuildCanvasHtmlDocumentResult {
    const warnings: string[] = [];
    const { type, sourceText, language } = input;
    const assets = input.assets ?? new Map<string, string>();
    const displayTitle = input.title && input.title.trim() ? input.title : 'Untitled canvas';

    let body: string;
    if (type === 'code') {
        body = renderCodeBody(sourceText, language, warnings);
    } else if (type === 'extension') {
        // The extension body is a fully-built, self-contained sandboxed iframe
        // (Layer D-ext). Its `<img>` tags live inside the escaped `srcdoc`
        // attribute, so running `rewriteImages` over it would corrupt the
        // markup — ship the body verbatim instead.
        body = input.bodyHtml ?? '';
    } else {
        body = rewriteImages(input.bodyHtml ?? '', assets, warnings);
    }

    const bodyClass =
        type === 'excalidraw'
            ? 'canvas-export__body canvas-export__excalidraw'
            : 'canvas-export__body';

    // Self-contained KaTeX stylesheet (glyph fonts already inlined as data URIs)
    // plus the narrow-page overflow override, embedded only when the caller
    // supplied math CSS — i.e. a markdown body that may contain rendered math.
    const mathCss = input.mathCss && input.mathCss.trim() ? input.mathCss.trim() : '';
    const styleBlock = mathCss
        ? `${BASE_CSS}\n${HLJS_THEME_CSS}\n${mathCss}\n${KATEX_EXPORT_OVERRIDES_CSS}`
        : `${BASE_CSS}\n${HLJS_THEME_CSS}`;

    const html =
        '<!doctype html>\n' +
        '<html lang="en">\n' +
        '<head>\n' +
        '<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<meta name="generator" content="coc canvas export">\n' +
        `<title>${escapeHtml(displayTitle)}</title>\n` +
        `<style>\n${styleBlock}\n</style>\n` +
        '</head>\n' +
        '<body>\n' +
        '<main class="canvas-export">\n' +
        `<h1 class="canvas-export__title">${escapeHtml(displayTitle)}</h1>\n` +
        `<div class="${bodyClass}">\n${body}\n</div>\n` +
        '</main>\n' +
        `<script type="${sourceScriptType(type)}" id="source">${escapeScriptText(sourceText)}</script>\n` +
        '</body>\n' +
        '</html>\n';

    return { html, warnings };
}

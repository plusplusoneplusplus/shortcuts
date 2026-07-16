/**
 * Layer E helper — pre-bake highlight.js token spans into the fenced code
 * blocks of rendered markdown body HTML.
 *
 * The chat markdown renderer (`chatMarkdownToHtml` → `createChatMarked`) emits
 * fenced code as `<pre><code class="language-X">ESCAPED</code></pre>`, with the
 * source only HTML-escaped — highlight.js normally runs at runtime via a global
 * to colour it. An exported, offline file ships no such runtime, so the theme
 * CSS (`.hljs-*` classes) would have nothing to style. This pass re-runs
 * highlight.js at export time and rewrites each recognised block to the
 * highlighted `<pre><code class="hljs language-X">…spans…</code></pre>`, so the
 * embedded theme CSS takes effect with zero runtime shipped.
 *
 * Node-safe (highlight.js core is pure) and deterministic (no time/random), so
 * it can run in the orchestrator and be asserted exactly in tests.
 */

import hljs from 'highlight.js';

/** Reverse the chat renderer's HTML escaping (`&amp;`/`&lt;`/`&gt;`, plus quotes for safety). */
function decodeHtml(escaped: string): string {
    return escaped
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Escape a validated language name for the emitted `class` attribute. */
function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Matches a fenced code block emitted by the chat markdown renderer. The inner
 * source is HTML-escaped, so it can never contain a literal `</code></pre>`,
 * making the lazy body match safe.
 */
const CODE_BLOCK_RE = /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/gi;

/**
 * Rewrite every recognised `language-X` code block in `html` to highlight.js
 * output. A block whose language highlight.js does not know (including
 * `mermaid`, handled by Layer C) is left untouched — it stays a plain, escaped
 * code block styled by the base CSS. Never throws: a highlight failure keeps the
 * original block. Input without code blocks is returned unchanged.
 */
export function highlightMarkdownCodeBlocks(html: string): string {
    if (!html) return html ?? '';
    return html.replace(CODE_BLOCK_RE, (whole, langRaw: string, escapedInner: string) => {
        const lang = decodeHtml(langRaw).trim();
        // Unknown languages (and mermaid, which Layer C already replaced) are left
        // as-is so we never mangle a block highlight.js cannot parse.
        if (!lang || lang.toLowerCase() === 'mermaid' || !hljs.getLanguage(lang)) {
            return whole;
        }
        try {
            const source = decodeHtml(escapedInner);
            const value = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
            return `<pre><code class="hljs language-${escapeAttr(lang)}">${value}</code></pre>`;
        } catch {
            return whole;
        }
    });
}

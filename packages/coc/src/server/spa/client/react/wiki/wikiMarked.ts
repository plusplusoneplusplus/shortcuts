import { mathMarkedExtension } from '../../shared/math/mathMarkedExtension';

/**
 * The Wiki renders Markdown through the CDN-loaded global `marked` (see
 * `html-template.ts`, gated on `enableWiki`), not the bundled npm `Marked`
 * instances used by chat/AskUser/PR. To keep math rendering consistent across
 * every user-visible Markdown surface (AC-01), register the same shared KaTeX
 * math extension on that global once, then parse.
 *
 * The extension itself (and its `renderMath`/KaTeX dependency) is part of the
 * bundled SPA, so no new CDN dependency is introduced — only the Markdown
 * parser is the CDN copy.
 */
type GlobalMarked = {
    parse(md: string): string;
    use?(ext: unknown): void;
};

let mathRegistered = false;

function getGlobalMarked(): GlobalMarked | undefined {
    return (globalThis as { marked?: GlobalMarked }).marked;
}

/**
 * Parse Wiki Markdown to HTML with math support, or return `null` when the
 * global `marked` script has not loaded so callers can apply their own
 * escaped-text fallback.
 */
export function tryParseWikiMarkdown(md: string): string | null {
    const marked = getGlobalMarked();
    if (!marked) return null;
    if (!mathRegistered) {
        // marked >= 4 exposes `.use({ extensions })`; guard in case the CDN
        // copy is an older API so math wiring never breaks article rendering.
        try {
            marked.use?.(mathMarkedExtension);
        } catch {
            /* leave articles rendering without math rather than throwing */
        }
        mathRegistered = true;
    }
    return marked.parse(md);
}

/** Test-only: reset the one-time registration guard. */
export function __resetWikiMathRegistration(): void {
    mathRegistered = false;
}

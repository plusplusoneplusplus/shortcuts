/**
 * Safe KaTeX rendering wrapper.
 *
 * Central policy for turning a TeX string into HTML+MathML markup. Every
 * rendering seam funnels through here so the trust boundary and accessibility
 * output stay identical everywhere.
 *
 * Policy (fixed for all surfaces):
 *   - `trust: false`        — no `\href`, `\includegraphics`, or other commands
 *                             that could emit trusted URLs/HTML.
 *   - `throwOnError: false` — invalid TeX renders as a readable error node
 *                             instead of throwing or blanking the surface.
 *   - `output: 'htmlAndMathml'` — visual HTML plus MathML for accessibility;
 *                             theme-independent semantic markup.
 *   - `strict: 'ignore'`    — unsupported constructs degrade rather than throw.
 *   - `maxExpand` / `maxSize` — finite expansion and size bounds.
 *   - No `macros` object is shared across calls, so no mutable macro state
 *     leaks between messages or documents.
 */

import katex from 'katex';

export interface RenderMathOptions {
    /** Render as display (block) math when true, inline otherwise. */
    display?: boolean;
}

/** Escape text for safe inclusion in HTML (used by the error fallback). */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Render a TeX string to safe HTML+MathML markup.
 *
 * Never throws: on any failure it returns a readable, escaped error node that
 * preserves the original source so the surrounding Markdown is never corrupted.
 */
export function renderMath(tex: string, options?: RenderMathOptions): string {
    const display = options?.display === true;
    try {
        return katex.renderToString(tex, {
            displayMode: display,
            throwOnError: false,
            errorColor: '#cc0000',
            trust: false,
            strict: 'ignore',
            output: 'htmlAndMathml',
            // Finite bounds: cap macro expansion and rendered size so a
            // pathological expression cannot hang or blow up the page.
            maxExpand: 1000,
            maxSize: 500,
        });
    } catch (err) {
        // katex.renderToString should not throw with throwOnError:false, but a
        // truly malformed input (or a KaTeX bug) must still degrade safely.
        const message = err instanceof Error ? err.message : 'Invalid math expression';
        const cls = display ? 'math-error math-error--display' : 'math-error math-error--inline';
        return (
            `<span class="${cls}" role="img" aria-label="Math error: ${escapeHtml(message)}" ` +
            `title="${escapeHtml(message)}">${escapeHtml(tex)}</span>`
        );
    }
}

/**
 * Probe a TeX string for parse errors, returning the error message or `null`
 * when it is valid. `renderMath` itself uses `throwOnError: false` so live
 * surfaces never break; the rich-editor formula editor uses this to surface an
 * "invalid TeX" hint to the author while keeping the same trust/size bounds.
 */
export function getMathError(tex: string, options?: RenderMathOptions): string | null {
    try {
        katex.renderToString(tex, {
            displayMode: options?.display === true,
            throwOnError: true,
            trust: false,
            strict: 'ignore',
            output: 'htmlAndMathml',
            maxExpand: 1000,
            maxSize: 500,
        });
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'Invalid math expression';
    }
}

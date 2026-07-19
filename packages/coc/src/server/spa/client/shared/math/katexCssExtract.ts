/**
 * Extract the KaTeX styling from the live app stylesheets into one self-contained
 * CSS string, for embedding in derived/portable outputs (self-contained canvas
 * HTML export, conversation PDF) so already-rendered `.katex` markup styles
 * correctly with zero network access.
 *
 * Why read from the loaded CSSOM instead of re-bundling KaTeX here:
 *   - The SPA already imports `katex/dist/katex.min.css` (see `entry.tsx`), and
 *     the esbuild `dataurl` loader inlines every `KaTeX_*` web font as a `data:`
 *     URI into `bundle.css`. So the rules already on the page are self-contained
 *     — no CDN, no external font fetch, no duplicated font bytes in the source
 *     tree (the repo gitignores `dist/`, so a committed inlined-font blob would
 *     be off-pattern anyway).
 *   - Reading the live rules guarantees exported math matches on-screen math.
 *
 * The pure `extractKatexCss` takes any iterable of stylesheet-like objects, so it
 * unit-tests with plain fakes (no DOM). `getExportKatexCss` is the thin browser
 * adapter over `document.styleSheets`; it is defensive (a cross-origin sheet
 * throws on `.cssRules` access) and never throws.
 */

/** A CSS rule as far as extraction cares: its text, optional selector, optional style. */
interface CssRuleLike {
    /** Serialized rule text (`.katex{...}` or `@font-face{...}`). */
    cssText?: string | null;
    /** Present on style rules (`CSSStyleRule`); absent on `@font-face`. */
    selectorText?: string | null;
    /** Present on `@font-face`; `fontFamily` identifies the KaTeX families. */
    style?: { fontFamily?: string | null } | null;
}

/** A stylesheet as far as extraction cares. Accessing `cssRules` may throw (cross-origin). */
interface CssSheetLike {
    cssRules?: ArrayLike<CssRuleLike> | Iterable<CssRuleLike> | null;
}

/** Iterate an array-like or iterable uniformly; tolerates null/undefined. */
function* iterate<T>(list: ArrayLike<T> | Iterable<T> | null | undefined): Generator<T> {
    if (!list) return;
    if (typeof (list as Iterable<T>)[Symbol.iterator] === 'function') {
        yield* list as Iterable<T>;
        return;
    }
    const arr = list as ArrayLike<T>;
    for (let i = 0; i < arr.length; i++) yield arr[i];
}

/** Whether a rule is part of KaTeX styling (or the math-error fallback) we must ship. */
function isMathRule(rule: CssRuleLike, text: string): boolean {
    // Style rules: any KaTeX class (`.katex`, `.katex-display`, `.katex .base`,
    // …) or the invalid-TeX fallback (`.math-error`). Case-insensitive so a
    // future minifier casing change does not silently drop rules.
    const selector = rule.selectorText;
    if (typeof selector === 'string' && selector) {
        const lower = selector.toLowerCase();
        if (lower.includes('katex') || lower.includes('math-error')) return true;
        return false;
    }
    // `@font-face` rules: keep only the KaTeX_* families.
    if (text.startsWith('@font-face')) {
        const family = rule.style?.fontFamily;
        if (typeof family === 'string' && /katex/i.test(family)) return true;
        // Fallback when `style.fontFamily` is unavailable (some CSSOM impls):
        // sniff the serialized text.
        return /font-family:\s*["']?katex/i.test(text);
    }
    return false;
}

/**
 * Collect the KaTeX (and math-error) CSS rules from a set of stylesheets into a
 * single de-duplicated CSS string. Pure and DOM-free — pass `document.styleSheets`
 * in the browser, or plain fakes in a test. A sheet whose `cssRules` cannot be
 * read (cross-origin) is skipped, never thrown.
 */
export function extractKatexCss(
    sheets: ArrayLike<CssSheetLike> | Iterable<CssSheetLike> | null | undefined,
): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const sheet of iterate(sheets)) {
        let rules: ArrayLike<CssRuleLike> | Iterable<CssRuleLike> | null | undefined;
        try {
            rules = sheet?.cssRules;
        } catch {
            // Cross-origin stylesheet — cannot read rules. Skip it.
            continue;
        }
        for (const rule of iterate(rules)) {
            const text = (rule?.cssText ?? '').trim();
            if (!text) continue;
            if (isMathRule(rule, text) && !seen.has(text)) {
                seen.add(text);
                parts.push(text);
            }
        }
    }
    return parts.join('\n');
}

/** Minimal document shape needed to read stylesheets — the real `Document` satisfies it. */
interface StyleSheetHost {
    styleSheets?: ArrayLike<CssSheetLike> | Iterable<CssSheetLike> | null;
}

let cached: string | null = null;

/**
 * Browser adapter: extract the self-contained KaTeX CSS from the current
 * document's loaded stylesheets. Memoizes a non-empty result (the app stylesheet
 * set is stable for the page's lifetime) but never caches an empty extraction, so
 * a call made before styles have loaded is retried later. Returns `''` when no
 * document / no stylesheets are available (e.g. under Node), so callers degrade
 * gracefully to shipping unstyled math markup rather than failing the export.
 *
 * Pass an explicit `host` in tests; omit it to read the global `document`.
 */
export function getExportKatexCss(host?: StyleSheetHost): string {
    const usingGlobal = host === undefined;
    if (usingGlobal && cached) return cached;
    const doc: StyleSheetHost | undefined =
        host ?? (typeof document !== 'undefined' ? (document as unknown as StyleSheetHost) : undefined);
    if (!doc || !doc.styleSheets) return '';
    const css = extractKatexCss(doc.styleSheets);
    if (usingGlobal && css) cached = css;
    return css;
}

/** Test-only: reset the memoized global extraction. */
export function resetExportKatexCssCache(): void {
    cached = null;
}

/**
 * fontFamilies.ts — the note editor's font-family picker list and the CSS
 * font-stack normalization the Markdown round trip depends on.
 *
 * A font choice persists as literal CSS inside the `.md` file
 * (`<span style="font-family:…">`), so the picker and the parser have to agree
 * on one canonical spelling. Two things force a normalizer rather than a plain
 * string compare:
 *
 * - The persisted value lives inside a double-quoted HTML attribute, so a stack
 *   written with `"Segoe UI"` cannot be emitted verbatim. Canonical form quotes
 *   multi-word families with `'…'`.
 * - The browser rewrites `element.style.fontFamily` when Tiptap parses the HTML
 *   back (quote style and spacing both drift), and without normalization a
 *   save/reload cycle would churn the persisted Markdown with nothing edited.
 *
 * Like `colorPalette.ts`, this module is deliberately free of React and Tiptap
 * imports — `noteMarkdown.ts` pulls the normalizer from here and must stay
 * usable from the plain serialization path.
 */

export interface FontFamilyOption {
    /** Stable identifier — also the React key. */
    id: string;
    /** Menu label; also the trigger text when this font is active. */
    label: string;
    /**
     * The CSS stack handed to `setFontFamily`. Empty for the "Default" row,
     * which unsets the mark rather than setting a font.
     */
    stack: string;
    testId: string;
}

/**
 * The font menu, in render order.
 *
 * Websafe stacks only — nothing here downloads a web font, so every entry has
 * to degrade to something locally installed. `Mono` is the coding font and
 * leads with JetBrains Mono because the dashboard already ships that face for
 * code surfaces; the rest of its stack is the usual per-platform fallback.
 */
export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
    { id: 'default', label: 'Default', stack: '', testId: 'font-item-default' },
    { id: 'sans', label: 'Sans', stack: '-apple-system, "Segoe UI", Roboto, sans-serif', testId: 'font-item-sans' },
    { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif', testId: 'font-item-serif' },
    {
        id: 'mono',
        label: 'Mono',
        stack: '"JetBrains Mono", Consolas, "SF Mono", Menlo, monospace',
        testId: 'font-item-mono',
    },
    { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', testId: 'font-item-arial' },
    { id: 'times', label: 'Times', stack: '"Times New Roman", Times, serif', testId: 'font-item-times' },
] as const;

/** The reset row — selecting it runs `unsetFontFamily`, it sets no font. */
export const DEFAULT_FONT_OPTION = FONT_FAMILY_OPTIONS[0];

/**
 * Family names may only contain these characters. Anything else — parentheses
 * (`url(…)`, `expression(…)`), a semicolon, an angle bracket, a CSS variable —
 * makes the whole stack unpersistable, which is what keeps a pasted `style`
 * attribute from turning the note format into a general HTML-styling escape
 * hatch. Latin-1/Latin-Extended letters are allowed so non-English family names
 * survive.
 */
const FONT_STACK_ALLOWED = /^[A-Za-z0-9 _,'"À-ɏ-]+$/;

/**
 * Canonicalize a CSS font stack, or return `null` if it is not a form we
 * persist.
 *
 * Canonical form is `Family, 'Two Words', fallback`: comma-space separated,
 * multi-word (or otherwise non-bare) families single-quoted, everything else
 * bare. Single quotes rather than double so the result can sit inside a
 * double-quoted `style` attribute unescaped.
 */
export function normalizeFontStack(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value || !FONT_STACK_ALLOWED.test(value)) return null;

    const families = value
        .split(',')
        .map((part) => part.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean)
        // A single-word family is a valid CSS identifier and stays bare; the
        // leading hyphen of `-apple-system` is part of that spelling.
        .map((name) => (/^-?[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : `'${name.replace(/\s+/g, ' ')}'`));

    return families.length > 0 ? families.join(', ') : null;
}

/**
 * A quote-insensitive, case-insensitive key for comparing two stacks.
 *
 * The value read back off the editor was rewritten by the browser, so matching
 * the active menu entry has to ignore quoting and case — only the family names
 * and their order are meaningful.
 */
export function fontStackKey(raw: string | null | undefined): string | null {
    const normalized = normalizeFontStack(raw);
    return normalized ? normalized.replace(/'/g, '').toLowerCase() : null;
}

/**
 * The menu entry a stack corresponds to, or `null` for an unset, unparsable, or
 * foreign font (a stack pasted from elsewhere is kept on the mark but has no
 * row to check, so the trigger falls back to "Default").
 */
export function findFontOption(raw: string | null | undefined): FontFamilyOption | null {
    const key = fontStackKey(raw);
    if (!key) return null;
    return FONT_FAMILY_OPTIONS.find((option) => option.stack && fontStackKey(option.stack) === key) ?? null;
}

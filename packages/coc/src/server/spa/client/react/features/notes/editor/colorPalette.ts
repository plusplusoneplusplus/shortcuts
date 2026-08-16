/**
 * colorPalette.ts — the note editor's inline color palettes and the CSS-color
 * normalization the Markdown round trip depends on.
 *
 * Text color and highlight color both persist as literal hex inside the `.md`
 * file (`<span style="color:…">` / `<mark style="background-color:…">`), so the
 * palettes and the parser have to agree on one canonical spelling. Everything
 * that reads a color out of HTML goes through `normalizeCssColor` first: the
 * browser rewrites `style="color: #e11d48"` to `rgb(225, 29, 72)` when Tiptap
 * parses it back, and without normalization a save/reload cycle would churn the
 * persisted Markdown even though nothing was edited.
 *
 * This module is deliberately free of React and Tiptap imports — `noteMarkdown.ts`
 * pulls the default highlight color from here, and it must stay usable from the
 * plain serialization path.
 */

export interface PaletteColor {
    /** Human label — the swatch's `title` / `aria-label`. */
    name: string;
    /** Canonical lowercase `#rrggbb`. */
    color: string;
}

/**
 * Highlight swatches. The `mark` background sits behind body text, so these stay
 * pale; `noteEditor.css` force-flips `mark` ink to a near-black in dark mode.
 *
 * `tableCellBackground.ts` mirrors these names and light values as semantic
 * tokens — keep the two in sync so the pickers read as one system.
 */
export const HIGHLIGHT_COLORS: readonly PaletteColor[] = [
    { name: 'Yellow', color: '#fff3b0' },
    { name: 'Green', color: '#b9f5d0' },
    { name: 'Blue', color: '#bde0fe' },
    { name: 'Pink', color: '#ffc8dd' },
    { name: 'Orange', color: '#ffd6a5' },
    { name: 'Purple', color: '#e0c3fc' },
];

/**
 * The color a bare highlight gets. It is also the one highlight color that is
 * NOT persisted as inline HTML: a `<mark>` in this color serializes to plain
 * `==text==`, so ordinary highlights stay clean Markdown and every note written
 * before colors were persisted keeps parsing to exactly what it did before.
 */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(value: number): string {
    return clampByte(value).toString(16).padStart(2, '0');
}

/**
 * Canonicalize a CSS color to lowercase `#rrggbb`, or `null` if it is not a form
 * we persist.
 *
 * Accepts `#rgb`, `#rrggbb`, `rgb(…)` and `rgba(…)` (alpha is dropped — a
 * translucent ink has no `#rrggbb` spelling, and the palettes never produce one).
 * Anything else — a CSS keyword, `hsl()`, a custom property — returns `null` and
 * is treated as "no color", which is what keeps a pasted `style` attribute from
 * turning the note format into a general HTML-styling escape hatch.
 */
export function normalizeCssColor(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();

    const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
    if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;

    if (/^#[0-9a-f]{6}$/.test(value)) return value;

    const rgb = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/].*)?\)$/.exec(value);
    if (rgb) {
        const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
        if (parts.some(Number.isNaN)) return null;
        return `#${parts.map(toHex).join('')}`;
    }

    return null;
}

/**
 * Read one whitelisted declaration out of a raw `style` attribute string.
 *
 * The `(?:^|;)` anchor is load-bearing: without it, asking for `color` would
 * match the tail of `background-color`.
 */
export function readStyleProp(style: string | null | undefined, prop: 'color' | 'background-color'): string | null {
    if (!style) return null;
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
    return re.exec(style)?.[1]?.trim() ?? null;
}

/**
 * The canonical color carried by a raw `style` attribute string, or `null`.
 *
 * Takes the attribute rather than the element's `CSSStyleDeclaration` on purpose:
 * the attribute is what was actually authored, and it reads the same under
 * jsdom, domino and a real browser.
 */
export function readInlineColor(
    style: string | null | undefined,
    prop: 'color' | 'background-color',
): string | null {
    return normalizeCssColor(readStyleProp(style, prop));
}

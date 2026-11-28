/**
 * fontSizes.ts — the note editor's font-size picker list and the CSS length
 * normalization the Markdown round trip depends on.
 *
 * A size choice persists as literal CSS inside the `.md` file
 * (`<span style="font-size:24px">`), so the picker and the parser have to agree
 * on one canonical spelling. As with `fontFamilies.ts`, the browser rewrites
 * `element.style.fontSize` when Tiptap parses the HTML back (`24 px`, `24.0px`),
 * and without normalization a save/reload cycle would churn the persisted
 * Markdown with nothing edited.
 *
 * Only `px` is persisted. A pasted `em`/`rem`/`pt`/`%` size stays on the mark
 * for the session but matches no menu row and is dropped on save — the same
 * narrowness that keeps a pasted `style` attribute from turning the note format
 * into a general HTML-styling escape hatch.
 *
 * Like `colorPalette.ts` and `fontFamilies.ts`, this module is deliberately free
 * of React and Tiptap imports — `noteMarkdown.ts` pulls the normalizer from here
 * and must stay usable from the plain serialization path.
 */

export interface FontSizeOption {
    /** Stable identifier — also the React key. */
    id: string;
    /** Menu label; also the trigger text when this size is active. */
    label: string;
    /**
     * The CSS length handed to `setFontSize`. Empty for the "Default" row,
     * which unsets the mark rather than setting a size.
     */
    size: string;
    testId: string;
}

/** The px sizes offered, in menu order — the familiar word-processor ladder. */
const SIZES_PX = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 60] as const;

/**
 * The size menu, in render order: the reset row followed by every px preset.
 *
 * Labels are the bare number — the unit is implied, and a fixed-width trigger
 * has no room for `px` on top of two digits.
 */
export const FONT_SIZE_OPTIONS: readonly FontSizeOption[] = [
    { id: 'default', label: 'Default', size: '', testId: 'font-size-item-default' },
    ...SIZES_PX.map((px) => ({
        id: `px-${px}`,
        label: String(px),
        size: `${px}px`,
        testId: `font-size-item-${px}`,
    })),
];

/** The reset row — selecting it runs `unsetFontSize`, it sets no size. */
export const DEFAULT_FONT_SIZE_OPTION = FONT_SIZE_OPTIONS[0];

/**
 * Sizes outside this range are not persisted. A note is a document, not a
 * canvas: the bound keeps a pasted `font-size: 0` (invisible text) or a
 * four-digit size out of the file, and bounds what the normalizer has to
 * render.
 */
const MIN_PX = 1;
const MAX_PX = 400;

/**
 * Canonicalize a CSS font size, or return `null` if it is not a form we persist.
 *
 * Canonical form is `<number>px` with no space and no trailing zeros, so
 * `24 px`, `24.0px` and `24px` all converge — that convergence is what makes
 * re-saving an untouched note byte-identical.
 */
export function normalizeFontSize(raw: string | number | null | undefined): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    // A bare number is read as px; the extension stores whatever it was handed,
    // and a caller writing `24` means 24px.
    const value = String(raw).trim();
    const px = /^(\d+(?:\.\d+)?)\s*(?:px)?$/i.exec(value)?.[1];
    if (px === undefined) return null;

    const n = parseFloat(px);
    if (!Number.isFinite(n) || n < MIN_PX || n > MAX_PX) return null;
    // Round to a tenth: finer than that is invisible on screen and only serves
    // to churn the file when a browser reports a computed fractional size back.
    return `${Math.round(n * 10) / 10}px`;
}

/**
 * The canonical font size carried by a raw `style` attribute string, or `null`.
 *
 * Takes the attribute rather than the element's `CSSStyleDeclaration` for the
 * same reason `readInlineColor` and `readInlineFontFamily` do: the attribute is
 * what was actually authored, and it reads the same under jsdom, domino and a
 * real browser. The `(?:^|;)` anchor keeps this from matching the tail of some
 * other declaration — notably `font-family`, which ends in the same six
 * characters as the property name it must not be confused with.
 */
export function readInlineFontSize(style: string | null | undefined): string | null {
    if (!style) return null;
    const raw = /(?:^|;)\s*font-size\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
    return normalizeFontSize(raw);
}

/**
 * The menu entry a size corresponds to, or `null` for an unset, unparsable, or
 * off-ladder size (a `13px` pasted from elsewhere is kept on the mark but has no
 * row to check, so the trigger falls back to "Default").
 */
export function findSizeOption(raw: string | number | null | undefined): FontSizeOption | null {
    const normalized = normalizeFontSize(raw);
    if (!normalized) return null;
    return FONT_SIZE_OPTIONS.find((option) => option.size && option.size === normalized) ?? null;
}

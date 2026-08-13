/**
 * tableCellBackground.ts — per-cell fill color for note tables.
 *
 * A `backgroundColor` attribute on TableCell / TableHeader holding a *semantic
 * token* (`yellow`, `green`, …), never a hex. A cell fill covers a large area
 * behind the text, so no single hex reads well in both themes: the token lets
 * `noteEditor.css` pick a pale pastel in light mode and a desaturated tint in
 * dark mode while leaving body text color alone. (Text highlight stores raw hex
 * and papers over the dark-mode problem by force-flipping `mark` ink to
 * `#1e1e1e`; that trick does not generalize to a cell full of links and code
 * spans.)
 *
 * The token names and light values match `HIGHLIGHT_COLORS` in
 * `NoteEditorToolbar.tsx` so the two pickers read as one system.
 *
 * Rendering emits both `data-bg` (the token — the thing that round-trips
 * through markdown) and an inline `style` resolving the CSS variable. The
 * inline style is what makes a fill visible outside the editor, and its
 * specificity is also what lets an explicit fill beat the default `th` grey
 * with no extra CSS.
 */

import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

export interface TableCellColor {
    /** Persisted value, e.g. `yellow`. Also the CSS variable suffix. */
    token: string;
    /** Human label for the picker button. */
    name: string;
    /** Light-theme hex, used to paint the swatch in the toolbar. */
    swatch: string;
}

/**
 * The single source of truth for the palette — the toolbar imports this rather
 * than redeclaring it, so a swatch can never drift from a token the CSS knows.
 */
export const TABLE_CELL_COLORS: readonly TableCellColor[] = [
    { token: 'yellow', name: 'Yellow', swatch: '#fff3b0' },
    { token: 'green', name: 'Green', swatch: '#b9f5d0' },
    { token: 'blue', name: 'Blue', swatch: '#bde0fe' },
    { token: 'pink', name: 'Pink', swatch: '#ffc8dd' },
    { token: 'orange', name: 'Orange', swatch: '#ffd6a5' },
    { token: 'purple', name: 'Purple', swatch: '#e0c3fc' },
] as const;

/** CSS custom property backing a token, defined in `noteEditor.css`. */
export function tableCellBackgroundVar(token: string): string {
    return `--note-table-bg-${token}`;
}

export function isKnownTableCellColor(value: unknown): value is string {
    return typeof value === 'string' && TABLE_CELL_COLORS.some(c => c.token === value);
}

const SWATCH_TO_TOKEN = new Map(
    TABLE_CELL_COLORS.map(c => [c.swatch.toLowerCase(), c.token]),
);

/**
 * Recover a token from an inline `background-color`, for content that predates
 * this feature or was pasted from elsewhere.
 *
 * Two shapes are recognised: our own `var(--note-table-bg-<token>)`, and an
 * exact light-palette hex. Anything else — `rgb(...)` from a Notion/Excel
 * paste, a hand-written `red` — returns null and the fill is simply dropped.
 * Nearest-token matching would be friendlier but silently recolors content;
 * dropping is predictable, which matters more for something that persists.
 */
export function tableCellColorFromStyle(style: string | null | undefined): string | null {
    if (!style) return null;
    const value = style.match(/background-color:\s*([^;]+)/i)?.[1]?.trim();
    if (!value) return null;

    const fromVar = value.match(/^var\(\s*--note-table-bg-([a-z]+)\s*\)$/i)?.[1]?.toLowerCase();
    if (fromVar && isKnownTableCellColor(fromVar)) return fromVar;

    return SWATCH_TO_TOKEN.get(value.toLowerCase()) ?? null;
}

const backgroundColorAttribute = {
    backgroundColor: {
        default: null as string | null,
        parseHTML: (element: HTMLElement): string | null => {
            const token = element.getAttribute('data-bg');
            if (isKnownTableCellColor(token)) return token;
            return tableCellColorFromStyle(element.getAttribute('style'));
        },
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
            const token = attributes.backgroundColor;
            // An unknown token would render `var(--note-table-bg-chartreuse)`,
            // which resolves to nothing and leaves a `style` attribute that
            // parseHTML then reads back as null — so drop it outright.
            if (!isKnownTableCellColor(token)) return {};
            return {
                'data-bg': token,
                style: `background-color: var(${tableCellBackgroundVar(token)});`,
            };
        },
    },
};

// `...this.parent?.()` is load-bearing: colspan / rowspan / colwidth all live on
// the stock attribute set and must survive.
export const TableCellWithBackground = TableCell.extend({
    addAttributes() {
        return { ...this.parent?.(), ...backgroundColorAttribute };
    },
});

export const TableHeaderWithBackground = TableHeader.extend({
    addAttributes() {
        return { ...this.parent?.(), ...backgroundColorAttribute };
    },
});

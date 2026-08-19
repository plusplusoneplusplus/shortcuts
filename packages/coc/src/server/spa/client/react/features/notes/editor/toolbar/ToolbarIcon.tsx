import type { ReactNode } from 'react';

// ── Toolbar command icons ───────────────────────────────────────────────────
// Drawn rather than typed, for the same reason as `AlignIcon`: the glyphs these
// replace ("B", "S̶", "❝", "🔗", "→|", "🔍", "📄") came from three different
// sources — plain letters, box-drawing characters and emoji — so they rendered
// at different weights, widths and baselines, and the emoji picked up their own
// colors. One stroked set at one weight makes the row read as a single control.
//
// Every icon is a 24×24 stroke drawing so they share a grid, and none of them
// carries a label: each caller already sets `title`/`aria-label`.

/** Shorthand for one stroked path in the 24×24 grid. */
const p = (d: string, key: string) => <path key={key} d={d} />;

/**
 * The drawing for each icon, keyed by the toolbar command's `id`.
 *
 * A command with no entry here falls back to its text `icon`, so adding a
 * command never renders a blank button — it just renders the old way until a
 * drawing is added.
 */
const ICONS: Record<string, ReactNode> = {
    bold: p('M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8', 'b'),
    italic: [p('M19 4h-9', 'top'), p('M14 20H5', 'bottom'), p('m15 4-6 16', 'stem')],
    strike: [
        p('M16 4H9a3 3 0 0 0-2.83 4', 'top'),
        p('M14 12a4 4 0 0 1 0 8H6', 'bottom'),
        p('M4 12h16', 'bar'),
    ],
    superscript: [
        p('m4 19 8-8', 'x1'),
        p('m12 19-8-8', 'x2'),
        // The raised "2": an open loop that stops short of a closed digit so it
        // still reads at 15px.
        p('M20 12h-4c0-1.5.5-2 1.5-2.5S20 8.3 20 7c0-.5-.2-.9-.5-1.3a2.1 2.1 0 0 0-2.6-.4c-.4.2-.7.6-.9 1', 'two'),
    ],
    subscript: [
        p('m4 5 8 8', 'x1'),
        p('m12 5-8 8', 'x2'),
        p('M20 19h-4c0-1.5.5-2 1.5-2.5S20 15.3 20 14c0-.5-.2-.9-.5-1.3a2.1 2.1 0 0 0-2.6-.4c-.4.2-.7.6-.9 1', 'two'),
    ],
    blockquote: [
        p('M8 6H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3v3a2 2 0 0 1-2 2', 'left'),
        p('M19 6h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3v3a2 2 0 0 1-2 2', 'right'),
    ],
    code: [p('m16 18 6-6-6-6', 'right'), p('m8 6-6 6 6 6', 'left')],
    codeBlock: [
        <rect key="frame" x="3" y="3" width="18" height="18" rx="2" />,
        p('M10 9.5 8 12l2 2.5', 'left'),
        p('m14 9.5 2 2.5-2 2.5', 'right'),
    ],
    link: [
        p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'right'),
        p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', 'left'),
    ],
    horizontalRule: p('M5 12h14', 'rule'),
    increaseIndent: [
        p('m3 8 4 4-4 4', 'caret'),
        p('M21 6h-10', 'row1'),
        p('M21 12h-10', 'row2'),
        p('M21 18h-10', 'row3'),
    ],
    decreaseIndent: [
        p('m7 8-4 4 4 4', 'caret'),
        p('M21 6h-10', 'row1'),
        p('M21 12h-10', 'row2'),
        p('M21 18h-10', 'row3'),
    ],
    find: [<circle key="lens" cx="11" cy="11" r="7" />, p('m21 21-4.3-4.3', 'handle')],
    insertPdf: [
        p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'page'),
        p('M14 2v5h5', 'fold'),
        p('M8 13h8', 'line1'),
        p('M8 17h5', 'line2'),
    ],
};

/** Whether a drawn icon exists for this command id. */
export function hasToolbarIcon(name: string): boolean {
    return name in ICONS;
}

export interface ToolbarIconProps {
    /** The toolbar command's `id`. */
    name: string;
    /** Extra classes for the svg — sizing lives with the caller. */
    className?: string;
}

/**
 * The drawn glyph for one toolbar command, or nothing when it has no drawing.
 *
 * `currentColor` so the icon follows the button's text color in both themes,
 * and `aria-hidden` because every caller already labels itself.
 */
export function ToolbarIcon({ name, className }: ToolbarIconProps) {
    const drawing = ICONS[name];
    if (!drawing) return null;
    return (
        <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            data-testid={`toolbar-icon-${name}`}
            className={className}
        >
            {drawing}
        </svg>
    );
}

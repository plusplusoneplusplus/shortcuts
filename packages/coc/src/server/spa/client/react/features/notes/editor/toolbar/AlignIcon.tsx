import type { AlignValue } from './formattingCommands';

// ── Alignment icons ─────────────────────────────────────────────────────────
// Drawn rather than typed: the Unicode glyphs these replace (⫷ ≡ ⫸ ☰) render at
// wildly different weights and widths across fonts, so the four rows never
// lined up. Lives in its own module so `formattingCommands.ts` stays React-free.

/**
 * The four text rows of the icon, as `[x, width]` pairs in a 16×16 viewBox.
 *
 * Every alignment draws the same alternating long/short row rhythm — what
 * changes is where the short rows sit, which is exactly the cue the icon needs
 * to carry. Justify has no short rows: every row runs the full width.
 */
const BARS: Record<AlignValue, ReadonlyArray<readonly [number, number]>> = {
    left: [[2, 12], [2, 7], [2, 12], [2, 7]],
    center: [[2, 12], [4.5, 7], [2, 12], [4.5, 7]],
    right: [[2, 12], [7, 7], [2, 12], [7, 7]],
    justify: [[2, 12], [2, 12], [2, 12], [2, 12]],
};

/** Row baselines, evenly spaced so the icon reads as a block of text. */
const ROW_Y = [3, 6, 9, 12];

export interface AlignIconProps {
    value: AlignValue;
    /** Extra classes for the svg — sizing lives with the caller. */
    className?: string;
}

/**
 * The alignment glyph for one `textAlign` value.
 *
 * `currentColor` so it inherits the toolbar button's text color in both
 * themes, and `aria-hidden` because every caller already labels itself.
 */
export function AlignIcon({ value, className }: AlignIconProps) {
    return (
        <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            data-testid={`align-icon-${value}`}
            className={className}
        >
            {BARS[value].map(([x, width], i) => (
                <rect key={ROW_Y[i]} x={x} y={ROW_Y[i]} width={width} height="1.5" rx="0.75" />
            ))}
        </svg>
    );
}

/**
 * Utilities for automatic color selection in the repo color picker.
 */

export interface ColorOption {
    label: string;
    value: string;
}

/**
 * Resolves the best color for a new repo by picking the least-used palette color
 * among existing repos. Ties are broken by palette order (first = preferred).
 * If all colors are used equally, wraps around (round-robin over palette).
 *
 * @param existingColors - Array of color hex values currently used by existing repos
 * @param palette - The ordered palette of available colors (excluding 'auto')
 * @returns The hex string of the resolved color
 */
export function resolveAutoColor(existingColors: string[], palette: ColorOption[]): string {
    if (palette.length === 0) return '';

    const counts = new Map<string, number>();
    for (const option of palette) {
        counts.set(option.value, 0);
    }
    for (const c of existingColors) {
        if (counts.has(c)) {
            counts.set(c, (counts.get(c) ?? 0) + 1);
        }
    }

    let best = palette[0].value;
    let bestCount = counts.get(palette[0].value) ?? 0;
    for (let i = 1; i < palette.length; i++) {
        const count = counts.get(palette[i].value) ?? 0;
        if (count < bestCount) {
            best = palette[i].value;
            bestCount = count;
        }
    }
    return best;
}

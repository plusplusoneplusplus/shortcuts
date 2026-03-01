/**
 * Utility functions for duration overlay and particle animation logic.
 */

/**
 * Compute the relative weight of a node's duration (0–1) against total pipeline duration.
 * Returns 0 if either value is missing or zero.
 */
export function durationRatio(nodeDurationMs: number | undefined, totalDurationMs: number | undefined): number {
    if (nodeDurationMs == null || totalDurationMs == null || totalDurationMs === 0) return 0;
    return Math.min(nodeDurationMs / totalDurationMs, 1);
}

/**
 * Map a ratio (0–1) to a stroke width in the range [1.5, 4.5].
 * 1.5 is the existing default; 4.5 is max for the heaviest phase.
 */
export function ratioToStrokeWidth(ratio: number): number {
    const clamped = Math.max(0, Math.min(ratio, 1));
    return 1.5 + clamped * 3;
}

/**
 * Map a ratio (0–1) to an interpolated border color that shifts
 * from the base completed green toward a warm amber for heavy phases.
 * Returns a hex color string.
 */
export function ratioToBorderColor(ratio: number, isDark: boolean): string {
    const clamped = Math.max(0, Math.min(ratio, 1));
    // light mode: #16825d → #e8912d
    // dark mode:  #89d185 → #cca700
    const [r1, g1, b1] = isDark ? [0x89, 0xd1, 0x85] : [0x16, 0x82, 0x5d];
    const [r2, g2, b2] = isDark ? [0xcc, 0xa7, 0x00] : [0xe8, 0x91, 0x2d];

    const r = Math.round(r1 + clamped * (r2 - r1));
    const g = Math.round(g1 + clamped * (g2 - g1));
    const b = Math.round(b1 + clamped * (b2 - b1));

    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Format duration in a compact form suitable for below-node overlay.
 * e.g., "2.3s", "45.1s", "1m 12s", "< 1s"
 */
export function formatPreciseDuration(ms: number): string {
    if (ms < 1000) return '< 1s';
    const totalSec = ms / 1000;
    if (totalSec < 60) {
        const formatted = totalSec.toFixed(1);
        return formatted + 's';
    }
    let s = Math.floor(ms / 1000);
    let m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    s = s % 60;
    m = m % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + s + 's';
}

/**
 * Derive particle count (1–5) and animation duration from throughput.
 * throughput = completedItems / elapsedSec. Higher throughput → more particles, faster speed.
 */
export function deriveParticleParams(
    completedItems: number | undefined,
    elapsedMs: number | undefined,
): { particleCount: number; durationMs: number } {
    if (completedItems == null || elapsedMs == null || completedItems === 0 || elapsedMs === 0) {
        return { particleCount: 1, durationMs: 1500 };
    }
    const throughput = completedItems / (elapsedMs / 1000);
    const particleCount = Math.min(5, Math.max(1, Math.ceil(throughput / 2)));
    const durationMs = Math.min(2000, Math.max(400, Math.round(2000 / Math.max(throughput, 0.1))));
    return { particleCount, durationMs };
}

/** Strict numeric limits: invalid inputs use the fallback without string coercion. */
export function clampIntegerLimit(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(max, Math.max(min, n));
}

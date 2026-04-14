/**
 * Simple semver version comparison utility.
 *
 * Compares two version strings in major.minor.patch format.
 * Does not depend on the `semver` npm package.
 */

/**
 * Compare two semver-style version strings (major.minor.patch).
 *
 * @returns -1 if a < b, 0 if a === b, 1 if a > b, or undefined if either is unparseable.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return undefined;

    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

/**
 * Parse a version string into [major, minor, patch].
 * Returns undefined for malformed input.
 */
function parseVersion(v: string): [number, number, number] | undefined {
    if (!v || typeof v !== 'string') return undefined;
    const parts = v.split('.');
    if (parts.length < 1 || parts.length > 3) return undefined;

    const nums: number[] = [];
    for (const p of parts) {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 0) return undefined;
        nums.push(n);
    }
    // Pad missing components with 0
    while (nums.length < 3) nums.push(0);
    return nums as unknown as [number, number, number];
}

/**
 * Safely parse an unknown value as a string array.
 */
export function parseStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter(item => typeof item === 'string')
        .map(item => String(item));
}

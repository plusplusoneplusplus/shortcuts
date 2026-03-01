/**
 * Cross-platform path string utilities.
 *
 * Browser-safe — no Node.js dependencies.
 */

/**
 * Replace all backslashes with forward slashes.
 */
export function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Normalize slashes to match the OS style detected from the path.
 * Windows paths (starting with drive letter) get backslashes; others get forward slashes.
 * Browser-safe — no Node.js dependencies.
 */
export function toNativePath(p: string): string {
    if (/^[A-Za-z]:/.test(p)) {
        return p.replace(/\//g, '\\');
    }
    return toForwardSlashes(p);
}

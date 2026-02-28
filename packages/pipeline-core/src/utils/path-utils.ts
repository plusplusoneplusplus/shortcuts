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

/**
 * Directory containment check — Node.js only.
 *
 * Uses `path.resolve` and `path.sep` to guard against directory traversal.
 */

import * as path from 'path';

/**
 * Return true when `target` is equal to or a child of `base`,
 * after resolving both to absolute paths.
 *
 * Use this for directory-traversal security checks.
 */
export function isWithinDirectory(target: string, base: string): boolean {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(target);
    return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

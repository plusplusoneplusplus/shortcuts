/**
 * Directory containment check — Node.js only.
 *
 * Uses `path.resolve` and `path.sep` to guard against directory traversal.
 */

import * as path from 'path';
import { resolveWorkspaceExecutionContext, translatePathForExecution } from './workspace-execution';
import { trimTrailingPathSeparators } from './path-utils';

function isWithinNormalizedPath(target: string, base: string, separator: string): boolean {
    if (target === base) {
        return true;
    }
    return target.startsWith(base + separator);
}

/**
 * Return true when `target` is equal to or a child of `base`,
 * after resolving both to absolute paths.
 *
 * Use this for directory-traversal security checks.
 */
export function isWithinDirectory(target: string, base: string): boolean {
    const baseContext = resolveWorkspaceExecutionContext(base);
    const targetContext = resolveWorkspaceExecutionContext(target);

    if (baseContext.kind === 'wsl' || targetContext.kind === 'wsl') {
        if (baseContext.kind !== 'wsl' || targetContext.kind !== 'wsl') {
            return false;
        }
        if ((baseContext.distro ?? '').toLowerCase() !== (targetContext.distro ?? '').toLowerCase()) {
            return false;
        }

        const normalizedBase = trimTrailingPathSeparators(translatePathForExecution(base, baseContext));
        const normalizedTarget = trimTrailingPathSeparators(translatePathForExecution(target, baseContext));
        return isWithinNormalizedPath(normalizedTarget, normalizedBase, normalizedBase === '/' ? '' : '/');
    }

    let resolvedBase = path.resolve(base);
    let resolvedTarget = path.resolve(target);
    if (process.platform === 'win32') {
        resolvedBase = resolvedBase.toLowerCase();
        resolvedTarget = resolvedTarget.toLowerCase();
    }
    return isWithinNormalizedPath(resolvedTarget, resolvedBase, path.sep);
}

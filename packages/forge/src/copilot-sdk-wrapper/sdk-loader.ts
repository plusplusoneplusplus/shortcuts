/**
 * SDK Loader
 *
 * Provides a synchronous availability check for @github/copilot-sdk.
 * The SDK is ESM-only (no `"require"` export condition), so neither
 * `require.resolve('@github/copilot-sdk')` nor subpath resolution works.
 * We walk up from __dirname looking for the package in node_modules.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Check whether `@github/copilot-sdk` is installed and locatable.
 * Returns the package directory path on success, or `undefined`
 * when the package is not installed.
 *
 * @param startDir - Directory to start searching from (defaults to this file's directory).
 */
export function findSdkBinaryPath(
    startDir?: string,
): string | undefined {
    let dir = startDir ?? __dirname;
    while (true) {
        const candidate = path.join(dir, 'node_modules', '@github', 'copilot-sdk');
        const pkgJson = path.join(candidate, 'package.json');
        if (fs.existsSync(pkgJson)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

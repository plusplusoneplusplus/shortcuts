/**
 * Resolve Working Directory
 *
 * Ensures the working directory passed to the Copilot SDK session
 * is valid (i.e. exists on disk). The SDK spawns a child process
 * with `cwd` set to this directory; if the directory does not
 * exist, `child_process.spawn` throws ENOENT which surfaces as
 * an opaque ERR_STREAM_DESTROYED crash.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { printWarning } from '../logger';

/**
 * Resolve a valid working directory for an SDK session.
 *
 * Returns `repoPath` when it exists as a directory. Otherwise falls
 * back to `process.cwd()` and emits a warning. The AI prompt already
 * contains the absolute repo path so the tools can still navigate to
 * it even when `cwd` differs.
 *
 * @param repoPath - Intended working directory (typically the repo root)
 * @returns An existing directory path safe to use as SDK `cwd`
 */
export function resolveWorkingDirectory(repoPath: string): string {
    const resolved = path.resolve(repoPath);
    try {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            return resolved;
        }
    } catch {
        // stat failed — fall through to fallback
    }

    printWarning(
        `Working directory does not exist or is not a directory: ${resolved}. ` +
        'Falling back to process.cwd() for the SDK session.',
    );
    return process.cwd();
}

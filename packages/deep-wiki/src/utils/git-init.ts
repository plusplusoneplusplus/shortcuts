/**
 * Git Repository Initialization Utilities
 *
 * Initializes a wiki output directory as a Git repository with a default
 * `.gitignore`. Designed to run once after the output directory is created.
 *
 * - Skips if already a git repo (`.git/` exists)
 * - Skips `.gitignore` creation if file already exists
 * - Gracefully handles a git binary it cannot run (logs warning, does not fail)
 *
 * `git init` runs in the native addon, on a libuv worker. It was the last
 * synchronous git spawn in the repository, and it blocked the event loop of a
 * CLI that had just finished writing a wiki. `initGitRepo` and
 * `initWikiGitRepo` are async for it; `writeGitignore` is `fs` and is not.
 *
 * A `NativeAddonLoadError` is deliberately *not* rethrown here. Every failure
 * in this module already reaches the user as a warning carrying the message,
 * and the addon's message is the sentence that names the rebuild — so the
 * broken install is reported rather than swallowed, which is the reason the
 * rest of the move rethrows.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';

// ============================================================================
// Constants
// ============================================================================

/** Default .gitignore content for a wiki output directory */
const DEFAULT_GITIGNORE = `# OS files
.DS_Store
Thumbs.db

# Editor files
*.swp
*.swo
*~

# Node/build artifacts
node_modules/

# Deep Wiki cache
.wiki-cache/
`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the wiki output directory as a Git repository and write a
 * default `.gitignore`.
 *
 * Safe to call multiple times — skips steps that are already done.
 * Never throws; logs warnings on failure.
 *
 * @param dir - Absolute or relative path to the wiki output directory
 * @param log - Optional logging callbacks (defaults to stderr)
 */
export async function initWikiGitRepo(
    dir: string,
    log?: { info?: (msg: string) => void; warn?: (msg: string) => void }
): Promise<void> {
    const info = log?.info ?? ((msg: string) => process.stderr.write(`${msg}\n`));
    const warn = log?.warn ?? ((msg: string) => process.stderr.write(`⚠ ${msg}\n`));

    await initGitRepo(dir, { info, warn });
    writeGitignore(dir, { info, warn });
}

/**
 * Run `git init` in the given directory if it is not already a Git repository.
 *
 * @param dir - Directory to initialize
 * @param log - Logging callbacks
 * @returns `true` if the repo was initialized (or already existed), `false` on error
 */
export async function initGitRepo(
    dir: string,
    log?: { info?: (msg: string) => void; warn?: (msg: string) => void }
): Promise<boolean> {
    const resolved = path.resolve(dir);
    const gitDir = path.join(resolved, '.git');

    // Already a git repo
    if (fs.existsSync(gitDir)) {
        log?.info?.(`Git repository already exists at ${resolved}`);
        return true;
    }

    try {
        // `-C <resolved> init` is what `cwd: resolved` was: git changes into the
        // directory and initializes it. A directory that does not exist fails
        // the `-C` instead of the spawn, and still fails.
        await execGitAsync(['init'], resolved, { timeout: 10_000 });
        log?.info?.(`Initialized Git repository in ${resolved}`);
        return true;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log?.warn?.(`Could not initialize Git repository: ${message}`);
        return false;
    }
}

/**
 * Write a default `.gitignore` to the directory if one does not already exist.
 *
 * @param dir - Directory to write `.gitignore` in
 * @param log - Logging callbacks
 * @returns `true` if the file was written (or already existed), `false` on error
 */
export function writeGitignore(
    dir: string,
    log?: { info?: (msg: string) => void; warn?: (msg: string) => void }
): boolean {
    const resolved = path.resolve(dir);
    const gitignorePath = path.join(resolved, '.gitignore');

    // Already has a .gitignore
    if (fs.existsSync(gitignorePath)) {
        log?.info?.(`.gitignore already exists at ${resolved}`);
        return true;
    }

    try {
        fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf-8');
        log?.info?.(`Created .gitignore in ${resolved}`);
        return true;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log?.warn?.(`Could not create .gitignore: ${message}`);
        return false;
    }
}

/**
 * Return the default gitignore content (for testing).
 */
export function getDefaultGitignoreContent(): string {
    return DEFAULT_GITIGNORE;
}

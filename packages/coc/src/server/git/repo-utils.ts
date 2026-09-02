/**
 * Extract and normalize repository identifiers from task payloads.
 * Provides consistent repo identification for per-repo queue partitioning.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { TaskPayload } from '../tasks/task-types';
import {
    getWslExecutablePath,
    normalizeExecutionPath,
    normalizeWslExecutionPath,
    resolveWorkspaceExecutionContext,
} from '@plusplusoneplusplus/forge';

/**
 * Extract repository identifier from a task payload.
 *
 * Attempts to derive a git repository root from the task's context
 * (workingDirectory, promptFilePath, filePath, documentUri).
 * Returns a normalized path string as the repo identifier, or null
 * if no valid git repository is found.
 *
 * @returns Normalized repo path (absolute, lowercase on Windows), or null
 */
export async function extractRepoId(payload: TaskPayload): Promise<string | null> {
    const candidates: string[] = [];

    // 1. workingDirectory (most common)
    if ('workingDirectory' in payload && typeof payload.workingDirectory === 'string') {
        candidates.push(payload.workingDirectory);
    }

    // 2. promptFilePath (follow-prompt tasks)
    if ('promptFilePath' in payload && typeof payload.promptFilePath === 'string') {
        candidates.push(payload.promptFilePath);
    }

    // 3. filePath (AI clarification tasks)
    if ('filePath' in payload && typeof payload.filePath === 'string') {
        candidates.push(payload.filePath);
    }

    // 4. documentUri (resolve-comments tasks, convert from file:// URI)
    if ('documentUri' in payload && typeof payload.documentUri === 'string') {
        const uri = payload.documentUri;
        if (uri.startsWith('file://')) {
            const filePath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
            candidates.push(filePath);
        }
    }

    // 5. rulesFolder (code-review tasks)
    if ('rulesFolder' in payload && typeof payload.rulesFolder === 'string') {
        candidates.push(payload.rulesFolder);
    }

    // Try each candidate until we find a valid git root
    for (const candidate of candidates) {
        if (!candidate || candidate.trim().length === 0) {
            continue;
        }

        const gitRoot = await findGitRoot(candidate);
        if (gitRoot) {
            const executionContext = resolveWorkspaceExecutionContext(candidate);
            if (executionContext.kind === 'wsl' && gitRoot.startsWith('/')) {
                return normalizeWslExecutionPath(gitRoot, executionContext.distro);
            }
            return normalizeRepoPath(gitRoot);
        }
    }

    return null;
}

/**
 * Find the git repository root for a given path.
 *
 * Answers what `git rev-parse --show-toplevel` answers, but without a child
 * process: the native addon discovers the repository with `gix` on a worker
 * thread. This used to be an `execFileSync`, so every lookup blocked the event
 * loop for the length of a spawn.
 *
 * Repos inside a WSL distro keep their `wsl.exe` shell-out here in TypeScript —
 * Rust only ever runs git on the native host. That branch stays synchronous
 * because it is the dispatch path the goal exempts, and it is unreachable off
 * Windows.
 *
 * @param pathLike - File or directory path (absolute or relative)
 * @returns Absolute path to git root, or null if not in a git repo
 */
export async function findGitRoot(pathLike: string): Promise<string | null> {
    const executionContext = resolveWorkspaceExecutionContext(pathLike);

    if (executionContext.kind !== 'wsl') {
        // Outside the try: a stale binary must not be swallowed into "not a
        // repository", which is what every other failure here means. Reporting
        // no root would silently unpartition every task in the queue.
        const addon = loadNativeGit();
        try {
            // `path.resolve` stays in Node so the process's own working
            // directory keeps deciding what a relative path means.
            const gitRoot = await addon.gitDiscoverRepoRoot(path.resolve(pathLike));
            return gitRoot && path.isAbsolute(gitRoot) ? gitRoot : null;
        } catch {
            return null;
        }
    }

    try {
        const args: string[] = [];
        if (executionContext.distro) {
            args.push('-d', executionContext.distro);
        }
        args.push(
            '--',
            'sh',
            '-lc',
            'target="$1"; if [ -d "$target" ]; then candidate="$target"; else candidate="$(dirname "$target")"; fi; [ -d "$candidate" ] || exit 1; git -C "$candidate" rev-parse --show-toplevel',
            'sh',
            executionContext.linuxWorkingDirectory,
        );
        const result = execFileSync(
            getWslExecutablePath(),
            args,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const gitRoot = result.trim();
        return gitRoot.length > 0 ? gitRoot : null;
    } catch {
        return null;
    }
}

/**
 * Normalize a repository path for consistent identification.
 *
 * - Resolves to absolute path
 * - Normalizes path separators (forward slashes)
 * - Converts to lowercase on Windows (case-insensitive file systems)
 * - Resolves symlinks on Unix (best-effort)
 * - Removes trailing slashes
 */
export function normalizeRepoPath(repoPath: string): string {
    const executionContext = resolveWorkspaceExecutionContext(repoPath);
    if (executionContext.kind === 'wsl') {
        return normalizeExecutionPath(repoPath);
    }

    let normalized = path.resolve(repoPath);

    try {
        normalized = process.platform === 'win32'
            ? fs.realpathSync.native(normalized)
            : fs.realpathSync(normalized);
    } catch {
        // If realpath fails, continue with resolved path
    }

    return normalizeExecutionPath(normalized);
}

export function getWorkingDirectory(payload: TaskPayload): string | null {
    if ('workingDirectory' in payload && typeof payload.workingDirectory === 'string') {
        return payload.workingDirectory;
    }
    return null;
}

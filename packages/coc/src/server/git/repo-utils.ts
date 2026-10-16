/**
 * Extract and normalize repository identifiers from task payloads.
 * Provides consistent repo identification for per-repo queue partitioning.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { TaskPayload } from '../tasks/task-types';
import {
    discoverGitRepoRoot,
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

/** Find the repository root through Forge's host/WSL execution path. */
export const findGitRoot = discoverGitRepoRoot;

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

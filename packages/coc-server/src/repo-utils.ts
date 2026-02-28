/**
 * Repository Path Utilities
 *
 * Extract and normalize repository identifiers from task payloads.
 * Provides consistent repo identification for per-repo queue partitioning.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { TaskPayload } from './task-types';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core';

/**
 * Extract repository identifier from a task payload.
 *
 * Attempts to derive a git repository root from the task's context
 * (workingDirectory, promptFilePath, filePath, documentUri).
 * Returns a normalized path string as the repo identifier, or null
 * if no valid git repository is found.
 *
 * @param payload - The task payload to extract from
 * @returns Normalized repo path (absolute, lowercase on Windows), or null
 */
export function extractRepoId(payload: TaskPayload): string | null {
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

        const gitRoot = findGitRoot(candidate);
        if (gitRoot) {
            return normalizeRepoPath(gitRoot);
        }
    }

    return null;
}

/**
 * Find the git repository root for a given path.
 *
 * Executes `git rev-parse --show-toplevel` to locate the repo root.
 * Works for both files and directories within a git repository.
 *
 * @param pathLike - File or directory path (absolute or relative)
 * @returns Absolute path to git root, or null if not in a git repo
 */
export function findGitRoot(pathLike: string): string | null {
    try {
        const absolutePath = path.resolve(pathLike);

        let stats: fs.Stats;
        try {
            stats = fs.statSync(absolutePath);
        } catch {
            return null;
        }

        // If path is a file, use its parent directory
        const cwd = stats.isDirectory() ? absolutePath : path.dirname(absolutePath);

        const result = execSync('git rev-parse --show-toplevel', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        const gitRoot = result.trim();

        if (gitRoot.length > 0 && path.isAbsolute(gitRoot)) {
            return gitRoot;
        }

        return null;
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
 *
 * @param repoPath - Repository path to normalize
 * @returns Normalized absolute path string
 */
export function normalizeRepoPath(repoPath: string): string {
    let normalized = path.resolve(repoPath);

    // Resolve symlinks (Unix) and 8.3 short names (Windows) for consistency.
    // On Windows, realpathSync.native expands 8.3 short paths (e.g. RUNNER~1 → RunnerAdmin).
    try {
        normalized = process.platform === 'win32'
            ? fs.realpathSync.native(normalized)
            : fs.realpathSync(normalized);
    } catch {
        // If realpath fails, continue with resolved path
    }

    // Normalize separators (forward slashes)
    normalized = toForwardSlashes(normalized);

    // On Windows, convert to lowercase (case-insensitive file systems)
    if (process.platform === 'win32') {
        normalized = normalized.toLowerCase();
    }

    // Remove trailing slash (except for root paths like '/' or 'C:/')
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
}

/**
 * Extract the working directory from a task payload.
 *
 * Simple helper that returns the `workingDirectory` field if present,
 * or null otherwise.
 *
 * @param payload - The task payload
 * @returns The working directory path, or null
 */
export function getWorkingDirectory(payload: TaskPayload): string | null {
    if ('workingDirectory' in payload && typeof payload.workingDirectory === 'string') {
        return payload.workingDirectory;
    }
    return null;
}

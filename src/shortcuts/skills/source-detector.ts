/**
 * Source detection for skill installation
 * Determines whether input is a GitHub URL or local filesystem path
 */

import * as path from 'path';
import * as os from 'os';
import { ParsedSource, SkillSourceType } from './types';
import { safeExists } from '../shared';

/**
 * Error messages for source detection
 */
export const SourceDetectionErrors = {
    AMBIGUOUS: 'Could not determine source type. Use full GitHub URL or absolute/relative path.',
    INVALID_GITHUB_URL: 'Invalid GitHub URL. Expected: https://github.com/owner/repo/tree/branch/path',
    PATH_NOT_FOUND: (p: string) => `Path not found: ${p}`,
} as const;

/**
 * Detect the source type from user input
 * @param input User-provided source string
 * @param workspaceRoot Workspace root for resolving relative paths
 * @returns Parsed source information or error
 */
export function detectSource(input: string, workspaceRoot?: string): { success: true; source: ParsedSource } | { success: false; error: string } {
    const trimmed = input.trim();

    if (!trimmed) {
        return { success: false, error: SourceDetectionErrors.AMBIGUOUS };
    }

    // Check for GitHub URL patterns
    if (isGitHubUrl(trimmed)) {
        const parsed = parseGitHubUrl(trimmed);
        if (!parsed) {
            return { success: false, error: SourceDetectionErrors.INVALID_GITHUB_URL };
        }
        return {
            success: true,
            source: {
                type: 'github',
                github: parsed
            }
        };
    }

    // Check for local path patterns
    if (isLocalPath(trimmed)) {
        const resolved = resolveLocalPath(trimmed, workspaceRoot);
        if (!safeExists(resolved)) {
            return { success: false, error: SourceDetectionErrors.PATH_NOT_FOUND(trimmed) };
        }
        return {
            success: true,
            source: {
                type: 'local',
                localPath: resolved
            }
        };
    }

    return { success: false, error: SourceDetectionErrors.AMBIGUOUS };
}

/**
 * Check if input looks like a GitHub URL
 */
function isGitHubUrl(input: string): boolean {
    return (
        input.startsWith('https://github.com') ||
        input.startsWith('http://github.com') ||
        input.startsWith('github.com')
    );
}

/**
 * Check if input looks like a local path
 */
function isLocalPath(input: string): boolean {
    // Unix absolute path
    if (input.startsWith('/')) {
        return true;
    }

    // Home directory expansion
    if (input.startsWith('~')) {
        return true;
    }

    // Relative paths
    if (input.startsWith('./') || input.startsWith('../')) {
        return true;
    }

    // Windows drive letter (e.g., C:\, D:/)
    if (/^[a-zA-Z]:[/\\]/.test(input)) {
        return true;
    }

    // Windows UNC path
    if (input.startsWith('\\\\')) {
        return true;
    }

    return false;
}

/**
 * Parse a GitHub URL into its components
 * Supports formats:
 * - https://github.com/owner/repo/tree/branch/path/to/skills
 * - https://github.com/owner/repo (defaults to main branch, root path)
 * - github.com/owner/repo/tree/branch/path
 */
function parseGitHubUrl(url: string): { owner: string; repo: string; branch: string; path: string } | null {
    // Normalize URL - remove protocol prefix variations
    let normalized = url
        .replace(/^https?:\/\//, '')
        .replace(/^github\.com\//, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    // Parse the path segments
    const segments = normalized.split('/');

    if (segments.length < 2) {
        return null;
    }

    const owner = segments[0];
    const repo = segments[1];

    // Default values
    let branch = 'main';
    let repoPath = '';

    // Check for /tree/branch/path pattern
    if (segments.length > 2) {
        if (segments[2] === 'tree' && segments.length > 3) {
            branch = segments[3];
            if (segments.length > 4) {
                repoPath = segments.slice(4).join('/');
            }
        } else if (segments[2] === 'blob' && segments.length > 3) {
            // Handle blob URLs (pointing to files)
            branch = segments[3];
            if (segments.length > 4) {
                // Get directory containing the file
                repoPath = segments.slice(4, -1).join('/');
            }
        } else {
            // Assume it's a path without tree/branch specification
            // This handles URLs like github.com/owner/repo/path
            repoPath = segments.slice(2).join('/');
        }
    }

    if (!owner || !repo) {
        return null;
    }

    return { owner, repo, branch, path: repoPath };
}

/**
 * Resolve a local path to an absolute path
 */
function resolveLocalPath(input: string, workspaceRoot?: string): string {
    let resolved = input;

    // Expand home directory
    if (resolved.startsWith('~')) {
        resolved = path.join(os.homedir(), resolved.slice(1));
    }

    // Resolve relative paths
    if (!path.isAbsolute(resolved)) {
        const base = workspaceRoot || process.cwd();
        resolved = path.resolve(base, resolved);
    }

    // Normalize the path
    return path.normalize(resolved);
}

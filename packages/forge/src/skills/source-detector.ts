/**
 * Source detection for skill installation
 * Determines whether input is a GitHub URL or local filesystem path
 */

import * as path from 'path';
import * as os from 'os';
import { ParsedSource, SkillSourceType } from './types';
import { safeExists, httpDownload } from '../utils';

/**
 * Error messages for source detection
 */
export const SourceDetectionErrors = {
    AMBIGUOUS: 'Could not determine source type. Use full GitHub URL or absolute/relative path.',
    INVALID_GITHUB_URL: 'Invalid GitHub URL. Expected: https://github.com/owner/repo/tree/branch/path',
    INVALID_CLAWHUB_URL: 'Invalid ClawHub URL. Expected: clawhub.ai/owner/skill-name',
    CLAWHUB_NO_GITHUB_URL: 'Could not find GitHub repository for this ClawHub skill. Please provide the GitHub URL directly.',
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

    // Check for ClawHub URL patterns
    if (isClawHubUrl(trimmed)) {
        const parsed = parseClawHubUrl(trimmed);
        if (!parsed) {
            return { success: false, error: SourceDetectionErrors.INVALID_CLAWHUB_URL };
        }
        return {
            success: true,
            source: {
                type: 'clawhub',
                clawhub: parsed
            }
        };
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

/**
 * Check if input looks like a ClawHub URL
 */
export function isClawHubUrl(input: string): boolean {
    return (
        input.startsWith('https://clawhub.ai') ||
        input.startsWith('http://clawhub.ai') ||
        input.startsWith('clawhub.ai')
    );
}

/**
 * Parse a ClawHub URL into owner and slug
 * Supports: clawhub.ai/owner/slug, https://clawhub.ai/owner/slug
 */
export function parseClawHubUrl(url: string): { owner: string; slug: string } | null {
    let normalized = url
        .replace(/^https?:\/\//, '')
        .replace(/^clawhub\.ai\//, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    const segments = normalized.split('/');
    if (segments.length < 2 || !segments[0] || !segments[1]) {
        return null;
    }

    return { owner: segments[0], slug: segments[1] };
}

type DetectResult = { success: true; source: ParsedSource } | { success: false; error: string };

/**
 * Resolve a ClawHub source to a GitHub source by fetching the ClawHub page
 * and extracting GitHub repository URLs from the content.
 *
 * @param source Parsed ClawHub source (must have clawhub field)
 * @param fetchFn Optional fetch function for testing (defaults to httpDownload)
 */
export async function resolveClawHubToGitHub(
    source: ParsedSource,
    fetchFn?: (url: string) => Promise<string>
): Promise<DetectResult> {
    if (!source.clawhub) {
        return { success: false, error: SourceDetectionErrors.INVALID_CLAWHUB_URL };
    }

    const { owner, slug } = source.clawhub;
    const pageUrl = `https://clawhub.ai/${owner}/${slug}`;
    const fetcher = fetchFn ?? httpDownload;

    let html: string;
    try {
        html = await fetcher(pageUrl);
    } catch (err: any) {
        return { success: false, error: `Failed to fetch ClawHub page: ${err.message}` };
    }

    // Extract all github.com URLs from the page content
    const githubUrlRegex = /https?:\/\/github\.com\/([^/\s"'<>]+)\/([^/\s"'<>.]+)/g;
    const matches: Array<{ owner: string; repo: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = githubUrlRegex.exec(html)) !== null) {
        const ghOwner = match[1];
        const ghRepo = match[2];
        // Exclude the ClawHub footer link to their own repo
        if (ghOwner === 'openclaw' && ghRepo === 'clawhub') continue;
        matches.push({ owner: ghOwner, repo: ghRepo });
    }

    if (matches.length === 0) {
        return { success: false, error: SourceDetectionErrors.CLAWHUB_NO_GITHUB_URL };
    }

    // Prefer match where repo name matches the skill slug
    const preferred = matches.find(m => m.repo.toLowerCase() === slug.toLowerCase());
    const best = preferred ?? matches[0];

    return {
        success: true,
        source: {
            type: 'github',
            github: {
                owner: best.owner,
                repo: best.repo,
                branch: 'main',
                path: ''
            }
        }
    };
}

/**
 * Notes Root Resolver
 *
 * Centralizes notes root resolution logic for multi-root support.
 * The "default" root is the managed `~/.coc/repos/<workspaceId>/notes/` directory.
 * Additional roots are subfolders inside the workspace git repository.
 */

import * as path from 'path';
import { getRepoDataPath } from '../paths';

/** Maximum number of additional notes roots per workspace. */
export const MAX_ADDITIONAL_NOTES_ROOTS = 10;

/** Sentinel value representing the default managed notes root. */
export const DEFAULT_ROOT_ID = 'default';

export interface ResolvedNotesRoot {
    /** Absolute path to the notes root directory. */
    absolutePath: string;
    /** Whether this is the default managed root (under ~/.coc). */
    isDefault: boolean;
    /** The root identifier: 'default' for the managed root, or the relative path for repo-folder roots. */
    rootId: string;
}

/**
 * Resolve the notes root for a given workspace.
 *
 * @param dataDir - The CoC data directory (~/.coc)
 * @param workspaceId - The workspace identifier
 * @param workspaceRoot - Absolute path to the workspace git root
 * @param rootParam - The `root` query parameter value (undefined or 'default' = default root)
 * @param additionalRoots - The configured additional roots from preferences
 * @returns The resolved root info, or an error string if invalid
 */
export function resolveNotesRoot(
    dataDir: string,
    workspaceId: string,
    workspaceRoot: string | undefined,
    rootParam: string | undefined,
    additionalRoots: string[] | undefined,
): ResolvedNotesRoot | { error: string; statusCode: number } {
    // Default root
    if (!rootParam || rootParam === DEFAULT_ROOT_ID) {
        return {
            absolutePath: getRepoDataPath(dataDir, workspaceId, 'notes'),
            isDefault: true,
            rootId: DEFAULT_ROOT_ID,
        };
    }

    // Normalize the requested root
    const normalized = rootParam.replace(/\\/g, '/').replace(/\/+$/, '');

    // Validate the root is in the configured list
    if (!additionalRoots || !additionalRoots.includes(normalized)) {
        return {
            error: `Root '${normalized}' is not configured. Add it via workspace preferences first.`,
            statusCode: 400,
        };
    }

    // Validate workspace root is available
    if (!workspaceRoot) {
        return {
            error: 'Workspace root path is not available. Cannot resolve repo-folder root.',
            statusCode: 400,
        };
    }

    // Resolve to absolute path under workspace root
    const absolutePath = path.resolve(workspaceRoot, normalized);

    // Security: ensure the resolved path is within the workspace root
    const normalizedWsRoot = path.resolve(workspaceRoot);
    if (!absolutePath.startsWith(normalizedWsRoot + path.sep) && absolutePath !== normalizedWsRoot) {
        return {
            error: 'Resolved root path is outside the workspace directory.',
            statusCode: 403,
        };
    }

    return {
        absolutePath,
        isDefault: false,
        rootId: normalized,
    };
}

/**
 * Type guard to check if the result is an error.
 */
export function isRootResolveError(
    result: ResolvedNotesRoot | { error: string; statusCode: number },
): result is { error: string; statusCode: number } {
    return 'error' in result;
}

/**
 * Validate a candidate notes root path for addition to preferences.
 * Returns an error message if invalid, or undefined if valid.
 */
export function validateNotesRootPath(rootPath: string): string | undefined {
    if (!rootPath || typeof rootPath !== 'string') {
        return 'Root path must be a non-empty string.';
    }

    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');

    if (normalized.length === 0) {
        return 'Root path must be a non-empty string.';
    }

    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return 'Root path must be relative to the workspace git root.';
    }

    if (normalized === '.' || normalized === '..') {
        return 'Root path must be a subfolder, not the workspace root itself.';
    }

    if (normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/..')) {
        return 'Root path must not contain parent directory references (..).';
    }

    if (normalized.length > 500) {
        return 'Root path is too long (max 500 characters).';
    }

    return undefined;
}

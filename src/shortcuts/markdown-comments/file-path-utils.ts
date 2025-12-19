/**
 * File path utilities for the Review Editor View
 * These functions handle path resolution for opening files from markdown links
 */

import * as path from 'path';

/**
 * Result of resolving a file path
 */
export interface ResolvedFilePath {
    /** The resolved absolute path */
    resolvedPath: string;
    /** Whether the file exists */
    exists: boolean;
    /** How the path was resolved */
    resolution: 'absolute' | 'relative-to-file' | 'relative-to-workspace' | 'not-found';
}

/**
 * Check if a path is an external URL (http, https, mailto, etc.)
 */
export function isExternalUrl(filePath: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath);
}

/**
 * Check if a file is a markdown file based on its extension
 */
export function isMarkdownFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.md' || ext === '.markdown';
}

/**
 * Resolve a file path using multiple strategies
 * 
 * @param filePath - The path to resolve (can be absolute or relative)
 * @param fileDir - The directory of the current file (for relative path resolution)
 * @param workspaceRoot - The workspace root directory (for workspace-relative resolution)
 * @param existsCheck - Function to check if a file exists (allows dependency injection for testing)
 * @returns ResolvedFilePath with the resolved path and metadata
 */
export function resolveFilePath(
    filePath: string,
    fileDir: string,
    workspaceRoot: string,
    existsCheck: (path: string) => boolean = defaultExistsCheck
): ResolvedFilePath {
    // Check if it's an absolute path
    if (path.isAbsolute(filePath)) {
        const exists = existsCheck(filePath);
        return {
            resolvedPath: filePath,
            exists,
            resolution: exists ? 'absolute' : 'not-found'
        };
    }

    // Try relative to the file's directory first
    const relativeToFile = path.resolve(fileDir, filePath);
    if (existsCheck(relativeToFile)) {
        return {
            resolvedPath: relativeToFile,
            exists: true,
            resolution: 'relative-to-file'
        };
    }

    // Try workspace-relative path
    if (workspaceRoot) {
        const workspaceRelative = path.resolve(workspaceRoot, filePath);
        if (existsCheck(workspaceRelative)) {
            return {
                resolvedPath: workspaceRelative,
                exists: true,
                resolution: 'relative-to-workspace'
            };
        }
    }

    // Not found - return the relative-to-file path as the resolved path
    return {
        resolvedPath: relativeToFile,
        exists: false,
        resolution: 'not-found'
    };
}

/**
 * Default file existence check using fs.existsSync
 * This is separated to allow dependency injection for testing
 */
function defaultExistsCheck(filePath: string): boolean {
    try {
        // Using require here to avoid circular dependencies and allow mocking in tests
        const fs = require('fs');
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}


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
 * Result of parsing a file path with optional fragment
 */
export interface ParsedFilePath {
    /** The file path without fragment */
    filePath: string;
    /** The line number from fragment (1-based), or undefined */
    lineNumber?: number;
}

/**
 * Parse a file path that may contain a line number fragment (e.g., "file.ts#L100")
 * Supports formats: #L100, #100, #L100-L200 (uses start line)
 * Works on all platforms (Linux, Mac, Windows)
 * 
 * @param pathWithFragment - The path that may contain a line fragment
 * @returns ParsedFilePath with the path and optional line number
 */
export function parseLineFragment(pathWithFragment: string): ParsedFilePath {
    if (!pathWithFragment) {
        return { filePath: '' };
    }

    // Match common line fragment patterns:
    // #L100, #l100, #100, #L100-L200, #L100-200
    // The fragment is always at the end after the last #
    const fragmentMatch = pathWithFragment.match(/^(.+?)#[Ll]?(\d+)(?:-[Ll]?\d+)?$/);
    
    if (fragmentMatch) {
        const filePath = fragmentMatch[1];
        const lineNumber = parseInt(fragmentMatch[2], 10);
        
        // Validate line number is positive
        if (lineNumber > 0) {
            return { filePath, lineNumber };
        }
    }
    
    // No valid fragment found, return the original path
    return { filePath: pathWithFragment };
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


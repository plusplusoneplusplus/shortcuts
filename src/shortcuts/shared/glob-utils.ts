/**
 * Glob Utilities
 * 
 * Simple glob pattern matching for file discovery.
 * Uses Node.js built-in modules for compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a filename matches a simple extension pattern
 * @param filename The filename to check
 * @param extension The extension to match (e.g., ".md")
 * @returns True if the filename ends with the extension
 */
function matchesExtension(filename: string, extension: string): boolean {
    return filename.toLowerCase().endsWith(extension.toLowerCase());
}

/**
 * Extract the extension pattern from a glob pattern
 * For patterns like "**\/*.md", returns ".md"
 * @param pattern The glob pattern
 * @returns The extension or null if not a simple extension pattern
 */
function extractExtension(pattern: string): string | null {
    // Match patterns like **/*.md, *.md, **/*.txt
    const match = pattern.match(/\*+\/?\*(\.[a-zA-Z0-9]+)$/);
    if (match) {
        return match[1];
    }
    // Match patterns like *.md (without **/)
    const simpleMatch = pattern.match(/^\*(\.[a-zA-Z0-9]+)$/);
    if (simpleMatch) {
        return simpleMatch[1];
    }
    return null;
}

/**
 * Find all files matching a glob pattern in a directory
 * @param pattern The glob pattern (e.g., "**\/*.md")
 * @param baseDir The base directory to search from
 * @returns Array of absolute file paths matching the pattern
 */
export function glob(pattern: string, baseDir: string): string[] {
    const results: string[] = [];

    // For simple extension patterns, use optimized matching
    const extension = extractExtension(pattern);

    function walkDir(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Skip hidden directories and node_modules
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                        continue;
                    }
                    walkDir(entryPath);
                } else if (entry.isFile()) {
                    // Check if file matches the pattern
                    if (extension) {
                        // Use optimized extension matching
                        if (matchesExtension(entry.name, extension)) {
                            results.push(entryPath);
                        }
                    } else {
                        // Fallback: include all files for complex patterns
                        results.push(entryPath);
                    }
                }
            }
        } catch (error) {
            // Skip directories we can't read
            console.warn(`Cannot read directory ${dir}:`, error);
        }
    }

    walkDir(baseDir);
    return results;
}

/**
 * Get all files with a specific extension in a directory (recursive)
 * @param dir The directory to search
 * @param extension The file extension (e.g., ".md")
 * @returns Array of absolute file paths
 */
export function getFilesWithExtension(dir: string, extension: string): string[] {
    return glob(`**/*${extension}`, dir);
}


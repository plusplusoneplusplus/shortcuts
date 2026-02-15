/**
 * Seeds Phase — Heuristic Fallback
 *
 * Directory-name-based fallback for generating theme seeds when AI
 * under-generates or fails. Creates seeds from top-level directory names.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ThemeSeed } from '../types';
import { normalizeComponentId } from '../schemas';

// ============================================================================
// Constants
// ============================================================================

/**
 * Common directories to exclude from theme seed generation.
 * These are typically build artifacts, dependencies, or non-code directories.
 */
const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'target',
    'vendor',
    '.vscode',
    '.idea',
    '.vs',
    'coverage',
    '.nyc_output',
    '.cache',
    'tmp',
    'temp',
    '.tmp',
    '.temp',
    'bin',
    'obj',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    'venv',
    'env',
    '.venv',
    '.env',
    'Cargo.lock',
    'yarn.lock',
    'package-lock.json',
    '.DS_Store',
    'Thumbs.db',
]);

// ============================================================================
// Heuristic Fallback
// ============================================================================

/**
 * Generate theme seeds from directory names as a fallback.
 *
 * Scans top-level directories in the repository and creates a ThemeSeed
 * for each directory that isn't in the exclusion list.
 *
 * @param repoPath - Absolute path to the repository
 * @returns Array of ThemeSeed objects generated from directory names
 */
export function generateHeuristicSeeds(repoPath: string): ThemeSeed[] {
    const seeds: ThemeSeed[] = [];

    try {
        const entries = fs.readdirSync(repoPath, { withFileTypes: true });

        for (const entry of entries) {
            // Only process directories
            if (!entry.isDirectory()) {
                continue;
            }

            const dirName = entry.name;

            // Skip excluded directories
            if (EXCLUDED_DIRS.has(dirName)) {
                continue;
            }

            // Skip hidden directories (except those explicitly allowed)
            if (dirName.startsWith('.') && !EXCLUDED_DIRS.has(dirName)) {
                // Allow some common hidden directories that might be themes
                // but skip most
                continue;
            }

            // Normalize directory name to theme ID
            const themeId = normalizeComponentId(dirName);

            // Skip if normalization resulted in empty or invalid ID
            if (!themeId || themeId === 'unknown') {
                continue;
            }

            // Create a seed from the directory name
            seeds.push({
                theme: themeId,
                description: `Code related to ${dirName} directory`,
                hints: [dirName, themeId],
            });
        }
    } catch (error) {
        // If we can't read the directory, return empty array
        // The caller should handle this gracefully
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    return seeds;
}

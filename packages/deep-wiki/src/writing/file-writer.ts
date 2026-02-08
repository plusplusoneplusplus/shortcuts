/**
 * File Writer
 *
 * Writes generated wiki articles to disk in a structured directory layout:
 *   wiki/
 *   ├── index.md
 *   ├── architecture.md
 *   ├── getting-started.md
 *   └── modules/
 *       ├── auth.md
 *       ├── database.md
 *       └── ...
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WikiOutput, GeneratedArticle } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Subdirectory for module articles */
const MODULES_DIR = 'modules';

/** Subdirectory for area articles */
const AREAS_DIR = 'areas';

// ============================================================================
// File Writer
// ============================================================================

/**
 * Write all wiki articles to the output directory.
 *
 * Creates the directory structure and writes each article as a .md file.
 * UTF-8 encoding with LF line endings. Overwrites existing files.
 *
 * Supports both flat layout (small repos):
 *   wiki/modules/auth.md
 * And hierarchical layout (large repos with areas):
 *   wiki/areas/core/modules/auth.md
 *
 * @param output The wiki output containing all articles
 * @param outputDir The output directory path
 * @returns Array of written file paths
 */
export function writeWikiOutput(output: WikiOutput, outputDir: string): string[] {
    const resolvedDir = path.resolve(outputDir);
    const modulesDir = path.join(resolvedDir, MODULES_DIR);
    const writtenPaths: string[] = [];

    // Ensure directories exist
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.mkdirSync(modulesDir, { recursive: true });

    // Collect unique area IDs to create area directories
    const areaIds = new Set<string>();
    for (const article of output.articles) {
        if (article.areaId) {
            areaIds.add(article.areaId);
        }
    }

    // Create area directories if needed
    for (const areaId of areaIds) {
        const areaModulesDir = path.join(resolvedDir, AREAS_DIR, areaId, MODULES_DIR);
        fs.mkdirSync(areaModulesDir, { recursive: true });
    }

    for (const article of output.articles) {
        const filePath = getArticleFilePath(article, resolvedDir);

        // Ensure parent directory exists (for safety with deeply nested paths)
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Normalize line endings to LF
        const content = normalizeLineEndings(article.content);

        // Write file
        fs.writeFileSync(filePath, content, 'utf-8');
        writtenPaths.push(filePath);
    }

    return writtenPaths;
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the file path for an article based on its type, slug, and optional areaId.
 *
 * For articles with areaId set (hierarchical layout):
 *   - module → areas/{areaId}/modules/{slug}.md
 *   - area-index → areas/{areaId}/index.md
 *   - area-architecture → areas/{areaId}/architecture.md
 *
 * For articles without areaId (flat layout):
 *   - module → modules/{slug}.md
 *   - index → index.md
 *   - architecture → architecture.md
 *   - getting-started → getting-started.md
 */
export function getArticleFilePath(article: GeneratedArticle, outputDir: string): string {
    const slug = slugify(article.slug);

    switch (article.type) {
        case 'module':
            if (article.areaId) {
                return path.join(outputDir, AREAS_DIR, article.areaId, MODULES_DIR, `${slug}.md`);
            }
            return path.join(outputDir, MODULES_DIR, `${slug}.md`);
        case 'area-index':
            return path.join(outputDir, AREAS_DIR, article.areaId!, 'index.md');
        case 'area-architecture':
            return path.join(outputDir, AREAS_DIR, article.areaId!, 'architecture.md');
        case 'index':
            return path.join(outputDir, 'index.md');
        case 'architecture':
            return path.join(outputDir, 'architecture.md');
        case 'getting-started':
            return path.join(outputDir, 'getting-started.md');
        default:
            return path.join(outputDir, `${slug}.md`);
    }
}

/**
 * Slugify a string for use as a filename.
 * Converts to lowercase, replaces non-alphanumeric chars with hyphens,
 * and trims leading/trailing hyphens.
 */
export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-') || 'untitled';
}

/**
 * Normalize line endings to LF (Unix-style).
 */
export function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

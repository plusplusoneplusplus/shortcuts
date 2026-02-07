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

// ============================================================================
// File Writer
// ============================================================================

/**
 * Write all wiki articles to the output directory.
 *
 * Creates the directory structure and writes each article as a .md file.
 * UTF-8 encoding with LF line endings. Overwrites existing files.
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

    for (const article of output.articles) {
        const filePath = getArticleFilePath(article, resolvedDir);

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
 * Get the file path for an article based on its type and slug.
 */
export function getArticleFilePath(article: GeneratedArticle, outputDir: string): string {
    const slug = slugify(article.slug);

    switch (article.type) {
        case 'module':
            return path.join(outputDir, MODULES_DIR, `${slug}.md`);
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

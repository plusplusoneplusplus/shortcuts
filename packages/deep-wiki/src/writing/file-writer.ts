/**
 * File Writer
 *
 * Writes generated wiki articles to disk in a structured directory layout:
 *   wiki/
 *   ├── index.md
 *   ├── architecture.md
 *   ├── getting-started.md
 *   └── components/
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

/** Subdirectory for component articles */
const COMPONENTS_DIR = 'components';

/** Subdirectory for area articles */
const DOMAINS_DIR = 'domains';

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
 *   wiki/components/auth.md
 * And hierarchical layout (large repos with domains):
 *   wiki/domains/core/components/auth.md
 *
 * @param output The wiki output containing all articles
 * @param outputDir The output directory path
 * @returns Array of written file paths
 */
export function writeWikiOutput(output: WikiOutput, outputDir: string): string[] {
    const resolvedDir = path.resolve(outputDir);
    const componentsDir = path.join(resolvedDir, COMPONENTS_DIR);
    const writtenPaths: string[] = [];

    // Ensure directories exist
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.mkdirSync(componentsDir, { recursive: true });

    // Collect unique area IDs to create area directories
    const domainIds = new Set<string>();
    for (const article of output.articles) {
        if (article.domainId) {
            domainIds.add(article.domainId);
        }
    }

    // Create area directories if needed
    for (const domainId of domainIds) {
        const domainComponentsDir = path.join(resolvedDir, DOMAINS_DIR, domainId, COMPONENTS_DIR);
        fs.mkdirSync(domainComponentsDir, { recursive: true });
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
 * Get the file path for an article based on its type, slug, and optional domainId.
 *
 * For articles with domainId set (hierarchical layout):
 *   - component → domains/{domainId}/components/{slug}.md
 *   - area-index → domains/{domainId}/index.md
 *   - area-architecture → domains/{domainId}/architecture.md
 *
 * For articles without domainId (flat layout):
 *   - component → components/{slug}.md
 *   - index → index.md
 *   - architecture → architecture.md
 *   - getting-started → getting-started.md
 */
export function getArticleFilePath(article: GeneratedArticle, outputDir: string): string {
    const slug = slugify(article.slug);

    switch (article.type) {
        case 'component':
            if (article.domainId) {
                return path.join(outputDir, DOMAINS_DIR, article.domainId, COMPONENTS_DIR, `${slug}.md`);
            }
            return path.join(outputDir, COMPONENTS_DIR, `${slug}.md`);
        case 'domain-index':
            return path.join(outputDir, DOMAINS_DIR, article.domainId!, 'index.md');
        case 'domain-architecture':
            return path.join(outputDir, DOMAINS_DIR, article.domainId!, 'architecture.md');
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

/**
 * Theme File Writer
 *
 * Writes generated theme articles to the wiki directory.
 *
 * Layout logic:
 * - layout: 'single' → wiki/themes/{themeId}.md
 * - layout: 'area'   → wiki/themes/{themeId}/
 *                         ├── index.md
 *                         ├── {slug1}.md
 *                         └── {slug2}.md
 *
 * Creates themes/ directory if it doesn't exist.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ThemeOutline, ThemeArticle } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Subdirectory for theme articles within the wiki */
const THEMES_DIR = 'themes';

// ============================================================================
// Types
// ============================================================================

export interface ThemeWriteOptions {
    wikiDir: string;
    themeId: string;
    outline: ThemeOutline;
    articles: ThemeArticle[];
}

export interface ThemeWriteResult {
    /** Absolute paths of written files */
    writtenFiles: string[];
    /** Path to theme directory (or single file) */
    themeDir: string;
}

// ============================================================================
// File Writer
// ============================================================================

/**
 * Write theme articles to the wiki directory.
 *
 * Creates themes/ directory if it doesn't exist.
 * Overwrites existing files.
 */
export function writeThemeArticles(options: ThemeWriteOptions): ThemeWriteResult {
    const { wikiDir, themeId, outline, articles } = options;
    const resolvedWiki = path.resolve(wikiDir);
    const themesDir = path.join(resolvedWiki, THEMES_DIR);
    const writtenFiles: string[] = [];

    // Ensure themes/ directory exists
    fs.mkdirSync(themesDir, { recursive: true });

    if (outline.layout === 'single') {
        // Single layout: write one file at themes/{themeId}.md
        const filePath = path.join(themesDir, `${themeId}.md`);
        const article = articles[0];
        if (article) {
            const content = normalizeLineEndings(article.content);
            fs.writeFileSync(filePath, content, 'utf-8');
            writtenFiles.push(filePath);
        }
        return { writtenFiles, themeDir: filePath };
    }

    // Area layout: write directory at themes/{themeId}/
    const themeDir = path.join(themesDir, themeId);
    fs.mkdirSync(themeDir, { recursive: true });

    for (const article of articles) {
        const fileName = article.type === 'theme-index'
            ? 'index.md'
            : `${article.slug}.md`;
        const filePath = path.join(themeDir, fileName);
        const content = normalizeLineEndings(article.content);
        fs.writeFileSync(filePath, content, 'utf-8');
        writtenFiles.push(filePath);
    }

    return { writtenFiles, themeDir };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize line endings to LF (Unix-style).
 */
function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

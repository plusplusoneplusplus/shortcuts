/**
 * Topic File Writer
 *
 * Writes generated topic articles to the wiki directory.
 *
 * Layout logic:
 * - layout: 'single' → wiki/topics/{topicId}.md
 * - layout: 'area'   → wiki/topics/{topicId}/
 *                         ├── index.md
 *                         ├── {slug1}.md
 *                         └── {slug2}.md
 *
 * Creates topics/ directory if it doesn't exist.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TopicOutline, TopicArticle } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** Subdirectory for topic articles within the wiki */
const TOPICS_DIR = 'topics';

// ============================================================================
// Types
// ============================================================================

export interface TopicWriteOptions {
    wikiDir: string;
    topicId: string;
    outline: TopicOutline;
    articles: TopicArticle[];
}

export interface TopicWriteResult {
    /** Absolute paths of written files */
    writtenFiles: string[];
    /** Path to topic directory (or single file) */
    topicDir: string;
}

// ============================================================================
// File Writer
// ============================================================================

/**
 * Write topic articles to the wiki directory.
 *
 * Creates topics/ directory if it doesn't exist.
 * Overwrites existing files.
 */
export function writeTopicArticles(options: TopicWriteOptions): TopicWriteResult {
    const { wikiDir, topicId, outline, articles } = options;
    const resolvedWiki = path.resolve(wikiDir);
    const topicsDir = path.join(resolvedWiki, TOPICS_DIR);
    const writtenFiles: string[] = [];

    // Ensure topics/ directory exists
    fs.mkdirSync(topicsDir, { recursive: true });

    if (outline.layout === 'single') {
        // Single layout: write one file at topics/{topicId}.md
        const filePath = path.join(topicsDir, `${topicId}.md`);
        const article = articles[0];
        if (article) {
            const content = normalizeLineEndings(article.content);
            fs.writeFileSync(filePath, content, 'utf-8');
            writtenFiles.push(filePath);
        }
        return { writtenFiles, topicDir: filePath };
    }

    // Area layout: write directory at topics/{topicId}/
    const topicDir = path.join(topicsDir, topicId);
    fs.mkdirSync(topicDir, { recursive: true });

    for (const article of articles) {
        const fileName = article.type === 'topic-index'
            ? 'index.md'
            : `${article.slug}.md`;
        const filePath = path.join(topicDir, fileName);
        const content = normalizeLineEndings(article.content);
        fs.writeFileSync(filePath, content, 'utf-8');
        writtenFiles.push(filePath);
    }

    return { writtenFiles, topicDir };
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

/**
 * Wiki Integrator
 *
 * Updates existing wiki files to integrate a new topic area:
 * - module-graph.json — adds/updates TopicAreaMeta entry
 * - index.md — adds/updates "Topics" navigation section
 * - module articles — adds "Related Topics" cross-links
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleGraph, TopicAreaMeta, TopicOutline, TopicArticle } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface WikiIntegrationOptions {
    wikiDir: string;
    topicId: string;
    outline: TopicOutline;
    articles: TopicArticle[];
    noCrossLink: boolean;
}

// ============================================================================
// Module Graph
// ============================================================================

/**
 * Update module-graph.json to include the new topic area metadata.
 * - Reads existing module-graph.json
 * - Adds/updates entry in topics[] array (matched by id)
 * - Writes back with proper formatting
 */
export function updateModuleGraph(wikiDir: string, topicMeta: TopicAreaMeta): void {
    const graphPath = path.join(path.resolve(wikiDir), 'module-graph.json');

    let graph: ModuleGraph;
    try {
        const raw = fs.readFileSync(graphPath, 'utf-8');
        graph = JSON.parse(raw) as ModuleGraph;
    } catch {
        // If file doesn't exist or is invalid, create minimal graph
        graph = {
            project: { name: '', description: '', language: '', rootPath: '' } as ModuleGraph['project'],
            modules: [],
            categories: [],
            architectureNotes: '',
        };
    }

    // Ensure topics array exists
    if (!graph.topics) {
        graph.topics = [];
    }

    // Replace existing entry or append
    const existingIdx = graph.topics.findIndex(t => t.id === topicMeta.id);
    if (existingIdx >= 0) {
        graph.topics[existingIdx] = topicMeta;
    } else {
        graph.topics.push(topicMeta);
    }

    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
}

// ============================================================================
// Wiki Index
// ============================================================================

/**
 * Update wiki index.md to include a "Topics" section.
 * - If "## Topics" section exists, append new topic link (if not already present)
 * - If not, add "## Topics" section before the last line (footer) or at end
 */
export function updateWikiIndex(
    wikiDir: string,
    topicId: string,
    topicTitle: string,
    layout: 'single' | 'area',
): void {
    const indexPath = path.join(path.resolve(wikiDir), 'index.md');

    let content: string;
    try {
        content = fs.readFileSync(indexPath, 'utf-8');
    } catch {
        content = '';
    }

    const linkPath = layout === 'single'
        ? `./topics/${topicId}.md`
        : `./topics/${topicId}/index.md`;
    const linkLine = `- [${topicTitle}](${linkPath})`;

    // Check if link already exists (idempotent)
    if (content.includes(linkPath)) {
        return;
    }

    const topicsSectionRegex = /^## Topics$/m;
    if (topicsSectionRegex.test(content)) {
        // Append link after the "## Topics" heading
        content = content.replace(topicsSectionRegex, `## Topics\n${linkLine}`);
    } else {
        // Add new "## Topics" section at the end
        const section = `\n## Topics\n\n${linkLine}\n`;
        content = content.trimEnd() + '\n' + section;
    }

    fs.writeFileSync(indexPath, content, 'utf-8');
}

// ============================================================================
// Cross-Links
// ============================================================================

/**
 * Add "Related Topics" cross-links to existing module articles.
 * For each involved module, finds its article and appends a link.
 * Idempotent: won't add duplicate links.
 */
export function addCrossLinks(
    wikiDir: string,
    topicId: string,
    topicTitle: string,
    involvedModuleIds: string[],
    layout: 'single' | 'area',
): { updatedFiles: string[] } {
    const resolvedWiki = path.resolve(wikiDir);
    const modulesDir = path.join(resolvedWiki, 'modules');
    const updatedFiles: string[] = [];

    const linkPath = layout === 'single'
        ? `../topics/${topicId}.md`
        : `../topics/${topicId}/index.md`;
    const linkLine = `- [${topicTitle}](${linkPath})`;

    for (const moduleId of involvedModuleIds) {
        // Try to find the module article file
        const articlePath = findModuleArticle(modulesDir, moduleId);
        if (!articlePath) {
            continue;
        }

        let content: string;
        try {
            content = fs.readFileSync(articlePath, 'utf-8');
        } catch {
            continue;
        }

        // Skip if link already present (idempotent)
        if (content.includes(linkPath)) {
            continue;
        }

        const relatedSection = /^## Related Topics$/m;
        if (relatedSection.test(content)) {
            // Append link after existing "## Related Topics" heading
            content = content.replace(relatedSection, `## Related Topics\n${linkLine}`);
        } else {
            // Add new "## Related Topics" section at the end
            content = content.trimEnd() + '\n\n## Related Topics\n\n' + linkLine + '\n';
        }

        fs.writeFileSync(articlePath, content, 'utf-8');
        updatedFiles.push(articlePath);
    }

    return { updatedFiles };
}

/**
 * Find a module article by module ID in the modules/ directory.
 * Tries exact match first, then slug-based match.
 */
function findModuleArticle(modulesDir: string, moduleId: string): string | null {
    if (!fs.existsSync(modulesDir)) {
        return null;
    }

    // Try direct match: modules/{moduleId}.md
    const directPath = path.join(modulesDir, `${moduleId}.md`);
    if (fs.existsSync(directPath)) {
        return directPath;
    }

    // Try listing files for a slug-based match
    try {
        const files = fs.readdirSync(modulesDir);
        const match = files.find(f => {
            const name = path.basename(f, '.md');
            return name === moduleId || name.toLowerCase() === moduleId.toLowerCase();
        });
        if (match) {
            return path.join(modulesDir, match);
        }
    } catch {
        // Ignore read errors
    }

    return null;
}

// ============================================================================
// Full Integration
// ============================================================================

/**
 * Full integration: write files + update graph + update index + cross-links.
 */
export function integrateTopicIntoWiki(
    options: WikiIntegrationOptions,
): { writtenFiles: string[]; updatedFiles: string[] } {
    const { wikiDir, topicId, outline, articles, noCrossLink } = options;

    // Import and call file writer
    const { writeTopicArticles } = require('./file-writer');
    const writeResult = writeTopicArticles({ wikiDir, topicId, outline, articles });

    // Build TopicAreaMeta
    const topicMeta: TopicAreaMeta = {
        id: topicId,
        title: outline.title,
        description: outline.articles.find(a => a.isIndex)?.description || outline.title,
        layout: outline.layout,
        articles: articles.map(a => ({
            slug: a.slug,
            title: a.title,
            path: outline.layout === 'single'
                ? `topics/${topicId}.md`
                : `topics/${topicId}/${a.type === 'topic-index' ? 'index' : a.slug}.md`,
        })),
        involvedModuleIds: outline.involvedModules.map(m => m.moduleId),
        directoryPath: outline.layout === 'single'
            ? `topics/${topicId}.md`
            : `topics/${topicId}`,
        generatedAt: Date.now(),
    };

    // Update module-graph.json
    updateModuleGraph(wikiDir, topicMeta);

    // Update wiki index.md
    updateWikiIndex(wikiDir, topicId, outline.title, outline.layout);

    // Add cross-links to module articles
    let updatedFiles: string[] = [];
    if (!noCrossLink) {
        const involvedModuleIds = outline.involvedModules.map(m => m.moduleId);
        const crossResult = addCrossLinks(wikiDir, topicId, outline.title, involvedModuleIds, outline.layout);
        updatedFiles = crossResult.updatedFiles;
    }

    return { writtenFiles: writeResult.writtenFiles, updatedFiles };
}

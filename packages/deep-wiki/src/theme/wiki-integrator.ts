/**
 * Wiki Integrator
 *
 * Updates existing wiki files to integrate a new theme area:
 * - module-graph.json — adds/updates ThemeMeta entry
 * - index.md — adds/updates "Themes" navigation section
 * - module articles — adds "Related Themes" cross-links
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ComponentGraph, ThemeMeta, ThemeOutline, ThemeArticle } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface WikiIntegrationOptions {
    wikiDir: string;
    themeId: string;
    outline: ThemeOutline;
    articles: ThemeArticle[];
    noCrossLink: boolean;
}

// ============================================================================
// Module Graph
// ============================================================================

/**
 * Update module-graph.json to include the new theme area metadata.
 * - Reads existing module-graph.json
 * - Adds/updates entry in themes[] array (matched by id)
 * - Writes back with proper formatting
 */
export function updateModuleGraph(wikiDir: string, themeMeta: ThemeMeta): void {
    const graphPath = path.join(path.resolve(wikiDir), 'module-graph.json');

    let graph: ComponentGraph;
    try {
        const raw = fs.readFileSync(graphPath, 'utf-8');
        graph = JSON.parse(raw) as ComponentGraph;
    } catch {
        // If file doesn't exist or is invalid, create minimal graph
        graph = {
            project: { name: '', description: '', language: '', buildSystem: '', entryPoints: [] } as ComponentGraph['project'],
            components: [],
            categories: [],
            architectureNotes: '',
        };
    }

    // Ensure themes array exists
    if (!graph.themes) {
        graph.themes = [];
    }

    // Replace existing entry or append
    const existingIdx = graph.themes.findIndex(t => t.id === themeMeta.id);
    if (existingIdx >= 0) {
        graph.themes[existingIdx] = themeMeta;
    } else {
        graph.themes.push(themeMeta);
    }

    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
}

// ============================================================================
// Wiki Index
// ============================================================================

/**
 * Update wiki index.md to include a "Themes" section.
 * - If "## Themes" section exists, append new theme link (if not already present)
 * - If not, add "## Themes" section before the last line (footer) or at end
 */
export function updateWikiIndex(
    wikiDir: string,
    themeId: string,
    themeTitle: string,
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
        ? `./themes/${themeId}.md`
        : `./themes/${themeId}/index.md`;
    const linkLine = `- [${themeTitle}](${linkPath})`;

    // Check if link already exists (idempotent)
    if (content.includes(linkPath)) {
        return;
    }

    const themesSectionRegex = /^## Themes$/m;
    if (themesSectionRegex.test(content)) {
        // Append link after the "## Themes" heading
        content = content.replace(themesSectionRegex, `## Themes\n${linkLine}`);
    } else {
        // Add new "## Themes" section at the end
        const section = `\n## Themes\n\n${linkLine}\n`;
        content = content.trimEnd() + '\n' + section;
    }

    fs.writeFileSync(indexPath, content, 'utf-8');
}

// ============================================================================
// Cross-Links
// ============================================================================

/**
 * Add "Related Themes" cross-links to existing module articles.
 * For each involved module, finds its article and appends a link.
 * Idempotent: won't add duplicate links.
 */
export function addCrossLinks(
    wikiDir: string,
    themeId: string,
    themeTitle: string,
    involvedComponentIds: string[],
    layout: 'single' | 'area',
): { updatedFiles: string[] } {
    const resolvedWiki = path.resolve(wikiDir);
    const modulesDir = path.join(resolvedWiki, 'modules');
    const updatedFiles: string[] = [];

    const linkPath = layout === 'single'
        ? `../themes/${themeId}.md`
        : `../themes/${themeId}/index.md`;
    const linkLine = `- [${themeTitle}](${linkPath})`;

    for (const componentId of involvedComponentIds) {
        // Try to find the module article file
        const articlePath = findModuleArticle(modulesDir, componentId);
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

        const relatedSection = /^## Related Themes$/m;
        if (relatedSection.test(content)) {
            // Append link after existing "## Related Themes" heading
            content = content.replace(relatedSection, `## Related Themes\n${linkLine}`);
        } else {
            // Add new "## Related Themes" section at the end
            content = content.trimEnd() + '\n\n## Related Themes\n\n' + linkLine + '\n';
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
function findModuleArticle(modulesDir: string, componentId: string): string | null {
    if (!fs.existsSync(modulesDir)) {
        return null;
    }

    // Try direct match: modules/{componentId}.md
    const directPath = path.join(modulesDir, `${componentId}.md`);
    if (fs.existsSync(directPath)) {
        return directPath;
    }

    // Try listing files for a slug-based match
    try {
        const files = fs.readdirSync(modulesDir);
        const match = files.find(f => {
            const name = path.basename(f, '.md');
            return name === componentId || name.toLowerCase() === componentId.toLowerCase();
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
export function integrateThemeIntoWiki(
    options: WikiIntegrationOptions,
): { writtenFiles: string[]; updatedFiles: string[] } {
    const { wikiDir, themeId, outline, articles, noCrossLink } = options;

    // Import and call file writer
    const { writeThemeArticles } = require('./file-writer');
    const writeResult = writeThemeArticles({ wikiDir, themeId, outline, articles });

    // Build ThemeMeta
    const themeMeta: ThemeMeta = {
        id: themeId,
        title: outline.title,
        description: outline.articles.find(a => a.isIndex)?.description || outline.title,
        layout: outline.layout,
        articles: articles.map(a => ({
            slug: a.slug,
            title: a.title,
            path: outline.layout === 'single'
                ? `themes/${themeId}.md`
                : `themes/${themeId}/${a.type === 'theme-index' ? 'index' : a.slug}.md`,
        })),
        involvedComponentIds: outline.involvedComponents.map(m => m.componentId),
        directoryPath: outline.layout === 'single'
            ? `themes/${themeId}.md`
            : `themes/${themeId}`,
        generatedAt: Date.now(),
    };

    // Update module-graph.json
    updateModuleGraph(wikiDir, themeMeta);

    // Update wiki index.md
    updateWikiIndex(wikiDir, themeId, outline.title, outline.layout);

    // Add cross-links to module articles
    let updatedFiles: string[] = [];
    if (!noCrossLink) {
        const involvedComponentIds = outline.involvedComponents.map(m => m.componentId);
        const crossResult = addCrossLinks(wikiDir, themeId, outline.title, involvedComponentIds, outline.layout);
        updatedFiles = crossResult.updatedFiles;
    }

    return { writtenFiles: writeResult.writtenFiles, updatedFiles };
}

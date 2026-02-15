/**
 * Website Data
 *
 * Data reading, serialization, and utility functions for the website generator.
 * Extracted from website-generator.ts for maintainability.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ComponentGraph } from '../types';

// ============================================================================
// Component Graph Reader
// ============================================================================

/**
 * Read component-graph.json from the wiki directory.
 * @param wikiDir - Resolved wiki directory path
 * @returns Parsed component graph
 */
export function readComponentGraph(wikiDir: string): ComponentGraph {
    const graphPath = path.join(wikiDir, 'component-graph.json');
    if (!fs.existsSync(graphPath)) {
        throw new Error(`component-graph.json not found in ${wikiDir}`);
    }

    const content = fs.readFileSync(graphPath, 'utf-8');
    return JSON.parse(content) as ComponentGraph;
}

// ============================================================================
// Markdown Reader
// ============================================================================

/**
 * Read all markdown files for components from the wiki directory.
 *
 * Supports both flat and hierarchical layouts:
 *   - Flat: components/{slug}.md
 *   - Hierarchical: domains/{domainId}/components/{slug}.md
 *
 * Also reads top-level markdown files (index.md, architecture.md, getting-started.md)
 * and area-level index/architecture files.
 *
 * @param wikiDir - Resolved wiki directory path
 * @param componentGraph - The component graph (for component ID mapping)
 * @returns Map of component ID to markdown content
 */
export function readMarkdownFiles(
    wikiDir: string,
    componentGraph: ComponentGraph
): Record<string, string> {
    const data: Record<string, string> = {};

    // Read top-level markdown files
    const topLevelFiles = ['index.md', 'architecture.md', 'getting-started.md'];
    for (const file of topLevelFiles) {
        const filePath = path.join(wikiDir, file);
        if (fs.existsSync(filePath)) {
            const key = path.basename(file, '.md');
            data[`__${key}`] = fs.readFileSync(filePath, 'utf-8');
        }
    }

    // Read flat-layout component files
    const componentsDir = path.join(wikiDir, 'components');
    if (fs.existsSync(componentsDir) && fs.statSync(componentsDir).isDirectory()) {
        const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const slug = path.basename(file, '.md');
            const componentId = findComponentIdBySlug(slug, componentGraph);
            const key = componentId || slug;
            data[key] = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
        }
    }

    // Read topic files (topics/{topicId}.md for single, topics/{topicId}/ for area)
    const topicsDir = path.join(wikiDir, 'topics');
    if (fs.existsSync(topicsDir) && fs.statSync(topicsDir).isDirectory()) {
        const entries = fs.readdirSync(topicsDir);
        for (const entry of entries) {
            const entryPath = path.join(topicsDir, entry);
            const stat = fs.statSync(entryPath);

            if (stat.isFile() && entry.endsWith('.md')) {
                // Single-layout topic: topics/{topicId}.md
                const topicId = path.basename(entry, '.md');
                data[`__topic_${topicId}`] = fs.readFileSync(entryPath, 'utf-8');
            } else if (stat.isDirectory()) {
                // Area-layout topic: topics/{topicId}/
                const topicId = entry;
                const topicDir = entryPath;

                // Read index.md
                const indexPath = path.join(topicDir, 'index.md');
                if (fs.existsSync(indexPath)) {
                    data[`__topic_${topicId}_index`] = fs.readFileSync(indexPath, 'utf-8');
                }

                // Read sub-article files
                const subFiles = fs.readdirSync(topicDir).filter(f =>
                    f.endsWith('.md') && f !== 'index.md'
                );
                for (const subFile of subFiles) {
                    const slug = path.basename(subFile, '.md');
                    data[`__topic_${topicId}_${slug}`] = fs.readFileSync(path.join(topicDir, subFile), 'utf-8');
                }
            }
        }
    }

    // Read hierarchical-layout domain files
    const domainsDir = path.join(wikiDir, 'domains');
    if (fs.existsSync(domainsDir) && fs.statSync(domainsDir).isDirectory()) {
        const domainDirs = fs.readdirSync(domainsDir).filter(d =>
            fs.statSync(path.join(domainsDir, d)).isDirectory()
        );

        for (const domainId of domainDirs) {
            const domainDir = path.join(domainsDir, domainId);

            // Area-level files
            for (const file of ['index.md', 'architecture.md']) {
                const filePath = path.join(domainDir, file);
                if (fs.existsSync(filePath)) {
                    const key = path.basename(file, '.md');
                    data[`__domain_${domainId}_${key}`] = fs.readFileSync(filePath, 'utf-8');
                }
            }

            // Area component files
            const domainComponentsDir = path.join(domainDir, 'components');
            if (fs.existsSync(domainComponentsDir) && fs.statSync(domainComponentsDir).isDirectory()) {
                const files = fs.readdirSync(domainComponentsDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    const slug = path.basename(file, '.md');
                    const componentId = findComponentIdBySlug(slug, componentGraph);
                    const key = componentId || slug;
                    data[key] = fs.readFileSync(path.join(domainComponentsDir, file), 'utf-8');
                }
            }
        }
    }

    return data;
}

// ============================================================================
// Data Embedding
// ============================================================================

/**
 * Generate the embedded-data.js content.
 *
 * Produces a JavaScript file that defines two global constants:
 *   - COMPONENT_GRAPH: The component graph JSON
 *   - MARKDOWN_DATA: Map of component ID to markdown content
 *
 * Uses JSON.stringify with sorted keys for deterministic output.
 *
 * @param componentGraph - The component graph
 * @param markdownData - Map of component ID to markdown content
 * @returns JavaScript source code
 */
export function generateEmbeddedData(
    componentGraph: ComponentGraph,
    markdownData: Record<string, string>
): string {
    // Sort keys for deterministic output
    const sortedGraph = stableStringify(componentGraph);
    const sortedMarkdown = stableStringify(markdownData);

    return `// Auto-generated by deep-wiki. Do not edit manually.\nconst COMPONENT_GRAPH = ${sortedGraph};\nconst MARKDOWN_DATA = ${sortedMarkdown};\n`;
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * JSON.stringify with sorted keys for deterministic output.
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, sortedReplacer, 2);
}

/**
 * JSON replacer that sorts object keys.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
    }
    return value;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a component ID by its slug.
 * Matches by normalizing the component ID to a slug.
 */
function findComponentIdBySlug(slug: string, componentGraph: ComponentGraph): string | null {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (const mod of componentGraph.components) {
        const compSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (compSlug === normalized) {
            return mod.id;
        }
    }
    return null;
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

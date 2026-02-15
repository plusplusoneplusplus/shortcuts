/**
 * Wiki Data Layer
 *
 * Reads and caches wiki data (component graph, markdown articles, analyses)
 * from the wiki output directory on disk.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ComponentGraph, ComponentInfo, ComponentAnalysis, ThemeMeta } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Component summary returned by the /api/components endpoint.
 */
export interface ComponentSummary {
    id: string;
    name: string;
    category: string;
    complexity: string;
    path: string;
    purpose: string;
}

/**
 * Component detail returned by the /api/components/:id endpoint.
 */
export interface ComponentDetail {
    component: ComponentInfo;
    markdown: string;
    analysis?: ComponentAnalysis;
}

/**
 * Special page returned by the /api/pages/:key endpoint.
 */
export interface SpecialPage {
    key: string;
    title: string;
    markdown: string;
}

/**
 * Single theme article content.
 */
export interface ThemeArticleContent {
    slug: string;
    title: string;
    content: string;
}

/**
 * Theme article detail returned by the /api/themes/:id/:slug endpoint.
 */
export interface ThemeArticleDetail {
    content: string;
    meta: ThemeMeta;
}

// ============================================================================
// WikiData Class
// ============================================================================

/**
 * Reads and caches wiki data from the wiki output directory.
 *
 * Data is loaded eagerly on construction and can be refreshed via reload().
 */
export class WikiData {
    private wikiDir: string;
    private _graph: ComponentGraph | null = null;
    private _markdown: Record<string, string> = {};
    private _analyses: Map<string, ComponentAnalysis> = new Map();
    private _themeMarkdown: Record<string, string> = {};

    constructor(wikiDir: string) {
        this.wikiDir = path.resolve(wikiDir);
    }

    /**
     * Load all wiki data from disk. Call on startup and after rebuilds.
     */
    load(): void {
        this._graph = this.readComponentGraph();
        this._markdown = this.readMarkdownFiles();
        this._analyses = this.readAnalyses();
        this._themeMarkdown = this.readThemeFiles();
    }

    /**
     * Reload wiki data from disk (alias for load).
     */
    reload(): void {
        this.load();
    }

    /**
     * Get the full component graph.
     */
    get graph(): ComponentGraph {
        if (!this._graph) {
            throw new Error('Wiki data not loaded. Call load() first.');
        }
        return this._graph;
    }

    /**
     * Get the wiki directory path.
     */
    get dir(): string {
        return this.wikiDir;
    }

    /**
     * Get summaries for all components.
     */
    getComponentSummaries(): ComponentSummary[] {
        return this.graph.components.map(mod => ({
            id: mod.id,
            name: mod.name,
            category: mod.category,
            complexity: mod.complexity,
            path: mod.path,
            purpose: mod.purpose,
        }));
    }

    /**
     * Get detailed info for a single component.
     */
    getComponentDetail(componentId: string): ComponentDetail | null {
        const mod = this.graph.components.find(m => m.id === componentId);
        if (!mod) {
            return null;
        }

        return {
            component: mod,
            markdown: this._markdown[componentId] || '',
            analysis: this._analyses.get(componentId),
        };
    }

    /**
     * Get a special page by key (index, architecture, getting-started).
     */
    getSpecialPage(key: string): SpecialPage | null {
        const TITLES: Record<string, string> = {
            'index': 'Index',
            'architecture': 'Architecture',
            'getting-started': 'Getting Started',
        };

        const internalKey = `__${key}`;
        const markdown = this._markdown[internalKey];
        if (!markdown) {
            return null;
        }

        return {
            key,
            title: TITLES[key] || key,
            markdown,
        };
    }

    /**
     * Get all markdown data (used by SPA template for embedding).
     */
    getMarkdownData(): Record<string, string> {
        return { ...this._markdown };
    }

    /**
     * Get all theme markdown data (used by context builder for indexing).
     */
    getThemeMarkdownData(): Record<string, string> {
        return { ...this._themeMarkdown };
    }

    /**
     * Get the list of all theme areas with metadata.
     */
    getThemeList(): ThemeMeta[] {
        return this.graph.themes || [];
    }

    /**
     * Get a single theme article by themeId and optional slug.
     * If slug is omitted, returns the first article (or index) for the theme.
     */
    getThemeArticle(themeId: string, slug?: string): ThemeArticleDetail | null {
        const themes = this.graph.themes || [];
        const meta = themes.find(t => t.id === themeId);
        if (!meta) {
            return null;
        }

        const targetSlug = slug || (meta.articles.length > 0 ? meta.articles[0].slug : undefined);
        if (!targetSlug) {
            return null;
        }

        const key = `theme:${themeId}:${targetSlug}`;
        const content = this._themeMarkdown[key];
        if (!content) {
            return null;
        }

        return { content, meta };
    }

    /**
     * Get all articles for a theme area.
     */
    getThemeArticles(themeId: string): ThemeArticleContent[] {
        const themes = this.graph.themes || [];
        const meta = themes.find(t => t.id === themeId);
        if (!meta) {
            return [];
        }

        const articles: ThemeArticleContent[] = [];
        for (const article of meta.articles) {
            const key = `theme:${themeId}:${article.slug}`;
            const content = this._themeMarkdown[key] || '';
            articles.push({
                slug: article.slug,
                title: article.title,
                content,
            });
        }
        return articles;
    }

    /**
     * Check if wiki data has been loaded.
     */
    get isLoaded(): boolean {
        return this._graph !== null;
    }

    // ========================================================================
    // Private: Disk Readers
    // ========================================================================

    private readComponentGraph(): ComponentGraph {
        const graphPath = path.join(this.wikiDir, 'component-graph.json');
        if (!fs.existsSync(graphPath)) {
            throw new Error(`component-graph.json not found in ${this.wikiDir}`);
        }
        const content = fs.readFileSync(graphPath, 'utf-8');
        return JSON.parse(content) as ComponentGraph;
    }

    private readMarkdownFiles(): Record<string, string> {
        const data: Record<string, string> = {};

        // Read top-level markdown files
        const topLevelFiles = ['index.md', 'architecture.md', 'getting-started.md'];
        for (const file of topLevelFiles) {
            const filePath = path.join(this.wikiDir, file);
            if (fs.existsSync(filePath)) {
                const key = path.basename(file, '.md');
                data[`__${key}`] = fs.readFileSync(filePath, 'utf-8');
            }
        }

        // Read flat-layout component files
        const componentsDir = path.join(this.wikiDir, 'components');
        if (fs.existsSync(componentsDir) && fs.statSync(componentsDir).isDirectory()) {
            const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const slug = path.basename(file, '.md');
                const componentId = this.findComponentIdBySlug(slug);
                data[componentId || slug] = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
            }
        }

        // Read hierarchical-layout domain files
        const domainsDir = path.join(this.wikiDir, 'domains');
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
                        const componentId = this.findComponentIdBySlug(slug);
                        data[componentId || slug] = fs.readFileSync(path.join(domainComponentsDir, file), 'utf-8');
                    }
                }
            }
        }

        return data;
    }

    private readAnalyses(): Map<string, ComponentAnalysis> {
        const analyses = new Map<string, ComponentAnalysis>();

        // Try to read from cache directory
        const cacheDir = path.join(this.wikiDir, '.wiki-cache', 'analyses');
        if (!fs.existsSync(cacheDir) || !fs.statSync(cacheDir).isDirectory()) {
            return analyses;
        }

        const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
                const parsed = JSON.parse(content);
                // Handle both direct analysis and cached analysis formats
                const analysis: ComponentAnalysis = parsed.analysis || parsed;
                if (analysis.componentId) {
                    analyses.set(analysis.componentId, analysis);
                }
            } catch {
                // Skip invalid files
            }
        }

        return analyses;
    }

    /**
     * Read theme article files from the themes/ directory.
     * Keys are in format `theme:{themeId}:{slug}`.
     */
    private readThemeFiles(): Record<string, string> {
        const data: Record<string, string> = {};
        const themesDir = path.join(this.wikiDir, 'themes');

        if (!fs.existsSync(themesDir) || !fs.statSync(themesDir).isDirectory()) {
            return data;
        }

        const themes = this._graph?.themes || [];

        for (const theme of themes) {
            if (theme.layout === 'single') {
                // Single-file themes: themes/{themeId}.md
                const filePath = path.join(themesDir, `${theme.id}.md`);
                if (fs.existsSync(filePath)) {
                    const slug = theme.articles.length > 0 ? theme.articles[0].slug : theme.id;
                    data[`theme:${theme.id}:${slug}`] = fs.readFileSync(filePath, 'utf-8');
                }
            } else {
                // Area-layout themes: themes/{themeId}/*.md
                const themeDir = path.join(themesDir, theme.id);
                if (fs.existsSync(themeDir) && fs.statSync(themeDir).isDirectory()) {
                    for (const article of theme.articles) {
                        const slug = article.slug;
                        // Try the slug directly, then fallback to index.md for index articles
                        let filePath = path.join(themeDir, `${slug}.md`);
                        if (!fs.existsSync(filePath) && slug === theme.id) {
                            filePath = path.join(themeDir, 'index.md');
                        }
                        if (fs.existsSync(filePath)) {
                            data[`theme:${theme.id}:${slug}`] = fs.readFileSync(filePath, 'utf-8');
                        }
                    }
                }
            }
        }

        return data;
    }

    private findComponentIdBySlug(slug: string): string | null {
        if (!this._graph) { return null; }
        const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        for (const mod of this._graph.components) {
            const modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (modSlug === normalized) {
                return mod.id;
            }
        }
        return null;
    }
}

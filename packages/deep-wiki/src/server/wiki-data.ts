/**
 * Wiki Data Layer
 *
 * Reads and caches wiki data (module graph, markdown articles, analyses)
 * from the wiki output directory on disk.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleGraph, ModuleInfo, ModuleAnalysis, TopicAreaMeta } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Module summary returned by the /api/modules endpoint.
 */
export interface ModuleSummary {
    id: string;
    name: string;
    category: string;
    complexity: string;
    path: string;
    purpose: string;
}

/**
 * Module detail returned by the /api/modules/:id endpoint.
 */
export interface ModuleDetail {
    module: ModuleInfo;
    markdown: string;
    analysis?: ModuleAnalysis;
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
 * Single topic article content.
 */
export interface TopicArticleContent {
    slug: string;
    title: string;
    content: string;
}

/**
 * Topic article detail returned by the /api/topics/:id/:slug endpoint.
 */
export interface TopicArticleDetail {
    content: string;
    meta: TopicAreaMeta;
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
    private _graph: ModuleGraph | null = null;
    private _markdown: Record<string, string> = {};
    private _analyses: Map<string, ModuleAnalysis> = new Map();
    private _topicMarkdown: Record<string, string> = {};

    constructor(wikiDir: string) {
        this.wikiDir = path.resolve(wikiDir);
    }

    /**
     * Load all wiki data from disk. Call on startup and after rebuilds.
     */
    load(): void {
        this._graph = this.readModuleGraph();
        this._markdown = this.readMarkdownFiles();
        this._analyses = this.readAnalyses();
        this._topicMarkdown = this.readTopicFiles();
    }

    /**
     * Reload wiki data from disk (alias for load).
     */
    reload(): void {
        this.load();
    }

    /**
     * Get the full module graph.
     */
    get graph(): ModuleGraph {
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
     * Get summaries for all modules.
     */
    getModuleSummaries(): ModuleSummary[] {
        return this.graph.modules.map(mod => ({
            id: mod.id,
            name: mod.name,
            category: mod.category,
            complexity: mod.complexity,
            path: mod.path,
            purpose: mod.purpose,
        }));
    }

    /**
     * Get detailed info for a single module.
     */
    getModuleDetail(moduleId: string): ModuleDetail | null {
        const mod = this.graph.modules.find(m => m.id === moduleId);
        if (!mod) {
            return null;
        }

        return {
            module: mod,
            markdown: this._markdown[moduleId] || '',
            analysis: this._analyses.get(moduleId),
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
     * Get all topic markdown data (used by context builder for indexing).
     */
    getTopicMarkdownData(): Record<string, string> {
        return { ...this._topicMarkdown };
    }

    /**
     * Get the list of all topic areas with metadata.
     */
    getTopicList(): TopicAreaMeta[] {
        return this.graph.topics || [];
    }

    /**
     * Get a single topic article by topicId and optional slug.
     * If slug is omitted, returns the first article (or index) for the topic.
     */
    getTopicArticle(topicId: string, slug?: string): TopicArticleDetail | null {
        const topics = this.graph.topics || [];
        const meta = topics.find(t => t.id === topicId);
        if (!meta) {
            return null;
        }

        const targetSlug = slug || (meta.articles.length > 0 ? meta.articles[0].slug : undefined);
        if (!targetSlug) {
            return null;
        }

        const key = `topic:${topicId}:${targetSlug}`;
        const content = this._topicMarkdown[key];
        if (!content) {
            return null;
        }

        return { content, meta };
    }

    /**
     * Get all articles for a topic area.
     */
    getTopicArticles(topicId: string): TopicArticleContent[] {
        const topics = this.graph.topics || [];
        const meta = topics.find(t => t.id === topicId);
        if (!meta) {
            return [];
        }

        const articles: TopicArticleContent[] = [];
        for (const article of meta.articles) {
            const key = `topic:${topicId}:${article.slug}`;
            const content = this._topicMarkdown[key] || '';
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

    private readModuleGraph(): ModuleGraph {
        const graphPath = path.join(this.wikiDir, 'module-graph.json');
        if (!fs.existsSync(graphPath)) {
            throw new Error(`module-graph.json not found in ${this.wikiDir}`);
        }
        const content = fs.readFileSync(graphPath, 'utf-8');
        return JSON.parse(content) as ModuleGraph;
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

        // Read flat-layout module files
        const modulesDir = path.join(this.wikiDir, 'modules');
        if (fs.existsSync(modulesDir) && fs.statSync(modulesDir).isDirectory()) {
            const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const slug = path.basename(file, '.md');
                const moduleId = this.findModuleIdBySlug(slug);
                data[moduleId || slug] = fs.readFileSync(path.join(modulesDir, file), 'utf-8');
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

                // Area module files
                const domainModulesDir = path.join(domainDir, 'modules');
                if (fs.existsSync(domainModulesDir) && fs.statSync(domainModulesDir).isDirectory()) {
                    const files = fs.readdirSync(domainModulesDir).filter(f => f.endsWith('.md'));
                    for (const file of files) {
                        const slug = path.basename(file, '.md');
                        const moduleId = this.findModuleIdBySlug(slug);
                        data[moduleId || slug] = fs.readFileSync(path.join(domainModulesDir, file), 'utf-8');
                    }
                }
            }
        }

        return data;
    }

    private readAnalyses(): Map<string, ModuleAnalysis> {
        const analyses = new Map<string, ModuleAnalysis>();

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
                const analysis: ModuleAnalysis = parsed.analysis || parsed;
                if (analysis.moduleId) {
                    analyses.set(analysis.moduleId, analysis);
                }
            } catch {
                // Skip invalid files
            }
        }

        return analyses;
    }

    /**
     * Read topic article files from the topics/ directory.
     * Keys are in format `topic:{topicId}:{slug}`.
     */
    private readTopicFiles(): Record<string, string> {
        const data: Record<string, string> = {};
        const topicsDir = path.join(this.wikiDir, 'topics');

        if (!fs.existsSync(topicsDir) || !fs.statSync(topicsDir).isDirectory()) {
            return data;
        }

        const topics = this._graph?.topics || [];

        for (const topic of topics) {
            if (topic.layout === 'single') {
                // Single-file topics: topics/{topicId}.md
                const filePath = path.join(topicsDir, `${topic.id}.md`);
                if (fs.existsSync(filePath)) {
                    const slug = topic.articles.length > 0 ? topic.articles[0].slug : topic.id;
                    data[`topic:${topic.id}:${slug}`] = fs.readFileSync(filePath, 'utf-8');
                }
            } else {
                // Area-layout topics: topics/{topicId}/*.md
                const topicDir = path.join(topicsDir, topic.id);
                if (fs.existsSync(topicDir) && fs.statSync(topicDir).isDirectory()) {
                    for (const article of topic.articles) {
                        const slug = article.slug;
                        // Try the slug directly, then fallback to index.md for index articles
                        let filePath = path.join(topicDir, `${slug}.md`);
                        if (!fs.existsSync(filePath) && slug === topic.id) {
                            filePath = path.join(topicDir, 'index.md');
                        }
                        if (fs.existsSync(filePath)) {
                            data[`topic:${topic.id}:${slug}`] = fs.readFileSync(filePath, 'utf-8');
                        }
                    }
                }
            }
        }

        return data;
    }

    private findModuleIdBySlug(slug: string): string | null {
        if (!this._graph) { return null; }
        const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        for (const mod of this._graph.modules) {
            const modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (modSlug === normalized) {
                return mod.id;
            }
        }
        return null;
    }
}

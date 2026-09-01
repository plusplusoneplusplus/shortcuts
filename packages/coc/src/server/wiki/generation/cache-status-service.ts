/**
 * Reads the on-disk `.wiki-cache` layout to answer "which phases have cached
 * output, and how much of it is there". Pure filesystem inspection — it carries
 * no generation state, so it is reusable outside the status endpoint.
 *
 * The phase → file mapping mirrors the prerequisites the generation runner
 * loads when a phase is skipped, so status and execution agree on what counts
 * as "already generated".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface CacheEntryStatus {
    cached: boolean;
    timestamp?: string;
}

export interface PhaseCacheStatus extends CacheEntryStatus {
    components?: Record<string, CacheEntryStatus>;
}

export interface CacheMetadataStats {
    components: number;
    categories: number;
    themes: number;
    domains: number;
    analyses: number;
    articles: number;
    projectName?: string;
    projectLanguage?: string;
}

/** Minimal wiki shape the status service reads from. */
export interface CacheStatusWiki {
    wikiData: { graph: any };
}

// ============================================================================
// Service
// ============================================================================

export class WikiCacheStatusService {
    /**
     * Per-phase cache status for a wiki output directory.
     * Phase 4 additionally carries per-component article status.
     */
    getPhaseStatuses(wiki: CacheStatusWiki, outputDir: string): Record<string, PhaseCacheStatus> {
        const resolved = path.resolve(outputDir);
        const cacheDir = path.join(resolved, '.wiki-cache');
        const phases: Record<string, PhaseCacheStatus> = {
            '1': checkCacheFileStatus(path.join(cacheDir, 'component-graph.json')),
            '2': checkCacheFileStatus(path.join(cacheDir, 'consolidated-graph.json')),
            '3': checkCacheFileStatus(path.join(cacheDir, 'analyses', '_metadata.json')),
            '4': checkCacheFileStatus(path.join(cacheDir, 'articles', '_metadata.json')),
        };

        try {
            const components: Record<string, CacheEntryStatus> = {};
            const articlesDir = path.join(cacheDir, 'articles');
            for (const mod of wiki.wikiData.graph.components) {
                components[mod.id] = getComponentArticleCacheStatus(articlesDir, mod.id, mod.domain);
            }
            phases['4'].components = components;
        } catch { /* graph may not be loaded */ }

        phases['5'] = checkWebsiteCacheStatus(resolved);

        return phases;
    }

    /** Counts and project labels shown alongside phase status. */
    collectMetadata(wiki: CacheStatusWiki, outputDir: string): CacheMetadataStats {
        return collectCacheMetadata(wiki, outputDir);
    }
}

/** Shared instance — the service is stateless. */
export const defaultCacheStatusService = new WikiCacheStatusService();

// ============================================================================
// Metadata Collection
// ============================================================================

export function collectCacheMetadata(
    wiki: CacheStatusWiki,
    outputDir: string,
): CacheMetadataStats {
    const stats: CacheMetadataStats = {
        components: 0,
        categories: 0,
        themes: 0,
        domains: 0,
        analyses: 0,
        articles: 0,
    };

    try {
        const graph = wiki.wikiData.graph;
        if (graph) {
            stats.components = Array.isArray(graph.components) ? graph.components.length : 0;
            stats.categories = Array.isArray(graph.categories) ? graph.categories.length : 0;
            stats.themes = Array.isArray(graph.themes) ? graph.themes.length : 0;
            stats.domains = Array.isArray(graph.domains) ? graph.domains.length : 0;
            if (graph.project) {
                if (graph.project.name) stats.projectName = graph.project.name;
                if (graph.project.language) stats.projectLanguage = graph.project.language;
            }
        }
    } catch { /* graph may not be loaded */ }

    try {
        const analysesDir = path.join(outputDir, '.wiki-cache', 'analyses');
        if (fs.existsSync(analysesDir) && fs.statSync(analysesDir).isDirectory()) {
            const graphComponentIds = new Set(
                Array.isArray(wiki.wikiData?.graph?.components)
                    ? wiki.wikiData.graph.components.map((m: any) => m.id as string)
                    : []
            );
            const analysisFiles = fs.readdirSync(analysesDir)
                .filter(f => f.endsWith('.json') && f !== '_metadata.json');

            // A non-empty graph means stale pre-consolidation analyses on disk
            // should not inflate the count.
            if (graphComponentIds.size > 0) {
                stats.analyses = analysisFiles
                    .filter(f => graphComponentIds.has(f.slice(0, -5))).length;
            } else {
                stats.analyses = analysisFiles.length;
            }
        }
    } catch { /* ignore */ }

    try {
        const articlesDir = path.join(outputDir, '.wiki-cache', 'articles');
        if (fs.existsSync(articlesDir) && fs.statSync(articlesDir).isDirectory()) {
            stats.articles = countArticleFiles(articlesDir);
        }
    } catch { /* ignore */ }

    return stats;
}

function countArticleFiles(dir: string): number {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('_')) {
                count++;
            } else if (entry.isDirectory()) {
                count += countArticleFiles(path.join(dir, entry.name));
            }
        }
    } catch { /* ignore */ }
    return count;
}

// ============================================================================
// Cache Status Helpers
// ============================================================================

export function checkCacheFileStatus(filePath: string): CacheEntryStatus {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            const timestamp = parsed?.metadata?.timestamp || parsed?.timestamp;
            if (timestamp) {
                return { cached: true, timestamp: new Date(timestamp).toISOString() };
            }
            return { cached: true };
        }
        return { cached: false };
    } catch {
        return { cached: false };
    }
}

export function checkWebsiteCacheStatus(outputDir: string): CacheEntryStatus {
    try {
        const indexPath = path.join(path.resolve(outputDir), 'index.html');
        if (fs.existsSync(indexPath)) {
            const stat = fs.statSync(indexPath);
            return { cached: true, timestamp: stat.mtime.toISOString() };
        }
        return { cached: false };
    } catch {
        return { cached: false };
    }
}

export function getComponentArticleCacheStatus(
    articlesDir: string,
    componentId: string,
    domainId?: string,
): CacheEntryStatus {
    // Articles moved under a domain folder at some point; check both layouts.
    const pathsToTry = domainId
        ? [path.join(articlesDir, domainId, `${componentId}.json`), path.join(articlesDir, `${componentId}.json`)]
        : [path.join(articlesDir, `${componentId}.json`)];

    for (const cachePath of pathsToTry) {
        try {
            if (fs.existsSync(cachePath)) {
                const content = fs.readFileSync(cachePath, 'utf-8');
                const parsed = JSON.parse(content);
                if (parsed.article && parsed.article.slug) {
                    const timestamp = parsed.timestamp ? new Date(parsed.timestamp).toISOString() : undefined;
                    return { cached: true, timestamp };
                }
            }
        } catch { /* skip */ }
    }

    return { cached: false };
}

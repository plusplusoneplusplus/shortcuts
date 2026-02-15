import * as fs from 'fs';
import * as path from 'path';
import { ComponentGraph, ThemeRequest, ThemeCoverageCheck, ThemeMeta, ThemeRelatedComponent } from '../types';

/**
 * Load module-graph.json from the wiki directory.
 * Returns null if wiki doesn't exist or has no module-graph.json.
 */
export function loadWikiGraph(wikiDir: string): ComponentGraph | null {
    const graphPath = path.join(wikiDir, 'module-graph.json');
    try {
        if (!fs.existsSync(graphPath)) {
            return null;
        }
        const content = fs.readFileSync(graphPath, 'utf-8');
        return JSON.parse(content) as ComponentGraph;
    } catch {
        // Malformed JSON or read error — treat as missing
        return null;
    }
}

/**
 * List existing theme areas from the wiki directory.
 * Reads module-graph.json themes[] array + scans themes/ directory.
 */
export function listThemeAreas(wikiDir: string): ThemeMeta[] {
    const graph = loadWikiGraph(wikiDir);
    const fromGraph = graph?.themes ?? [];

    // Scan themes/ directory for any theme areas not in graph
    const themesDir = path.join(wikiDir, 'themes');
    const fromFs = scanThemesDirectory(themesDir);

    // Merge: graph entries take precedence, add filesystem-only entries
    const seen = new Set(fromGraph.map(t => t.id));
    const merged = [...fromGraph];
    for (const fsTheme of fromFs) {
        if (!seen.has(fsTheme.id)) {
            merged.push(fsTheme);
        }
    }
    return merged;
}

/**
 * Check whether a theme is already covered in the wiki.
 *
 * Detection strategy (no AI needed):
 * 1. Exact match: theme.theme matches existing ThemeMeta.id
 * 2. Partial overlap: keyword matching against module names, purposes,
 *    and article content (TF-IDF style scoring)
 * 3. New: no significant overlap found
 *
 * Returns ThemeCoverageCheck with status and related modules.
 */
export function checkThemeCoverage(
    theme: ThemeRequest,
    graph: ComponentGraph,
    wikiDir: string
): ThemeCoverageCheck {
    // 1. Exact theme match
    const existingThemes = graph.themes ?? [];
    const exactTheme = existingThemes.find(t => t.id === theme.theme);
    if (exactTheme) {
        const articlePath = exactTheme.articles.length > 0
            ? exactTheme.articles[0].path
            : undefined;
        return {
            status: 'exists',
            existingArticlePath: articlePath,
            relatedComponents: exactTheme.involvedComponentIds.map(id => ({
                componentId: id,
                articlePath: resolveModuleArticlePath(id, wikiDir, graph),
                relevance: 'high' as const,
                matchReason: `Module belongs to existing theme "${exactTheme.id}"`
            }))
        };
    }

    // 2. Keyword matching against modules
    const keywords = tokenize(theme.theme, theme.description, theme.hints);
    const relatedComponents = scoreModules(keywords, graph, wikiDir);

    const highCount = relatedComponents.filter(m => m.relevance === 'high').length;
    if (highCount >= 2) {
        return {
            status: 'partial',
            relatedComponents
        };
    }

    if (relatedComponents.length > 0 && highCount >= 1) {
        return {
            status: 'partial',
            relatedComponents
        };
    }

    return {
        status: 'new',
        relatedComponents
    };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Tokenize theme name, description, and hints into normalized keywords.
 */
export function tokenize(
    themeName: string,
    description?: string,
    hints?: string[]
): string[] {
    const parts: string[] = [];

    // Split kebab-case / camelCase / spaces
    parts.push(...splitIntoWords(themeName));
    if (description) {
        parts.push(...splitIntoWords(description));
    }
    if (hints) {
        for (const h of hints) {
            parts.push(...splitIntoWords(h));
        }
    }

    // Normalize: lowercase, deduplicate, remove stopwords
    const normalized = parts.map(w => w.toLowerCase()).filter(w => w.length > 1 && !STOP_WORDS.has(w));
    return [...new Set(normalized)];
}

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
    'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'we', 'they'
]);

function splitIntoWords(text: string): string[] {
    return text
        // Split kebab-case
        .replace(/-/g, ' ')
        // Split camelCase
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Split on non-alphanumeric
        .split(/[^a-zA-Z0-9]+/)
        .filter(w => w.length > 0);
}

/**
 * Score each module in the graph against the keywords.
 * Returns modules with relevance >= low, sorted by relevance.
 */
function scoreModules(
    keywords: string[],
    graph: ComponentGraph,
    wikiDir: string
): ThemeRelatedComponent[] {
    if (keywords.length === 0) {
        return [];
    }

    const results: ThemeRelatedComponent[] = [];

    for (const mod of graph.components) {
        let score = 0;
        const reasons: string[] = [];

        // High: module name/id contains keyword
        const modWords = splitIntoWords(mod.id).map(w => w.toLowerCase());
        const nameWords = splitIntoWords(mod.name).map(w => w.toLowerCase());
        const allModWords = [...modWords, ...nameWords];

        for (const kw of keywords) {
            if (allModWords.includes(kw)) {
                score += 3;
                reasons.push(`name/id contains "${kw}"`);
            }
        }

        // Medium: purpose substring match
        const purposeLower = mod.purpose.toLowerCase();
        for (const kw of keywords) {
            if (purposeLower.includes(kw)) {
                score += 2;
                reasons.push(`purpose mentions "${kw}"`);
            }
        }

        // Low: article content grep
        const articlePath = resolveModuleArticlePath(mod.id, wikiDir, graph);
        if (articlePath) {
            const fullPath = path.join(wikiDir, articlePath);
            try {
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8').toLowerCase();
                    for (const kw of keywords) {
                        if (content.includes(kw)) {
                            score += 1;
                            reasons.push(`article mentions "${kw}"`);
                        }
                    }
                }
            } catch {
                // Skip unreadable articles
            }
        }

        if (score > 0) {
            const relevance: ThemeRelatedComponent['relevance'] =
                score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
            results.push({
                componentId: mod.id,
                articlePath: articlePath || '',
                relevance,
                matchReason: reasons.join('; ')
            });
        }
    }

    // Sort: high first, then medium, then low
    const order = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => order[a.relevance] - order[b.relevance]);

    return results;
}

/**
 * Resolve the expected article path for a module.
 */
function resolveModuleArticlePath(
    componentId: string,
    wikiDir: string,
    graph: ComponentGraph
): string {
    const mod = graph.components.find(m => m.id === componentId);

    // Hierarchical layout with domains
    if (mod?.domain && graph.domains) {
        const area = graph.domains.find(a => a.components.includes(componentId));
        if (area) {
            return `domains/${area.id}/modules/${componentId}.md`;
        }
    }

    // Flat layout
    return `modules/${componentId}.md`;
}

/**
 * Scan the themes/ directory to discover theme areas from the filesystem.
 */
function scanThemesDirectory(themesDir: string): ThemeMeta[] {
    if (!fs.existsSync(themesDir)) {
        return [];
    }

    const results: ThemeMeta[] = [];
    try {
        const entries = fs.readdirSync(themesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Theme area directory (e.g., themes/compaction/)
                const dirPath = path.join(themesDir, entry.name);
                const articles = scanThemeArticles(dirPath, entry.name);
                results.push({
                    id: entry.name,
                    title: entry.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: '',
                    layout: 'area',
                    articles,
                    involvedComponentIds: [],
                    directoryPath: `themes/${entry.name}`,
                    generatedAt: 0
                });
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                // Single-article theme (e.g., themes/auth.md)
                const id = entry.name.replace(/\.md$/, '');
                results.push({
                    id,
                    title: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: '',
                    layout: 'single',
                    articles: [{ slug: id, title: id, path: `themes/${entry.name}` }],
                    involvedComponentIds: [],
                    directoryPath: `themes`,
                    generatedAt: 0
                });
            }
        }
    } catch {
        // Ignore read errors
    }
    return results;
}

function scanThemeArticles(
    dirPath: string,
    themeId: string
): { slug: string; title: string; path: string }[] {
    const articles: { slug: string; title: string; path: string }[] = [];
    try {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const slug = file.replace(/\.md$/, '');
            articles.push({
                slug,
                title: slug === 'index' ? themeId : slug,
                path: `themes/${themeId}/${file}`
            });
        }
    } catch {
        // Ignore read errors
    }
    return articles;
}

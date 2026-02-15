import * as fs from 'fs';
import * as path from 'path';
import { ModuleGraph, TopicRequest, TopicCoverageCheck, TopicAreaMeta, TopicRelatedModule } from '../types';

/**
 * Load module-graph.json from the wiki directory.
 * Returns null if wiki doesn't exist or has no module-graph.json.
 */
export function loadWikiGraph(wikiDir: string): ModuleGraph | null {
    const graphPath = path.join(wikiDir, 'module-graph.json');
    try {
        if (!fs.existsSync(graphPath)) {
            return null;
        }
        const content = fs.readFileSync(graphPath, 'utf-8');
        return JSON.parse(content) as ModuleGraph;
    } catch {
        // Malformed JSON or read error — treat as missing
        return null;
    }
}

/**
 * List existing topic areas from the wiki directory.
 * Reads module-graph.json topics[] array + scans topics/ directory.
 */
export function listTopicAreas(wikiDir: string): TopicAreaMeta[] {
    const graph = loadWikiGraph(wikiDir);
    const fromGraph = graph?.topics ?? [];

    // Scan topics/ directory for any topic areas not in graph
    const topicsDir = path.join(wikiDir, 'topics');
    const fromFs = scanTopicsDirectory(topicsDir);

    // Merge: graph entries take precedence, add filesystem-only entries
    const seen = new Set(fromGraph.map(t => t.id));
    const merged = [...fromGraph];
    for (const fsTopic of fromFs) {
        if (!seen.has(fsTopic.id)) {
            merged.push(fsTopic);
        }
    }
    return merged;
}

/**
 * Check whether a topic is already covered in the wiki.
 *
 * Detection strategy (no AI needed):
 * 1. Exact match: topic.topic matches existing TopicAreaMeta.id
 * 2. Partial overlap: keyword matching against module names, purposes,
 *    and article content (TF-IDF style scoring)
 * 3. New: no significant overlap found
 *
 * Returns TopicCoverageCheck with status and related modules.
 */
export function checkTopicCoverage(
    topic: TopicRequest,
    graph: ModuleGraph,
    wikiDir: string
): TopicCoverageCheck {
    // 1. Exact topic match
    const existingTopics = graph.topics ?? [];
    const exactTopic = existingTopics.find(t => t.id === topic.topic);
    if (exactTopic) {
        const articlePath = exactTopic.articles.length > 0
            ? exactTopic.articles[0].path
            : undefined;
        return {
            status: 'exists',
            existingArticlePath: articlePath,
            relatedModules: exactTopic.involvedModuleIds.map(id => ({
                moduleId: id,
                articlePath: resolveModuleArticlePath(id, wikiDir, graph),
                relevance: 'high' as const,
                matchReason: `Module belongs to existing topic "${exactTopic.id}"`
            }))
        };
    }

    // 2. Keyword matching against modules
    const keywords = tokenize(topic.topic, topic.description, topic.hints);
    const relatedModules = scoreModules(keywords, graph, wikiDir);

    const highCount = relatedModules.filter(m => m.relevance === 'high').length;
    if (highCount >= 2) {
        return {
            status: 'partial',
            relatedModules
        };
    }

    if (relatedModules.length > 0 && highCount >= 1) {
        return {
            status: 'partial',
            relatedModules
        };
    }

    return {
        status: 'new',
        relatedModules
    };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Tokenize topic name, description, and hints into normalized keywords.
 */
export function tokenize(
    topicName: string,
    description?: string,
    hints?: string[]
): string[] {
    const parts: string[] = [];

    // Split kebab-case / camelCase / spaces
    parts.push(...splitIntoWords(topicName));
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
    graph: ModuleGraph,
    wikiDir: string
): TopicRelatedModule[] {
    if (keywords.length === 0) {
        return [];
    }

    const results: TopicRelatedModule[] = [];

    for (const mod of graph.modules) {
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
            const relevance: TopicRelatedModule['relevance'] =
                score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
            results.push({
                moduleId: mod.id,
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
    moduleId: string,
    wikiDir: string,
    graph: ModuleGraph
): string {
    const mod = graph.modules.find(m => m.id === moduleId);

    // Hierarchical layout with domains
    if (mod?.domain && graph.domains) {
        const area = graph.domains.find(a => a.modules.includes(moduleId));
        if (area) {
            return `domains/${area.id}/modules/${moduleId}.md`;
        }
    }

    // Flat layout
    return `modules/${moduleId}.md`;
}

/**
 * Scan the topics/ directory to discover topic areas from the filesystem.
 */
function scanTopicsDirectory(topicsDir: string): TopicAreaMeta[] {
    if (!fs.existsSync(topicsDir)) {
        return [];
    }

    const results: TopicAreaMeta[] = [];
    try {
        const entries = fs.readdirSync(topicsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Topic area directory (e.g., topics/compaction/)
                const dirPath = path.join(topicsDir, entry.name);
                const articles = scanTopicArticles(dirPath, entry.name);
                results.push({
                    id: entry.name,
                    title: entry.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: '',
                    layout: 'area',
                    articles,
                    involvedModuleIds: [],
                    directoryPath: `topics/${entry.name}`,
                    generatedAt: 0
                });
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                // Single-article topic (e.g., topics/auth.md)
                const id = entry.name.replace(/\.md$/, '');
                results.push({
                    id,
                    title: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    description: '',
                    layout: 'single',
                    articles: [{ slug: id, title: id, path: `topics/${entry.name}` }],
                    involvedModuleIds: [],
                    directoryPath: `topics`,
                    generatedAt: 0
                });
            }
        }
    } catch {
        // Ignore read errors
    }
    return results;
}

function scanTopicArticles(
    dirPath: string,
    topicId: string
): { slug: string; title: string; path: string }[] {
    const articles: { slug: string; title: string; path: string }[] = [];
    try {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const slug = file.replace(/\.md$/, '');
            articles.push({
                slug,
                title: slug === 'index' ? topicId : slug,
                path: `topics/${topicId}/${file}`
            });
        }
    } catch {
        // Ignore read errors
    }
    return articles;
}

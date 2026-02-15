/**
 * Context Builder
 *
 * TF-IDF indexing and context retrieval for the AI Q&A feature.
 * Builds an in-memory index of component articles on startup and
 * retrieves the most relevant components for a given question.
 *
 * No external dependencies — TF-IDF is ~100 lines.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph } from '../types';
import type { TopicAreaMeta } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * A document in the TF-IDF index.
 */
interface IndexedDocument {
    /** Document ID (component ID or topic:{topicId}:{slug}) */
    componentId: string;
    /** Display name */
    name: string;
    /** Category */
    category: string;
    /** Source type */
    source: 'component' | 'topic';
    /** Tokenized terms with their TF values */
    termFrequencies: Map<string, number>;
    /** Total number of terms in the document */
    termCount: number;
}

/**
 * Context retrieval result.
 */
export interface RetrievedContext {
    /** Component IDs selected as context */
    componentIds: string[];
    /** Markdown content for the selected components */
    contextText: string;
    /** Component graph summary for architectural context */
    graphSummary: string;
    /** Topic articles included in context */
    topicContexts: TopicContextEntry[];
}

/**
 * A topic article included in context retrieval results.
 */
export interface TopicContextEntry {
    /** Topic area ID */
    topicId: string;
    /** Article slug */
    slug: string;
    /** Article title (from metadata) */
    title: string;
    /** Article markdown content */
    content: string;
}

// ============================================================================
// Stop Words
// ============================================================================

/** Boost factor applied when a component name matches a query term */
const NAME_MATCH_BOOST = 1.5;

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
    'these', 'those', 'it', 'its', 'i', 'we', 'you', 'he', 'she', 'they',
    'me', 'us', 'him', 'her', 'them', 'my', 'our', 'your', 'his', 'their',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'not',
    'no', 'if', 'then', 'else', 'so', 'as', 'just', 'also', 'than',
    'very', 'too', 'more', 'most', 'each', 'every', 'all', 'any', 'some',
    'about', 'up', 'out', 'into', 'over', 'after', 'before', 'between',
]);

// ============================================================================
// ContextBuilder Class
// ============================================================================

/**
 * Builds a TF-IDF index from component articles and retrieves relevant context.
 */
export class ContextBuilder {
    private documents: IndexedDocument[] = [];
    private inverseDocFreq: Map<string, number> = new Map();
    private graph: ComponentGraph;
    private markdownData: Record<string, string>;
    private topicMarkdownData: Record<string, string>;

    constructor(graph: ComponentGraph, markdownData: Record<string, string>, topicMarkdownData?: Record<string, string>) {
        this.graph = graph;
        this.markdownData = markdownData;
        this.topicMarkdownData = topicMarkdownData || {};
        this.buildIndex();
    }

    /**
     * Retrieve the most relevant components for a question.
     *
     * @param question - The user's question
     * @param maxModules - Maximum number of components to return (default: 5)
     * @param maxTopics - Maximum number of topic articles to return (default: 3)
     * @returns Retrieved context with component IDs, markdown, and graph summary
     */
    retrieve(question: string, maxModules = 5, maxTopics = 3): RetrievedContext {
        const queryTerms = tokenize(question);

        // Score each document
        const componentScores: Array<{ componentId: string; score: number }> = [];
        const topicScores: Array<{ docId: string; score: number }> = [];

        for (const doc of this.documents) {
            let score = 0;
            for (const term of queryTerms) {
                const tf = doc.termFrequencies.get(term) || 0;
                const idf = this.inverseDocFreq.get(term) || 0;
                score += tf * idf;
            }

            // Boost if component name matches a query term
            const nameLower = doc.name.toLowerCase();
            for (const term of queryTerms) {
                if (nameLower.includes(term)) {
                    score *= NAME_MATCH_BOOST;
                }
            }

            if (score > 0) {
                if (doc.source === 'topic') {
                    topicScores.push({ docId: doc.componentId, score });
                } else {
                    componentScores.push({ componentId: doc.componentId, score });
                }
            }
        }

        // Sort by score descending
        componentScores.sort((a, b) => b.score - a.score);
        topicScores.sort((a, b) => b.score - a.score);

        // Select top-K components
        const topComponents = componentScores.slice(0, maxModules);
        const selectedIds = topComponents.map(s => s.componentId);

        // Expand with 1-hop dependency neighbors if we have room
        const expandedIds = new Set(selectedIds);
        if (selectedIds.length < maxModules) {
            for (const componentId of selectedIds) {
                const mod = this.graph.components.find(m => m.id === componentId);
                if (mod) {
                    for (const dep of mod.dependencies) {
                        if (expandedIds.size >= maxModules) break;
                        expandedIds.add(dep);
                    }
                    for (const dep of mod.dependents) {
                        if (expandedIds.size >= maxModules) break;
                        expandedIds.add(dep);
                    }
                }
            }
        }

        const finalIds = Array.from(expandedIds);

        // Build context text for components
        const contextParts: string[] = [];
        for (const componentId of finalIds) {
            const markdown = this.markdownData[componentId];
            if (markdown) {
                contextParts.push(`## Component: ${componentId}\n\n${markdown}`);
            }
        }

        // Select top-K topic articles
        const selectedTopics = topicScores.slice(0, maxTopics);
        const topicContexts: TopicContextEntry[] = [];
        const topics = this.graph.topics || [];

        for (const { docId } of selectedTopics) {
            // docId format: topic:{topicId}:{slug}
            const parts = docId.split(':');
            if (parts.length < 3) continue;
            const topicId = parts[1];
            const slug = parts.slice(2).join(':');

            const meta = topics.find(t => t.id === topicId);
            if (!meta) continue;

            const articleMeta = meta.articles.find(a => a.slug === slug);
            const content = this.topicMarkdownData[docId] || '';
            if (!content) continue;

            topicContexts.push({
                topicId,
                slug,
                title: articleMeta?.title || slug,
                content,
            });

            contextParts.push(`## Topic Article: ${articleMeta?.title || slug}\n\nSource: topics/${topicId}/${slug}.md\n\n${content}`);
        }

        // Build graph summary
        const graphSummary = this.buildGraphSummary();

        return {
            componentIds: finalIds,
            contextText: contextParts.join('\n\n---\n\n'),
            graphSummary,
            topicContexts,
        };
    }

    /**
     * Get the number of indexed documents.
     */
    get documentCount(): number {
        return this.documents.length;
    }

    /**
     * Get the vocabulary size.
     */
    get vocabularySize(): number {
        return this.inverseDocFreq.size;
    }

    // ========================================================================
    // Private: Index Building
    // ========================================================================

    private buildIndex(): void {
        // Index each component article
        for (const mod of this.graph.components) {
            const markdown = this.markdownData[mod.id] || '';
            // Combine component metadata with markdown content for better matching
            const text = [
                mod.name,
                mod.purpose,
                mod.category,
                mod.path,
                mod.keyFiles.join(' '),
                markdown,
            ].join(' ');

            const terms = tokenize(text);
            const termFrequencies = new Map<string, number>();

            for (const term of terms) {
                termFrequencies.set(term, (termFrequencies.get(term) || 0) + 1);
            }

            // Normalize term frequencies
            const termCount = terms.length;
            if (termCount > 0) {
                for (const [term, count] of termFrequencies) {
                    termFrequencies.set(term, count / termCount);
                }
            }

            this.documents.push({
                componentId: mod.id,
                name: mod.name,
                category: mod.category,
                source: 'component',
                termFrequencies,
                termCount,
            });
        }

        // Index topic articles
        const topics = this.graph.topics || [];
        for (const topic of topics) {
            for (const article of topic.articles) {
                const docId = `topic:${topic.id}:${article.slug}`;
                const markdown = this.topicMarkdownData[docId] || '';

                const involvedComponentNames = topic.involvedComponentIds
                    .map(id => this.graph.components.find(m => m.id === id)?.name || '')
                    .filter(Boolean);

                const text = [
                    topic.title,
                    topic.description,
                    article.title,
                    involvedComponentNames.join(' '),
                    markdown,
                ].join(' ');

                const terms = tokenize(text);
                const termFrequencies = new Map<string, number>();

                for (const term of terms) {
                    termFrequencies.set(term, (termFrequencies.get(term) || 0) + 1);
                }

                const termCount = terms.length;
                if (termCount > 0) {
                    for (const [term, count] of termFrequencies) {
                        termFrequencies.set(term, count / termCount);
                    }
                }

                this.documents.push({
                    componentId: docId,
                    name: article.title || topic.title,
                    category: 'topic',
                    source: 'topic',
                    termFrequencies,
                    termCount,
                });
            }
        }

        // Compute IDF for each term
        const N = this.documents.length;
        const docFreq = new Map<string, number>();

        for (const doc of this.documents) {
            for (const term of doc.termFrequencies.keys()) {
                docFreq.set(term, (docFreq.get(term) || 0) + 1);
            }
        }

        for (const [term, df] of docFreq) {
            // IDF = log(N / df) + 1 (smoothed)
            this.inverseDocFreq.set(term, Math.log(N / df) + 1);
        }
    }

    private buildGraphSummary(): string {
        const lines: string[] = [];
        lines.push(`Project: ${this.graph.project.name}`);
        lines.push(`Description: ${this.graph.project.description}`);
        lines.push(`Language: ${this.graph.project.language}`);
        lines.push(`Components: ${this.graph.components.length}`);
        lines.push('');
        lines.push('Component Graph:');

        for (const mod of this.graph.components) {
            const deps = mod.dependencies.length > 0
                ? ` → depends on: ${mod.dependencies.join(', ')}`
                : '';
            lines.push(`  - ${mod.name} (${mod.id}): ${mod.purpose}${deps}`);
        }

        return lines.join('\n');
    }
}

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Tokenize text into lowercase terms, removing stop words and short words.
 */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-_]/g, ' ')
        .split(/\s+/)
        .filter(word =>
            word.length >= 2 &&
            !STOP_WORDS.has(word)
        );
}

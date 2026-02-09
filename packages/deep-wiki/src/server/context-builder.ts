/**
 * Context Builder
 *
 * TF-IDF indexing and context retrieval for the AI Q&A feature.
 * Builds an in-memory index of module articles on startup and
 * retrieves the most relevant modules for a given question.
 *
 * No external dependencies — TF-IDF is ~100 lines.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModuleGraph } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * A document in the TF-IDF index.
 */
interface IndexedDocument {
    /** Module ID */
    moduleId: string;
    /** Module name */
    name: string;
    /** Module category */
    category: string;
    /** Tokenized terms with their TF values */
    termFrequencies: Map<string, number>;
    /** Total number of terms in the document */
    termCount: number;
}

/**
 * Context retrieval result.
 */
export interface RetrievedContext {
    /** Module IDs selected as context */
    moduleIds: string[];
    /** Markdown content for the selected modules */
    contextText: string;
    /** Module graph summary for architectural context */
    graphSummary: string;
}

// ============================================================================
// Stop Words
// ============================================================================

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
 * Builds a TF-IDF index from module articles and retrieves relevant context.
 */
export class ContextBuilder {
    private documents: IndexedDocument[] = [];
    private inverseDocFreq: Map<string, number> = new Map();
    private graph: ModuleGraph;
    private markdownData: Record<string, string>;

    constructor(graph: ModuleGraph, markdownData: Record<string, string>) {
        this.graph = graph;
        this.markdownData = markdownData;
        this.buildIndex();
    }

    /**
     * Retrieve the most relevant modules for a question.
     *
     * @param question - The user's question
     * @param maxModules - Maximum number of modules to return (default: 5)
     * @returns Retrieved context with module IDs, markdown, and graph summary
     */
    retrieve(question: string, maxModules = 5): RetrievedContext {
        const queryTerms = tokenize(question);

        // Score each document
        const scores: Array<{ moduleId: string; score: number }> = [];
        for (const doc of this.documents) {
            let score = 0;
            for (const term of queryTerms) {
                const tf = doc.termFrequencies.get(term) || 0;
                const idf = this.inverseDocFreq.get(term) || 0;
                score += tf * idf;
            }

            // Boost if module name matches a query term
            const nameLower = doc.name.toLowerCase();
            for (const term of queryTerms) {
                if (nameLower.includes(term)) {
                    score *= 1.5;
                }
            }

            if (score > 0) {
                scores.push({ moduleId: doc.moduleId, score });
            }
        }

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        // Select top-K
        const topModules = scores.slice(0, maxModules);
        const selectedIds = topModules.map(s => s.moduleId);

        // Expand with 1-hop dependency neighbors if we have room
        const expandedIds = new Set(selectedIds);
        if (selectedIds.length < maxModules) {
            for (const moduleId of selectedIds) {
                const mod = this.graph.modules.find(m => m.id === moduleId);
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

        // Build context text
        const contextParts: string[] = [];
        for (const moduleId of finalIds) {
            const markdown = this.markdownData[moduleId];
            if (markdown) {
                contextParts.push(`## Module: ${moduleId}\n\n${markdown}`);
            }
        }

        // Build graph summary
        const graphSummary = this.buildGraphSummary();

        return {
            moduleIds: finalIds,
            contextText: contextParts.join('\n\n---\n\n'),
            graphSummary,
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
        // Index each module article
        for (const mod of this.graph.modules) {
            const markdown = this.markdownData[mod.id] || '';
            // Combine module metadata with markdown content for better matching
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
                moduleId: mod.id,
                name: mod.name,
                category: mod.category,
                termFrequencies,
                termCount,
            });
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
        lines.push(`Modules: ${this.graph.modules.length}`);
        lines.push('');
        lines.push('Module Graph:');

        for (const mod of this.graph.modules) {
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

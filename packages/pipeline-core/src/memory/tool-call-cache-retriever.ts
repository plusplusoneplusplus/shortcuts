/**
 * Tool Call Cache Retriever
 *
 * Looks up cached explore answers using keyword-based Jaccard similarity
 * and returns them with staleness metadata derived from git hash comparison.
 * Pure algorithmic matching (no AI dependency) with configurable staleness
 * strategies.
 *
 * No VS Code dependencies — pure Node.js.
 */

import type {
    ToolCallCacheStore,
    ConsolidatedToolCallEntry,
    ConsolidatedIndexEntry,
    StalenessStrategy,
    ToolCallCacheLookupResult,
} from './tool-call-cache-types';

export interface ToolCallCacheRetrieverOptions {
    /** How to handle stale entries. Default: 'warn' */
    stalenessStrategy?: StalenessStrategy;
    /** Minimum Jaccard similarity score to consider a match. Default: 0.4 */
    similarityThreshold?: number;
}

export class ToolCallCacheRetriever {
    private readonly store: ToolCallCacheStore;
    private readonly stalenessStrategy: StalenessStrategy;
    private readonly similarityThreshold: number;
    private indexCache: ConsolidatedIndexEntry[] | null = null;

    private static readonly STOP_WORDS = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
        'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
        'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
        'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
        'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
        'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
        'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        'just', 'because', 'but', 'and', 'or', 'if', 'while', 'what', 'which',
        'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
        'myself', 'we', 'our', 'ours', 'you', 'your', 'yours', 'he', 'him',
        'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their',
    ]);

    constructor(store: ToolCallCacheStore, options?: ToolCallCacheRetrieverOptions) {
        this.store = store;
        this.stalenessStrategy = options?.stalenessStrategy ?? 'warn';
        this.similarityThreshold = options?.similarityThreshold ?? 0.4;
    }

    /**
     * Look up a cached answer for the given question.
     *
     * Uses Jaccard similarity on tokenized words to find the best match.
     * Returns null if no match meets the similarity threshold or if the
     * staleness strategy dictates skipping stale entries.
     */
    async lookup(question: string, currentGitHash?: string): Promise<ToolCallCacheLookupResult | null> {
        const entries = await this.loadIndex();
        if (entries.length === 0) return null;

        const questionTokens = ToolCallCacheRetriever.tokenize(question);

        let bestEntry: ConsolidatedIndexEntry | null = null;
        let bestScore = -1;

        for (const entry of entries) {
            const entryTokens = ToolCallCacheRetriever.tokenize(entry.question);
            const score = ToolCallCacheRetriever.jaccardSimilarity(questionTokens, entryTokens);
            if (score > bestScore) {
                bestScore = score;
                bestEntry = entry;
            }
        }

        if (bestEntry === null || bestScore < this.similarityThreshold) return null;

        // Staleness detection
        let stale: boolean;
        if (currentGitHash === undefined) {
            stale = false;
        } else if (bestEntry.gitHash === undefined) {
            stale = true;
        } else {
            stale = bestEntry.gitHash !== currentGitHash;
        }

        // Apply staleness strategy
        if (stale && this.stalenessStrategy === 'skip') return null;

        // Lazy-load answer only for the matched entry
        const answer = await this.store.readEntryAnswer(bestEntry.id) ?? '';

        // 'warn' and 'revalidate' (v1: same as warn) return the result
        return { entry: { ...bestEntry, answer }, score: bestScore, stale };
    }

    /**
     * Increment the hit count for a matched entry and persist.
     * Uses the single-entry write API to avoid rewriting all answer files.
     */
    async incrementHitCount(entryId: string): Promise<void> {
        const entries = await this.loadIndex();
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;
        entry.hitCount = (entry.hitCount ?? 0) + 1;
        // Load answer to produce a full entry for writeConsolidatedEntry
        const answer = await this.store.readEntryAnswer(entryId) ?? '';
        await this.store.writeConsolidatedEntry({ ...entry, answer });
        // In-memory index cache already updated (mutated in-place)
    }

    /** Force reload from store on next lookup. */
    invalidateCache(): void {
        this.indexCache = null;
    }

    /**
     * Tokenize a question string into a set of meaningful words.
     *
     * Steps:
     * 1. Lowercase the input
     * 2. Replace non-alphanumeric chars (except hyphens in identifiers) with spaces
     * 3. Split on whitespace
     * 4. Remove stop words
     * 5. Remove tokens shorter than 2 characters
     * 6. Return as a Set<string>
     */
    static tokenize(text: string): Set<string> {
        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2 && !ToolCallCacheRetriever.STOP_WORDS.has(w));
        return new Set(words);
    }

    /**
     * Compute Jaccard similarity coefficient between two token sets.
     *
     * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
     *
     * Returns 0 if both sets are empty.
     */
    static jaccardSimilarity(a: Set<string>, b: Set<string>): number {
        if (a.size === 0 && b.size === 0) return 0;

        let intersection = 0;
        const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
        for (const token of smaller) {
            if (larger.has(token)) {
                intersection++;
            }
        }

        const union = a.size + b.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    /**
     * Load consolidated index from the store, cached in-memory.
     * Only loads metadata (no answer payloads) for efficient scoring.
     */
    private async loadIndex(): Promise<ConsolidatedIndexEntry[]> {
        if (this.indexCache !== null) {
            return this.indexCache;
        }
        const data = await this.store.readConsolidatedIndex();
        this.indexCache = data ?? [];
        return this.indexCache;
    }
}

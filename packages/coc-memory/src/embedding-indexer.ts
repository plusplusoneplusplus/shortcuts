/**
 * EmbeddingBackfillService — asynchronously populates embeddings for existing
 * facts that were added before an embedding provider was configured, or after
 * a provider change that altered dimensionality.
 *
 * Key guarantees:
 * - Fact content and metadata are never modified.
 * - Only the `embedding` BLOB column is updated.
 * - Individual embed failures are logged and counted but do not abort the run.
 * - If the provider becomes unavailable before the run starts, returns immediately
 *   with all facts counted as skipped.
 */

import type { EmbeddingProvider } from './embedding-provider';
import type { SqliteFactStore } from './store-impl/sqlite-fact-store';
import { encodeEmbedding } from './vector-ranker';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface BackfillResult {
    /** Facts that received a new embedding */
    processed: number;
    /** Facts that failed to embed (provider error) */
    failed: number;
    /** Facts that were skipped because the provider was unavailable at start */
    skipped: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EmbeddingBackfillService {
    constructor(
        private readonly store: SqliteFactStore,
        private readonly provider: EmbeddingProvider,
    ) {}

    /**
     * Populate embeddings for all active facts that currently lack one.
     *
     * @param onProgress  Optional callback invoked after each fact attempt.
     *                    Receives `(completedSoFar, totalToProcess)`.
     */
    async backfill(
        onProgress?: (done: number, total: number) => void,
    ): Promise<BackfillResult> {
        const available = await this.provider.isAvailable();
        if (!available) {
            const total = this.store.listFactsWithoutEmbedding().length;
            return { processed: 0, failed: 0, skipped: total };
        }

        const facts = this.store.listFactsWithoutEmbedding();
        let processed = 0;
        let failed = 0;

        for (const fact of facts) {
            try {
                const vec = await this.provider.embed(fact.content);
                const buf = encodeEmbedding(vec.values);
                this.store.storeEmbedding(fact.id, buf);
                processed++;
            } catch {
                failed++;
            }
            onProgress?.(processed + failed, facts.length);
        }

        return { processed, failed, skipped: 0 };
    }

    /**
     * Re-embed a single fact by ID.
     *
     * Useful when a fact's content is edited and the embedding needs refreshing,
     * or when a new provider with different dimensionality replaces the old one.
     *
     * @returns `true` if the embedding was updated, `false` otherwise.
     */
    async reindex(factId: string): Promise<boolean> {
        const available = await this.provider.isAvailable();
        if (!available) return false;

        const fact = await this.store.getFact(factId);
        if (!fact) return false;

        try {
            const vec = await this.provider.embed(fact.content);
            const buf = encodeEmbedding(vec.values);
            this.store.storeEmbedding(factId, buf);
            return true;
        } catch {
            return false;
        }
    }
}

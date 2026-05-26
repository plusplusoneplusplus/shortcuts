/**
 * HybridSearchEngine — blends BM25 lexical and vector search results.
 *
 * ## Ranking policy (deterministic, AC-03)
 *
 *   combined = w_lex*bm25 + w_vec*vecSim + w_imp*importance + w_conf*confidence + w_rec*recency
 *
 * Weight sets:
 *   BM25-only  : { lex:0.70, vec:0.00, imp:0.20, conf:0.07, rec:0.03 }
 *   Vector-only: { lex:0.00, vec:0.70, imp:0.20, conf:0.07, rec:0.03 }
 *   Hybrid     : { lex:0.45, vec:0.35, imp:0.12, conf:0.05, rec:0.03 }
 *
 * ## Fallback
 * When the embedding provider is absent or throws during the search, the
 * engine silently degrades to BM25-only results — no exception is surfaced.
 */

import type { EmbeddingProvider } from './embedding-provider';
import type { MemoryFact, MemorySearchQuery, MemorySearchResult } from './types';
import type { SqliteFactStore } from './store-impl/sqlite-fact-store';
import { cosineSimilarity, decodeEmbedding, recencyScore } from './vector-ranker';

// ---------------------------------------------------------------------------
// Weight sets
// ---------------------------------------------------------------------------

interface WeightSet {
    lex: number;
    vec: number;
    imp: number;
    conf: number;
    rec: number;
}

const WEIGHTS_BM25_ONLY: WeightSet = { lex: 0.70, vec: 0.00, imp: 0.20, conf: 0.07, rec: 0.03 };
const WEIGHTS_VEC_ONLY: WeightSet = { lex: 0.00, vec: 0.70, imp: 0.20, conf: 0.07, rec: 0.03 };
const WEIGHTS_HYBRID: WeightSet = { lex: 0.45, vec: 0.35, imp: 0.12, conf: 0.05, rec: 0.03 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VectorHit {
    fact: MemoryFact;
    vectorScore: number;
}

interface MergedHit {
    fact: MemoryFact;
    bm25Score: number;
    vectorScore: number | null;
}

/** Options that can override per-call behaviour */
export interface HybridSearchOptions {
    /**
     * Override the engine's default embedding provider just for this search.
     * Pass `null` to force BM25-only for this call.
     */
    provider?: EmbeddingProvider | null;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Wraps a `SqliteFactStore` and an optional `EmbeddingProvider` to produce
 * blended BM25 + vector search results.
 *
 * Construct one engine per store (global or workspace-isolated).
 */
export class HybridSearchEngine {
    constructor(
        private readonly store: SqliteFactStore,
        private readonly defaultProvider: EmbeddingProvider | null = null,
    ) {}

    async search(
        query: MemorySearchQuery,
        opts?: HybridSearchOptions,
    ): Promise<MemorySearchResult[]> {
        const provider: EmbeddingProvider | null =
            opts?.provider !== undefined ? (opts.provider ?? null) : this.defaultProvider;
        const limit = query.limit ?? 10;

        // --- BM25 ---
        const bm25Results: MemorySearchResult[] = query.text
            ? await this.store.searchFacts(query)
            : [];

        // --- Vector ---
        let vectorHits: VectorHit[] = [];
        if (provider && query.text) {
            vectorHits = await this._vectorSearch(provider, query, limit * 2);
        }

        if (bm25Results.length === 0 && vectorHits.length === 0) {
            return [];
        }

        return this._blend(bm25Results, vectorHits, limit);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async _vectorSearch(
        provider: EmbeddingProvider,
        query: MemorySearchQuery,
        limit: number,
    ): Promise<VectorHit[]> {
        try {
            const available = await provider.isAvailable();
            if (!available) return [];

            const vec = await provider.embed(query.text);
            const queryValues = vec.values;

            const statuses = query.statuses ?? ['active'];
            const pairs = this.store.listEmbeddingPairs(
                query.scope,
                query.workspaceId,
                statuses,
            );

            const scored = pairs
                .map(({ id, embedding }) => {
                    const stored = decodeEmbedding(embedding);
                    const sim = cosineSimilarity(queryValues, stored);
                    return { id, sim };
                })
                .filter(x => x.sim > 0)
                .sort((a, b) => b.sim - a.sim)
                .slice(0, limit);

            const hits: VectorHit[] = [];
            for (const { id, sim } of scored) {
                const fact = await this.store.getFact(id);
                if (fact) hits.push({ fact, vectorScore: sim });
            }
            return hits;
        } catch {
            // Provider failed — silently degrade to BM25-only
            return [];
        }
    }

    private _blend(
        bm25Results: MemorySearchResult[],
        vectorHits: VectorHit[],
        limit: number,
    ): MemorySearchResult[] {
        const nowMs = Date.now(); // capture once so all recency scores within a search are deterministic
        const hasBm25 = bm25Results.length > 0;
        const hasVec = vectorHits.length > 0;
        const weights =
            hasBm25 && hasVec ? WEIGHTS_HYBRID
            : hasBm25 ? WEIGHTS_BM25_ONLY
            : WEIGHTS_VEC_ONLY;

        // Build union map: factId → MergedHit
        const map = new Map<string, MergedHit>();

        for (const r of bm25Results) {
            map.set(r.fact.id, {
                fact: r.fact,
                bm25Score: r.bm25Score,
                vectorScore: null,
            });
        }
        for (const { fact, vectorScore } of vectorHits) {
            const existing = map.get(fact.id);
            if (existing) {
                existing.vectorScore = vectorScore;
            } else {
                map.set(fact.id, { fact, bm25Score: 0, vectorScore });
            }
        }

        const results: MemorySearchResult[] = [];
        for (const { fact, bm25Score, vectorScore } of map.values()) {
            const rec = recencyScore(fact.createdAt, undefined, nowMs);
            const score =
                weights.lex * bm25Score +
                weights.vec * (vectorScore ?? 0) +
                weights.imp * fact.importance +
                weights.conf * fact.confidence +
                weights.rec * rec;

            results.push({ fact, score, bm25Score, vectorScore });
        }

        return results.sort((a, b) => b.score - a.score).slice(0, limit);
    }
}

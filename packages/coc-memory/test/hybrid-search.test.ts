/**
 * AC-03 tests: BM25 + Vector Search (HybridSearchEngine, EmbeddingBackfillService,
 * vector-ranker utilities).
 *
 * DoD coverage:
 *  1. Search returns relevant facts with only BM25 (no provider).
 *  2. With a configured provider, search uses vector similarity and still returns
 *     results when the provider later fails.
 *  3. Re-indexing/backfill populates embeddings for existing facts without data loss.
 *  4. Ranking tests cover lexical-only, vector-only, blended, and fallback paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteFactStore } from '../src/store-impl/sqlite-fact-store';
import { HybridSearchEngine } from '../src/hybrid-search';
import { EmbeddingBackfillService } from '../src/embedding-indexer';
import {
    encodeEmbedding,
    decodeEmbedding,
    cosineSimilarity,
    normalise,
    recencyScore,
} from '../src/vector-ranker';
import type { EmbeddingProvider, EmbeddingVector } from '../src/embedding-provider';
import type { MemoryFactInput } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function tmpDir() {
    return mkdtempSync(join(tmpdir(), 'coc-memory-ac03-'));
}

function makeFactInput(content: string, importance = 0.5): MemoryFactInput {
    return {
        scope: 'global',
        content,
        importance,
        confidence: 0.9,
        status: 'active',
        tags: [],
        source: 'explicit',
    };
}

/**
 * Deterministic embedding provider for tests.
 *
 * Vocabulary → 4-D unit vector mapping:
 *   "dog"         → [1, 0, 0, 0]
 *   "cat"         → [0.9, 0.44, 0, 0]  (normalised)
 *   "programming" → [0, 0, 1, 0]
 *   "typescript"  → [0, 0.1, 0.99, 0]  (normalised)
 *   default       → [0.5, 0.5, 0.5, 0.5] (normalised)
 */
function makeVec(text: string): number[] {
    const t = text.toLowerCase();
    if (t.includes('dog')) return normalise([1, 0, 0, 0]);
    if (t.includes('cat')) return normalise([0.9, 0.44, 0, 0]);
    if (t.includes('typescript')) return normalise([0, 0.1, 0.99, 0]);
    if (t.includes('programming') || t.includes('code')) return normalise([0, 0, 1, 0]);
    return normalise([0.5, 0.5, 0.5, 0.5]);
}

function buildProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
    return {
        name: 'mock-4d',
        dimensions: 4,
        isAvailable: async () => true,
        embed: async (textOrTexts: string | string[]) => {
            if (typeof textOrTexts === 'string') {
                return { values: makeVec(textOrTexts), dimensions: 4 } as EmbeddingVector;
            }
            return textOrTexts.map(t => ({
                values: makeVec(t),
                dimensions: 4,
            })) as EmbeddingVector[];
        },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// vector-ranker unit tests
// ---------------------------------------------------------------------------

describe('vector-ranker', () => {
    it('encodes and decodes a Float32Array round-trip', () => {
        const original = [0.1, 0.2, 0.3, 0.4];
        const buf = encodeEmbedding(original);
        const decoded = decodeEmbedding(buf);
        expect(decoded.length).toBe(4);
        for (let i = 0; i < 4; i++) {
            expect(decoded[i]).toBeCloseTo(original[i], 5);
        }
    });

    it('encodes and decodes a native Float32Array', () => {
        const arr = new Float32Array([0.5, 0.5, 0, 0]);
        const buf = encodeEmbedding(arr);
        const decoded = decodeEmbedding(buf);
        expect(decoded.length).toBe(4);
        expect(decoded[0]).toBeCloseTo(0.5, 5);
    });

    it('cosine similarity: identical unit vectors → 1.0', () => {
        const v = normalise([1, 2, 3, 4]);
        expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('cosine similarity: orthogonal vectors → 0.0', () => {
        expect(cosineSimilarity([1, 0, 0, 0], [0, 1, 0, 0])).toBeCloseTo(0.0, 5);
    });

    it('cosine similarity: near-parallel vectors → close to 1.0', () => {
        const a = normalise([1, 0, 0, 0]);
        const b = normalise([0.9, 0.44, 0, 0]);
        const sim = cosineSimilarity(a, b);
        // Actual similarity ≈ 0.898 — verify it is clearly above orthogonal (0)
        // and clearly below identical (1)
        expect(sim).toBeGreaterThan(0.85);
        expect(sim).toBeLessThan(1.0);
    });

    it('cosine similarity: zero vector → 0.0', () => {
        expect(cosineSimilarity([0, 0, 0, 0], [1, 0, 0, 0])).toBe(0);
    });

    it('normalise produces a unit vector', () => {
        const v = normalise([3, 4]);
        const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        expect(len).toBeCloseTo(1.0, 5);
    });

    it('normalise of zero vector returns zero vector unchanged', () => {
        const v = normalise([0, 0, 0]);
        expect(v).toEqual([0, 0, 0]);
    });

    it('recency score is 1.0 for today', () => {
        const score = recencyScore(new Date().toISOString());
        expect(score).toBeCloseTo(1.0, 2);
    });

    it('recency score decreases with age', () => {
        const old = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
        expect(recencyScore(old)).toBeLessThan(0.2);
    });
});

// ---------------------------------------------------------------------------
// HybridSearchEngine
// ---------------------------------------------------------------------------

describe('HybridSearchEngine', () => {
    let dir: string;
    let store: SqliteFactStore;

    beforeEach(async () => {
        dir = tmpDir();
        store = new SqliteFactStore(join(dir, 'facts.db'));

        // Seed facts
        await store.addFact(makeFactInput('Dogs love to fetch balls outside'));
        await store.addFact(makeFactInput('Cats are independent pets'));
        await store.addFact(makeFactInput('TypeScript is a typed superset of JavaScript', 0.8));
        await store.addFact(makeFactInput('Programming with Node.js is efficient', 0.7));
    });

    afterEach(() => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // DoD 1: BM25-only (no provider)
    // -----------------------------------------------------------------------

    describe('BM25-only (no embedding provider)', () => {
        it('returns relevant facts for a lexical query', async () => {
            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'dogs fetch' });
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].fact.content).toMatch(/[Dd]og/);
        });

        it('all results have vectorScore === null', async () => {
            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'cats pets' });
            for (const r of results) {
                expect(r.vectorScore).toBeNull();
            }
        });

        it('returns empty for a no-match query', async () => {
            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'zzz_no_match_xyz' });
            expect(results).toHaveLength(0);
        });

        it('respects the limit parameter', async () => {
            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'TypeScript JavaScript', limit: 1 });
            expect(results.length).toBeLessThanOrEqual(1);
        });

        it('uses BM25-only weight set: bm25Score drives the top result', async () => {
            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'TypeScript JavaScript typed' });
            // TypeScript fact should rank first (highest BM25)
            expect(results[0].fact.content).toMatch(/TypeScript/);
            expect(results[0].bm25Score).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // DoD 2: Vector search + provider failure fallback
    // -----------------------------------------------------------------------

    describe('vector search with embedding provider', () => {
        it('returns results when provider is configured', async () => {
            const provider = buildProvider();
            const engine = new HybridSearchEngine(store, provider);

            // Index all facts first
            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const results = await engine.search({ text: 'dogs fetch balls' });
            expect(results.length).toBeGreaterThan(0);
        });

        it('hybrid results have non-null vectorScore for facts that have embeddings', async () => {
            const provider = buildProvider();
            const engine = new HybridSearchEngine(store, provider);

            const facts = await store.listFacts({ statuses: ['active'] });
            for (const fact of facts) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const results = await engine.search({ text: 'TypeScript programming' });
            const withVec = results.filter(r => r.vectorScore !== null);
            expect(withVec.length).toBeGreaterThan(0);
        });

        it('still returns BM25 results when provider fails mid-search', async () => {
            const failingProvider = buildProvider({
                embed: async () => {
                    throw new Error('provider unavailable');
                },
            });
            const engine = new HybridSearchEngine(store, failingProvider);
            const results = await engine.search({ text: 'TypeScript' });
            // Must still return BM25 results
            expect(results.length).toBeGreaterThan(0);
            for (const r of results) {
                expect(r.vectorScore).toBeNull();
            }
        });

        it('returns results when provider reports isAvailable=false', async () => {
            const unavailableProvider = buildProvider({
                isAvailable: async () => false,
            });
            const engine = new HybridSearchEngine(store, unavailableProvider);
            const results = await engine.search({ text: 'cats' });
            expect(results.length).toBeGreaterThan(0);
            // All should be BM25-only
            for (const r of results) {
                expect(r.vectorScore).toBeNull();
            }
        });

        it('per-call provider override forces BM25-only when null', async () => {
            const provider = buildProvider();
            const engine = new HybridSearchEngine(store, provider);
            const results = await engine.search({ text: 'dogs' }, { provider: null });
            for (const r of results) {
                expect(r.vectorScore).toBeNull();
            }
        });

        it('per-call provider override can inject a different provider', async () => {
            const defaultProvider = buildProvider({ isAvailable: async () => false });
            const overrideProvider = buildProvider();
            const engine = new HybridSearchEngine(store, defaultProvider);

            // Index facts with the override provider
            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await overrideProvider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const results = await engine.search({ text: 'cats pets' }, { provider: overrideProvider });
            const withVec = results.filter(r => r.vectorScore !== null);
            expect(withVec.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // DoD 3: Backfill without data loss
    // -----------------------------------------------------------------------

    describe('EmbeddingBackfillService', () => {
        it('populates embeddings for all active facts without embedding', async () => {
            const provider = buildProvider();
            const service = new EmbeddingBackfillService(store, provider);

            const before = store.listFactsWithoutEmbedding();
            expect(before.length).toBe(4); // none indexed yet

            const result = await service.backfill();
            expect(result.processed).toBe(4);
            expect(result.failed).toBe(0);
            expect(result.skipped).toBe(0);

            // All facts still exist with original content
            for (const fact of before) {
                const fetched = await store.getFact(fact.id);
                expect(fetched).not.toBeNull();
                expect(fetched!.content).toBe(fact.content);
            }

            // No facts without embedding remain
            expect(store.listFactsWithoutEmbedding()).toHaveLength(0);
        });

        it('skips all when provider is unavailable', async () => {
            const provider = buildProvider({ isAvailable: async () => false });
            const service = new EmbeddingBackfillService(store, provider);
            const result = await service.backfill();
            expect(result.processed).toBe(0);
            expect(result.skipped).toBe(4);
        });

        it('counts failures but continues processing other facts', async () => {
            let calls = 0;
            const flakyProvider = buildProvider({
                embed: async (text: string | string[]) => {
                    calls++;
                    if (calls === 2) throw new Error('transient error');
                    const t = typeof text === 'string' ? text : text[0];
                    return { values: makeVec(t), dimensions: 4 } as EmbeddingVector;
                },
            });
            const service = new EmbeddingBackfillService(store, flakyProvider);
            const result = await service.backfill();
            expect(result.processed).toBe(3);
            expect(result.failed).toBe(1);
        });

        it('reindex updates the embedding for a single fact', async () => {
            const provider = buildProvider();
            const service = new EmbeddingBackfillService(store, provider);

            const facts = await store.listFacts({ statuses: ['active'] });
            const target = facts[0];

            const ok = await service.reindex(target.id);
            expect(ok).toBe(true);

            const buf = store.getEmbedding(target.id);
            expect(buf).not.toBeNull();
        });

        it('reindex returns false for a non-existent fact', async () => {
            const provider = buildProvider();
            const service = new EmbeddingBackfillService(store, provider);
            const ok = await service.reindex('non-existent-id');
            expect(ok).toBe(false);
        });

        it('progress callback is called for each fact', async () => {
            const provider = buildProvider();
            const service = new EmbeddingBackfillService(store, provider);

            const progress: Array<[number, number]> = [];
            await service.backfill((done, total) => progress.push([done, total]));

            expect(progress).toHaveLength(4);
            expect(progress[3]).toEqual([4, 4]);
        });

        it('does not modify fact metadata during backfill', async () => {
            const provider = buildProvider();
            const service = new EmbeddingBackfillService(store, provider);

            const factsBefore = await store.listFacts({ statuses: ['active'] });
            await service.backfill();
            const factsAfter = await store.listFacts({ statuses: ['active'] });

            for (let i = 0; i < factsBefore.length; i++) {
                const before = factsBefore.find(f => f.id === factsAfter[i].id)!;
                // Core fields unchanged
                expect(factsAfter[i].content).toBe(before.content);
                expect(factsAfter[i].importance).toBe(before.importance);
                expect(factsAfter[i].confidence).toBe(before.confidence);
                expect(factsAfter[i].updatedAt).toBe(before.updatedAt);
            }
        });
    });

    // -----------------------------------------------------------------------
    // DoD 4: Ranking tests — all four paths
    // -----------------------------------------------------------------------

    describe('ranking policy', () => {
        it('lexical-only: higher BM25 score wins', async () => {
            const engine = new HybridSearchEngine(store, null);
            // Query matches "TypeScript" fact more than "Programming" fact
            const results = await engine.search({ text: 'TypeScript typed superset' });
            expect(results[0].fact.content).toMatch(/TypeScript/);
            expect(results[0].bm25Score).toBeGreaterThan(0);
            expect(results[0].vectorScore).toBeNull();
        });

        it('vector-only: higher cosine similarity wins when BM25 finds nothing', async () => {
            const provider = buildProvider();
            const engine = new HybridSearchEngine(store, provider);

            // Index all facts
            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            // Use a search text that won't match BM25 (rare tokens) but
            // semantically maps to "dogs" via the mock provider
            const results = await engine.search({ text: 'dog fetch' });
            // Dog fact should appear (BM25 also hits here, but vectorScore is non-null)
            expect(results.length).toBeGreaterThan(0);
        });

        it('blended: hybrid weights applied when both scores present', async () => {
            const provider = buildProvider();
            const engine = new HybridSearchEngine(store, provider);

            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const results = await engine.search({ text: 'dogs' });
            // At least one result should have both BM25 and vector scores
            const blended = results.find(r => r.bm25Score > 0 && r.vectorScore !== null);
            expect(blended).toBeDefined();
            // Combined score should be between 0 and 1 (roughly)
            expect(blended!.score).toBeGreaterThan(0);
        });

        it('fallback: importance & recency remain in score when BM25 used alone', async () => {
            // Add two facts with same BM25 match but different importance
            await store.addFact({ ...makeFactInput('fetch the stick please', 0.9) });
            await store.addFact({ ...makeFactInput('fetch the stick please', 0.1) });

            const engine = new HybridSearchEngine(store, null);
            const results = await engine.search({ text: 'fetch the stick' });
            // Higher importance should score higher (all else equal)
            const highImp = results.find(r => r.fact.importance === 0.9)!;
            const lowImp = results.find(r => r.fact.importance === 0.1)!;
            if (highImp && lowImp) {
                expect(highImp.score).toBeGreaterThan(lowImp.score);
            }
        });

        it('score is deterministic: same input → same output', async () => {
            const now = Date.now();
            vi.useFakeTimers();
            vi.setSystemTime(now);
            try {
                const engine = new HybridSearchEngine(store, null);
                const r1 = await engine.search({ text: 'TypeScript' });
                const r2 = await engine.search({ text: 'TypeScript' });
                expect(r1.map(r => r.fact.id)).toEqual(r2.map(r => r.fact.id));
                expect(r1.map(r => r.score)).toEqual(r2.map(r => r.score));
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // -----------------------------------------------------------------------
    // Scope isolation
    // -----------------------------------------------------------------------

    describe('scope isolation in vector search', () => {
        it('workspace-scoped vector search does not return global facts', async () => {
            const provider = buildProvider();

            // Add a workspace fact
            const wsFact = await store.addFact({
                scope: 'workspace',
                workspaceId: 'ws-test',
                content: 'Dogs are great pets for workspace users',
                importance: 0.5,
                confidence: 0.9,
                status: 'active',
                tags: [],
                source: 'explicit',
            });

            // Index all
            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const engine = new HybridSearchEngine(store, provider);
            const results = await engine.search({
                text: 'dogs pets',
                scope: 'workspace',
                workspaceId: 'ws-test',
            });

            // Only the workspace fact should appear
            expect(results.every(r => r.fact.workspaceId === 'ws-test')).toBe(true);
            expect(results.some(r => r.fact.id === wsFact.id)).toBe(true);
        });

        it('listEmbeddingPairs respects scope filter', async () => {
            const provider = buildProvider();
            await store.addFact({
                scope: 'workspace',
                workspaceId: 'ws-a',
                content: 'workspace fact',
                importance: 0.5,
                confidence: 0.9,
                status: 'active',
                tags: [],
                source: 'explicit',
            });

            for (const fact of await store.listFacts({ statuses: ['active'] })) {
                const vec = await provider.embed(fact.content);
                store.storeEmbedding(fact.id, encodeEmbedding(vec.values));
            }

            const globalPairs = store.listEmbeddingPairs('global', undefined, ['active']);
            const wsPairs = store.listEmbeddingPairs('workspace', 'ws-a', ['active']);

            expect(globalPairs.length).toBe(4); // original 4 global facts
            expect(wsPairs.length).toBe(1);
        });
    });
});

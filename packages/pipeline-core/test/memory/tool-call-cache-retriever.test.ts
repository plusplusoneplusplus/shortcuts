import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCallCacheStore, ConsolidatedToolCallEntry } from '../../src/memory/tool-call-cache-types';
import { ToolCallCacheRetriever } from '../../src/memory/tool-call-cache-retriever';

function makeConsolidatedEntry(
    id: string,
    question: string,
    answer: string,
    gitHash?: string,
): ConsolidatedToolCallEntry {
    return {
        id,
        question,
        answer,
        topics: ['general'],
        gitHash,
        toolSources: ['grep'],
        createdAt: '2025-01-01T00:00:00Z',
        hitCount: 1,
    };
}

function createMockStore(entries: ConsolidatedToolCallEntry[] = []): ToolCallCacheStore {
    const indexEntries = entries.map(({ answer: _, ...rest }) => rest);
    return {
        listRaw: vi.fn().mockResolvedValue([]),
        readRaw: vi.fn().mockResolvedValue(undefined),
        writeRaw: vi.fn().mockResolvedValue(''),
        deleteRaw: vi.fn().mockResolvedValue(true),
        readConsolidated: vi.fn().mockResolvedValue(entries),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readConsolidatedIndex: vi.fn().mockResolvedValue(indexEntries),
        readEntryAnswer: vi.fn().mockImplementation(async (id: string) => {
            const entry = entries.find(e => e.id === id);
            return entry?.answer;
        }),
        writeConsolidatedEntry: vi.fn().mockResolvedValue(undefined),
        deleteConsolidatedEntry: vi.fn().mockResolvedValue(true),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, consolidatedCount: 0 }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, consolidatedCount: 0, lastAggregation: null }),
        clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolCallCacheStore;
}

describe('ToolCallCacheRetriever', () => {
    describe('tokenize', () => {
        it('strips stop words', () => {
            const tokens = ToolCallCacheRetriever.tokenize('what is the structure of the auth module');
            expect(tokens).toEqual(new Set(['structure', 'auth', 'module']));
        });

        it('preserves hyphenated identifiers', () => {
            const tokens = ToolCallCacheRetriever.tokenize('branch-service git-diff');
            expect(tokens).toEqual(new Set(['branch-service', 'git-diff']));
        });

        it('lowercases input', () => {
            const tokens = ToolCallCacheRetriever.tokenize('README FileStore');
            expect(tokens).toEqual(new Set(['readme', 'filestore']));
        });

        it('removes short tokens', () => {
            const tokens = ToolCallCacheRetriever.tokenize('a b cd ef');
            expect(tokens).toEqual(new Set(['cd', 'ef']));
        });

        it('handles empty string', () => {
            expect(ToolCallCacheRetriever.tokenize('')).toEqual(new Set());
        });
    });

    describe('jaccardSimilarity', () => {
        it('returns 0 for empty sets', () => {
            expect(ToolCallCacheRetriever.jaccardSimilarity(new Set(), new Set())).toBe(0);
        });

        it('returns 1.0 for identical sets', () => {
            const s = new Set(['auth', 'module', 'structure']);
            expect(ToolCallCacheRetriever.jaccardSimilarity(s, s)).toBe(1.0);
        });

        it('returns 0 for disjoint sets', () => {
            const a = new Set(['auth', 'module']);
            const b = new Set(['testing', 'vitest']);
            expect(ToolCallCacheRetriever.jaccardSimilarity(a, b)).toBe(0);
        });

        it('computes correct partial overlap', () => {
            const a = new Set(['files', 'utils', 'directory']);
            const b = new Set(['list', 'files', 'utils', 'folder']);
            // intersection: {files, utils} = 2, union = 5
            expect(ToolCallCacheRetriever.jaccardSimilarity(a, b)).toBeCloseTo(2 / 5);
        });
    });

    describe('lookup', () => {
        describe('matching', () => {
            it('returns high score for exact match', async () => {
                const entry = makeConsolidatedEntry('e1', 'what files are in src/utils', 'found 5 files', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('what files are in src/utils');
                expect(result).not.toBeNull();
                expect(result!.score).toBeGreaterThanOrEqual(0.9);
                expect(result!.entry.id).toBe('e1');
            });

            it('returns match for similar question above threshold', async () => {
                const entry = makeConsolidatedEntry('e1', 'what files are in src/utils', 'found 5 files', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('list the files in the utils directory');
                expect(result).not.toBeNull();
                expect(result!.score).toBeGreaterThanOrEqual(0.4);
                expect(result!.entry.id).toBe('e1');
            });

            it('returns null for dissimilar question', async () => {
                const entry = makeConsolidatedEntry('e1', 'what files are in src/utils', 'found 5 files', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('how does authentication work');
                expect(result).toBeNull();
            });

            it('returns best match among multiple entries', async () => {
                const entries = [
                    makeConsolidatedEntry('e1', 'how does auth work', 'JWT tokens', 'abc'),
                    makeConsolidatedEntry('e2', 'what files are in utils', 'found files', 'abc'),
                    makeConsolidatedEntry('e3', 'describe the testing strategy', 'vitest based', 'abc'),
                ];
                const store = createMockStore(entries);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('list files in the utils folder');
                expect(result).not.toBeNull();
                expect(result!.entry.id).toBe('e2');
            });

            it('returns null for empty consolidated', async () => {
                const store = createMockStore([]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('anything');
                expect(result).toBeNull();
            });
        });

        describe('staleness', () => {
            it('marks entry as not stale when hashes match', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('auth module structure', 'abc123');
                expect(result).not.toBeNull();
                expect(result!.stale).toBe(false);
            });

            it('marks entry as stale when hashes differ (strategy=warn)', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store, { stalenessStrategy: 'warn' });

                const result = await retriever.lookup('auth module structure', 'def456');
                expect(result).not.toBeNull();
                expect(result!.stale).toBe(true);
            });

            it('returns null for stale entry with strategy=skip', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store, { stalenessStrategy: 'skip' });

                const result = await retriever.lookup('auth module structure', 'def456');
                expect(result).toBeNull();
            });

            it('treats entry as not stale when currentGitHash is undefined', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('auth module structure');
                expect(result).not.toBeNull();
                expect(result!.stale).toBe(false);
            });

            it('treats entry as stale when entry has no gitHash', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store);

                const result = await retriever.lookup('auth module structure', 'abc123');
                expect(result).not.toBeNull();
                expect(result!.stale).toBe(true);
            });

            it('revalidate strategy behaves as warn in v1', async () => {
                const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc123');
                const store = createMockStore([entry]);
                const retriever = new ToolCallCacheRetriever(store, { stalenessStrategy: 'revalidate' });

                const result = await retriever.lookup('auth module structure', 'def456');
                expect(result).not.toBeNull();
                expect(result!.stale).toBe(true);
            });
        });
    });

    describe('incrementHitCount', () => {
        it('increments hit count and persists via writeConsolidatedEntry', async () => {
            const entry = makeConsolidatedEntry('e1', 'auth module', 'JWT', 'abc');
            entry.hitCount = 3;
            const store = createMockStore([entry]);
            const retriever = new ToolCallCacheRetriever(store);

            // Force load cache
            await retriever.lookup('auth module');

            await retriever.incrementHitCount('e1');

            expect(store.writeConsolidatedEntry).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'e1', hitCount: 4, answer: 'JWT' }),
            );
        });

        it('does nothing for unknown entry id', async () => {
            const store = createMockStore([makeConsolidatedEntry('e1', 'q', 'a', 'h')]);
            const retriever = new ToolCallCacheRetriever(store);

            await retriever.incrementHitCount('nonexistent');

            expect(store.writeConsolidatedEntry).not.toHaveBeenCalled();
        });
    });

    describe('caching', () => {
        it('caches index data across lookups', async () => {
            const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc');
            const store = createMockStore([entry]);
            const retriever = new ToolCallCacheRetriever(store);

            await retriever.lookup('auth module structure');
            await retriever.lookup('auth module structure');

            expect(store.readConsolidatedIndex).toHaveBeenCalledTimes(1);
        });

        it('invalidateCache forces reload', async () => {
            const entry = makeConsolidatedEntry('e1', 'auth module structure', 'uses JWT', 'abc');
            const store = createMockStore([entry]);
            const retriever = new ToolCallCacheRetriever(store);

            await retriever.lookup('auth module structure');
            retriever.invalidateCache();
            await retriever.lookup('auth module structure');

            expect(store.readConsolidatedIndex).toHaveBeenCalledTimes(2);
        });
    });
});

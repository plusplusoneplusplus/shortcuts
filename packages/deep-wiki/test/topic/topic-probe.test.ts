import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopicRequest, ModuleGraph, ModuleInfo, TopicSeed } from '../../src/types';
import type { TopicProbeResult, ProbeFoundModule } from '../../src/discovery/iterative/types';

// Mock the probe-session module before importing topic-probe
vi.mock('../../src/discovery/iterative/probe-session', () => ({
    runTopicProbe: vi.fn(),
}));

import { buildTopicSeed, runSingleTopicProbe, type EnrichedProbeResult, type TopicProbeOptions } from '../../src/topic/topic-probe';
import { runTopicProbe } from '../../src/discovery/iterative/probe-session';

const mockedRunTopicProbe = vi.mocked(runTopicProbe);

// ─── Helpers ───────────────────────────────────────────────────────────

function makeModule(overrides: Partial<ProbeFoundModule> = {}): ProbeFoundModule {
    return {
        id: 'mod-a',
        name: 'Module A',
        path: 'src/mod-a',
        purpose: 'Does A things',
        keyFiles: ['src/mod-a/index.ts'],
        evidence: 'found references',
        ...overrides,
    };
}

function makeGraphModule(overrides: Partial<ModuleInfo> = {}): ModuleInfo {
    return {
        id: 'mod-a',
        name: 'Module A',
        path: 'src/mod-a',
        purpose: 'Does A things',
        keyFiles: ['src/mod-a/index.ts'],
        dependencies: [],
        dependents: [],
        complexity: 'low',
        category: 'core',
        ...overrides,
    };
}

function makeGraph(modules: ModuleInfo[]): ModuleGraph {
    return {
        project: { name: 'test', description: 'test project', mainLanguage: 'typescript', frameworks: [], buildTools: [] },
        modules,
        categories: [],
        architectureNotes: '',
    };
}

function makeProbeResult(overrides: Partial<TopicProbeResult> = {}): TopicProbeResult {
    return {
        topic: 'compaction',
        foundModules: [],
        discoveredTopics: [],
        dependencies: [],
        confidence: 0.8,
        ...overrides,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('topic-probe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── buildTopicSeed ──────────────────────────────────────────────

    describe('buildTopicSeed', () => {
        it('converts a full TopicRequest to TopicSeed', () => {
            const req: TopicRequest = {
                topic: 'compaction',
                description: 'Log compaction in storage engine',
                hints: ['compact', 'sstable', 'merge'],
            };
            const seed = buildTopicSeed(req);

            expect(seed.topic).toBe('compaction');
            expect(seed.description).toBe('Log compaction in storage engine');
            expect(seed.hints).toEqual(['compact', 'sstable', 'merge']);
        });

        it('generates description when not provided', () => {
            const req: TopicRequest = { topic: 'wal-recovery' };
            const seed = buildTopicSeed(req);

            expect(seed.description).toBe('Discover code related to wal recovery');
        });

        it('generates hints when not provided', () => {
            const req: TopicRequest = { topic: 'compaction' };
            const seed = buildTopicSeed(req);

            expect(seed.hints).toContain('compaction');
            expect(seed.hints.length).toBeGreaterThan(1);
        });

        it('generates hints from multi-word topic', () => {
            const req: TopicRequest = { topic: 'wal-recovery' };
            const seed = buildTopicSeed(req);

            expect(seed.hints).toContain('wal');
            expect(seed.hints).toContain('recovery');
            expect(seed.hints).toContain('wal-recovery');
        });

        it('uses provided hints and ignores generation', () => {
            const req: TopicRequest = {
                topic: 'compaction',
                hints: ['manual-hint'],
            };
            const seed = buildTopicSeed(req);

            expect(seed.hints).toEqual(['manual-hint']);
        });

        it('treats empty hints array as needing generation', () => {
            const req: TopicRequest = {
                topic: 'compaction',
                hints: [],
            };
            const seed = buildTopicSeed(req);

            expect(seed.hints.length).toBeGreaterThan(0);
            expect(seed.hints).toContain('compaction');
        });
    });

    // ── Hint generation ─────────────────────────────────────────────

    describe('hint generation', () => {
        it('adds -ing suffix variation', () => {
            const seed = buildTopicSeed({ topic: 'compact' });
            expect(seed.hints).toContain('compacting');
        });

        it('adds -or and -er suffix variations', () => {
            const seed = buildTopicSeed({ topic: 'compact' });
            expect(seed.hints).toContain('compactor');
            expect(seed.hints).toContain('compacter');
        });

        it('handles -e ending for -ing form', () => {
            const seed = buildTopicSeed({ topic: 'cache' });
            expect(seed.hints).toContain('caching');
        });

        it('skips very short parts for suffix generation', () => {
            const seed = buildTopicSeed({ topic: 'io-stream' });
            // "io" is too short (< 3 chars) — shouldn't get suffixed
            expect(seed.hints).toContain('io');
            expect(seed.hints).not.toContain('ioing');
        });
    });

    // ── runSingleTopicProbe ─────────────────────────────────────────

    describe('runSingleTopicProbe', () => {
        it('calls runTopicProbe with correct arguments', async () => {
            const probeResult = makeProbeResult();
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const options: TopicProbeOptions = {
                repoPath: '/repo',
                topic: { topic: 'compaction', description: 'desc', hints: ['compact'] },
                model: 'gpt-4',
                timeout: 60,
            };

            await runSingleTopicProbe(options);

            expect(mockedRunTopicProbe).toHaveBeenCalledOnce();
            const [repoPath, seed, opts] = mockedRunTopicProbe.mock.calls[0];
            expect(repoPath).toBe('/repo');
            expect(seed.topic).toBe('compaction');
            expect(seed.description).toBe('desc');
            expect(seed.hints).toEqual(['compact']);
            expect(opts).toEqual({ model: 'gpt-4', timeout: 60 });
        });

        it('uses default timeout of 120 when not specified', async () => {
            mockedRunTopicProbe.mockResolvedValue(makeProbeResult());

            await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
            });

            const [, , opts] = mockedRunTopicProbe.mock.calls[0];
            expect(opts.timeout).toBe(120);
        });

        it('returns enriched result with all modules as new when no graph', async () => {
            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'mod-a', keyFiles: ['a.ts'] }),
                    makeModule({ id: 'mod-b', keyFiles: ['b.ts'] }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
            });

            expect(result.existingModuleIds).toEqual([]);
            expect(result.newModuleIds).toEqual(['mod-a', 'mod-b']);
            expect(result.allKeyFiles).toEqual(['a.ts', 'b.ts']);
        });
    });

    // ── Cross-referencing ───────────────────────────────────────────

    describe('cross-referencing with existing graph', () => {
        it('partitions modules into existing and new', async () => {
            const graph = makeGraph([
                makeGraphModule({ id: 'mod-a', path: 'src/mod-a' }),
                makeGraphModule({ id: 'mod-b', path: 'src/mod-b' }),
                makeGraphModule({ id: 'mod-c', path: 'src/mod-c' }),
            ]);

            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'mod-a', path: 'src/mod-a' }),
                    makeModule({ id: 'mod-b', path: 'src/mod-b' }),
                    makeModule({ id: 'mod-c', path: 'src/mod-c' }),
                    makeModule({ id: 'mod-d', path: 'src/mod-d' }),
                    makeModule({ id: 'mod-e', path: 'src/mod-e' }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual(['mod-a', 'mod-b', 'mod-c']);
            expect(result.newModuleIds).toEqual(['mod-d', 'mod-e']);
        });

        it('matches by path when IDs differ', async () => {
            const graph = makeGraph([
                makeGraphModule({ id: 'old-name', path: 'src/auth' }),
            ]);

            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'new-name', path: 'src/auth' }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual(['new-name']);
            expect(result.newModuleIds).toEqual([]);
        });

        it('handles path with trailing slash for fuzzy match', async () => {
            const graph = makeGraph([
                makeGraphModule({ id: 'auth', path: 'src/auth/' }),
            ]);

            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'auth-new', path: 'src/auth' }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual(['auth-new']);
        });

        it('handles empty existing graph', async () => {
            const graph = makeGraph([]);

            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'mod-a' }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual([]);
            expect(result.newModuleIds).toEqual(['mod-a']);
        });
    });

    // ── Empty probe result ──────────────────────────────────────────

    describe('empty probe result', () => {
        it('returns empty enriched result when AI finds nothing', async () => {
            const probeResult = makeProbeResult({ foundModules: [] });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'nonexistent' },
            });

            expect(result.existingModuleIds).toEqual([]);
            expect(result.newModuleIds).toEqual([]);
            expect(result.allKeyFiles).toEqual([]);
            expect(result.probeResult.foundModules).toEqual([]);
        });
    });

    // ── Key file collection ─────────────────────────────────────────

    describe('allKeyFiles', () => {
        it('collects key files across all found modules', async () => {
            const probeResult = makeProbeResult({
                foundModules: [
                    makeModule({ id: 'mod-a', keyFiles: ['a.ts', 'shared.ts'] }),
                    makeModule({ id: 'mod-b', keyFiles: ['b.ts', 'shared.ts'] }),
                ],
            });
            mockedRunTopicProbe.mockResolvedValue(probeResult);

            const result = await runSingleTopicProbe({
                repoPath: '/repo',
                topic: { topic: 'test' },
            });

            expect(result.allKeyFiles).toEqual(['a.ts', 'shared.ts', 'b.ts']);
        });
    });
});

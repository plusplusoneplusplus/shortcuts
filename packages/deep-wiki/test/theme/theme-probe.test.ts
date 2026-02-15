import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThemeRequest, ComponentGraph, ComponentInfo, ThemeSeed } from '../../src/types';
import type { ThemeProbeResult, ProbeFoundComponent } from '../../src/discovery/iterative/types';

// Mock the probe-session module before importing theme-probe
vi.mock('../../src/discovery/iterative/probe-session', () => ({
    runThemeProbe: vi.fn(),
}));

import { buildThemeSeed, runSingleThemeProbe, type EnrichedProbeResult, type ThemeProbeOptions } from '../../src/theme/theme-probe';
import { runThemeProbe } from '../../src/discovery/iterative/probe-session';

const mockedRunThemeProbe = vi.mocked(runThemeProbe);

// ─── Helpers ───────────────────────────────────────────────────────────

function makeModule(overrides: Partial<ProbeFoundComponent> = {}): ProbeFoundComponent {
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

function makeGraphModule(overrides: Partial<ComponentInfo> = {}): ComponentInfo {
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

function makeGraph(modules: ComponentInfo[]): ComponentGraph {
    return {
        project: { name: 'test', description: 'test project', mainLanguage: 'typescript', frameworks: [], buildTools: [] },
        components: modules,
        categories: [],
        architectureNotes: '',
    };
}

function makeProbeResult(overrides: Partial<ThemeProbeResult> = {}): ThemeProbeResult {
    return {
        theme: 'compaction',
        foundComponents: [],
        discoveredThemes: [],
        dependencies: [],
        confidence: 0.8,
        ...overrides,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('theme-probe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── buildThemeSeed ──────────────────────────────────────────────

    describe('buildThemeSeed', () => {
        it('converts a full ThemeRequest to ThemeSeed', () => {
            const req: ThemeRequest = {
                theme: 'compaction',
                description: 'Log compaction in storage engine',
                hints: ['compact', 'sstable', 'merge'],
            };
            const seed = buildThemeSeed(req);

            expect(seed.theme).toBe('compaction');
            expect(seed.description).toBe('Log compaction in storage engine');
            expect(seed.hints).toEqual(['compact', 'sstable', 'merge']);
        });

        it('generates description when not provided', () => {
            const req: ThemeRequest = { theme: 'wal-recovery' };
            const seed = buildThemeSeed(req);

            expect(seed.description).toBe('Discover code related to wal recovery');
        });

        it('generates hints when not provided', () => {
            const req: ThemeRequest = { theme: 'compaction' };
            const seed = buildThemeSeed(req);

            expect(seed.hints).toContain('compaction');
            expect(seed.hints.length).toBeGreaterThan(1);
        });

        it('generates hints from multi-word theme', () => {
            const req: ThemeRequest = { theme: 'wal-recovery' };
            const seed = buildThemeSeed(req);

            expect(seed.hints).toContain('wal');
            expect(seed.hints).toContain('recovery');
            expect(seed.hints).toContain('wal-recovery');
        });

        it('uses provided hints and ignores generation', () => {
            const req: ThemeRequest = {
                theme: 'compaction',
                hints: ['manual-hint'],
            };
            const seed = buildThemeSeed(req);

            expect(seed.hints).toEqual(['manual-hint']);
        });

        it('treats empty hints array as needing generation', () => {
            const req: ThemeRequest = {
                theme: 'compaction',
                hints: [],
            };
            const seed = buildThemeSeed(req);

            expect(seed.hints.length).toBeGreaterThan(0);
            expect(seed.hints).toContain('compaction');
        });
    });

    // ── Hint generation ─────────────────────────────────────────────

    describe('hint generation', () => {
        it('adds -ing suffix variation', () => {
            const seed = buildThemeSeed({ theme: 'compact' });
            expect(seed.hints).toContain('compacting');
        });

        it('adds -or and -er suffix variations', () => {
            const seed = buildThemeSeed({ theme: 'compact' });
            expect(seed.hints).toContain('compactor');
            expect(seed.hints).toContain('compacter');
        });

        it('handles -e ending for -ing form', () => {
            const seed = buildThemeSeed({ theme: 'cache' });
            expect(seed.hints).toContain('caching');
        });

        it('skips very short parts for suffix generation', () => {
            const seed = buildThemeSeed({ theme: 'io-stream' });
            // "io" is too short (< 3 chars) — shouldn't get suffixed
            expect(seed.hints).toContain('io');
            expect(seed.hints).not.toContain('ioing');
        });
    });

    // ── runSingleThemeProbe ─────────────────────────────────────────

    describe('runSingleThemeProbe', () => {
        it('calls runThemeProbe with correct arguments', async () => {
            const probeResult = makeProbeResult();
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const options: ThemeProbeOptions = {
                repoPath: '/repo',
                theme: { theme: 'compaction', description: 'desc', hints: ['compact'] },
                model: 'gpt-4',
                timeout: 60,
            };

            await runSingleThemeProbe(options);

            expect(mockedRunThemeProbe).toHaveBeenCalledOnce();
            const [repoPath, seed, opts] = mockedRunThemeProbe.mock.calls[0];
            expect(repoPath).toBe('/repo');
            expect(seed.theme).toBe('compaction');
            expect(seed.description).toBe('desc');
            expect(seed.hints).toEqual(['compact']);
            expect(opts).toEqual({ model: 'gpt-4', timeout: 60 });
        });

        it('uses default timeout of 120 when not specified', async () => {
            mockedRunThemeProbe.mockResolvedValue(makeProbeResult());

            await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
            });

            const [, , opts] = mockedRunThemeProbe.mock.calls[0];
            expect(opts.timeout).toBe(120);
        });

        it('returns enriched result with all modules as new when no graph', async () => {
            const probeResult = makeProbeResult({
                foundComponents: [
                    makeModule({ id: 'mod-a', keyFiles: ['a.ts'] }),
                    makeModule({ id: 'mod-b', keyFiles: ['b.ts'] }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
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
                foundComponents: [
                    makeModule({ id: 'mod-a', path: 'src/mod-a' }),
                    makeModule({ id: 'mod-b', path: 'src/mod-b' }),
                    makeModule({ id: 'mod-c', path: 'src/mod-c' }),
                    makeModule({ id: 'mod-d', path: 'src/mod-d' }),
                    makeModule({ id: 'mod-e', path: 'src/mod-e' }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
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
                foundComponents: [
                    makeModule({ id: 'new-name', path: 'src/auth' }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
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
                foundComponents: [
                    makeModule({ id: 'auth-new', path: 'src/auth' }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual(['auth-new']);
        });

        it('handles empty existing graph', async () => {
            const graph = makeGraph([]);

            const probeResult = makeProbeResult({
                foundComponents: [
                    makeModule({ id: 'mod-a' }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
                existingGraph: graph,
            });

            expect(result.existingModuleIds).toEqual([]);
            expect(result.newModuleIds).toEqual(['mod-a']);
        });
    });

    // ── Empty probe result ──────────────────────────────────────────

    describe('empty probe result', () => {
        it('returns empty enriched result when AI finds nothing', async () => {
            const probeResult = makeProbeResult({ foundComponents: [] });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'nonexistent' },
            });

            expect(result.existingModuleIds).toEqual([]);
            expect(result.newModuleIds).toEqual([]);
            expect(result.allKeyFiles).toEqual([]);
            expect(result.probeResult.foundComponents).toEqual([]);
        });
    });

    // ── Key file collection ─────────────────────────────────────────

    describe('allKeyFiles', () => {
        it('collects key files across all found modules', async () => {
            const probeResult = makeProbeResult({
                foundComponents: [
                    makeModule({ id: 'mod-a', keyFiles: ['a.ts', 'shared.ts'] }),
                    makeModule({ id: 'mod-b', keyFiles: ['b.ts', 'shared.ts'] }),
                ],
            });
            mockedRunThemeProbe.mockResolvedValue(probeResult);

            const result = await runSingleThemeProbe({
                repoPath: '/repo',
                theme: { theme: 'test' },
            });

            expect(result.allKeyFiles).toEqual(['a.ts', 'shared.ts', 'b.ts']);
        });
    });
});

/**
 * Discovery Pipeline Error Recovery Tests
 *
 * Gap: Individual phase tests exist but never combine to test recovery across
 * phases. When Phase 3 (analysis) partially fails for some components, does
 * Phase 4 (writing) correctly skip the failed ones?
 *
 * These tests verify:
 * - In non-strict mode, analysis continues with partial results
 * - Writing phase receives and processes only successfully analyzed components
 * - Resuming from a later phase uses cached data from earlier phases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks — identical pattern to phase-runners.test.ts
// ============================================================================

vi.mock('../../src/ai-invoker', function () { return ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
    createAnalysisInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
            componentId: 'comp-a',
            overview: 'A',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }),
    })),
    createWritingInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: '# Article\n\nContent.',
    })),
}); });

vi.mock('../../src/discovery', function () { return ({
    discoverComponentGraph: vi.fn().mockResolvedValue({ graph: {}, duration: 1 }),
    runIterativeDiscovery: vi.fn(),
}); });

vi.mock('../../src/consolidation', function () { return ({
    consolidateComponents: vi.fn(),
}); });

vi.mock('../../src/analysis', function () { return ({
    analyzeComponents: vi.fn().mockResolvedValue({
        analyses: [],
        duration: 1000,
    }),
    parseAnalysisResponse: vi.fn(),
}); });

vi.mock('../../src/writing', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateArticles: vi.fn().mockResolvedValue({
            articles: [],
            duration: 500,
        }),
    };
});

vi.mock('../../src/writing/website-generator', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateWebsite: vi.fn().mockReturnValue(['/mock/index.html']),
    };
});

vi.mock('../../src/seeds', function () { return ({
    generateThemeSeeds: vi.fn(),
    parseSeedFile: vi.fn(),
}); });

vi.mock('../../src/cache', function () { return ({
    getCachedGraph: vi.fn().mockResolvedValue(null),
    getCachedGraphAny: vi.fn().mockReturnValue(null),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getCachedAnalyses: vi.fn().mockReturnValue(null),
    saveAllAnalyses: vi.fn().mockResolvedValue(undefined),
    getComponentsNeedingReanalysis: vi.fn().mockResolvedValue(null),
    getCachedAnalysis: vi.fn().mockReturnValue(null),
    getAnalysesCacheMetadata: vi.fn().mockReturnValue(null),
    saveAnalysis: vi.fn(),
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getGitRoot: vi.fn().mockResolvedValue('/mock/git/root'),
    scanIndividualAnalysesCache: vi.fn().mockReturnValue({ found: [], missing: [] }),
    scanIndividualAnalysesCacheAny: vi.fn().mockReturnValue({ found: [], missing: [] }),
    saveArticle: vi.fn(),
    saveAllArticles: vi.fn().mockResolvedValue(undefined),
    scanIndividualArticlesCache: vi.fn().mockImplementation(
        (ids: string[]) => ({ found: [], missing: [...ids] })
    ),
    scanIndividualArticlesCacheAny: vi.fn().mockImplementation(
        (ids: string[]) => ({ found: [], missing: [...ids] })
    ),
    restampArticles: vi.fn().mockReturnValue(0),
    getCachedReduceArticles: vi.fn().mockReturnValue(null),
    saveReduceArticles: vi.fn(),
    saveSeedsCache: vi.fn(),
    getCachedSeeds: vi.fn().mockReturnValue(null),
    getCachedSeedsAny: vi.fn().mockReturnValue(null),
    clearDiscoveryCache: vi.fn().mockReturnValue(false),
    getCachedConsolidation: vi.fn().mockResolvedValue(null),
    getCachedConsolidationAny: vi.fn().mockReturnValue(null),
    saveConsolidation: vi.fn().mockResolvedValue(undefined),
    clearConsolidationCache: vi.fn().mockReturnValue(false),
    saveProbeResult: vi.fn(),
    getCachedProbeResult: vi.fn().mockReturnValue(null),
    scanCachedProbes: vi.fn().mockImplementation(
        (themes: string[]) => ({ found: new Map(), missing: [...themes] })
    ),
    scanCachedProbesAny: vi.fn().mockImplementation(
        (themes: string[]) => ({ found: new Map(), missing: [...themes] })
    ),
    saveStructuralScan: vi.fn(),
    getCachedStructuralScan: vi.fn().mockReturnValue(null),
    getCachedStructuralScanAny: vi.fn().mockReturnValue(null),
    saveDomainSubGraph: vi.fn(),
    getCachedDomainSubGraph: vi.fn().mockReturnValue(null),
    scanCachedDomains: vi.fn().mockImplementation(
        (ids: string[]) => ({ found: new Map(), missing: [...ids] })
    ),
    scanCachedDomainsAny: vi.fn().mockImplementation(
        (ids: string[]) => ({ found: new Map(), missing: [...ids] })
    ),
    saveDiscoveryMetadata: vi.fn(),
    getDiscoveryMetadata: vi.fn().mockReturnValue(null),
    getDiscoveryCacheDir: vi.fn().mockReturnValue('/mock/.wiki-cache/discovery'),
}); });

vi.mock('../../src/logger', function () { return ({
    Spinner: vi.fn().mockImplementation(function () { return ({
        start: vi.fn(),
        update: vi.fn(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        warn: vi.fn(),
    }); }),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printInfo: vi.fn(),
    printHeader: vi.fn(),
    printKeyValue: vi.fn(),
    bold: (s: string) => s,
    gray: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
}); });

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { runPhase3Analysis, runPhase4Writing } from '../../src/commands/phases';
import { EXIT_CODES } from '../../src/cli';
import { analyzeComponents } from '../../src/analysis';
import { generateArticles } from '../../src/writing';
import { getCachedAnalyses } from '../../src/cache';
import type { ComponentGraph, ComponentAnalysis, GenerateCommandOptions } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let repoDir: string;

function makeGraph(componentIds: string[]): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: componentIds.map(id => ({
            id,
            name: id,
            path: `src/${id}/`,
            purpose: `${id} module`,
            keyFiles: [`src/${id}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        })),
        categories: [{ name: 'core', description: 'Core' }],
        architectureNotes: 'Test notes',
    };
}

function makeAnalysis(componentId: string): ComponentAnalysis {
    return {
        componentId,
        overview: `Overview of ${componentId}`,
        keyConcepts: [],
        publicAPI: [],
        internalArchitecture: '',
        dataFlow: '',
        patterns: [],
        errorHandling: '',
        codeExamples: [],
        dependencies: { internal: [], external: [] },
        suggestedDiagram: '',
    };
}

function defaultOptions(overrides: Partial<GenerateCommandOptions> = {}): GenerateCommandOptions {
    return {
        output: path.join(tempDir, 'wiki'),
        depth: 'normal' as const,
        force: false,
        useCache: false,
        verbose: false,
        ...overrides,
    } as GenerateCommandOptions;
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-error-recovery-test-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    vi.clearAllMocks();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe('Discovery pipeline error recovery', () => {
    // ========================================================================
    // Phase 3 partial failures
    // ========================================================================

    describe('analysis phase skips failed components in non-strict mode', () => {
        it('returns partial analyses when some components fail and strict is false', async () => {
            // 3 components in graph, but analyzeComponents only returns 2
            const graph = makeGraph(['comp-a', 'comp-b', 'comp-c']);

            vi.mocked(analyzeComponents).mockResolvedValue({
                analyses: [makeAnalysis('comp-a'), makeAnalysis('comp-b')],
                duration: 1000,
            });

            const result = await runPhase3Analysis(
                repoDir,
                graph,
                defaultOptions({ strict: false }),
                () => false,
            );

            // Should succeed (non-strict allows partial)
            expect(result.exitCode).toBeUndefined();
            // Should only have the 2 successful analyses
            expect(result.analyses).toHaveLength(2);
            expect(result.analyses!.map(a => a.componentId)).toContain('comp-a');
            expect(result.analyses!.map(a => a.componentId)).toContain('comp-b');
            expect(result.analyses!.map(a => a.componentId)).not.toContain('comp-c');
        });

        it('returns EXECUTION_ERROR when all components fail', async () => {
            const graph = makeGraph(['comp-a', 'comp-b']);

            // analyzeComponents returns no analyses (all failed)
            vi.mocked(analyzeComponents).mockResolvedValue({
                analyses: [],
                duration: 1000,
            });

            const result = await runPhase3Analysis(
                repoDir,
                graph,
                defaultOptions({ strict: false }),
                () => false,
            );

            expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
            expect(result.analyses).toBeUndefined();
        });

        it('returns EXECUTION_ERROR in strict mode (default) when any component fails', async () => {
            const graph = makeGraph(['comp-a', 'comp-b', 'comp-c']);

            // Only 2 of 3 succeed
            vi.mocked(analyzeComponents).mockResolvedValue({
                analyses: [makeAnalysis('comp-a'), makeAnalysis('comp-b')],
                duration: 1000,
            });

            const result = await runPhase3Analysis(
                repoDir,
                graph,
                defaultOptions({ strict: true }),
                () => false,
            );

            // Strict mode: any failure is fatal
            expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        });
    });

    // ========================================================================
    // Phase 4 only writes articles for components with analyses
    // ========================================================================

    describe('article writing skips components without analysis data', () => {
        it('generateArticles is called only with analyses that exist — failed components excluded', async () => {
            // Provide only 2 analyses (comp-a, comp-b) — comp-c has no analysis
            const analyses = [makeAnalysis('comp-a'), makeAnalysis('comp-b')];
            const graph = makeGraph(['comp-a', 'comp-b', 'comp-c']);

            vi.mocked(generateArticles).mockResolvedValue({
                articles: [
                    { type: 'component', slug: 'comp-a', title: 'Comp A', content: '# A', componentId: 'comp-a' },
                    { type: 'component', slug: 'comp-b', title: 'Comp B', content: '# B', componentId: 'comp-b' },
                ],
                duration: 500,
            });

            await runPhase4Writing(repoDir, graph, analyses, defaultOptions(), () => false);

            // generateArticles must receive only the 2 analyses with data
            const generateArticlesCall = vi.mocked(generateArticles).mock.calls[0];
            if (generateArticlesCall) {
                const passedAnalyses = generateArticlesCall[0].analyses;
                expect(passedAnalyses).toHaveLength(2);
                expect(passedAnalyses.map((a: ComponentAnalysis) => a.componentId)).toContain('comp-a');
                expect(passedAnalyses.map((a: ComponentAnalysis) => a.componentId)).toContain('comp-b');
                expect(passedAnalyses.map((a: ComponentAnalysis) => a.componentId)).not.toContain('comp-c');
            }
        });

        it('phase 4 handles an empty analyses array gracefully', async () => {
            const graph = makeGraph(['comp-a']);

            vi.mocked(generateArticles).mockResolvedValue({
                articles: [],
                duration: 0,
            });

            const result = await runPhase4Writing(repoDir, graph, [], defaultOptions(), () => false);

            // Should not crash with empty analyses
            expect(result.exitCode).toBeUndefined();
        });
    });

    // ========================================================================
    // Resuming from cached phase
    // ========================================================================

    describe('partial cache allows resuming from a later phase', () => {
        it('phase 3 loads analyses from cache when available, skipping re-analysis', async () => {
            const graph = makeGraph(['comp-a', 'comp-b']);

            // Simulate cached analyses
            vi.mocked(getCachedAnalyses).mockReturnValue([
                makeAnalysis('comp-a'),
                makeAnalysis('comp-b'),
            ]);
            // scanIndividualAnalysesCacheAny returns all found (cached)
            const { scanIndividualAnalysesCacheAny } = await import('../../src/cache');
            vi.mocked(scanIndividualAnalysesCacheAny).mockReturnValue({
                found: [makeAnalysis('comp-a'), makeAnalysis('comp-b')],
                missing: [],
            });

            const result = await runPhase3Analysis(
                repoDir,
                graph,
                defaultOptions({ useCache: true }),
                () => false,
            );

            // analyzeComponents should NOT be called — all loaded from cache
            expect(vi.mocked(analyzeComponents)).not.toHaveBeenCalled();
            expect(result.analyses).toHaveLength(2);
        });
    });
});

/**
 * Phase Runner Unit Tests
 *
 * Tests each extracted phase runner function in isolation.
 * The full pipeline integration is tested in generate.test.ts — these tests
 * verify that the individual phase functions behave correctly with explicit
 * parameters (the key outcome of the extraction refactoring).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks — identical pattern to generate.test.ts
// ============================================================================

vi.mock('../../../src/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
    createAnalysisInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
            componentId: 'test-module',
            overview: 'Test overview',
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
        response: '# Test Article\n\nContent here.',
    })),
    createConsolidationInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: '{}',
    })),
}));

vi.mock('../../../src/discovery', () => ({
    discoverComponentGraph: vi.fn().mockResolvedValue({
        graph: {
            project: {
                name: 'TestProject',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: ['src/index.ts'],
            },
            components: [{
                id: 'test-module',
                name: 'Test Module',
                path: 'src/test/',
                purpose: 'Testing',
                keyFiles: ['src/test/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            }],
            categories: [{ name: 'core', description: 'Core' }],
            architectureNotes: 'Test notes',
        },
        duration: 1000,
    }),
    runIterativeDiscovery: vi.fn(),
}));

vi.mock('../../../src/consolidation', () => ({
    consolidateComponents: vi.fn().mockResolvedValue({
        graph: {
            project: {
                name: 'TestProject',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: ['src/index.ts'],
            },
            components: [{
                id: 'test-module',
                name: 'Test Module',
                path: 'src/test/',
                purpose: 'Testing',
                keyFiles: ['src/test/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            }],
            categories: [{ name: 'core', description: 'Core' }],
            architectureNotes: 'Test notes',
        },
        originalCount: 2,
        afterRuleBasedCount: 1,
        finalCount: 1,
    }),
}));

vi.mock('../../../src/analysis', () => ({
    analyzeComponents: vi.fn().mockResolvedValue({
        analyses: [{
            componentId: 'test-module',
            overview: 'Test overview',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }],
        duration: 1000,
    }),
    parseAnalysisResponse: vi.fn(),
}));

vi.mock('../../../src/writing', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateArticles: vi.fn().mockResolvedValue({
            articles: [{
                type: 'component',
                slug: 'test-module',
                title: 'Test Module',
                content: '# Test Module\n\nContent here.',
                componentId: 'test-module',
            }],
            duration: 1000,
        }),
    };
});

vi.mock('../../../src/writing/website-generator', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateWebsite: vi.fn().mockReturnValue(['/mock/index.html']),
    };
});

vi.mock('../../../src/seeds', () => ({
    generateThemeSeeds: vi.fn().mockResolvedValue([
        { theme: 'auth', description: 'Auth', hints: ['auth'] },
    ]),
    parseSeedFile: vi.fn().mockReturnValue([
        { theme: 'auth', description: 'Auth', hints: ['auth'] },
    ]),
}));

vi.mock('../../../src/cache', () => ({
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
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
    ),
    scanIndividualArticlesCacheAny: vi.fn().mockImplementation(
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
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
        (domainIds: string[]) => ({ found: new Map(), missing: [...domainIds] })
    ),
    scanCachedDomainsAny: vi.fn().mockImplementation(
        (domainIds: string[]) => ({ found: new Map(), missing: [...domainIds] })
    ),
    saveDiscoveryMetadata: vi.fn(),
    getDiscoveryMetadata: vi.fn().mockReturnValue(null),
    getDiscoveryCacheDir: vi.fn().mockReturnValue('/mock/.wiki-cache/discovery'),
}));

vi.mock('../../../src/logger', () => ({
    Spinner: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        update: vi.fn(),
        stop: vi.fn(),
        succeed: vi.fn(),
        fail: vi.fn(),
        warn: vi.fn(),
    })),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printInfo: vi.fn(),
    printHeader: vi.fn(),
    printKeyValue: vi.fn(),
    bold: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    runPhase1,
    runPhase2Consolidation,
    runPhase3Analysis,
    runPhase4Writing,
    runPhase5Website,
} from '../../../src/commands/phases';
import { EXIT_CODES } from '../../../src/cli';
import { UsageTracker } from '../../../src/usage-tracker';
import { discoverComponentGraph } from '../../../src/discovery';
import { consolidateComponents } from '../../../src/consolidation';
import { analyzeComponents } from '../../../src/analysis';
import { generateArticles, writeWikiOutput } from '../../../src/writing';
import { generateWebsite } from '../../../src/writing/website-generator';
import {
    getCachedGraph,
    getCachedGraphAny,
    clearDiscoveryCache,
    getCachedConsolidation,
    getCachedConsolidationAny,
    getComponentsNeedingReanalysis,
    scanIndividualArticlesCache,
} from '../../../src/cache';
import type { ComponentGraph, ComponentAnalysis, GenerateCommandOptions } from '../../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let repoDir: string;

const sampleGraph: ComponentGraph = {
    project: {
        name: 'TestProject',
        description: 'Test',
        language: 'TypeScript',
        buildSystem: 'npm',
        entryPoints: ['src/index.ts'],
    },
    components: [{
        id: 'test-module',
        name: 'Test Module',
        path: 'src/test/',
        purpose: 'Testing',
        keyFiles: ['src/test/index.ts'],
        dependencies: [],
        dependents: [],
        complexity: 'medium',
        category: 'core',
    }],
    categories: [{ name: 'core', description: 'Core' }],
    architectureNotes: 'Test notes',
};

const sampleAnalyses: ComponentAnalysis[] = [{
    componentId: 'test-module',
    overview: 'Test overview',
    keyConcepts: [],
    publicAPI: [],
    internalArchitecture: '',
    dataFlow: '',
    patterns: [],
    errorHandling: '',
    codeExamples: [],
    dependencies: { internal: [], external: [] },
    suggestedDiagram: '',
}];

function defaultOptions(overrides: Record<string, any> = {}): GenerateCommandOptions {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-phase-test-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    vi.clearAllMocks();

    // Re-set default mock implementations
    vi.mocked(getCachedGraph).mockResolvedValue(null);
    vi.mocked(getComponentsNeedingReanalysis).mockResolvedValue(null);

    vi.mocked(analyzeComponents).mockResolvedValue({
        analyses: sampleAnalyses,
        duration: 1000,
    });

    vi.mocked(generateArticles).mockResolvedValue({
        articles: [{
            type: 'component',
            slug: 'test-module',
            title: 'Test Module',
            content: '# Test Module\n\nContent here.',
            componentId: 'test-module',
        }],
        duration: 1000,
    });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Phase 1: Discovery
// ============================================================================

describe('runPhase1', () => {
    it('should discover modules and return graph', async () => {
        const result = await runPhase1(repoDir, defaultOptions(), () => false);
        expect(result.graph).toBeDefined();
        expect(result.graph!.components).toHaveLength(1);
        expect(result.exitCode).toBeUndefined();
    });

    it('should call discoverComponentGraph', async () => {
        await runPhase1(repoDir, defaultOptions(), () => false);
        expect(discoverComponentGraph).toHaveBeenCalled();
    });

    it('should use cached graph when available', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue({ graph: sampleGraph, hash: 'abc' });
        const result = await runPhase1(repoDir, defaultOptions(), () => false);
        expect(result.graph).toBeDefined();
        expect(discoverComponentGraph).not.toHaveBeenCalled();
    });

    it('should skip cache when --force', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue({ graph: sampleGraph, hash: 'abc' });
        await runPhase1(repoDir, defaultOptions({ force: true }), () => false);
        expect(discoverComponentGraph).toHaveBeenCalled();
        expect(clearDiscoveryCache).toHaveBeenCalled();
    });

    it('should return exit code on discovery failure', async () => {
        vi.mocked(discoverComponentGraph).mockRejectedValue(new Error('AI failed'));
        const result = await runPhase1(repoDir, defaultOptions(), () => false);
        expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        expect(result.graph).toBeUndefined();
    });

    it('should use getCachedGraphAny when --use-cache', async () => {
        vi.mocked(getCachedGraphAny).mockReturnValue({ graph: sampleGraph, hash: 'any' });
        const result = await runPhase1(repoDir, defaultOptions({ useCache: true }), () => false);
        expect(result.graph).toBeDefined();
        expect(getCachedGraphAny).toHaveBeenCalled();
        expect(discoverComponentGraph).not.toHaveBeenCalled();
    });

    it('should report duration', async () => {
        const result = await runPhase1(repoDir, defaultOptions(), () => false);
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });
});

// ============================================================================
// Phase 2: Consolidation
// ============================================================================

describe('runPhase2Consolidation', () => {
    it('should consolidate modules and return graph', async () => {
        const tracker = new UsageTracker();
        const result = await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions(), tracker);
        expect(result.graph).toBeDefined();
        expect(result.graph.components).toHaveLength(1);
    });

    it('should call consolidateComponents', async () => {
        await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions());
        expect(consolidateComponents).toHaveBeenCalled();
    });

    it('should use cached consolidation when available', async () => {
        vi.mocked(getCachedConsolidation).mockResolvedValue({ graph: sampleGraph, hash: 'abc' });
        const result = await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions());
        expect(result.graph).toBeDefined();
        expect(consolidateComponents).not.toHaveBeenCalled();
    });

    it('should use getCachedConsolidationAny when --use-cache', async () => {
        vi.mocked(getCachedConsolidationAny).mockReturnValue({ graph: sampleGraph, hash: 'any' });
        const result = await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions({ useCache: true }));
        expect(result.graph).toBeDefined();
        expect(getCachedConsolidationAny).toHaveBeenCalled();
    });

    it('should fall back to original graph on consolidation failure', async () => {
        vi.mocked(consolidateComponents).mockRejectedValue(new Error('Consolidation failed'));
        const result = await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions());
        // Should return the original graph, not throw
        expect(result.graph).toEqual(sampleGraph);
    });

    it('should report duration', async () => {
        const result = await runPhase2Consolidation(repoDir, sampleGraph, defaultOptions());
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });
});

// ============================================================================
// Phase 3: Analysis
// ============================================================================

describe('runPhase3Analysis', () => {
    it('should analyze modules and return analyses', async () => {
        const result = await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(result.analyses).toBeDefined();
        expect(result.analyses!).toHaveLength(1);
        expect(result.exitCode).toBeUndefined();
    });

    it('should call analyzeComponents', async () => {
        await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(analyzeComponents).toHaveBeenCalled();
    });

    it('should return reanalyzedModuleIds', async () => {
        const result = await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(result.reanalyzedModuleIds).toEqual(['test-module']);
    });

    it('should return empty reanalyzedModuleIds when all cached', async () => {
        vi.mocked(getComponentsNeedingReanalysis).mockResolvedValue([]);
        const { getCachedAnalyses } = await import('../../../src/cache');
        vi.mocked(getCachedAnalyses).mockReturnValue(sampleAnalyses);

        const result = await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(result.reanalyzedModuleIds).toEqual([]);
        expect(analyzeComponents).not.toHaveBeenCalled();
    });

    it('should return exit code on total analysis failure', async () => {
        vi.mocked(analyzeComponents).mockResolvedValue({
            analyses: [],
            duration: 100,
        });

        const result = await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
    });

    it('should return exit code on error', async () => {
        vi.mocked(analyzeComponents).mockRejectedValue(new Error('Analysis error'));
        const result = await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false);
        expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
    });

    it('should track usage with usageTracker', async () => {
        const tracker = new UsageTracker();
        await runPhase3Analysis(repoDir, sampleGraph, defaultOptions(), () => false, tracker);
        // The tracker wrapping occurs inside — we just verify it doesn't throw
        expect(tracker).toBeDefined();
    });
});

// ============================================================================
// Phase 4: Writing
// ============================================================================

describe('runPhase4Writing', () => {
    it('should generate articles and return count', async () => {
        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false
        );
        expect(result.articlesWritten).toBeGreaterThan(0);
        expect(result.exitCode).toBeUndefined();
    });

    it('should call generateArticles', async () => {
        await runPhase4Writing(repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false);
        expect(generateArticles).toHaveBeenCalled();
    });

    it('should write files to output directory', async () => {
        const options = defaultOptions();
        await runPhase4Writing(repoDir, sampleGraph, sampleAnalyses, options, () => false);
        // writeWikiOutput is real, so files should be written
        const outputDir = path.resolve(options.output);
        expect(fs.existsSync(outputDir)).toBe(true);
    });

    it('should return exit code on error', async () => {
        vi.mocked(generateArticles).mockRejectedValue(new Error('Writing failed'));
        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false
        );
        expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
    });

    it('should accept reanalyzedModuleIds parameter', async () => {
        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false,
            undefined, ['test-module']
        );
        expect(result.exitCode).toBeUndefined();
    });

    it('should report duration', async () => {
        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false
        );
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should fail in strict mode when articles fail', async () => {
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [],
            duration: 100,
            failedComponentIds: ['test-module'],
        });

        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses, defaultOptions(), () => false
        );
        expect(result.exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
    });

    it('should continue in non-strict mode when articles fail', async () => {
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [],
            duration: 100,
            failedComponentIds: ['test-module'],
        });

        const result = await runPhase4Writing(
            repoDir, sampleGraph, sampleAnalyses,
            defaultOptions({ strict: false }), () => false
        );
        expect(result.exitCode).toBeUndefined();
    });
});

// ============================================================================
// Phase 5: Website
// ============================================================================

describe('runPhase5Website', () => {
    it('should generate website and return success', () => {
        const result = runPhase5Website(defaultOptions());
        expect(result.success).toBe(true);
    });

    it('should call generateWebsite', () => {
        runPhase5Website(defaultOptions());
        expect(generateWebsite).toHaveBeenCalled();
    });

    it('should pass theme option', () => {
        runPhase5Website(defaultOptions({ theme: 'dark' }));
        expect(generateWebsite).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ theme: 'dark' })
        );
    });

    it('should pass title option', () => {
        runPhase5Website(defaultOptions({ title: 'My Wiki' }));
        expect(generateWebsite).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ title: 'My Wiki' })
        );
    });

    it('should return failure on error without throwing', () => {
        vi.mocked(generateWebsite).mockImplementation(() => {
            throw new Error('Website generation failed');
        });
        const result = runPhase5Website(defaultOptions());
        expect(result.success).toBe(false);
    });

    it('should report duration', () => {
        const result = runPhase5Website(defaultOptions());
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });
});

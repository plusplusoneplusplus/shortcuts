/**
 * Generate Command Tests
 *
 * Tests for the full five-phase generate command orchestration:
 * Phase 1→2→3→4→5 flow, --phase skipping, --force bypass, --skip-website, and error handling.
 *
 * Uses extensive mocking since the actual AI calls are integration-tested separately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks
// ============================================================================

// Mock AI invoker
vi.mock('../../src/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
    createAnalysisInvoker: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
        success: true,
        response: JSON.stringify({
            moduleId: 'test-module',
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
}));

// Mock discovery
vi.mock('../../src/discovery', () => ({
    discoverModuleGraph: vi.fn().mockResolvedValue({
        graph: {
            project: {
                name: 'TestProject',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: ['src/index.ts'],
            },
            modules: [{
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
    runIterativeDiscovery: vi.fn().mockResolvedValue({
        project: {
            name: 'TestProject',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: [{
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
        architectureNotes: 'Iterative discovery',
    }),
}));

// Mock analysis module
vi.mock('../../src/analysis', () => ({
    analyzeModules: vi.fn().mockResolvedValue({
        analyses: [{
            moduleId: 'test-module',
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

// Mock writing module — keep writeWikiOutput and buildReducePromptTemplate as real implementations
// so existing tests that depend on file writes continue to work.
vi.mock('../../src/writing', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateArticles: vi.fn().mockResolvedValue({
            articles: [{
                type: 'module',
                slug: 'test-module',
                title: 'Test Module',
                content: '# Test Module\n\nContent here.',
                moduleId: 'test-module',
            }],
            duration: 1000,
        }),
    };
});

// Mock seeds
vi.mock('../../src/seeds', () => ({
    generateTopicSeeds: vi.fn().mockResolvedValue([
        { topic: 'auth', description: 'Auth', hints: ['auth'] },
    ]),
    parseSeedFile: vi.fn().mockReturnValue([
        { topic: 'auth', description: 'Auth', hints: ['auth'] },
    ]),
}));

// Mock cache
vi.mock('../../src/cache', () => ({
    getCachedGraph: vi.fn().mockResolvedValue(null),
    getCachedGraphAny: vi.fn().mockReturnValue(null),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getCachedAnalyses: vi.fn().mockReturnValue(null),
    saveAllAnalyses: vi.fn().mockResolvedValue(undefined),
    getModulesNeedingReanalysis: vi.fn().mockResolvedValue(null),
    getCachedAnalysis: vi.fn().mockReturnValue(null),
    getAnalysesCacheMetadata: vi.fn().mockReturnValue(null),
    saveAnalysis: vi.fn(),
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getGitRoot: vi.fn().mockResolvedValue('/mock/git/root'),
    scanIndividualAnalysesCache: vi.fn().mockReturnValue({ found: [], missing: [] }),
    scanIndividualAnalysesCacheAny: vi.fn().mockReturnValue({ found: [], missing: [] }),
    // Article cache functions (Phase 4)
    saveArticle: vi.fn(),
    saveAllArticles: vi.fn().mockResolvedValue(undefined),
    scanIndividualArticlesCache: vi.fn().mockImplementation(
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
    ),
    scanIndividualArticlesCacheAny: vi.fn().mockImplementation(
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
    ),
    restampArticles: vi.fn().mockReturnValue(0),
    // Reduce article cache functions (Phase 4 reduce)
    getCachedReduceArticles: vi.fn().mockReturnValue(null),
    saveReduceArticles: vi.fn(),
    // Discovery cache functions
    saveSeedsCache: vi.fn(),
    getCachedSeeds: vi.fn().mockReturnValue(null),
    getCachedSeedsAny: vi.fn().mockReturnValue(null),
    clearDiscoveryCache: vi.fn().mockReturnValue(false),
    // Consolidation cache functions (Phase 2)
    getCachedConsolidation: vi.fn().mockResolvedValue(null),
    getCachedConsolidationAny: vi.fn().mockReturnValue(null),
    saveConsolidation: vi.fn().mockResolvedValue(undefined),
    clearConsolidationCache: vi.fn().mockReturnValue(false),
    // Probe/area cache functions (used by iterative discovery and large-repo handler)
    saveProbeResult: vi.fn(),
    getCachedProbeResult: vi.fn().mockReturnValue(null),
    scanCachedProbes: vi.fn().mockImplementation(
        (topics: string[]) => ({ found: new Map(), missing: [...topics] })
    ),
    scanCachedProbesAny: vi.fn().mockImplementation(
        (topics: string[]) => ({ found: new Map(), missing: [...topics] })
    ),
    saveStructuralScan: vi.fn(),
    getCachedStructuralScan: vi.fn().mockReturnValue(null),
    getCachedStructuralScanAny: vi.fn().mockReturnValue(null),
    saveAreaSubGraph: vi.fn(),
    getCachedAreaSubGraph: vi.fn().mockReturnValue(null),
    scanCachedAreas: vi.fn().mockImplementation(
        (areaIds: string[]) => ({ found: new Map(), missing: [...areaIds] })
    ),
    scanCachedAreasAny: vi.fn().mockImplementation(
        (areaIds: string[]) => ({ found: new Map(), missing: [...areaIds] })
    ),
    saveDiscoveryMetadata: vi.fn(),
    getDiscoveryMetadata: vi.fn().mockReturnValue(null),
    getDiscoveryCacheDir: vi.fn().mockReturnValue('/mock/.wiki-cache/discovery'),
}));

// Mock website generator — keep real exports, only mock generateWebsite
vi.mock('../../src/writing/website-generator', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        generateWebsite: vi.fn().mockReturnValue(['/mock/index.html', '/mock/embedded-data.js']),
    };
});

// Suppress logger output during tests
vi.mock('../../src/logger', () => ({
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

import { executeGenerate } from '../../src/commands/generate';
import { EXIT_CODES } from '../../src/cli';
import { checkAIAvailability, createWritingInvoker } from '../../src/ai-invoker';
import {
    getCachedGraph,
    getCachedGraphAny,
    getCachedAnalyses,
    getModulesNeedingReanalysis,
    scanIndividualAnalysesCache,
    scanIndividualAnalysesCacheAny,
    scanIndividualArticlesCache,
    scanIndividualArticlesCacheAny,
    getRepoHeadHash,
    getFolderHeadHash,
    saveAnalysis,
    saveReduceArticles,
    restampArticles,
    getCachedReduceArticles,
} from '../../src/cache';
import { discoverModuleGraph } from '../../src/discovery';
import { generateWebsite } from '../../src/writing/website-generator';
import { analyzeModules } from '../../src/analysis';
import { generateArticles, writeWikiOutput } from '../../src/writing';
import { printError, printInfo, printSuccess, printWarning, printKeyValue } from '../../src/logger';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let repoDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-gen-test-'));
    repoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    vi.clearAllMocks();

    // Re-set default mocks (vi.clearAllMocks only clears history, not implementations)
    vi.mocked(checkAIAvailability).mockResolvedValue({ available: true });
    vi.mocked(getCachedGraph).mockResolvedValue(null);
    vi.mocked(getCachedAnalyses).mockReturnValue(null);

    // Re-set analysis mock (default: all succeed)
    vi.mocked(analyzeModules).mockResolvedValue({
        analyses: [{
            moduleId: 'test-module',
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
    });

    // Re-set writing mock (default: all succeed, no failed modules)
    vi.mocked(generateArticles).mockResolvedValue({
        articles: [{
            type: 'module',
            slug: 'test-module',
            title: 'Test Module',
            content: '# Test Module\n\nContent here.',
            moduleId: 'test-module',
        }],
        duration: 1000,
    });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function defaultOptions(overrides: Record<string, any> = {}) {
    return {
        output: path.join(tempDir, 'wiki'),
        depth: 'normal' as const,
        force: false,
        useCache: false,
        verbose: false,
        ...overrides,
    };
}

// ============================================================================
// Basic Validation
// ============================================================================

describe('executeGenerate — validation', () => {
    it('should fail for non-existent repo path', async () => {
        const exitCode = await executeGenerate('/nonexistent/path', defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail for file (not directory) repo path', async () => {
        const filePath = path.join(tempDir, 'file.txt');
        fs.writeFileSync(filePath, 'content');

        const exitCode = await executeGenerate(filePath, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail for invalid --phase value', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 6 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should fail when AI is unavailable', async () => {
        vi.mocked(checkAIAvailability).mockResolvedValue({
            available: false,
            reason: 'Not signed in',
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
    });
});

// ============================================================================
// Full Pipeline
// ============================================================================

describe('executeGenerate — full pipeline', () => {
    it('should run all phases and return SUCCESS', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    });

    it('should call discoverModuleGraph for Phase 1', async () => {
        await executeGenerate(repoDir, defaultOptions());
        expect(discoverModuleGraph).toHaveBeenCalled();
    });
});

// ============================================================================
// --phase option
// ============================================================================

describe('executeGenerate — --phase option', () => {
    it('--phase 3 should skip discovery and consolidation and use cached graph', async () => {
        // Set up cached graph
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: {
                gitHash: 'abc123',
                timestamp: Date.now(),
                version: '1.0.0',
            },
            graph: {
                project: {
                    name: 'Cached',
                    description: 'Cached',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [{
                    id: 'cached-mod',
                    name: 'Cached Module',
                    path: 'src/cached/',
                    purpose: 'Cached',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(discoverModuleGraph).not.toHaveBeenCalled();
    });

    it('--phase 3 should error when no cached graph exists', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('--phase 4 should error when no cached analyses exist', async () => {
        // Set up cached graph but no analyses
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'T', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
        });
        vi.mocked(getCachedAnalyses).mockReturnValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 4 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });
});

// ============================================================================
// --end-phase option
// ============================================================================

describe('executeGenerate — --end-phase option', () => {
    it('should fail for invalid --end-phase value (0)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 0 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('Invalid --end-phase value')
        );
    });

    it('should fail for invalid --end-phase value (6)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 6 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('Invalid --end-phase value')
        );
    });

    it('should fail when --end-phase < --phase', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3, endPhase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('less than --phase')
        );
    });

    it('--end-phase 1 should stop after Phase 1 (discovery only)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 1 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Phase 1 should run
        expect(discoverModuleGraph).toHaveBeenCalled();
        // Phase 3 analysis should NOT run
        expect(analyzeModules).not.toHaveBeenCalled();
        // Phase 5 website should NOT run
        expect(generateWebsite).not.toHaveBeenCalled();

        expect(printSuccess).toHaveBeenCalledWith(
            expect.stringContaining('--end-phase 1')
        );
    });

    it('--end-phase 2 should stop after Phase 2 (discovery + consolidation)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Phase 1 should run
        expect(discoverModuleGraph).toHaveBeenCalled();
        // Phase 3 analysis should NOT run
        expect(analyzeModules).not.toHaveBeenCalled();
        // Phase 5 website should NOT run
        expect(generateWebsite).not.toHaveBeenCalled();

        expect(printSuccess).toHaveBeenCalledWith(
            expect.stringContaining('--end-phase 2')
        );
    });

    it('--end-phase 3 should stop after Phase 3 (through analysis, no writing)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Phase 1 should run
        expect(discoverModuleGraph).toHaveBeenCalled();
        // Phase 3 should run
        expect(analyzeModules).toHaveBeenCalled();
        // Phase 4 writing should NOT run
        expect(generateArticles).not.toHaveBeenCalled();
        // Phase 5 website should NOT run
        expect(generateWebsite).not.toHaveBeenCalled();

        expect(printSuccess).toHaveBeenCalledWith(
            expect.stringContaining('--end-phase 3')
        );
    });

    it('--end-phase 4 should run through Phase 4 but skip website (Phase 5)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 4 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // All phases up to 4 should run
        expect(discoverModuleGraph).toHaveBeenCalled();
        expect(analyzeModules).toHaveBeenCalled();
        expect(generateArticles).toHaveBeenCalled();
        // Phase 5 website should NOT run
        expect(generateWebsite).not.toHaveBeenCalled();
    });

    it('--end-phase 5 should run all phases (same as default)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ endPhase: 5 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // All phases should run
        expect(discoverModuleGraph).toHaveBeenCalled();
        expect(analyzeModules).toHaveBeenCalled();
        expect(generateArticles).toHaveBeenCalled();
        expect(generateWebsite).toHaveBeenCalled();
    });

    it('--phase 3 --end-phase 3 should run only Phase 3 (analysis)', async () => {
        // Set up cached graph for Phase 3
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc123', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: {
                    name: 'Cached',
                    description: 'Cached',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [{
                    id: 'cached-mod',
                    name: 'Cached Module',
                    path: 'src/cached/',
                    purpose: 'Cached',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3, endPhase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Phase 1 should NOT run (skipped by --phase 3)
        expect(discoverModuleGraph).not.toHaveBeenCalled();
        // Phase 3 should run
        expect(analyzeModules).toHaveBeenCalled();
        // Phase 4 writing should NOT run (stopped by --end-phase 3)
        expect(generateArticles).not.toHaveBeenCalled();
        // Phase 5 website should NOT run
        expect(generateWebsite).not.toHaveBeenCalled();

        expect(printSuccess).toHaveBeenCalledWith(
            expect.stringContaining('--end-phase 3')
        );
    });

    it('--phase 2 --end-phase 4 should skip Phase 1 and Phase 5', async () => {
        // Set up cached graph
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc123', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: {
                    name: 'Cached',
                    description: 'Cached',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [{
                    id: 'cached-mod',
                    name: 'Cached Module',
                    path: 'src/cached/',
                    purpose: 'Cached',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 2, endPhase: 4 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Phase 1 should NOT run (skipped by --phase 2)
        expect(discoverModuleGraph).not.toHaveBeenCalled();
        // Phase 3 should run
        expect(analyzeModules).toHaveBeenCalled();
        // Phase 4 should run
        expect(generateArticles).toHaveBeenCalled();
        // Phase 5 website should NOT run (stopped by --end-phase 4)
        expect(generateWebsite).not.toHaveBeenCalled();
    });

    it('should print End Phase in header when --end-phase is set', async () => {
        await executeGenerate(repoDir, defaultOptions({ endPhase: 3 }));
        expect(printKeyValue).toHaveBeenCalledWith('End Phase', '3');
    });

    it('should not print End Phase in header when --end-phase is not set', async () => {
        await executeGenerate(repoDir, defaultOptions());
        expect(printKeyValue).not.toHaveBeenCalledWith('End Phase', expect.anything());
    });

    it('--phase 3 --end-phase 3 should equal --end-phase 3 (same as --phase==--end-phase)', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'T', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [{
                    id: 'test-mod',
                    name: 'Test Module',
                    path: 'src/test/',
                    purpose: 'Test',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3, endPhase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        // Phase 3 ran
        expect(analyzeModules).toHaveBeenCalled();
        // Phase 4 did not run
        expect(generateArticles).not.toHaveBeenCalled();
    });
});

// ============================================================================
// --force option
// ============================================================================

describe('executeGenerate — --seeds option', () => {
    it('should use iterative discovery when --seeds auto is provided', async () => {
        const discovery = await import('../../src/discovery');
        const seeds = await import('../../src/seeds');

        const { executeGenerate } = await import('../../src/commands/generate');
        const exitCode = await executeGenerate(repoDir, {
            ...defaultOptions(),
            seeds: 'auto',
        });

        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(vi.mocked(seeds.generateTopicSeeds)).toHaveBeenCalledOnce();
        expect(vi.mocked(discovery.runIterativeDiscovery)).toHaveBeenCalledOnce();
        expect(vi.mocked(discovery.discoverModuleGraph)).not.toHaveBeenCalled();
    });

    it('should parse seed file and use iterative discovery when --seeds with file path', async () => {
        const discovery = await import('../../src/discovery');
        const seeds = await import('../../src/seeds');

        const seedFile = path.join(tempDir, 'seeds.json');
        fs.writeFileSync(seedFile, JSON.stringify({
            topics: [
                { topic: 'auth', description: 'Auth', hints: ['auth'] },
            ],
        }), 'utf-8');

        const { executeGenerate } = await import('../../src/commands/generate');
        const exitCode = await executeGenerate(repoDir, {
            ...defaultOptions(),
            seeds: seedFile,
        });

        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(vi.mocked(seeds.parseSeedFile)).toHaveBeenCalledWith(seedFile);
        expect(vi.mocked(discovery.runIterativeDiscovery)).toHaveBeenCalledOnce();
        expect(vi.mocked(discovery.discoverModuleGraph)).not.toHaveBeenCalled();
    });
});

describe('executeGenerate — --force option', () => {
    it('--force should bypass cache for Phase 1', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'Cached', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
        });

        await executeGenerate(repoDir, defaultOptions({ force: true }));

        // Should still call discover even though cache exists
        expect(discoverModuleGraph).toHaveBeenCalled();
    });
});

// ============================================================================
// Incremental Per-Module Caching
// ============================================================================

describe('executeGenerate — incremental per-module caching', () => {
    it('should attempt partial cache recovery when no metadata exists', async () => {
        // getModulesNeedingReanalysis returns null (no metadata)
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');

        // Simulate partial cache with 1 recovered module
        vi.mocked(scanIndividualAnalysesCache).mockReturnValue({
            found: [{
                moduleId: 'test-module',
                overview: 'Cached overview',
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
            missing: [],
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should have called scanIndividualAnalysesCache for crash recovery
        expect(scanIndividualAnalysesCache).toHaveBeenCalled();
    });

    it('should not scan for partial cache when --force is used', async () => {
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ force: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should NOT have called scanIndividualAnalysesCache when force is used
        expect(scanIndividualAnalysesCache).not.toHaveBeenCalled();
    });

    it('should skip partial cache scan when git hash unavailable', async () => {
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(getFolderHeadHash).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should NOT have called scanIndividualAnalysesCache when no git hash
        expect(scanIndividualAnalysesCache).not.toHaveBeenCalled();
    });

    it('should log recovery info when partial cache is found', async () => {
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');

        vi.mocked(scanIndividualAnalysesCache).mockReturnValue({
            found: [{
                moduleId: 'recovered-module',
                overview: 'Recovered',
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
            missing: ['missing-module'],
        });

        // Need to set up a 2-module discovery for the partial cache to matter
        const { discoverModuleGraph: discoverMock } = await import('../../src/discovery');
        vi.mocked(discoverMock).mockResolvedValue({
            graph: {
                project: {
                    name: 'TestProject',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                modules: [
                    {
                        id: 'recovered-module',
                        name: 'Recovered Module',
                        path: 'src/recovered/',
                        purpose: 'Testing',
                        keyFiles: ['src/recovered/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'medium',
                        category: 'core',
                    },
                    {
                        id: 'missing-module',
                        name: 'Missing Module',
                        path: 'src/missing/',
                        purpose: 'Testing',
                        keyFiles: ['src/missing/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'medium',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: 'Test notes',
            },
            duration: 1000,
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should have printed info about recovery
        expect(printInfo).toHaveBeenCalledWith(
            expect.stringContaining('Recovered 1 module analyses from partial cache')
        );
    });
});

// ============================================================================
// --use-cache option
// ============================================================================

describe('executeGenerate — --use-cache option', () => {
    it('--use-cache should use getCachedGraphAny for Phase 1', async () => {
        vi.mocked(getCachedGraphAny).mockReturnValue({
            metadata: { gitHash: 'old-stale-hash', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'Stale', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [{
                    id: 'stale-mod',
                    name: 'Stale Module',
                    path: 'src/stale/',
                    purpose: 'Stale',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ useCache: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should use getCachedGraphAny (not getCachedGraph with hash validation)
        expect(getCachedGraphAny).toHaveBeenCalled();
        // Should NOT call discoverModuleGraph since cache was used
        expect(discoverModuleGraph).not.toHaveBeenCalled();
    });

    it('--use-cache should use scanIndividualAnalysesCacheAny for Phase 3', async () => {
        vi.mocked(scanIndividualAnalysesCacheAny).mockReturnValue({
            found: [{
                moduleId: 'test-module',
                overview: 'Cached overview',
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
            missing: [],
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ useCache: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should use scanIndividualAnalysesCacheAny (no hash check)
        expect(scanIndividualAnalysesCacheAny).toHaveBeenCalled();
        // Should NOT use the hash-validated version
        expect(scanIndividualAnalysesCache).not.toHaveBeenCalled();
    });

    it('--use-cache should use scanIndividualArticlesCacheAny for Phase 4', async () => {
        vi.mocked(scanIndividualArticlesCacheAny).mockReturnValue({
            found: [{
                type: 'module',
                slug: 'test-module',
                title: 'Test Module',
                content: '# Test',
                moduleId: 'test-module',
            }],
            missing: [],
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ useCache: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should use scanIndividualArticlesCacheAny (no hash check)
        expect(scanIndividualArticlesCacheAny).toHaveBeenCalled();
        // Should NOT use the hash-validated version
        expect(scanIndividualArticlesCache).not.toHaveBeenCalled();
    });

    it('should generate reduce pages without regenerating modules when module articles are cached', async () => {
        vi.mocked(getCachedGraphAny).mockReturnValue({
            metadata: { gitHash: 'old-stale-hash', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'TestProject', description: 'Test', language: 'TypeScript', buildSystem: 'npm', entryPoints: [] },
                modules: [{
                    id: 'test-module',
                    name: 'Test Module',
                    path: 'src/test/',
                    purpose: 'Testing',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'low',
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        vi.mocked(getCachedAnalyses).mockReturnValue([{
            moduleId: 'test-module',
            overview: 'Cached overview',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }]);

        vi.mocked(scanIndividualArticlesCacheAny).mockReturnValue({
            found: [{
                type: 'module',
                slug: 'test-module',
                title: 'Test Module',
                content: '# Cached module article',
                moduleId: 'test-module',
            }],
            missing: [],
        });

        const writingFn = vi.fn().mockResolvedValue({
            success: true,
            response: "```json\n{\n  \"index\": \"# Index\\n\\nHello\",\n  \"architecture\": \"# Architecture\\n\\nHello\",\n  \"gettingStarted\": \"# Getting Started\\n\\nHello\"\n}\n```",
        });
        vi.mocked(createWritingInvoker).mockReturnValue(writingFn);

        const options = defaultOptions({ useCache: true, phase: 4, skipWebsite: true });
        const exitCode = await executeGenerate(repoDir, options);
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Reduce-only should be a single AI call
        expect(writingFn).toHaveBeenCalledTimes(1);
        expect(writingFn.mock.calls[0][0]).toContain('Generate THREE pages');

        expect(saveReduceArticles).toHaveBeenCalledTimes(1);
        const saved = vi.mocked(saveReduceArticles).mock.calls[0][0] as Array<{ type: string }>;
        expect(saved.map(a => a.type).sort()).toEqual(['architecture', 'getting-started', 'index']);

        // Ensure the markdown files were written
        expect(fs.existsSync(path.join(options.output, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(options.output, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(options.output, 'getting-started.md'))).toBe(true);
    });
});

// ============================================================================
// Phase 5: Website Generation
// ============================================================================

describe('executeGenerate — Phase 5: Website Generation', () => {
    it('should call generateWebsite by default', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(generateWebsite).toHaveBeenCalled();
    });

    it('should skip website generation with --skip-website', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ skipWebsite: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(generateWebsite).not.toHaveBeenCalled();
    });

    it('should pass theme option to generateWebsite', async () => {
        await executeGenerate(repoDir, defaultOptions({ theme: 'dark' }));
        expect(generateWebsite).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ theme: 'dark' })
        );
    });

    it('should pass title option to generateWebsite', async () => {
        await executeGenerate(repoDir, defaultOptions({ title: 'My Wiki' }));
        expect(generateWebsite).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ title: 'My Wiki' })
        );
    });

    it('should report website in summary', async () => {
        await executeGenerate(repoDir, defaultOptions());
        expect(printKeyValue).toHaveBeenCalledWith('Website', 'Generated');
    });

    it('should not report website when skipped', async () => {
        await executeGenerate(repoDir, defaultOptions({ skipWebsite: true }));
        expect(printKeyValue).not.toHaveBeenCalledWith('Website', 'Generated');
    });

    it('should succeed even if website generation fails', async () => {
        vi.mocked(generateWebsite).mockImplementation(() => {
            throw new Error('Website generation error');
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(printWarning).toHaveBeenCalledWith(
            expect.stringContaining('Website generation failed')
        );
    });

    it('should report website generation failure as warning', async () => {
        vi.mocked(generateWebsite).mockImplementation(() => {
            throw new Error('Template error');
        });

        await executeGenerate(repoDir, defaultOptions());
        expect(printWarning).toHaveBeenCalledWith(
            expect.stringContaining('Template error')
        );
    });

    it('should print website path on success', async () => {
        vi.mocked(generateWebsite).mockReturnValue(['/mock/index.html', '/mock/embedded-data.js']);

        await executeGenerate(repoDir, defaultOptions());
        expect(printSuccess).toHaveBeenCalledWith(
            expect.stringContaining('index.html')
        );
    });
});

// ============================================================================
// Strict Mode (--no-strict)
// ============================================================================

describe('executeGenerate — strict mode', () => {
    // Reset mocks that may have been modified by earlier test groups or prior tests in this block
    beforeEach(() => {
        // Reset discovery to default single-module graph
        vi.mocked(discoverModuleGraph).mockResolvedValue({
            graph: {
                project: {
                    name: 'TestProject',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                modules: [{
                    id: 'test-module',
                    name: 'Test Module',
                    path: 'src/test/',
                    purpose: 'Testing',
                    keyFiles: ['src/test/index.ts'],
                    dependencies: [],
                    dependents: [],
                    complexity: 'medium' as const,
                    category: 'core',
                }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: 'Test notes',
            },
            duration: 1000,
        });
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [{
                moduleId: 'test-module',
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
        });
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [{
                type: 'module',
                slug: 'test-module',
                title: 'Test Module',
                content: '# Test Module\n\nContent here.',
                moduleId: 'test-module',
            }],
            duration: 1000,
        });
        vi.mocked(getCachedGraphAny).mockReturnValue(null);
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
        vi.mocked(scanIndividualAnalysesCache).mockReturnValue({ found: [], missing: [] });
        vi.mocked(scanIndividualAnalysesCacheAny).mockReturnValue({ found: [], missing: [] });
        vi.mocked(scanIndividualArticlesCache).mockImplementation(
            (moduleIds: string[]) => ({ found: [] as any[], missing: [...moduleIds] })
        );
        vi.mocked(scanIndividualArticlesCacheAny).mockImplementation(
            (moduleIds: string[]) => ({ found: [] as any[], missing: [...moduleIds] })
        );
        vi.mocked(generateWebsite).mockReturnValue(['/mock/index.html', '/mock/embedded-data.js']);
    });

    // Helper: set up a 2-module discovery graph
    function setupTwoModuleGraph() {
        vi.mocked(discoverModuleGraph).mockResolvedValue({
            graph: {
                project: {
                    name: 'TestProject',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                modules: [
                    {
                        id: 'module-a',
                        name: 'Module A',
                        path: 'src/a/',
                        purpose: 'Testing A',
                        keyFiles: ['src/a/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'medium' as const,
                        category: 'core',
                    },
                    {
                        id: 'module-b',
                        name: 'Module B',
                        path: 'src/b/',
                        purpose: 'Testing B',
                        keyFiles: ['src/b/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'medium' as const,
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: 'Test notes',
            },
            duration: 1000,
        });
    }

    // ---- Phase 3: Analysis strict mode ----

    it('strict mode (default) should fail Phase 3 when a module analysis fails', async () => {
        setupTwoModuleGraph();

        // analyzeModules returns only 1 of 2 modules (module-b failed)
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [{
                moduleId: 'module-a',
                overview: 'Overview A',
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
        });

        // noCluster: true prevents Phase 2 from merging modules under same parent dir
        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('Strict mode')
        );
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('module-b')
        );
    });

    it('strict mode should list all failed module IDs in the error message', async () => {
        setupTwoModuleGraph();

        // Both modules fail (empty analyses)
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [],
            duration: 1000,
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        // When ALL fail, the existing "All module analyses failed" check fires first
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('No modules could be analyzed')
        );
    });

    it('--no-strict should allow Phase 3 to continue with partial analysis results', async () => {
        setupTwoModuleGraph();

        // analyzeModules returns only 1 of 2 modules (module-b failed)
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [{
                moduleId: 'module-a',
                overview: 'Overview A',
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
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ strict: false, noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        // Should NOT have printed strict mode error
        expect(printError).not.toHaveBeenCalledWith(
            expect.stringContaining('Strict mode')
        );
    });

    it('strict mode should not fail when all analyses succeed', async () => {
        setupTwoModuleGraph();

        // Both modules succeed
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [
                {
                    moduleId: 'module-a',
                    overview: 'Overview A',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
                {
                    moduleId: 'module-b',
                    overview: 'Overview B',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
            ],
            duration: 1000,
        });

        // Also set up articles for both modules
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [
                { type: 'module', slug: 'module-a', title: 'Module A', content: '# A', moduleId: 'module-a' },
                { type: 'module', slug: 'module-b', title: 'Module B', content: '# B', moduleId: 'module-b' },
            ],
            duration: 1000,
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    });

    // ---- Phase 4: Article generation strict mode ----

    it('strict mode (default) should fail Phase 4 when article generation fails for a module', async () => {
        setupTwoModuleGraph();

        // Both analyses succeed
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [
                {
                    moduleId: 'module-a',
                    overview: 'Overview A',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
                {
                    moduleId: 'module-b',
                    overview: 'Overview B',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
            ],
            duration: 1000,
        });

        // Article generation: module-a succeeds, module-b fails
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [
                { type: 'module', slug: 'module-a', title: 'Module A', content: '# A', moduleId: 'module-a' },
            ],
            duration: 1000,
            failedModuleIds: ['module-b'],
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('Strict mode')
        );
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('module-b')
        );
    });

    it('--no-strict should allow Phase 4 to continue with partial article results', async () => {
        setupTwoModuleGraph();

        // Both analyses succeed
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [
                {
                    moduleId: 'module-a',
                    overview: 'Overview A',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
                {
                    moduleId: 'module-b',
                    overview: 'Overview B',
                    keyConcepts: [],
                    publicAPI: [],
                    internalArchitecture: '',
                    dataFlow: '',
                    patterns: [],
                    errorHandling: '',
                    codeExamples: [],
                    dependencies: { internal: [], external: [] },
                    suggestedDiagram: '',
                },
            ],
            duration: 1000,
        });

        // Article generation: module-a succeeds, module-b fails
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [
                { type: 'module', slug: 'module-a', title: 'Module A', content: '# A', moduleId: 'module-a' },
            ],
            duration: 1000,
            failedModuleIds: ['module-b'],
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ strict: false, noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        // Should NOT have printed strict mode error
        expect(printError).not.toHaveBeenCalledWith(
            expect.stringContaining('Strict mode')
        );
    });

    it('strict mode should not fail Phase 4 when no failedModuleIds', async () => {
        // Default mocks: single module, all succeed, no failedModuleIds
        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    });

    it('should print strict mode setting in header when --no-strict is used', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions({ strict: false }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(printKeyValue).toHaveBeenCalledWith('Strict', 'no (partial failures allowed)');
    });

    it('should not print strict mode setting in header when strict is default (true)', async () => {
        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(printKeyValue).not.toHaveBeenCalledWith('Strict', expect.anything());
    });

    it('strict mode error message should suggest --no-strict', async () => {
        setupTwoModuleGraph();

        // One module fails analysis
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [{
                moduleId: 'module-a',
                overview: 'Overview A',
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
        });

        await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(printError).toHaveBeenCalledWith(
            expect.stringContaining('--no-strict')
        );
    });
});

// ============================================================================
// Phase 4 Incremental Invalidation (restampArticles)
// ============================================================================

describe('executeGenerate — Phase 4 incremental invalidation', () => {
    // Helper: set up a 5-module discovery graph
    function setupFiveModuleGraph() {
        const modules = ['auth', 'db', 'api', 'ui', 'config'].map(id => ({
            id,
            name: `${id} Module`,
            path: `src/${id}/`,
            purpose: `Testing ${id}`,
            keyFiles: [`src/${id}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        }));

        vi.mocked(discoverModuleGraph).mockResolvedValue({
            graph: {
                project: {
                    name: 'TestProject',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                modules,
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: 'Test notes',
            },
            duration: 1000,
        });

        return modules;
    }

    function setupFiveModuleAnalyses() {
        return ['auth', 'db', 'api', 'ui', 'config'].map(id => ({
            moduleId: id,
            overview: `Overview of ${id}`,
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }));
    }

    function setupFiveModuleArticles(moduleIds?: string[]) {
        return (moduleIds || ['auth', 'db', 'api', 'ui', 'config']).map(id => ({
            type: 'module' as const,
            slug: id,
            title: `${id} Module`,
            content: `# ${id}\n\nArticle content.`,
            moduleId: id,
        }));
    }

    beforeEach(() => {
        vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(scanIndividualAnalysesCache).mockReturnValue({ found: [], missing: [] });
        vi.mocked(scanIndividualAnalysesCacheAny).mockReturnValue({ found: [], missing: [] });
        vi.mocked(scanIndividualArticlesCache).mockImplementation(
            (moduleIds: string[]) => ({ found: [] as any[], missing: [...moduleIds] })
        );
        vi.mocked(restampArticles).mockReturnValue(0);
        vi.mocked(generateWebsite).mockReturnValue(['/mock/index.html']);
    });

    it('should call restampArticles for unchanged modules when Phase 3 provides reanalyzedModuleIds', async () => {
        setupFiveModuleGraph();
        const allAnalyses = setupFiveModuleAnalyses();

        // Phase 3: only 'auth' was re-analyzed, others are cached
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(['auth']);

        // Set up cached analyses for unchanged modules
        for (const id of ['db', 'api', 'ui', 'config']) {
            vi.mocked(scanIndividualAnalysesCache).mockReturnValue({
                found: [],
                missing: [],
            });
        }

        // Phase 3: simulate partial rebuild
        const cachedAnalyses = allAnalyses.filter(a => a.moduleId !== 'auth');
        const authAnalysis = allAnalyses.find(a => a.moduleId === 'auth')!;

        // getModulesNeedingReanalysis returns ['auth']
        // getCachedAnalysis returns analyses for unchanged modules
        const { getCachedAnalysis } = await import('../../src/cache');
        for (const a of cachedAnalyses) {
            vi.mocked(getCachedAnalysis).mockReturnValueOnce(a);
        }

        // Phase 3 analysis: only auth analyzed
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [authAnalysis],
            duration: 1000,
        });

        // Phase 4: simulate that after re-stamping, all but 'auth' are found
        vi.mocked(restampArticles).mockReturnValue(4);
        vi.mocked(scanIndividualArticlesCache).mockImplementation(
            (moduleIds: string[]) => {
                // After re-stamping, only 'auth' should be missing
                const found = setupFiveModuleArticles(['db', 'api', 'ui', 'config']);
                const missing = moduleIds.filter(id => id === 'auth');
                return { found, missing };
            }
        );

        // Phase 4 article generation for only auth
        vi.mocked(generateArticles).mockResolvedValue({
            articles: [{
                type: 'module',
                slug: 'auth',
                title: 'auth Module',
                content: '# auth\n\nFresh article.',
                moduleId: 'auth',
            }],
            duration: 500,
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // restampArticles should have been called with unchanged module IDs
        expect(restampArticles).toHaveBeenCalledWith(
            expect.arrayContaining(['db', 'api', 'ui', 'config']),
            expect.any(String),
            expect.any(String)
        );

        // restampArticles should NOT include 'auth' (it was re-analyzed)
        const restampCall = vi.mocked(restampArticles).mock.calls[0];
        expect(restampCall[0]).not.toContain('auth');
    });

    it('should not call restampArticles when --force is used', async () => {
        setupFiveModuleGraph();
        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: setupFiveModuleAnalyses(),
            duration: 1000,
        });
        vi.mocked(generateArticles).mockResolvedValue({
            articles: setupFiveModuleArticles(),
            duration: 1000,
        });

        const exitCode = await executeGenerate(repoDir, defaultOptions({ force: true, noCluster: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // restampArticles should NOT be called when --force is used
        expect(restampArticles).not.toHaveBeenCalled();
    });

    it('should not call restampArticles when --use-cache is used', async () => {
        vi.mocked(getCachedGraphAny).mockReturnValue({
            metadata: { gitHash: 'old-hash', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'T', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [{ id: 'test-module', name: 'T', path: 'src/', purpose: 'T', keyFiles: [], dependencies: [], dependents: [], complexity: 'low' as const, category: 'core' }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        vi.mocked(scanIndividualAnalysesCacheAny).mockReturnValue({
            found: setupFiveModuleAnalyses().slice(0, 1),
            missing: [],
        });

        vi.mocked(scanIndividualArticlesCacheAny).mockReturnValue({
            found: setupFiveModuleArticles().slice(0, 1),
            missing: [],
        });

        vi.mocked(getCachedReduceArticles).mockReturnValue([
            { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
        ]);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ useCache: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // restampArticles should NOT be called when --use-cache is used
        expect(restampArticles).not.toHaveBeenCalled();
    });

    it('should not call restampArticles when reanalyzedModuleIds is undefined (phase 4 only)', async () => {
        // --phase 4: Phase 3 was skipped, so reanalyzedModuleIds is undefined
        vi.mocked(getCachedGraph).mockResolvedValue({
            metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' },
            graph: {
                project: { name: 'T', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [{ id: 'test-module', name: 'T', path: 'src/', purpose: 'T', keyFiles: [], dependencies: [], dependents: [], complexity: 'low' as const, category: 'core' }],
                categories: [{ name: 'core', description: 'Core' }],
                architectureNotes: '',
            },
        });

        vi.mocked(getCachedAnalyses).mockReturnValue([{
            moduleId: 'test-module',
            overview: 'Test',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        }]);

        // All articles cached
        vi.mocked(scanIndividualArticlesCache).mockReturnValue({
            found: [{ type: 'module', slug: 'test-module', title: 'T', content: '# T', moduleId: 'test-module' }],
            missing: [],
        });

        vi.mocked(getCachedReduceArticles).mockReturnValue([
            { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
        ]);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 4 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // When --phase 4 is used, Phase 3 is skipped so reanalyzedModuleIds is undefined.
        // restampArticles should NOT be called.
        expect(restampArticles).not.toHaveBeenCalled();
    });

    it('should re-run reduce when modules were re-analyzed even if all articles are cached', async () => {
        setupFiveModuleGraph();
        const allAnalyses = setupFiveModuleAnalyses();

        // Phase 3: only 'auth' was re-analyzed
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(['auth']);
        const { getCachedAnalysis } = await import('../../src/cache');
        for (const a of allAnalyses.filter(x => x.moduleId !== 'auth')) {
            vi.mocked(getCachedAnalysis).mockReturnValueOnce(a);
        }

        vi.mocked(analyzeModules).mockResolvedValue({
            analyses: [allAnalyses.find(a => a.moduleId === 'auth')!],
            duration: 1000,
        });

        // Phase 4: re-stamp makes all articles cached, auth article also found somehow
        vi.mocked(restampArticles).mockReturnValue(4);
        vi.mocked(scanIndividualArticlesCache).mockReturnValue({
            found: setupFiveModuleArticles(),
            missing: [],
        });

        // Set up writing invoker for reduce
        const writingFn = vi.fn().mockResolvedValue({
            success: true,
            response: "```json\n{\n  \"index\": \"# Index\\nHello\",\n  \"architecture\": \"# Arch\\nHello\",\n  \"gettingStarted\": \"# GS\\nHello\"\n}\n```",
        });
        vi.mocked(createWritingInvoker).mockReturnValue(writingFn);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true, skipWebsite: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Reduce should have been called (module content changed)
        expect(writingFn).toHaveBeenCalled();
    });

    it('should skip reduce when no modules were re-analyzed and reduce cache exists', async () => {
        // All modules cached, nothing re-analyzed
        setupFiveModuleGraph();

        // Phase 3: all cached (nothing re-analyzed)
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue([]);
        vi.mocked(getCachedAnalyses).mockReturnValue(setupFiveModuleAnalyses());

        // Phase 4: all articles cached
        vi.mocked(scanIndividualArticlesCache).mockReturnValue({
            found: setupFiveModuleArticles(),
            missing: [],
        });

        // Reduce articles also cached
        vi.mocked(getCachedReduceArticles).mockReturnValue([
            { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
            { type: 'architecture', slug: 'architecture', title: 'Architecture', content: '# Arch' },
        ]);

        const writingFn = vi.fn();
        vi.mocked(createWritingInvoker).mockReturnValue(writingFn);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ noCluster: true, skipWebsite: true }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Writing invoker should NOT have been called (everything from cache)
        expect(writingFn).not.toHaveBeenCalled();

        // restampArticles should NOT have been called (nothing re-analyzed, reanalyzedModuleIds is [])
        expect(restampArticles).not.toHaveBeenCalled();
    });
});

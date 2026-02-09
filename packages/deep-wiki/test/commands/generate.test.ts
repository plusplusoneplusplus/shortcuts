/**
 * Generate Command Tests
 *
 * Tests for the full four-phase generate command orchestration:
 * Phase 1→2→3→4 flow, --phase skipping, --force bypass, --skip-website, and error handling.
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
    scanIndividualAnalysesCache: vi.fn().mockReturnValue({ found: [], missing: [] }),
    scanIndividualAnalysesCacheAny: vi.fn().mockReturnValue({ found: [], missing: [] }),
    // Article cache functions (Phase 3)
    saveArticle: vi.fn(),
    saveAllArticles: vi.fn().mockResolvedValue(undefined),
    scanIndividualArticlesCache: vi.fn().mockImplementation(
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
    ),
    scanIndividualArticlesCacheAny: vi.fn().mockImplementation(
        (moduleIds: string[]) => ({ found: [], missing: [...moduleIds] })
    ),
    // Reduce article cache functions (Phase 3 reduce)
    getCachedReduceArticles: vi.fn().mockReturnValue(null),
    saveReduceArticles: vi.fn(),
}));

// Mock website generator
vi.mock('../../src/writing/website-generator', () => ({
    generateWebsite: vi.fn().mockReturnValue(['/mock/index.html', '/mock/embedded-data.js']),
}));

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
    saveAnalysis,
    saveReduceArticles,
} from '../../src/cache';
import { discoverModuleGraph } from '../../src/discovery';
import { generateWebsite } from '../../src/writing/website-generator';
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

    // Re-set default mocks
    vi.mocked(checkAIAvailability).mockResolvedValue({ available: true });
    vi.mocked(getCachedGraph).mockResolvedValue(null);
    vi.mocked(getCachedAnalyses).mockReturnValue(null);
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
        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 5 }));
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
    it('should run all three phases and return SUCCESS', async () => {
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
    it('--phase 2 should skip discovery and use cached graph', async () => {
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

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        expect(discoverModuleGraph).not.toHaveBeenCalled();
    });

    it('--phase 2 should error when no cached graph exists', async () => {
        vi.mocked(getCachedGraph).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 2 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('--phase 3 should error when no cached analyses exist', async () => {
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

        const exitCode = await executeGenerate(repoDir, defaultOptions({ phase: 3 }));
        expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
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
        vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');

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
        vi.mocked(getRepoHeadHash).mockResolvedValue(null);

        const exitCode = await executeGenerate(repoDir, defaultOptions());
        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        // Should NOT have called scanIndividualAnalysesCache when no git hash
        expect(scanIndividualAnalysesCache).not.toHaveBeenCalled();
    });

    it('should log recovery info when partial cache is found', async () => {
        vi.mocked(getModulesNeedingReanalysis).mockResolvedValue(null);
        vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');

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

    it('--use-cache should use scanIndividualAnalysesCacheAny for Phase 2', async () => {
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

    it('--use-cache should use scanIndividualArticlesCacheAny for Phase 3', async () => {
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

        const options = defaultOptions({ useCache: true, phase: 3, skipWebsite: true });
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
// Phase 4: Website Generation
// ============================================================================

describe('executeGenerate — Phase 4: Website Generation', () => {
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

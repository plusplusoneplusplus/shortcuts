/**
 * Theme Command Tests
 *
 * Tests for the `deep-wiki theme` command orchestration:
 * --list, --check, --force, full pipeline (mocked), cache, error handling.
 *
 * Uses extensive mocking since the actual AI calls are integration-tested separately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXIT_CODES } from '../../src/cli';

// ============================================================================
// Mocks
// ============================================================================

// Mock AI invoker
vi.mock('../../src/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

// Mock cache module
vi.mock('../../src/cache', () => ({
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
}));

// Mock theme cache module
vi.mock('../../src/cache/theme-cache', () => ({
    getCachedThemeProbe: vi.fn().mockReturnValue(null),
    saveThemeProbe: vi.fn(),
    getCachedThemeOutline: vi.fn().mockReturnValue(null),
    saveThemeOutline: vi.fn(),
    getCachedThemeAnalysis: vi.fn().mockReturnValue(null),
    saveThemeAnalysis: vi.fn(),
    getCachedThemeArticles: vi.fn().mockReturnValue(null),
    saveThemeArticle: vi.fn(),
    isThemeCacheValid: vi.fn().mockReturnValue(false),
    clearThemeCache: vi.fn().mockReturnValue(false),
}));

// Mock theme modules
vi.mock('../../src/theme', () => ({
    loadWikiGraph: vi.fn().mockReturnValue(null),
    listThemeAreas: vi.fn().mockReturnValue([]),
    checkThemeCoverage: vi.fn().mockReturnValue({ status: 'new', relatedComponents: [] }),
    runSingleThemeProbe: vi.fn().mockResolvedValue({
        probeResult: {
            foundComponents: [
                { id: 'mod-a', name: 'Module A', path: 'src/a/', purpose: 'Test', keyFiles: ['src/a/index.ts'], evidence: 'found' },
                { id: 'mod-b', name: 'Module B', path: 'src/b/', purpose: 'Test', keyFiles: ['src/b/index.ts'], evidence: 'found' },
                { id: 'mod-c', name: 'Module C', path: 'src/c/', purpose: 'Test', keyFiles: ['src/c/index.ts'], evidence: 'found' },
            ],
        },
        existingModuleIds: [],
        newModuleIds: ['mod-a', 'mod-b', 'mod-c'],
        allKeyFiles: ['src/a/index.ts', 'src/b/index.ts', 'src/c/index.ts'],
    }),
    generateThemeOutline: vi.fn().mockResolvedValue({
        themeId: 'compaction',
        title: 'Compaction',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Compaction Overview', description: 'Overview', isIndex: true, coveredComponentIds: ['mod-a', 'mod-b', 'mod-c'], coveredFiles: [] },
            { slug: 'mod-a', title: 'Module A', description: 'Details A', isIndex: false, coveredComponentIds: ['mod-a'], coveredFiles: ['src/a/index.ts'] },
            { slug: 'mod-b', title: 'Module B', description: 'Details B', isIndex: false, coveredComponentIds: ['mod-b'], coveredFiles: ['src/b/index.ts'] },
        ],
        involvedComponents: [
            { componentId: 'mod-a', role: 'Test', keyFiles: ['src/a/index.ts'] },
            { componentId: 'mod-b', role: 'Test', keyFiles: ['src/b/index.ts'] },
            { componentId: 'mod-c', role: 'Test', keyFiles: ['src/c/index.ts'] },
        ],
    }),
    runThemeAnalysis: vi.fn().mockResolvedValue({
        themeId: 'compaction',
        overview: 'Overview of compaction',
        perArticle: [
            { slug: 'mod-a', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
            { slug: 'mod-b', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
        ],
        crossCutting: { architecture: '', dataFlow: '', suggestedDiagram: '' },
    }),
    generateThemeArticles: vi.fn().mockResolvedValue({
        articles: [
            { type: 'theme-index', slug: 'index', title: 'Compaction Overview', content: '# Compaction\n\nOverview', themeId: 'compaction', coveredComponentIds: ['mod-a', 'mod-b', 'mod-c'] },
            { type: 'theme-article', slug: 'mod-a', title: 'Module A', content: '# Module A\n\nDetails', themeId: 'compaction', coveredComponentIds: ['mod-a'] },
            { type: 'theme-article', slug: 'mod-b', title: 'Module B', content: '# Module B\n\nDetails', themeId: 'compaction', coveredComponentIds: ['mod-b'] },
        ],
        duration: 1000,
    }),
    writeThemeArticles: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], themeDir: 'themes/compaction' }),
    integrateThemeIntoWiki: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], updatedFiles: [] }),
}));

// Mock writing module
vi.mock('../../src/writing', () => ({
    generateWebsite: vi.fn().mockReturnValue(['index.html']),
}));

// ============================================================================
// Test Setup
// ============================================================================

let tmpDir: string;
let stderrOutput: string;
const originalStderrWrite = process.stderr.write;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-theme-test-'));
    stderrOutput = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
    }) as typeof process.stderr.write;

    // Reset all mock implementations to defaults
    const aiInvoker = await import('../../src/ai-invoker');
    vi.mocked(aiInvoker.checkAIAvailability).mockResolvedValue({ available: true });

    const cache = await import('../../src/cache');
    vi.mocked(cache.getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');

    const themeCache = await import('../../src/cache/theme-cache');
    vi.mocked(themeCache.getCachedThemeProbe).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeOutline).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeAnalysis).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeArticles).mockReturnValue(null);
    vi.mocked(themeCache.isThemeCacheValid).mockReturnValue(false);

    const theme = await import('../../src/theme');
    vi.mocked(theme.loadWikiGraph).mockReturnValue(null);
    vi.mocked(theme.listThemeAreas).mockReturnValue([]);
    vi.mocked(theme.checkThemeCoverage).mockReturnValue({ status: 'new', relatedComponents: [] });
    vi.mocked(theme.runSingleThemeProbe).mockResolvedValue({
        probeResult: {
            foundComponents: [
                { id: 'mod-a', name: 'Module A', path: 'src/a/', purpose: 'Test', keyFiles: ['src/a/index.ts'], evidence: 'found' },
                { id: 'mod-b', name: 'Module B', path: 'src/b/', purpose: 'Test', keyFiles: ['src/b/index.ts'], evidence: 'found' },
                { id: 'mod-c', name: 'Module C', path: 'src/c/', purpose: 'Test', keyFiles: ['src/c/index.ts'], evidence: 'found' },
            ],
        },
        existingModuleIds: [],
        newModuleIds: ['mod-a', 'mod-b', 'mod-c'],
        allKeyFiles: ['src/a/index.ts', 'src/b/index.ts', 'src/c/index.ts'],
    } as any);
    vi.mocked(theme.generateThemeOutline).mockResolvedValue({
        themeId: 'compaction',
        title: 'Compaction',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Compaction Overview', description: 'Overview', isIndex: true, coveredComponentIds: ['mod-a', 'mod-b', 'mod-c'], coveredFiles: [] },
            { slug: 'mod-a', title: 'Module A', description: 'Details A', isIndex: false, coveredComponentIds: ['mod-a'], coveredFiles: ['src/a/index.ts'] },
            { slug: 'mod-b', title: 'Module B', description: 'Details B', isIndex: false, coveredComponentIds: ['mod-b'], coveredFiles: ['src/b/index.ts'] },
        ],
        involvedComponents: [
            { componentId: 'mod-a', role: 'Test', keyFiles: ['src/a/index.ts'] },
            { componentId: 'mod-b', role: 'Test', keyFiles: ['src/b/index.ts'] },
            { componentId: 'mod-c', role: 'Test', keyFiles: ['src/c/index.ts'] },
        ],
    });
    vi.mocked(theme.runThemeAnalysis).mockResolvedValue({
        themeId: 'compaction',
        overview: 'Overview of compaction',
        perArticle: [
            { slug: 'mod-a', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
            { slug: 'mod-b', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
        ],
        crossCutting: { architecture: '', dataFlow: '', suggestedDiagram: '' },
    });
    vi.mocked(theme.generateThemeArticles).mockResolvedValue({
        articles: [
            { type: 'theme-index', slug: 'index', title: 'Compaction Overview', content: '# Compaction\n\nOverview', themeId: 'compaction', coveredComponentIds: ['mod-a', 'mod-b', 'mod-c'] },
            { type: 'theme-article', slug: 'mod-a', title: 'Module A', content: '# Module A\n\nDetails', themeId: 'compaction', coveredComponentIds: ['mod-a'] },
            { type: 'theme-article', slug: 'mod-b', title: 'Module B', content: '# Module B\n\nDetails', themeId: 'compaction', coveredComponentIds: ['mod-b'] },
        ],
        duration: 1000,
    });
    vi.mocked(theme.integrateThemeIntoWiki).mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], updatedFiles: [] });
});

afterEach(() => {
    process.stderr.write = originalStderrWrite;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('executeTheme', () => {
    // Helper to import executeTheme fresh for each test
    async function getExecuteTheme() {
        const { executeTheme } = await import('../../src/commands/theme');
        return executeTheme;
    }

    function makeOptions(overrides: Partial<import('../../src/types').ThemeCommandOptions> = {}): import('../../src/types').ThemeCommandOptions {
        return {
            theme: 'compaction',
            wiki: path.join(tmpDir, 'wiki'),
            force: false,
            check: false,
            list: false,
            depth: 'normal',
            timeout: 120,
            concurrency: 3,
            noCrossLink: false,
            noWebsite: false,
            interactive: false,
            verbose: false,
            ...overrides,
        };
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    describe('validation', () => {
        it('should return CONFIG_ERROR for non-existent repo path', async () => {
            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme('/nonexistent/path', 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('does not exist');
        });

        it('should return CONFIG_ERROR when repo path is a file', async () => {
            const filePath = path.join(tmpDir, 'not-a-dir.txt');
            fs.writeFileSync(filePath, 'content');

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(filePath, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('not a directory');
        });

        it('should return CONFIG_ERROR when theme name is missing (non-list)', async () => {
            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, undefined, makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('Theme name is required');
        });
    });

    // ------------------------------------------------------------------
    // --list flow
    // ------------------------------------------------------------------

    describe('--list flow', () => {
        it('should list themes from wiki and return SUCCESS', async () => {
            const { listThemeAreas } = await import('../../src/theme');
            vi.mocked(listThemeAreas).mockReturnValue([
                {
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM-tree compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'Overview', path: 'themes/compaction/index.md' }],
                    involvedComponentIds: ['mod-a'],
                    directoryPath: 'themes/compaction',
                    generatedAt: Date.now(),
                },
            ]);

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, undefined, makeOptions({ list: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('Compaction');
        });

        it('should print info when no themes exist', async () => {
            const { listThemeAreas } = await import('../../src/theme');
            vi.mocked(listThemeAreas).mockReturnValue([]);

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, undefined, makeOptions({ list: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('No theme areas found');
        });
    });

    // ------------------------------------------------------------------
    // --check flow
    // ------------------------------------------------------------------

    describe('--check flow', () => {
        it('should print coverage result and return SUCCESS', async () => {
            const { loadWikiGraph, checkThemeCoverage } = await import('../../src/theme');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                components: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkThemeCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'themes/compaction/index.md',
                relatedComponents: [],
            });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions({ check: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('fully covered');
        });

        it('should report new theme when no wiki exists', async () => {
            const { loadWikiGraph } = await import('../../src/theme');
            vi.mocked(loadWikiGraph).mockReturnValue(null);

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions({ check: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('new');
        });
    });

    // ------------------------------------------------------------------
    // Theme exists (no --force)
    // ------------------------------------------------------------------

    describe('theme exists without --force', () => {
        it('should return SUCCESS with info message', async () => {
            const { loadWikiGraph, checkThemeCoverage } = await import('../../src/theme');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                components: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkThemeCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'themes/compaction/index.md',
                relatedComponents: [],
            });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('already covered');
            expect(stderrOutput).toContain('--force');
        });
    });

    // ------------------------------------------------------------------
    // Theme exists (with --force)
    // ------------------------------------------------------------------

    describe('theme exists with --force', () => {
        it('should proceed with generation', async () => {
            const { loadWikiGraph, checkThemeCoverage, runSingleThemeProbe } = await import('../../src/theme');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                components: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkThemeCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'themes/compaction/index.md',
                relatedComponents: [],
            });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions({ force: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(runSingleThemeProbe).toHaveBeenCalled();
            expect(stderrOutput).toContain('Theme area generated');
        });
    });

    // ------------------------------------------------------------------
    // AI unavailable
    // ------------------------------------------------------------------

    describe('AI unavailable', () => {
        it('should return AI_UNAVAILABLE exit code', async () => {
            const { checkAIAvailability } = await import('../../src/ai-invoker');
            vi.mocked(checkAIAvailability).mockResolvedValue({ available: false, reason: 'No SDK' });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
            expect(stderrOutput).toContain('not available');
        });
    });

    // ------------------------------------------------------------------
    // Empty probe result
    // ------------------------------------------------------------------

    describe('empty probe result', () => {
        it('should return EXECUTION_ERROR with helpful message', async () => {
            const { runSingleThemeProbe } = await import('../../src/theme');
            vi.mocked(runSingleThemeProbe).mockResolvedValue({
                probeResult: { foundComponents: [] },
                existingModuleIds: [],
                newModuleIds: [],
                allKeyFiles: [],
            });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'nonexistent-theme', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
            expect(stderrOutput).toContain('no related components');
            expect(stderrOutput).toContain('Suggestions');
        });
    });

    // ------------------------------------------------------------------
    // Full pipeline (mocked)
    // ------------------------------------------------------------------

    describe('full pipeline', () => {
        it('should run all phases and return SUCCESS', async () => {
            const theme = await import('../../src/theme');

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);

            // Verify orchestration order
            expect(theme.runSingleThemeProbe).toHaveBeenCalled();
            expect(theme.generateThemeOutline).toHaveBeenCalled();
            expect(theme.runThemeAnalysis).toHaveBeenCalled();
            expect(theme.generateThemeArticles).toHaveBeenCalled();
            expect(theme.integrateThemeIntoWiki).toHaveBeenCalled();

            // Verify summary output
            expect(stderrOutput).toContain('Theme area generated');
            expect(stderrOutput).toContain('3 articles');
            expect(stderrOutput).toContain('3 components');
        });

        it('should print header with correct info', async () => {
            const executeTheme = await getExecuteTheme();
            await executeTheme(tmpDir, 'compaction', makeOptions({ description: 'LSM-tree compaction' }));

            expect(stderrOutput).toContain('Theme Generation');
            expect(stderrOutput).toContain('compaction');
            expect(stderrOutput).toContain('LSM-tree compaction');
            expect(stderrOutput).toContain('normal');
        });
    });

    // ------------------------------------------------------------------
    // Cache hit
    // ------------------------------------------------------------------

    describe('cache hit', () => {
        it('should use cached probe when cache is valid', async () => {
            const { isThemeCacheValid, getCachedThemeProbe } = await import('../../src/cache/theme-cache');
            const { runSingleThemeProbe } = await import('../../src/theme');

            vi.mocked(isThemeCacheValid).mockReturnValue(true);
            vi.mocked(getCachedThemeProbe).mockReturnValue({
                probeResult: {
                    foundComponents: [
                        { id: 'cached-mod', name: 'Cached', path: 'src/cached/', purpose: 'Cached', keyFiles: ['src/cached/index.ts'], evidence: 'cached' },
                    ],
                },
                existingModuleIds: [],
                newModuleIds: ['cached-mod'],
                allKeyFiles: ['src/cached/index.ts'],
            });

            const executeTheme = await getExecuteTheme();
            await executeTheme(tmpDir, 'compaction', makeOptions());

            // Should NOT call the real probe since cache was used
            expect(runSingleThemeProbe).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // Partial article failure
    // ------------------------------------------------------------------

    describe('partial article failure', () => {
        it('should complete with warnings', async () => {
            const { generateThemeArticles } = await import('../../src/theme');
            vi.mocked(generateThemeArticles).mockResolvedValue({
                articles: [
                    { type: 'theme-index', slug: 'index', title: 'Overview', content: '# Overview', themeId: 'compaction', coveredComponentIds: [] },
                ],
                duration: 1000,
                failedSlugs: ['mod-a', 'mod-b'],
            });

            const executeTheme = await getExecuteTheme();
            const exitCode = await executeTheme(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('2 article(s) failed');
        });
    });

    // ------------------------------------------------------------------
    // Theme name normalization
    // ------------------------------------------------------------------

    describe('theme name normalization', () => {
        it('should normalize spaces to hyphens and lowercase', async () => {
            const { runSingleThemeProbe } = await import('../../src/theme');

            const executeTheme = await getExecuteTheme();
            await executeTheme(tmpDir, 'My Theme Name', makeOptions());

            expect(runSingleThemeProbe).toHaveBeenCalledWith(
                expect.objectContaining({
                    theme: expect.objectContaining({ theme: 'my-theme-name' }),
                })
            );
        });
    });
});

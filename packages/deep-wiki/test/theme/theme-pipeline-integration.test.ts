/**
 * Theme Pipeline Integration Tests
 *
 * Gap: test/commands/theme.test.ts mocks everything. No test wires
 * probe → outline → analysis → article-generator end-to-end and verifies
 * that each phase actually receives the output of the previous phase.
 * theme.test.ts explicitly notes it defers to "integration tests" that don't exist.
 *
 * These tests verify phase-to-phase data flow by capturing call arguments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXIT_CODES } from '../../src/cli';

// ============================================================================
// Hoisted mock data — must be defined before vi.mock() factory references them
// ============================================================================

const {
    MOCK_PROBE_RESULT,
    MOCK_OUTLINE,
    MOCK_ANALYSIS,
    MOCK_ARTICLES,
} = vi.hoisted(() => {
    const MOCK_PROBE_RESULT = {
        probeResult: {
            foundComponents: [
                { id: 'auth', name: 'Auth', path: 'src/auth/', purpose: 'Authentication', keyFiles: ['src/auth/index.ts'], evidence: 'found' },
                { id: 'session', name: 'Session', path: 'src/session/', purpose: 'Session management', keyFiles: ['src/session/index.ts'], evidence: 'found' },
            ],
        },
        existingModuleIds: [] as string[],
        newModuleIds: ['auth', 'session'],
        allKeyFiles: ['src/auth/index.ts', 'src/session/index.ts'],
    };

    const MOCK_OUTLINE = {
        themeId: 'authentication',
        title: 'Authentication Flow',
        layout: 'area' as const,
        articles: [
            { slug: 'index', title: 'Authentication Overview', description: 'Overview', isIndex: true, coveredComponentIds: ['auth', 'session'], coveredFiles: [] },
            { slug: 'auth', title: 'Auth Module', description: 'Details', isIndex: false, coveredComponentIds: ['auth'], coveredFiles: ['src/auth/index.ts'] },
        ],
        involvedComponents: [
            { componentId: 'auth', role: 'Core', keyFiles: ['src/auth/index.ts'] },
            { componentId: 'session', role: 'Support', keyFiles: ['src/session/index.ts'] },
        ],
    };

    const MOCK_ANALYSIS = {
        themeId: 'authentication',
        overview: 'Authentication system overview',
        perArticle: [
            { slug: 'auth', keyConcepts: ['JWT', 'OAuth'], dataFlow: 'token flow', codeExamples: [], internalDetails: 'auth internals' },
        ],
        crossCutting: { architecture: 'layered', dataFlow: 'stateless', suggestedDiagram: '' },
    };

    const MOCK_ARTICLES = {
        articles: [
            { type: 'theme-index', slug: 'index', title: 'Authentication Overview', content: '# Auth\n\nOverview', themeId: 'authentication', coveredComponentIds: ['auth', 'session'] },
            { type: 'theme-article', slug: 'auth', title: 'Auth Module', content: '# Auth Module\n\nDetails', themeId: 'authentication', coveredComponentIds: ['auth'] },
        ],
        duration: 500,
    };

    return { MOCK_PROBE_RESULT, MOCK_OUTLINE, MOCK_ANALYSIS, MOCK_ARTICLES };
});

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/ai-invoker', function () { return ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
}); });

vi.mock('../../src/cache', function () { return ({
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
}); });

vi.mock('../../src/cache/theme-cache', function () { return ({
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
}); });

vi.mock('../../src/theme', function () { return ({
    loadWikiGraph: vi.fn().mockReturnValue(null),
    listThemeAreas: vi.fn().mockReturnValue([]),
    checkThemeCoverage: vi.fn().mockReturnValue({ status: 'new', relatedComponents: [] }),
    runSingleThemeProbe: vi.fn().mockResolvedValue(MOCK_PROBE_RESULT),
    generateThemeOutline: vi.fn().mockResolvedValue(MOCK_OUTLINE),
    runThemeAnalysis: vi.fn().mockResolvedValue(MOCK_ANALYSIS),
    generateThemeArticles: vi.fn().mockResolvedValue(MOCK_ARTICLES),
    writeThemeArticles: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'auth.md'], themeDir: 'themes/authentication' }),
    integrateThemeIntoWiki: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'auth.md'], updatedFiles: [] }),
}); });

vi.mock('../../src/writing', function () { return ({
    generateWebsite: vi.fn().mockReturnValue(['index.html']),
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
}); });

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { executeTheme } from '../../src/commands/theme';

// ============================================================================
// Test Setup
// ============================================================================

let tmpDir: string;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-theme-pipeline-test-'));

    // Create minimal repo fixture files
    fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export function login() {}');
    fs.writeFileSync(path.join(tmpDir, 'session.ts'), 'export class Session {}');

    // Reset mocks to defaults
    const aiInvoker = await import('../../src/ai-invoker');
    vi.mocked(aiInvoker.checkAIAvailability).mockResolvedValue({ available: true });

    const themeCache = await import('../../src/cache/theme-cache');
    vi.mocked(themeCache.getCachedThemeProbe).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeOutline).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeAnalysis).mockReturnValue(null);
    vi.mocked(themeCache.getCachedThemeArticles).mockReturnValue(null);
    vi.mocked(themeCache.isThemeCacheValid).mockReturnValue(false);

    const theme = await import('../../src/theme');
    vi.mocked(theme.runSingleThemeProbe).mockResolvedValue(MOCK_PROBE_RESULT as any);
    vi.mocked(theme.generateThemeOutline).mockResolvedValue(MOCK_OUTLINE as any);
    vi.mocked(theme.runThemeAnalysis).mockResolvedValue(MOCK_ANALYSIS as any);
    vi.mocked(theme.generateThemeArticles).mockResolvedValue(MOCK_ARTICLES as any);
    vi.mocked(theme.integrateThemeIntoWiki).mockReturnValue({ writtenFiles: ['index.md', 'auth.md'], updatedFiles: [] });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
});

function makeOptions(overrides: Partial<import('../../src/types').ThemeCommandOptions> = {}): import('../../src/types').ThemeCommandOptions {
    return {
        theme: 'authentication',
        wiki: path.join(tmpDir, '.wiki'),
        force: false,
        check: false,
        list: false,
        depth: 'normal',
        timeout: 60,
        concurrency: 1,
        noCrossLink: false,
        noWebsite: true,
        interactive: false,
        verbose: false,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Theme pipeline integration (mock AI)', () => {
    it('probe → outline → analysis → articles flow completes successfully', async () => {
        const exitCode = await executeTheme(tmpDir, 'authentication', makeOptions());

        expect(exitCode).toBe(EXIT_CODES.SUCCESS);

        const theme = await import('../../src/theme');
        expect(vi.mocked(theme.runSingleThemeProbe)).toHaveBeenCalledOnce();
        expect(vi.mocked(theme.generateThemeOutline)).toHaveBeenCalledOnce();
        expect(vi.mocked(theme.runThemeAnalysis)).toHaveBeenCalledOnce();
        expect(vi.mocked(theme.generateThemeArticles)).toHaveBeenCalledOnce();
        expect(vi.mocked(theme.integrateThemeIntoWiki)).toHaveBeenCalledOnce();
    });

    it('generateThemeOutline receives probeResult from probe phase', async () => {
        await executeTheme(tmpDir, 'authentication', makeOptions());

        const theme = await import('../../src/theme');
        const outlineCall = vi.mocked(theme.generateThemeOutline).mock.calls[0][0];

        // Outline phase should receive the probe result returned by runSingleThemeProbe
        expect(outlineCall.probeResult).toEqual(MOCK_PROBE_RESULT);
    });

    it('runThemeAnalysis receives outline from outline phase', async () => {
        await executeTheme(tmpDir, 'authentication', makeOptions());

        const theme = await import('../../src/theme');
        const analysisCall = vi.mocked(theme.runThemeAnalysis).mock.calls[0][0];

        // Analysis phase should receive the outline returned by generateThemeOutline
        expect(analysisCall.outline).toEqual(MOCK_OUTLINE);
    });

    it('generateThemeArticles receives outline and analysis from earlier phases', async () => {
        await executeTheme(tmpDir, 'authentication', makeOptions());

        const theme = await import('../../src/theme');
        const articlesCall = vi.mocked(theme.generateThemeArticles).mock.calls[0][0];

        // Article phase should receive both outline and analysis
        expect(articlesCall.outline).toEqual(MOCK_OUTLINE);
        expect(articlesCall.analysis).toEqual(MOCK_ANALYSIS);
        expect(articlesCall.themeId).toBe('authentication');
    });

    it('integrateThemeIntoWiki receives outline and generated articles', async () => {
        await executeTheme(tmpDir, 'authentication', makeOptions());

        const theme = await import('../../src/theme');
        const integrationCall = vi.mocked(theme.integrateThemeIntoWiki).mock.calls[0][0];

        expect(integrationCall.outline).toEqual(MOCK_OUTLINE);
        expect(integrationCall.articles).toEqual(MOCK_ARTICLES.articles);
        expect(integrationCall.themeId).toBe('authentication');
    });

    it('gracefully handles probe returning no components — exits without calling downstream phases', async () => {
        const theme = await import('../../src/theme');
        vi.mocked(theme.runSingleThemeProbe).mockResolvedValue({
            probeResult: { foundComponents: [] },
            existingModuleIds: [],
            newModuleIds: [],
            allKeyFiles: [],
        } as any);

        const exitCode = await executeTheme(tmpDir, 'authentication', makeOptions());

        // Non-zero exit because no components found
        expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
        // Downstream phases should NOT be called when probe finds nothing
        expect(vi.mocked(theme.generateThemeOutline)).not.toHaveBeenCalled();
        expect(vi.mocked(theme.runThemeAnalysis)).not.toHaveBeenCalled();
        expect(vi.mocked(theme.generateThemeArticles)).not.toHaveBeenCalled();
    });

    it('uses cached probe result and passes it to outline phase', async () => {
        const themeCache = await import('../../src/cache/theme-cache');
        // Simulate a valid cache hit
        vi.mocked(themeCache.isThemeCacheValid).mockReturnValue(true);
        vi.mocked(themeCache.getCachedThemeProbe).mockReturnValue(MOCK_PROBE_RESULT as any);

        await executeTheme(tmpDir, 'authentication', makeOptions());

        const theme = await import('../../src/theme');
        // Probe AI should NOT be called when cache is valid
        expect(vi.mocked(theme.runSingleThemeProbe)).not.toHaveBeenCalled();
        // But outline should still be called with the cached probe result
        const outlineCall = vi.mocked(theme.generateThemeOutline).mock.calls[0][0];
        expect(outlineCall.probeResult).toEqual(MOCK_PROBE_RESULT);
    });

    it('theme name is normalized to kebab-case before being passed to phases', async () => {
        const theme = await import('../../src/theme');

        await executeTheme(tmpDir, 'My Auth Flow', makeOptions());

        const probeCall = vi.mocked(theme.runSingleThemeProbe).mock.calls[0][0];
        expect(probeCall.theme.theme).toBe('my-auth-flow');
    });
});

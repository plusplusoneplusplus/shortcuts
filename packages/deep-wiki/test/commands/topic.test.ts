/**
 * Topic Command Tests
 *
 * Tests for the `deep-wiki topic` command orchestration:
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

// Mock topic cache module
vi.mock('../../src/cache/topic-cache', () => ({
    getCachedTopicProbe: vi.fn().mockReturnValue(null),
    saveTopicProbe: vi.fn(),
    getCachedTopicOutline: vi.fn().mockReturnValue(null),
    saveTopicOutline: vi.fn(),
    getCachedTopicAnalysis: vi.fn().mockReturnValue(null),
    saveTopicAnalysis: vi.fn(),
    getCachedTopicArticles: vi.fn().mockReturnValue(null),
    saveTopicArticle: vi.fn(),
    isTopicCacheValid: vi.fn().mockReturnValue(false),
    clearTopicCache: vi.fn().mockReturnValue(false),
}));

// Mock topic modules
vi.mock('../../src/topic', () => ({
    loadWikiGraph: vi.fn().mockReturnValue(null),
    listTopicAreas: vi.fn().mockReturnValue([]),
    checkTopicCoverage: vi.fn().mockReturnValue({ status: 'new', relatedModules: [] }),
    runSingleTopicProbe: vi.fn().mockResolvedValue({
        probeResult: {
            foundModules: [
                { id: 'mod-a', name: 'Module A', path: 'src/a/', purpose: 'Test', keyFiles: ['src/a/index.ts'], evidence: 'found' },
                { id: 'mod-b', name: 'Module B', path: 'src/b/', purpose: 'Test', keyFiles: ['src/b/index.ts'], evidence: 'found' },
                { id: 'mod-c', name: 'Module C', path: 'src/c/', purpose: 'Test', keyFiles: ['src/c/index.ts'], evidence: 'found' },
            ],
        },
        existingModuleIds: [],
        newModuleIds: ['mod-a', 'mod-b', 'mod-c'],
        allKeyFiles: ['src/a/index.ts', 'src/b/index.ts', 'src/c/index.ts'],
    }),
    generateTopicOutline: vi.fn().mockResolvedValue({
        topicId: 'compaction',
        title: 'Compaction',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Compaction Overview', description: 'Overview', isIndex: true, coveredModuleIds: ['mod-a', 'mod-b', 'mod-c'], coveredFiles: [] },
            { slug: 'mod-a', title: 'Module A', description: 'Details A', isIndex: false, coveredModuleIds: ['mod-a'], coveredFiles: ['src/a/index.ts'] },
            { slug: 'mod-b', title: 'Module B', description: 'Details B', isIndex: false, coveredModuleIds: ['mod-b'], coveredFiles: ['src/b/index.ts'] },
        ],
        involvedModules: [
            { moduleId: 'mod-a', role: 'Test', keyFiles: ['src/a/index.ts'] },
            { moduleId: 'mod-b', role: 'Test', keyFiles: ['src/b/index.ts'] },
            { moduleId: 'mod-c', role: 'Test', keyFiles: ['src/c/index.ts'] },
        ],
    }),
    runTopicAnalysis: vi.fn().mockResolvedValue({
        topicId: 'compaction',
        overview: 'Overview of compaction',
        perArticle: [
            { slug: 'mod-a', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
            { slug: 'mod-b', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
        ],
        crossCutting: { architecture: '', dataFlow: '', suggestedDiagram: '' },
    }),
    generateTopicArticles: vi.fn().mockResolvedValue({
        articles: [
            { type: 'topic-index', slug: 'index', title: 'Compaction Overview', content: '# Compaction\n\nOverview', topicId: 'compaction', coveredModuleIds: ['mod-a', 'mod-b', 'mod-c'] },
            { type: 'topic-article', slug: 'mod-a', title: 'Module A', content: '# Module A\n\nDetails', topicId: 'compaction', coveredModuleIds: ['mod-a'] },
            { type: 'topic-article', slug: 'mod-b', title: 'Module B', content: '# Module B\n\nDetails', topicId: 'compaction', coveredModuleIds: ['mod-b'] },
        ],
        duration: 1000,
    }),
    writeTopicArticles: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], topicDir: 'topics/compaction' }),
    integrateTopicIntoWiki: vi.fn().mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], updatedFiles: [] }),
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-topic-test-'));
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

    const topicCache = await import('../../src/cache/topic-cache');
    vi.mocked(topicCache.getCachedTopicProbe).mockReturnValue(null);
    vi.mocked(topicCache.getCachedTopicOutline).mockReturnValue(null);
    vi.mocked(topicCache.getCachedTopicAnalysis).mockReturnValue(null);
    vi.mocked(topicCache.getCachedTopicArticles).mockReturnValue(null);
    vi.mocked(topicCache.isTopicCacheValid).mockReturnValue(false);

    const topic = await import('../../src/topic');
    vi.mocked(topic.loadWikiGraph).mockReturnValue(null);
    vi.mocked(topic.listTopicAreas).mockReturnValue([]);
    vi.mocked(topic.checkTopicCoverage).mockReturnValue({ status: 'new', relatedModules: [] });
    vi.mocked(topic.runSingleTopicProbe).mockResolvedValue({
        probeResult: {
            foundModules: [
                { id: 'mod-a', name: 'Module A', path: 'src/a/', purpose: 'Test', keyFiles: ['src/a/index.ts'], evidence: 'found' },
                { id: 'mod-b', name: 'Module B', path: 'src/b/', purpose: 'Test', keyFiles: ['src/b/index.ts'], evidence: 'found' },
                { id: 'mod-c', name: 'Module C', path: 'src/c/', purpose: 'Test', keyFiles: ['src/c/index.ts'], evidence: 'found' },
            ],
        },
        existingModuleIds: [],
        newModuleIds: ['mod-a', 'mod-b', 'mod-c'],
        allKeyFiles: ['src/a/index.ts', 'src/b/index.ts', 'src/c/index.ts'],
    } as any);
    vi.mocked(topic.generateTopicOutline).mockResolvedValue({
        topicId: 'compaction',
        title: 'Compaction',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Compaction Overview', description: 'Overview', isIndex: true, coveredModuleIds: ['mod-a', 'mod-b', 'mod-c'], coveredFiles: [] },
            { slug: 'mod-a', title: 'Module A', description: 'Details A', isIndex: false, coveredModuleIds: ['mod-a'], coveredFiles: ['src/a/index.ts'] },
            { slug: 'mod-b', title: 'Module B', description: 'Details B', isIndex: false, coveredModuleIds: ['mod-b'], coveredFiles: ['src/b/index.ts'] },
        ],
        involvedModules: [
            { moduleId: 'mod-a', role: 'Test', keyFiles: ['src/a/index.ts'] },
            { moduleId: 'mod-b', role: 'Test', keyFiles: ['src/b/index.ts'] },
            { moduleId: 'mod-c', role: 'Test', keyFiles: ['src/c/index.ts'] },
        ],
    });
    vi.mocked(topic.runTopicAnalysis).mockResolvedValue({
        topicId: 'compaction',
        overview: 'Overview of compaction',
        perArticle: [
            { slug: 'mod-a', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
            { slug: 'mod-b', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '' },
        ],
        crossCutting: { architecture: '', dataFlow: '', suggestedDiagram: '' },
    });
    vi.mocked(topic.generateTopicArticles).mockResolvedValue({
        articles: [
            { type: 'topic-index', slug: 'index', title: 'Compaction Overview', content: '# Compaction\n\nOverview', topicId: 'compaction', coveredModuleIds: ['mod-a', 'mod-b', 'mod-c'] },
            { type: 'topic-article', slug: 'mod-a', title: 'Module A', content: '# Module A\n\nDetails', topicId: 'compaction', coveredModuleIds: ['mod-a'] },
            { type: 'topic-article', slug: 'mod-b', title: 'Module B', content: '# Module B\n\nDetails', topicId: 'compaction', coveredModuleIds: ['mod-b'] },
        ],
        duration: 1000,
    });
    vi.mocked(topic.integrateTopicIntoWiki).mockReturnValue({ writtenFiles: ['index.md', 'mod-a.md', 'mod-b.md'], updatedFiles: [] });
});

afterEach(() => {
    process.stderr.write = originalStderrWrite;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('executeTopic', () => {
    // Helper to import executeTopic fresh for each test
    async function getExecuteTopic() {
        const { executeTopic } = await import('../../src/commands/topic');
        return executeTopic;
    }

    function makeOptions(overrides: Partial<import('../../src/types').TopicCommandOptions> = {}): import('../../src/types').TopicCommandOptions {
        return {
            topic: 'compaction',
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
            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic('/nonexistent/path', 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('does not exist');
        });

        it('should return CONFIG_ERROR when repo path is a file', async () => {
            const filePath = path.join(tmpDir, 'not-a-dir.txt');
            fs.writeFileSync(filePath, 'content');

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(filePath, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('not a directory');
        });

        it('should return CONFIG_ERROR when topic name is missing (non-list)', async () => {
            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, undefined, makeOptions());
            expect(exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
            expect(stderrOutput).toContain('Topic name is required');
        });
    });

    // ------------------------------------------------------------------
    // --list flow
    // ------------------------------------------------------------------

    describe('--list flow', () => {
        it('should list topics from wiki and return SUCCESS', async () => {
            const { listTopicAreas } = await import('../../src/topic');
            vi.mocked(listTopicAreas).mockReturnValue([
                {
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM-tree compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'Overview', path: 'topics/compaction/index.md' }],
                    involvedModuleIds: ['mod-a'],
                    directoryPath: 'topics/compaction',
                    generatedAt: Date.now(),
                },
            ]);

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, undefined, makeOptions({ list: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('Compaction');
        });

        it('should print info when no topics exist', async () => {
            const { listTopicAreas } = await import('../../src/topic');
            vi.mocked(listTopicAreas).mockReturnValue([]);

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, undefined, makeOptions({ list: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('No topic areas found');
        });
    });

    // ------------------------------------------------------------------
    // --check flow
    // ------------------------------------------------------------------

    describe('--check flow', () => {
        it('should print coverage result and return SUCCESS', async () => {
            const { loadWikiGraph, checkTopicCoverage } = await import('../../src/topic');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkTopicCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'topics/compaction/index.md',
                relatedModules: [],
            });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions({ check: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('fully covered');
        });

        it('should report new topic when no wiki exists', async () => {
            const { loadWikiGraph } = await import('../../src/topic');
            vi.mocked(loadWikiGraph).mockReturnValue(null);

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions({ check: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('new');
        });
    });

    // ------------------------------------------------------------------
    // Topic exists (no --force)
    // ------------------------------------------------------------------

    describe('topic exists without --force', () => {
        it('should return SUCCESS with info message', async () => {
            const { loadWikiGraph, checkTopicCoverage } = await import('../../src/topic');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkTopicCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'topics/compaction/index.md',
                relatedModules: [],
            });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('already covered');
            expect(stderrOutput).toContain('--force');
        });
    });

    // ------------------------------------------------------------------
    // Topic exists (with --force)
    // ------------------------------------------------------------------

    describe('topic exists with --force', () => {
        it('should proceed with generation', async () => {
            const { loadWikiGraph, checkTopicCoverage, runSingleTopicProbe } = await import('../../src/topic');
            vi.mocked(loadWikiGraph).mockReturnValue({
                project: { name: 'Test', description: '', language: '', buildSystem: '', entryPoints: [] },
                modules: [],
                categories: [],
                architectureNotes: '',
            });
            vi.mocked(checkTopicCoverage).mockReturnValue({
                status: 'exists',
                existingArticlePath: 'topics/compaction/index.md',
                relatedModules: [],
            });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions({ force: true }));
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(runSingleTopicProbe).toHaveBeenCalled();
            expect(stderrOutput).toContain('Topic area generated');
        });
    });

    // ------------------------------------------------------------------
    // AI unavailable
    // ------------------------------------------------------------------

    describe('AI unavailable', () => {
        it('should return AI_UNAVAILABLE exit code', async () => {
            const { checkAIAvailability } = await import('../../src/ai-invoker');
            vi.mocked(checkAIAvailability).mockResolvedValue({ available: false, reason: 'No SDK' });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.AI_UNAVAILABLE);
            expect(stderrOutput).toContain('not available');
        });
    });

    // ------------------------------------------------------------------
    // Empty probe result
    // ------------------------------------------------------------------

    describe('empty probe result', () => {
        it('should return EXECUTION_ERROR with helpful message', async () => {
            const { runSingleTopicProbe } = await import('../../src/topic');
            vi.mocked(runSingleTopicProbe).mockResolvedValue({
                probeResult: { foundModules: [] },
                existingModuleIds: [],
                newModuleIds: [],
                allKeyFiles: [],
            });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'nonexistent-topic', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
            expect(stderrOutput).toContain('no related modules');
            expect(stderrOutput).toContain('Suggestions');
        });
    });

    // ------------------------------------------------------------------
    // Full pipeline (mocked)
    // ------------------------------------------------------------------

    describe('full pipeline', () => {
        it('should run all phases and return SUCCESS', async () => {
            const topic = await import('../../src/topic');

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);

            // Verify orchestration order
            expect(topic.runSingleTopicProbe).toHaveBeenCalled();
            expect(topic.generateTopicOutline).toHaveBeenCalled();
            expect(topic.runTopicAnalysis).toHaveBeenCalled();
            expect(topic.generateTopicArticles).toHaveBeenCalled();
            expect(topic.integrateTopicIntoWiki).toHaveBeenCalled();

            // Verify summary output
            expect(stderrOutput).toContain('Topic area generated');
            expect(stderrOutput).toContain('3 articles');
            expect(stderrOutput).toContain('3 modules');
        });

        it('should print header with correct info', async () => {
            const executeTopic = await getExecuteTopic();
            await executeTopic(tmpDir, 'compaction', makeOptions({ description: 'LSM-tree compaction' }));

            expect(stderrOutput).toContain('Topic Generation');
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
            const { isTopicCacheValid, getCachedTopicProbe } = await import('../../src/cache/topic-cache');
            const { runSingleTopicProbe } = await import('../../src/topic');

            vi.mocked(isTopicCacheValid).mockReturnValue(true);
            vi.mocked(getCachedTopicProbe).mockReturnValue({
                probeResult: {
                    foundModules: [
                        { id: 'cached-mod', name: 'Cached', path: 'src/cached/', purpose: 'Cached', keyFiles: ['src/cached/index.ts'], evidence: 'cached' },
                    ],
                },
                existingModuleIds: [],
                newModuleIds: ['cached-mod'],
                allKeyFiles: ['src/cached/index.ts'],
            });

            const executeTopic = await getExecuteTopic();
            await executeTopic(tmpDir, 'compaction', makeOptions());

            // Should NOT call the real probe since cache was used
            expect(runSingleTopicProbe).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // Partial article failure
    // ------------------------------------------------------------------

    describe('partial article failure', () => {
        it('should complete with warnings', async () => {
            const { generateTopicArticles } = await import('../../src/topic');
            vi.mocked(generateTopicArticles).mockResolvedValue({
                articles: [
                    { type: 'topic-index', slug: 'index', title: 'Overview', content: '# Overview', topicId: 'compaction', coveredModuleIds: [] },
                ],
                duration: 1000,
                failedSlugs: ['mod-a', 'mod-b'],
            });

            const executeTopic = await getExecuteTopic();
            const exitCode = await executeTopic(tmpDir, 'compaction', makeOptions());
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(stderrOutput).toContain('2 article(s) failed');
        });
    });

    // ------------------------------------------------------------------
    // Topic name normalization
    // ------------------------------------------------------------------

    describe('topic name normalization', () => {
        it('should normalize spaces to hyphens and lowercase', async () => {
            const { runSingleTopicProbe } = await import('../../src/topic');

            const executeTopic = await getExecuteTopic();
            await executeTopic(tmpDir, 'My Topic Name', makeOptions());

            expect(runSingleTopicProbe).toHaveBeenCalledWith(
                expect.objectContaining({
                    topic: expect.objectContaining({ topic: 'my-topic-name' }),
                })
            );
        });
    });
});

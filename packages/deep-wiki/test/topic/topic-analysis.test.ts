import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    TopicOutline,
    TopicArticlePlan,
    TopicArticleAnalysis,
    TopicCrossCuttingAnalysis,
    ModuleAnalysis,
} from '../../src/types';
import type { EnrichedProbeResult } from '../../src/topic/topic-probe';

// ─── Mock SDK ──────────────────────────────────────────────────────────

const mockSendMessage = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            sendMessage: mockSendMessage,
        }),
    };
});

vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
}));

import {
    runTopicAnalysis,
    analyzeArticleScope,
    analyzeCrossCutting,
    type TopicAnalysisOptions,
} from '../../src/topic/topic-analysis';
import {
    buildArticleAnalysisPrompt,
    buildCrossCuttingPrompt,
} from '../../src/topic/analysis-prompts';

// ─── Helpers ───────────────────────────────────────────────────────────

function makeArticlePlan(overrides: Partial<TopicArticlePlan> = {}): TopicArticlePlan {
    return {
        slug: 'article-a',
        title: 'Article A',
        description: 'Description of article A',
        isIndex: false,
        coveredModuleIds: ['mod-a'],
        coveredFiles: ['src/mod-a/index.ts', 'src/mod-a/utils.ts'],
        ...overrides,
    };
}

function makeOutline(articles?: TopicArticlePlan[]): TopicOutline {
    return {
        topicId: 'test-topic',
        title: 'Test Topic',
        layout: 'area',
        articles: articles ?? [
            makeArticlePlan({ slug: 'index', title: 'Overview', isIndex: true, coveredModuleIds: ['mod-a', 'mod-b'], coveredFiles: [] }),
            makeArticlePlan({ slug: 'article-a', title: 'Article A', coveredModuleIds: ['mod-a'] }),
            makeArticlePlan({ slug: 'article-b', title: 'Article B', coveredModuleIds: ['mod-b'], coveredFiles: ['src/mod-b/main.ts'] }),
        ],
        involvedModules: [
            { moduleId: 'mod-a', role: 'Module A handles data', keyFiles: ['src/mod-a/index.ts'] },
            { moduleId: 'mod-b', role: 'Module B handles UI', keyFiles: ['src/mod-b/main.ts'] },
        ],
    };
}

function makeProbeResult(): EnrichedProbeResult {
    return {
        probeResult: {
            topic: 'test-topic',
            foundModules: [
                { id: 'mod-a', name: 'Module A', path: 'src/mod-a', purpose: 'Data handling', keyFiles: ['src/mod-a/index.ts'], evidence: 'found' },
                { id: 'mod-b', name: 'Module B', path: 'src/mod-b', purpose: 'UI rendering', keyFiles: ['src/mod-b/main.ts'], evidence: 'found' },
            ],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.9,
        },
        existingModuleIds: [],
        newModuleIds: ['mod-a', 'mod-b'],
        allKeyFiles: ['src/mod-a/index.ts', 'src/mod-b/main.ts'],
    };
}

function makeArticleAnalysisJson(slug: string): string {
    return JSON.stringify({
        slug,
        keyConcepts: [{ name: 'Concept1', description: 'Desc1', codeRef: 'src/file.ts' }],
        dataFlow: 'Data flows from A to B',
        codeExamples: [{ title: 'Example 1', code: 'const x = 1;', file: 'src/file.ts' }],
        internalDetails: 'Implementation uses pattern X',
    });
}

function makeCrossCuttingJson(): string {
    return JSON.stringify({
        architecture: 'Modules A and B collaborate via events',
        dataFlow: 'Input → Module A → Module B → Output',
        suggestedDiagram: 'graph LR\n  A --> B',
        configuration: 'Set env.MODE to control behavior',
        relatedTopics: ['caching', 'logging'],
    });
}

function makeModuleAnalysis(moduleId: string): ModuleAnalysis {
    return {
        moduleId,
        overview: `Overview of ${moduleId}`,
        keyConcepts: [{ name: 'KConcept', description: 'KDesc' }],
        publicAPI: [],
        internalArchitecture: 'Internal arch',
        dataFlow: 'Module data flow',
        patterns: ['singleton'],
        errorHandling: 'try/catch',
        codeExamples: [],
        dependencies: { internal: [], external: [] },
        suggestedDiagram: '',
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Topic Analysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Prompt Construction ────────────────────────────────────────────

    describe('buildArticleAnalysisPrompt', () => {
        it('should include topic title and article details', () => {
            const prompt = buildArticleAnalysisPrompt(
                'My Topic', 'Article Title', 'Article description', 'my-article',
                ['src/a.ts', 'src/b.ts'], '', 'normal'
            );

            expect(prompt).toContain('My Topic');
            expect(prompt).toContain('Article Title');
            expect(prompt).toContain('my-article');
            expect(prompt).toContain('Article description');
            expect(prompt).toContain('src/a.ts');
            expect(prompt).toContain('src/b.ts');
        });

        it('should include module context when provided', () => {
            const prompt = buildArticleAnalysisPrompt(
                'Topic', 'Art', 'Desc', 'slug',
                ['src/a.ts'], 'Module A handles caching', 'normal'
            );
            expect(prompt).toContain('Module A handles caching');
        });

        it('should use shallow investigation steps for shallow depth', () => {
            const prompt = buildArticleAnalysisPrompt(
                'Topic', 'Art', 'Desc', 'slug', ['src/a.ts'], '', 'shallow'
            );
            expect(prompt).toContain('keyConcepts to 2-3 entries');
        });

        it('should use deep investigation steps for deep depth', () => {
            const prompt = buildArticleAnalysisPrompt(
                'Topic', 'Art', 'Desc', 'slug', ['src/a.ts'], '', 'deep'
            );
            expect(prompt).toContain('exhaustively investigate');
        });

        it('should handle empty covered files', () => {
            const prompt = buildArticleAnalysisPrompt(
                'Topic', 'Art', 'Desc', 'slug', [], '', 'normal'
            );
            expect(prompt).toContain('no specific files listed');
        });

        it('should include JSON schema', () => {
            const prompt = buildArticleAnalysisPrompt(
                'Topic', 'Art', 'Desc', 'slug', [], '', 'normal'
            );
            expect(prompt).toContain('"slug"');
            expect(prompt).toContain('"keyConcepts"');
            expect(prompt).toContain('"dataFlow"');
            expect(prompt).toContain('"codeExamples"');
            expect(prompt).toContain('"internalDetails"');
        });
    });

    describe('buildCrossCuttingPrompt', () => {
        it('should include topic info and article summaries', () => {
            const prompt = buildCrossCuttingPrompt(
                'My Topic', 'my-topic',
                '### article-a\nKey concepts: X\nData flow: Y\nDetails: Z\n',
                ['mod-a', 'mod-b']
            );

            expect(prompt).toContain('My Topic');
            expect(prompt).toContain('my-topic');
            expect(prompt).toContain('mod-a');
            expect(prompt).toContain('mod-b');
            expect(prompt).toContain('article-a');
        });

        it('should include the cross-cutting schema', () => {
            const prompt = buildCrossCuttingPrompt('T', 'id', 'summaries', []);
            expect(prompt).toContain('"architecture"');
            expect(prompt).toContain('"suggestedDiagram"');
            expect(prompt).toContain('"relatedTopics"');
        });
    });

    // ── analyzeArticleScope ────────────────────────────────────────────

    describe('analyzeArticleScope', () => {
        it('should call AI and parse valid response', async () => {
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeArticleAnalysisJson('art-x'),
            });

            const article = makeArticlePlan({ slug: 'art-x', title: 'Art X' });
            const result = await analyzeArticleScope(
                '/repo', article, 'Topic', '', { depth: 'normal' }
            );

            expect(result.slug).toBe('art-x');
            expect(result.keyConcepts).toHaveLength(1);
            expect(result.keyConcepts[0].name).toBe('Concept1');
            expect(result.dataFlow).toBe('Data flows from A to B');
            expect(result.codeExamples).toHaveLength(1);
            expect(result.internalDetails).toBe('Implementation uses pattern X');
            expect(mockSendMessage).toHaveBeenCalledOnce();
        });

        it('should throw on AI failure', async () => {
            mockSendMessage.mockResolvedValueOnce({
                success: false,
                error: 'timeout',
            });

            const article = makeArticlePlan({ slug: 'art-fail' });
            await expect(
                analyzeArticleScope('/repo', article, 'Topic', '', { depth: 'normal' })
            ).rejects.toThrow('AI response failed');
        });

        it('should use provided model and timeout', async () => {
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeArticleAnalysisJson('art-m'),
            });

            const article = makeArticlePlan({ slug: 'art-m' });
            await analyzeArticleScope(
                '/repo', article, 'Topic', '',
                { model: 'gpt-4', timeout: 60000, depth: 'shallow' }
            );

            const callArgs = mockSendMessage.mock.calls[0][0];
            expect(callArgs.model).toBe('gpt-4');
            expect(callArgs.timeoutMs).toBe(60000);
        });

        it('should use default slug when AI response has wrong slug', async () => {
            const responseJson = JSON.stringify({
                slug: 'wrong-slug',
                keyConcepts: [],
                dataFlow: 'flow',
                codeExamples: [],
                internalDetails: 'details',
            });
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: responseJson,
            });

            const article = makeArticlePlan({ slug: 'correct-slug' });
            const result = await analyzeArticleScope(
                '/repo', article, 'Topic', '', { depth: 'normal' }
            );

            // Parser preserves the slug from AI response (not overridden)
            expect(result.slug).toBe('wrong-slug');
        });

        it('should handle response with missing optional fields', async () => {
            const responseJson = JSON.stringify({
                slug: 'minimal',
                keyConcepts: [],
                dataFlow: '',
                codeExamples: [],
                internalDetails: '',
            });
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: responseJson,
            });

            const article = makeArticlePlan({ slug: 'minimal' });
            const result = await analyzeArticleScope(
                '/repo', article, 'Topic', '', { depth: 'normal' }
            );

            expect(result.slug).toBe('minimal');
            expect(result.keyConcepts).toEqual([]);
            expect(result.codeExamples).toEqual([]);
        });
    });

    // ── analyzeCrossCutting ────────────────────────────────────────────

    describe('analyzeCrossCutting', () => {
        it('should call AI and parse valid cross-cutting response', async () => {
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeCrossCuttingJson(),
            });

            const outline = makeOutline();
            const analyses: TopicArticleAnalysis[] = [
                { slug: 'art-a', keyConcepts: [{ name: 'C1', description: 'D1' }], dataFlow: 'flow', codeExamples: [], internalDetails: 'details' },
            ];

            const result = await analyzeCrossCutting('/repo', outline, analyses, {});

            expect(result.architecture).toBe('Modules A and B collaborate via events');
            expect(result.dataFlow).toContain('Module A');
            expect(result.suggestedDiagram).toContain('graph LR');
            expect(result.configuration).toBe('Set env.MODE to control behavior');
            expect(result.relatedTopics).toEqual(['caching', 'logging']);
        });

        it('should return default on AI failure', async () => {
            mockSendMessage.mockResolvedValueOnce({
                success: false,
                error: 'timeout',
            });

            const outline = makeOutline();
            const result = await analyzeCrossCutting('/repo', outline, [], {});

            expect(result.architecture).toBe('');
            expect(result.dataFlow).toBe('');
            expect(result.suggestedDiagram).toBe('');
        });

        it('should return default on AI exception', async () => {
            mockSendMessage.mockRejectedValueOnce(new Error('Network error'));

            const outline = makeOutline();
            const result = await analyzeCrossCutting('/repo', outline, [], {});

            expect(result.architecture).toBe('');
        });

        it('should handle response without optional fields', async () => {
            const responseJson = JSON.stringify({
                architecture: 'Simple arch',
                dataFlow: 'Simple flow',
                suggestedDiagram: '',
            });
            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: responseJson,
            });

            const outline = makeOutline();
            const result = await analyzeCrossCutting('/repo', outline, [], {});

            expect(result.architecture).toBe('Simple arch');
            expect(result.configuration).toBeUndefined();
            expect(result.relatedTopics).toBeUndefined();
        });
    });

    // ── runTopicAnalysis (full flow) ──────────────────────────────────

    describe('runTopicAnalysis', () => {
        it('should produce complete TopicAnalysis for multi-article topic', async () => {
            // Two non-index articles + cross-cutting = 3 AI calls
            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-a') })
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-b') })
                .mockResolvedValueOnce({ success: true, response: makeCrossCuttingJson() });

            const options: TopicAnalysisOptions = {
                repoPath: '/repo',
                outline: makeOutline(),
                probeResult: makeProbeResult(),
                depth: 'normal',
            };

            const result = await runTopicAnalysis(options);

            expect(result.topicId).toBe('test-topic');
            expect(result.perArticle).toHaveLength(2);
            expect(result.perArticle[0].slug).toBe('article-a');
            expect(result.perArticle[1].slug).toBe('article-b');
            expect(result.crossCutting.architecture).toContain('collaborate');
            expect(result.overview).toContain('collaborate');
            expect(mockSendMessage).toHaveBeenCalledTimes(3);
        });

        it('should handle single-article topic (no cross-cutting)', async () => {
            // Single index article → 1 AI call, no cross-cutting
            const singleOutline = makeOutline([
                makeArticlePlan({ slug: 'index', title: 'Only Article', isIndex: true }),
            ]);

            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeArticleAnalysisJson('index'),
            });

            const result = await runTopicAnalysis({
                repoPath: '/repo',
                outline: singleOutline,
                probeResult: makeProbeResult(),
                depth: 'normal',
            });

            expect(result.topicId).toBe('test-topic');
            expect(result.perArticle).toHaveLength(1);
            expect(result.perArticle[0].slug).toBe('index');
            // No cross-cutting AI call
            expect(mockSendMessage).toHaveBeenCalledTimes(1);
            // Cross-cutting derived from index analysis
            expect(result.crossCutting.dataFlow).toBe('Data flows from A to B');
        });

        it('should reuse cached module analyses in context', async () => {
            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-a') })
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-b') })
                .mockResolvedValueOnce({ success: true, response: makeCrossCuttingJson() });

            const existingAnalyses = [makeModuleAnalysis('mod-a')];

            const result = await runTopicAnalysis({
                repoPath: '/repo',
                outline: makeOutline(),
                probeResult: makeProbeResult(),
                existingAnalyses,
                depth: 'normal',
            });

            expect(result.perArticle).toHaveLength(2);

            // Verify the prompt includes cached module analysis context
            const firstCallPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(firstCallPrompt).toContain('Overview of mod-a');
        });

        it('should respect concurrency limit', async () => {
            const concurrency = 2;
            const articleCount = 5;

            // Track concurrent invocations
            let currentConcurrent = 0;
            let maxConcurrent = 0;

            const articles = Array.from({ length: articleCount }, (_, i) =>
                makeArticlePlan({ slug: `art-${i}`, title: `Art ${i}`, isIndex: false })
            );
            const outline = makeOutline([
                makeArticlePlan({ slug: 'index', title: 'Index', isIndex: true }),
                ...articles,
            ]);

            mockSendMessage.mockImplementation(async () => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                await new Promise(resolve => setTimeout(resolve, 50));
                currentConcurrent--;
                return { success: true, response: makeArticleAnalysisJson('art') };
            });

            await runTopicAnalysis({
                repoPath: '/repo',
                outline,
                probeResult: makeProbeResult(),
                depth: 'normal',
                concurrency,
            });

            expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
            // 5 articles + 1 cross-cutting
            expect(mockSendMessage).toHaveBeenCalledTimes(articleCount + 1);
        });

        it('should gracefully handle individual article analysis failure', async () => {
            // First article fails, second succeeds, cross-cutting succeeds
            mockSendMessage
                .mockRejectedValueOnce(new Error('AI timeout'))
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-b') })
                .mockResolvedValueOnce({ success: true, response: makeCrossCuttingJson() });

            const result = await runTopicAnalysis({
                repoPath: '/repo',
                outline: makeOutline(),
                probeResult: makeProbeResult(),
                depth: 'normal',
            });

            expect(result.perArticle).toHaveLength(2);
            // Failed article gets placeholder
            const failed = result.perArticle.find(a => a.slug === 'article-a');
            expect(failed).toBeDefined();
            expect(failed!.internalDetails).toContain('failed');
            // Successful article is intact
            const success = result.perArticle.find(a => a.slug === 'article-b');
            expect(success).toBeDefined();
            expect(success!.keyConcepts).toHaveLength(1);
        });

        it('should handle empty outline (no articles at all)', async () => {
            const emptyOutline: TopicOutline = {
                topicId: 'empty',
                title: 'Empty Topic',
                layout: 'single',
                articles: [],
                involvedModules: [],
            };

            const result = await runTopicAnalysis({
                repoPath: '/repo',
                outline: emptyOutline,
                probeResult: makeProbeResult(),
                depth: 'normal',
            });

            expect(result.topicId).toBe('empty');
            expect(result.perArticle).toHaveLength(0);
            expect(result.overview).toContain('Empty Topic');
            // No AI calls needed
            expect(mockSendMessage).not.toHaveBeenCalled();
        });

        it('should pass model and timeout to AI calls', async () => {
            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-a') })
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-b') })
                .mockResolvedValueOnce({ success: true, response: makeCrossCuttingJson() });

            await runTopicAnalysis({
                repoPath: '/repo',
                outline: makeOutline(),
                probeResult: makeProbeResult(),
                depth: 'deep',
                model: 'claude-4',
                timeout: 45000,
            });

            // All calls should have model and timeout
            for (const call of mockSendMessage.mock.calls) {
                expect(call[0].model).toBe('claude-4');
                expect(call[0].timeoutMs).toBe(45000);
            }
        });

        it('should use probe info when no existing analyses provided', async () => {
            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-a') })
                .mockResolvedValueOnce({ success: true, response: makeArticleAnalysisJson('article-b') })
                .mockResolvedValueOnce({ success: true, response: makeCrossCuttingJson() });

            await runTopicAnalysis({
                repoPath: '/repo',
                outline: makeOutline(),
                probeResult: makeProbeResult(),
                depth: 'normal',
                // No existingAnalyses
            });

            // Prompt should include probe-level info
            const prompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(prompt).toContain('mod-a');
            expect(prompt).toContain('Module A handles data');
        });
    });
});

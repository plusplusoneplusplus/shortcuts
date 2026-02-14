import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    TopicOutline,
    TopicAnalysis,
    TopicArticle,
    TopicArticlePlan,
    TopicArticleAnalysis,
    TopicCrossCuttingAnalysis,
} from '../../src/types';

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
    generateTopicArticles,
    extractSummary,
    type TopicArticleGenOptions,
    type TopicArticleGenResult,
} from '../../src/topic/article-generator';
import {
    buildSubArticlePrompt,
    buildIndexPagePrompt,
} from '../../src/topic/article-prompts';

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

function makeOutline(articles?: TopicArticlePlan[], layout?: 'single' | 'area'): TopicOutline {
    return {
        topicId: 'test-topic',
        title: 'Test Topic',
        layout: layout ?? 'area',
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

function makeArticleAnalysis(slug: string): TopicArticleAnalysis {
    return {
        slug,
        keyConcepts: [{ name: 'Concept1', description: 'Desc1', codeRef: 'src/file.ts' }],
        dataFlow: 'Data flows from A to B',
        codeExamples: [{ title: 'Example 1', code: 'const x = 1;', file: 'src/file.ts' }],
        internalDetails: 'Implementation uses pattern X',
    };
}

function makeCrossCutting(): TopicCrossCuttingAnalysis {
    return {
        architecture: 'Modules A and B collaborate via events',
        dataFlow: 'Input → Module A → Module B → Output',
        suggestedDiagram: 'graph LR\n  A --> B',
        configuration: 'Set env.MODE to control behavior',
        relatedTopics: ['caching', 'logging'],
    };
}

function makeAnalysis(outline: TopicOutline): TopicAnalysis {
    const nonIndex = outline.articles.filter(a => !a.isIndex);
    return {
        topicId: outline.topicId,
        overview: 'Overview of test topic',
        perArticle: nonIndex.map(a => makeArticleAnalysis(a.slug)),
        crossCutting: makeCrossCutting(),
    };
}

function makeSingleAnalysis(): TopicAnalysis {
    return {
        topicId: 'test-topic',
        overview: 'Overview of test topic',
        perArticle: [makeArticleAnalysis('index')],
        crossCutting: makeCrossCutting(),
    };
}

function makeSubArticleResponse(title: string, slug: string, siblings: string[] = []): string {
    const seeAlso = siblings.length > 0
        ? `\n\n## See also\n${siblings.map(s => `- [${s}](./${s}.md)`).join('\n')}`
        : '';
    return `# ${title}\n\n> Part of the [Test Topic](./index.md) topic area.\n\nThis article covers ${title}.${seeAlso}`;
}

function makeIndexResponse(topicTitle: string): string {
    return `# ${topicTitle}\n\nOverview of the topic.\n\n## Architecture\n\n\`\`\`mermaid\ngraph LR\n  A --> B\n\`\`\`\n\n## Articles\n\n- [Article A](./article-a.md)\n- [Article B](./article-b.md)`;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Topic Article Generator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Prompt Construction ────────────────────────────────────────────

    describe('buildSubArticlePrompt', () => {
        it('should include topic title, article details, and analysis data', () => {
            const plan = makeArticlePlan({ slug: 'my-article', title: 'My Article' });
            const analysis = makeArticleAnalysis('my-article');
            const siblings = [{ slug: 'sibling-a', title: 'Sibling A' }];

            const prompt = buildSubArticlePrompt('My Topic', plan, analysis, siblings, 'normal');

            expect(prompt).toContain('My Topic');
            expect(prompt).toContain('My Article');
            expect(prompt).toContain('my-article');
            expect(prompt).toContain('Concept1');
            expect(prompt).toContain('Data flows from A to B');
            expect(prompt).toContain('Sibling A');
            expect(prompt).toContain('./sibling-a.md');
        });

        it('should include code examples from analysis', () => {
            const plan = makeArticlePlan();
            const analysis = makeArticleAnalysis('article-a');
            const prompt = buildSubArticlePrompt('Topic', plan, analysis, [], 'normal');

            expect(prompt).toContain('Example 1');
            expect(prompt).toContain('const x = 1;');
            expect(prompt).toContain('src/file.ts');
        });

        it('should use shallow style for shallow depth', () => {
            const plan = makeArticlePlan();
            const analysis = makeArticleAnalysis('article-a');
            const prompt = buildSubArticlePrompt('Topic', plan, analysis, [], 'shallow');

            expect(prompt).toContain('500-800 words');
        });

        it('should use deep style for deep depth', () => {
            const plan = makeArticlePlan();
            const analysis = makeArticleAnalysis('article-a');
            const prompt = buildSubArticlePrompt('Topic', plan, analysis, [], 'deep');

            expect(prompt).toContain('1500-3000 words');
        });

        it('should handle empty analysis gracefully', () => {
            const plan = makeArticlePlan({ coveredFiles: [] });
            const analysis: TopicArticleAnalysis = {
                slug: 'empty', keyConcepts: [], dataFlow: '', codeExamples: [], internalDetails: '',
            };
            const prompt = buildSubArticlePrompt('Topic', plan, analysis, [], 'normal');

            expect(prompt).toContain('no key concepts available');
            expect(prompt).toContain('not described');
        });

        it('should include covered files list', () => {
            const plan = makeArticlePlan({ coveredFiles: ['src/a.ts', 'src/b.ts'] });
            const analysis = makeArticleAnalysis('article-a');
            const prompt = buildSubArticlePrompt('Topic', plan, analysis, [], 'normal');

            expect(prompt).toContain('src/a.ts');
            expect(prompt).toContain('src/b.ts');
        });
    });

    describe('buildIndexPagePrompt', () => {
        it('should include topic title, summaries, and cross-cutting analysis', () => {
            const outline = makeOutline();
            const crossCutting = makeCrossCutting();
            const summaries = [
                { slug: 'article-a', title: 'Article A', summary: 'Summary A' },
                { slug: 'article-b', title: 'Article B', summary: 'Summary B' },
            ];

            const prompt = buildIndexPagePrompt('Test Topic', outline, crossCutting, summaries);

            expect(prompt).toContain('Test Topic');
            expect(prompt).toContain('Summary A');
            expect(prompt).toContain('Summary B');
            expect(prompt).toContain('./article-a.md');
            expect(prompt).toContain('./article-b.md');
            expect(prompt).toContain('Modules A and B collaborate via events');
            expect(prompt).toContain('graph LR');
        });

        it('should include involved modules', () => {
            const outline = makeOutline();
            const prompt = buildIndexPagePrompt('Topic', outline, makeCrossCutting(), []);

            expect(prompt).toContain('mod-a');
            expect(prompt).toContain('Module A handles data');
        });

        it('should include related topics when available', () => {
            const prompt = buildIndexPagePrompt('Topic', makeOutline(), makeCrossCutting(), []);

            expect(prompt).toContain('caching');
            expect(prompt).toContain('logging');
        });

        it('should handle empty cross-cutting analysis', () => {
            const emptyCross: TopicCrossCuttingAnalysis = {
                architecture: '', dataFlow: '', suggestedDiagram: '',
            };
            const prompt = buildIndexPagePrompt('Topic', makeOutline(), emptyCross, []);

            expect(prompt).toContain('not described');
            expect(prompt).toContain('no diagram available');
        });
    });

    // ── extractSummary ─────────────────────────────────────────────────

    describe('extractSummary', () => {
        it('should extract first N words skipping heading', () => {
            const content = '# Title\n\n> Topic breadcrumb.\n\nThis is the body with multiple words here and there.';
            const summary = extractSummary(content, 5);
            expect(summary).toBe('This is the body with…');
        });

        it('should return full content if under limit', () => {
            const content = '# Title\n\nShort body.';
            const summary = extractSummary(content, 100);
            expect(summary).toContain('Short body.');
        });

        it('should handle content with no heading', () => {
            const content = 'Just plain text with some words.';
            const summary = extractSummary(content, 3);
            expect(summary).toBe('Just plain text…');
        });
    });

    // ── Single Article Generation ──────────────────────────────────────

    describe('single article generation', () => {
        it('should generate one article for single layout with no reduce', async () => {
            const singleOutline = makeOutline(
                [makeArticlePlan({ slug: 'index', title: 'Complete Guide', isIndex: true })],
                'single'
            );

            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeSubArticleResponse('Complete Guide', 'index'),
            });

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline: singleOutline,
                analysis: makeSingleAnalysis(),
                depth: 'normal',
            });

            expect(result.articles).toHaveLength(1);
            expect(result.articles[0].type).toBe('topic-article');
            expect(result.articles[0].slug).toBe('index');
            expect(result.articles[0].content).toContain('Complete Guide');
            expect(result.failedSlugs).toBeUndefined();
            // Only 1 AI call (no reduce)
            expect(mockSendMessage).toHaveBeenCalledTimes(1);
        });
    });

    // ── Multi-Article Generation ───────────────────────────────────────

    describe('multi-article generation', () => {
        it('should generate sub-articles + index for area layout', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            // 2 sub-articles + 1 index = 3 AI calls
            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article A', 'article-a', ['article-b']) })
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b', ['article-a']) })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
            });

            expect(result.articles).toHaveLength(3);

            const subArticles = result.articles.filter(a => a.type === 'topic-article');
            const indexArticle = result.articles.find(a => a.type === 'topic-index');

            expect(subArticles).toHaveLength(2);
            expect(indexArticle).toBeDefined();
            expect(indexArticle!.slug).toBe('index');
            expect(indexArticle!.content).toContain('Architecture');
            expect(result.failedSlugs).toBeUndefined();
            expect(mockSendMessage).toHaveBeenCalledTimes(3);
        });
    });

    // ── Cross-References ───────────────────────────────────────────────

    describe('cross-references', () => {
        it('should include sibling links in generated sub-articles', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            mockSendMessage
                .mockResolvedValueOnce({
                    success: true,
                    response: '# Article A\n\n## See also\n- [Article B](./article-b.md)',
                })
                .mockResolvedValueOnce({
                    success: true,
                    response: '# Article B\n\n## See also\n- [Article A](./article-a.md)',
                })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
            });

            const articleA = result.articles.find(a => a.slug === 'article-a');
            const articleB = result.articles.find(a => a.slug === 'article-b');

            expect(articleA!.content).toContain('./article-b.md');
            expect(articleB!.content).toContain('./article-a.md');
        });
    });

    // ── onArticleComplete Callback ─────────────────────────────────────

    describe('onArticleComplete callback', () => {
        it('should fire for each article including index', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);
            const completedArticles: TopicArticle[] = [];

            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article A', 'article-a') })
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b') })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
                onArticleComplete: (article) => completedArticles.push(article),
            });

            expect(completedArticles).toHaveLength(3);
            expect(completedArticles.map(a => a.slug).sort()).toEqual(['article-a', 'article-b', 'index']);
        });

        it('should fire for single-article topics', async () => {
            const singleOutline = makeOutline(
                [makeArticlePlan({ slug: 'index', title: 'Only', isIndex: true })],
                'single'
            );
            const completedArticles: TopicArticle[] = [];

            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeSubArticleResponse('Only', 'index'),
            });

            await generateTopicArticles({
                topicId: 'test-topic',
                outline: singleOutline,
                analysis: makeSingleAnalysis(),
                depth: 'normal',
                onArticleComplete: (article) => completedArticles.push(article),
            });

            expect(completedArticles).toHaveLength(1);
        });
    });

    // ── Partial Failure ────────────────────────────────────────────────

    describe('partial failure', () => {
        it('should continue other articles when one fails', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            // First sub-article fails, second succeeds, index succeeds
            mockSendMessage
                .mockRejectedValueOnce(new Error('AI timeout'))
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b') })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
            });

            // 1 successful sub-article + 1 index
            const subArticles = result.articles.filter(a => a.type === 'topic-article');
            const indexArticle = result.articles.find(a => a.type === 'topic-index');

            expect(subArticles).toHaveLength(1);
            expect(subArticles[0].slug).toBe('article-b');
            expect(indexArticle).toBeDefined();
            expect(result.failedSlugs).toEqual(['article-a']);
        });

        it('should fall back to static index when reduce fails', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article A', 'article-a') })
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b') })
                .mockRejectedValueOnce(new Error('Index generation failed'));

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
            });

            const indexArticle = result.articles.find(a => a.type === 'topic-index');
            expect(indexArticle).toBeDefined();
            expect(indexArticle!.content).toContain('Test Topic');
            expect(indexArticle!.content).toContain('Article A');
            expect(indexArticle!.content).toContain('Article B');
        });

        it('should return AI failure error in failedSlugs', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            mockSendMessage
                .mockResolvedValueOnce({ success: false, error: 'rate limited' })
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b') })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            const result = await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
            });

            expect(result.failedSlugs).toEqual(['article-a']);
        });
    });

    // ── Depth Influence ────────────────────────────────────────────────

    describe('depth influence', () => {
        it('should pass depth to prompt builder', async () => {
            const singleOutline = makeOutline(
                [makeArticlePlan({ slug: 'index', title: 'Only', isIndex: true })],
                'single'
            );

            mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: makeSubArticleResponse('Only', 'index'),
            });

            await generateTopicArticles({
                topicId: 'test-topic',
                outline: singleOutline,
                analysis: makeSingleAnalysis(),
                depth: 'deep',
            });

            const callPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(callPrompt).toContain('1500-3000 words');
        });
    });

    // ── Concurrency ────────────────────────────────────────────────────

    describe('concurrency control', () => {
        it('should respect concurrency limit', async () => {
            const concurrency = 2;
            const articleCount = 5;
            let currentConcurrent = 0;
            let maxConcurrent = 0;

            const articles = Array.from({ length: articleCount }, (_, i) =>
                makeArticlePlan({ slug: `art-${i}`, title: `Art ${i}`, isIndex: false })
            );
            const outline = makeOutline([
                makeArticlePlan({ slug: 'index', title: 'Index', isIndex: true }),
                ...articles,
            ]);

            const perArticle = articles.map(a => makeArticleAnalysis(a.slug));
            const analysis: TopicAnalysis = {
                topicId: 'test-topic',
                overview: 'Overview',
                perArticle,
                crossCutting: makeCrossCutting(),
            };

            mockSendMessage.mockImplementation(async () => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                await new Promise(resolve => setTimeout(resolve, 50));
                currentConcurrent--;
                return { success: true, response: '# Art\n\nBody content here.' };
            });

            await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
                concurrency,
            });

            expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
            // 5 sub-articles + 1 index = 6 AI calls
            expect(mockSendMessage).toHaveBeenCalledTimes(articleCount + 1);
        });
    });

    // ── Model and Timeout ──────────────────────────────────────────────

    describe('model and timeout', () => {
        it('should pass model and timeout to AI calls', async () => {
            const outline = makeOutline();
            const analysis = makeAnalysis(outline);

            mockSendMessage
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article A', 'article-a') })
                .mockResolvedValueOnce({ success: true, response: makeSubArticleResponse('Article B', 'article-b') })
                .mockResolvedValueOnce({ success: true, response: makeIndexResponse('Test Topic') });

            await generateTopicArticles({
                topicId: 'test-topic',
                outline,
                analysis,
                depth: 'normal',
                model: 'gpt-4',
                timeout: 60000,
            });

            for (const call of mockSendMessage.mock.calls) {
                expect(call[0].model).toBe('gpt-4');
                expect(call[0].timeoutMs).toBe(60000);
            }
        });
    });
});

/**
 * Theme Article Generator
 *
 * Generates markdown articles for each item in a theme outline using
 * a map-reduce pattern: map generates per-sub-article content,
 * reduce synthesizes the index page.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    ThemeOutline,
    ThemeAnalysis,
    ThemeArticle,
    ThemeArticlePlan,
    ThemeArticleAnalysis,
} from '../types';
import { buildSubArticlePrompt, buildIndexPagePrompt } from './article-prompts';
import { printInfo, printWarning, gray } from '../logger';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for per-article generation: 120 seconds */
const DEFAULT_ARTICLE_TIMEOUT_MS = 120_000;

/** Default timeout for index page generation: 90 seconds */
const DEFAULT_INDEX_TIMEOUT_MS = 90_000;

/** Default concurrency for parallel article generation */
const DEFAULT_CONCURRENCY = 5;

// ============================================================================
// Types
// ============================================================================

export interface ThemeArticleGenOptions {
    themeId: string;
    outline: ThemeOutline;
    analysis: ThemeAnalysis;
    depth: 'shallow' | 'normal' | 'deep';
    model?: string;
    timeout?: number;
    concurrency?: number;
    onArticleComplete?: (article: ThemeArticle) => void;
}

export interface ThemeArticleGenResult {
    articles: ThemeArticle[];
    duration: number;
    failedSlugs?: string[];
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Generate all articles for a theme area:
 *
 * 1. MAP phase: Generate sub-articles in parallel
 *    - Each article gets its specific analysis context
 *    - Prompt includes sibling article titles (for cross-references)
 *    - Output: markdown content with proper headings, code blocks, links
 *
 * 2. REDUCE phase: Generate index page
 *    - Receives all sub-article summaries
 *    - Produces overview, architecture diagram, navigation links
 *    - Cross-module data flow summary
 */
export async function generateThemeArticles(
    options: ThemeArticleGenOptions
): Promise<ThemeArticleGenResult> {
    const {
        themeId,
        outline,
        analysis,
        depth,
        model,
        timeout,
        concurrency = DEFAULT_CONCURRENCY,
        onArticleComplete,
    } = options;

    const startTime = Date.now();
    const articles: ThemeArticle[] = [];
    const failedSlugs: string[] = [];

    const nonIndexArticles = outline.articles.filter(a => !a.isIndex);
    const analysisMap = new Map(analysis.perArticle.map(a => [a.slug, a]));

    printInfo(`  Generating theme articles for "${outline.title}": ${outline.articles.length} article(s) ${gray(`(depth: ${depth})`)}`);

    // Single-article theme (layout: 'single') → generate one article, no reduce
    if (outline.layout === 'single' || nonIndexArticles.length === 0) {
        const singlePlan = outline.articles[0];
        if (singlePlan) {
            const singleAnalysis = analysisMap.get(singlePlan.slug) ?? analysis.perArticle[0] ?? makeEmptyArticleAnalysis(singlePlan.slug);
            try {
                const article = await generateSubArticle(
                    outline.title, singlePlan, singleAnalysis, [], depth, model, timeout
                );
                articles.push(article);
                onArticleComplete?.(article);
            } catch (error) {
                printWarning(`    Article generation failed for "${singlePlan.slug}": ${getErrorMessage(error)}`);
                failedSlugs.push(singlePlan.slug);
            }
        }

        return { articles, duration: Date.now() - startTime, failedSlugs: failedSlugs.length > 0 ? failedSlugs : undefined };
    }

    // MAP phase: Generate sub-articles in parallel
    const siblingTitles = nonIndexArticles.map(a => ({ slug: a.slug, title: a.title }));

    const mapResults = await runSubArticlesParallel(
        outline.title, nonIndexArticles, analysisMap, siblingTitles,
        depth, model, timeout, concurrency, onArticleComplete, themeId
    );

    articles.push(...mapResults.articles);
    failedSlugs.push(...mapResults.failedSlugs);

    // REDUCE phase: Generate index page
    const articleSummaries = mapResults.articles.map(a => ({
        slug: a.slug,
        title: a.title,
        summary: extractSummary(a.content, 200),
    }));

    try {
        const indexArticle = await generateIndexPage(
            outline, analysis.crossCutting, articleSummaries, themeId, model, timeout
        );
        articles.push(indexArticle);
        onArticleComplete?.(indexArticle);
    } catch (error) {
        printWarning(`    Index page generation failed: ${getErrorMessage(error)}`);
        // Fall back to a static index page
        const staticIndex = buildStaticIndexPage(outline, articleSummaries);
        articles.push(staticIndex);
        onArticleComplete?.(staticIndex);
    }

    return {
        articles,
        duration: Date.now() - startTime,
        failedSlugs: failedSlugs.length > 0 ? failedSlugs : undefined,
    };
}

// ============================================================================
// MAP Phase: Sub-Article Generation
// ============================================================================

interface MapPhaseResult {
    articles: ThemeArticle[];
    failedSlugs: string[];
}

/**
 * Generate sub-articles in parallel with concurrency control.
 */
async function runSubArticlesParallel(
    themeTitle: string,
    articles: ThemeArticlePlan[],
    analysisMap: Map<string, ThemeArticleAnalysis>,
    siblingTitles: { slug: string; title: string }[],
    depth: 'shallow' | 'normal' | 'deep',
    model: string | undefined,
    timeout: number | undefined,
    concurrency: number,
    onArticleComplete: ((article: ThemeArticle) => void) | undefined,
    themeId: string
): Promise<MapPhaseResult> {
    const results: ThemeArticle[] = [];
    const failedSlugs: string[] = [];
    let activeCount = 0;
    const waiters: (() => void)[] = [];

    async function acquire(): Promise<void> {
        if (activeCount < concurrency) {
            activeCount++;
            return;
        }
        await new Promise<void>(resolve => waiters.push(resolve));
        activeCount++;
    }

    function release(): void {
        activeCount--;
        const next = waiters.shift();
        if (next) next();
    }

    const tasks = articles.map(async (plan) => {
        await acquire();
        try {
            const articleAnalysis = analysisMap.get(plan.slug) ?? makeEmptyArticleAnalysis(plan.slug);
            // Filter out the current article from siblings
            const siblings = siblingTitles.filter(s => s.slug !== plan.slug);

            const article = await generateSubArticle(
                themeTitle, plan, articleAnalysis, siblings, depth, model, timeout
            );
            article.themeId = themeId;
            results.push(article);
            onArticleComplete?.(article);
        } catch (error) {
            printWarning(`    Article generation failed for "${plan.slug}": ${getErrorMessage(error)}`);
            failedSlugs.push(plan.slug);
        } finally {
            release();
        }
    });

    await Promise.all(tasks);

    return { articles: results, failedSlugs };
}

/**
 * Generate a single sub-article via AI.
 */
async function generateSubArticle(
    themeTitle: string,
    plan: ThemeArticlePlan,
    analysis: ThemeArticleAnalysis,
    siblingTitles: { slug: string; title: string }[],
    depth: 'shallow' | 'normal' | 'deep',
    model: string | undefined,
    timeout: number | undefined
): Promise<ThemeArticle> {
    const service = getCopilotSDKService();

    const prompt = buildSubArticlePrompt(themeTitle, plan, analysis, siblingTitles, depth);

    const sendOptions: SendMessageOptions = {
        prompt,
        usePool: false,
        timeoutMs: timeout ?? DEFAULT_ARTICLE_TIMEOUT_MS,
    };

    if (model) {
        sendOptions.model = model;
    }

    printInfo(`    Generating article: ${plan.title} ${gray(`(${plan.coveredFiles.length} files)`)}`);
    const result = await service.sendMessage(sendOptions);

    if (!result.success || !result.response) {
        throw new Error(`AI response failed: ${result.error || 'empty response'}`);
    }

    return {
        type: 'theme-article',
        slug: plan.slug,
        title: plan.title,
        content: result.response,
        themeId: '',  // set by caller
        coveredComponentIds: plan.coveredComponentIds,
    };
}

// ============================================================================
// REDUCE Phase: Index Page Generation
// ============================================================================

/**
 * Generate the index page for a theme area via AI.
 */
async function generateIndexPage(
    outline: ThemeOutline,
    crossCutting: ThemeAnalysis['crossCutting'],
    articleSummaries: { slug: string; title: string; summary: string }[],
    themeId: string,
    model: string | undefined,
    timeout: number | undefined
): Promise<ThemeArticle> {
    const service = getCopilotSDKService();

    const prompt = buildIndexPagePrompt(
        outline.title, outline, crossCutting, articleSummaries
    );

    const sendOptions: SendMessageOptions = {
        prompt,
        usePool: false,
        timeoutMs: timeout ?? DEFAULT_INDEX_TIMEOUT_MS,
    };

    if (model) {
        sendOptions.model = model;
    }

    printInfo(`    Generating index page for "${outline.title}" ${gray(`(${articleSummaries.length} summaries)`)}`);
    const result = await service.sendMessage(sendOptions);

    if (!result.success || !result.response) {
        throw new Error(`AI response failed: ${result.error || 'empty response'}`);
    }

    return {
        type: 'theme-index',
        slug: 'index',
        title: outline.title,
        content: result.response,
        themeId,
        coveredComponentIds: outline.involvedComponents.map(m => m.componentId),
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the first N words from markdown content as a summary.
 */
export function extractSummary(content: string, maxWords: number): string {
    // Strip the leading heading line
    const lines = content.split('\n');
    const bodyStart = lines.findIndex((line, i) => i > 0 && line.trim().length > 0 && !line.startsWith('#') && !line.startsWith('>'));
    const body = bodyStart >= 0 ? lines.slice(bodyStart).join(' ') : content;

    const words = body.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ') + '…';
}

/**
 * Build a static index page when AI reduce fails.
 */
function buildStaticIndexPage(
    outline: ThemeOutline,
    articleSummaries: { slug: string; title: string; summary: string }[]
): ThemeArticle {
    const lines: string[] = [
        `# ${outline.title}`,
        '',
        `Overview of the ${outline.title} theme area.`,
        '',
        '## Articles',
        '',
    ];

    for (const summary of articleSummaries) {
        lines.push(`- [${summary.title}](./${summary.slug}.md) — ${summary.summary.substring(0, 100)}`);
    }

    lines.push('');
    lines.push('## Involved Modules');
    lines.push('');

    for (const mod of outline.involvedComponents) {
        lines.push(`- **${mod.componentId}**: ${mod.role}`);
    }

    return {
        type: 'theme-index',
        slug: 'index',
        title: outline.title,
        content: lines.join('\n'),
        themeId: outline.themeId,
        coveredComponentIds: outline.involvedComponents.map(m => m.componentId),
    };
}

/**
 * Create an empty article analysis for articles without analysis data.
 */
function makeEmptyArticleAnalysis(slug: string): ThemeArticleAnalysis {
    return {
        slug,
        keyConcepts: [],
        dataFlow: '',
        codeExamples: [],
        internalDetails: '',
    };
}

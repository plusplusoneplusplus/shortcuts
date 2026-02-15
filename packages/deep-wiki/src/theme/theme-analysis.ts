/**
 * Theme Analysis Executor
 *
 * Runs deep analysis for each sub-article in a theme outline,
 * plus a cross-cutting analysis for the index page.
 * Per-article analyses run in parallel with concurrency control.
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
    ThemeArticlePlan,
    ThemeArticleAnalysis,
    ThemeCrossCuttingAnalysis,
    ComponentAnalysis,
} from '../types';
import type { EnrichedProbeResult } from './theme-probe';
import { buildArticleAnalysisPrompt, buildCrossCuttingPrompt } from './analysis-prompts';
import { parseAIJsonResponse } from '../utils/parse-ai-response';
import { printInfo, printWarning, gray } from '../logger';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for per-article analysis: 120 seconds */
const DEFAULT_ARTICLE_TIMEOUT_MS = 120_000;

/** Default timeout for cross-cutting analysis: 90 seconds */
const DEFAULT_CROSS_CUTTING_TIMEOUT_MS = 90_000;

/** Default concurrency for parallel article analysis */
const DEFAULT_CONCURRENCY = 5;

// ============================================================================
// Types
// ============================================================================

export interface ThemeAnalysisOptions {
    repoPath: string;
    outline: ThemeOutline;
    probeResult: EnrichedProbeResult;
    /** Reuse cached module analyses for context enrichment */
    existingAnalyses?: ComponentAnalysis[];
    model?: string;
    timeout?: number;
    concurrency?: number;
    depth: 'shallow' | 'normal' | 'deep';
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run analysis for the entire theme:
 * 1. For each non-index article → run per-article analysis in parallel
 * 2. Run cross-cutting analysis for the index page (synthesizes all results)
 *
 * Single-article themes (only an index) skip cross-cutting and return
 * the index article's analysis directly.
 */
export async function runThemeAnalysis(
    options: ThemeAnalysisOptions
): Promise<ThemeAnalysis> {
    const {
        outline,
        repoPath,
        probeResult,
        existingAnalyses,
        model,
        timeout,
        concurrency = DEFAULT_CONCURRENCY,
        depth,
    } = options;

    const nonIndexArticles = outline.articles.filter(a => !a.isIndex);
    const moduleContext = buildModuleContext(outline, probeResult, existingAnalyses);

    printInfo(`  Analyzing theme "${outline.title}": ${outline.articles.length} article(s) ${gray(`(depth: ${depth})`)}`);

    // Phase 1: Per-article analyses (parallel with concurrency control)
    const articleAnalyses = await runArticleAnalysesParallel(
        repoPath, outline, nonIndexArticles, moduleContext, depth, model, timeout, concurrency
    );

    // Single-article theme (only index) → simplified result
    if (nonIndexArticles.length === 0) {
        const indexArticle = outline.articles.find(a => a.isIndex) ?? outline.articles[0];

        // Truly empty outline → return minimal result
        if (!indexArticle) {
            return {
                themeId: outline.themeId,
                overview: `Overview of ${outline.title}`,
                perArticle: [],
                crossCutting: makeDefaultCrossCutting(),
            };
        }

        const indexAnalysis = await analyzeArticleScope(
            repoPath, indexArticle, outline.title, moduleContext, { model, timeout, depth }
        );

        return {
            themeId: outline.themeId,
            overview: indexAnalysis.internalDetails || `Overview of ${outline.title}`,
            perArticle: [indexAnalysis],
            crossCutting: {
                architecture: indexAnalysis.internalDetails,
                dataFlow: indexAnalysis.dataFlow,
                suggestedDiagram: '',
                configuration: undefined,
                relatedThemes: undefined,
            },
        };
    }

    // Phase 2: Cross-cutting analysis
    const crossCutting = await analyzeCrossCutting(
        repoPath, outline, articleAnalyses, { model, timeout }
    );

    return {
        themeId: outline.themeId,
        overview: crossCutting.architecture || `Overview of ${outline.title}`,
        perArticle: articleAnalyses,
        crossCutting,
    };
}

// ============================================================================
// Per-Article Analysis
// ============================================================================

/**
 * Run per-article analyses in parallel with concurrency control.
 * Uses a semaphore pattern to enforce the concurrency limit.
 */
async function runArticleAnalysesParallel(
    repoPath: string,
    outline: ThemeOutline,
    articles: ThemeArticlePlan[],
    moduleContext: string,
    depth: 'shallow' | 'normal' | 'deep',
    model: string | undefined,
    timeout: number | undefined,
    concurrency: number
): Promise<ThemeArticleAnalysis[]> {
    const results: ThemeArticleAnalysis[] = [];
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

    const tasks = articles.map(async (article) => {
        await acquire();
        try {
            const analysis = await analyzeArticleScope(
                repoPath, article, outline.title, moduleContext, { model, timeout, depth }
            );
            results.push(analysis);
        } catch (error) {
            printWarning(`    Article analysis failed for "${article.slug}": ${getErrorMessage(error)}`);
            results.push(makeFailedArticleAnalysis(article.slug));
        } finally {
            release();
        }
    });

    await Promise.all(tasks);

    return results;
}

/**
 * Analyze a single sub-article's scope.
 * Uses AI to examine the covered files and produce structured analysis.
 */
export async function analyzeArticleScope(
    repoPath: string,
    article: ThemeArticlePlan,
    themeTitle: string,
    moduleContext: string,
    options: { model?: string; timeout?: number; depth: 'shallow' | 'normal' | 'deep' }
): Promise<ThemeArticleAnalysis> {
    const service = getCopilotSDKService();

    const prompt = buildArticleAnalysisPrompt(
        themeTitle,
        article.title,
        article.description,
        article.slug,
        article.coveredFiles,
        moduleContext,
        options.depth
    );

    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        usePool: false,
        timeoutMs: options.timeout ?? DEFAULT_ARTICLE_TIMEOUT_MS,
    };

    if (options.model) {
        sendOptions.model = options.model;
    }

    printInfo(`    Analyzing article: ${article.title} ${gray(`(${article.coveredFiles.length} files)`)}`);
    const result = await service.sendMessage(sendOptions);

    if (!result.success || !result.response) {
        throw new Error(`AI response failed: ${result.error || 'empty response'}`);
    }

    return parseArticleAnalysisResponse(result.response, article.slug);
}

// ============================================================================
// Cross-Cutting Analysis
// ============================================================================

/**
 * Generate cross-cutting analysis for the index page.
 * Synthesizes all per-article analyses into a holistic view.
 */
export async function analyzeCrossCutting(
    repoPath: string,
    outline: ThemeOutline,
    articleAnalyses: ThemeArticleAnalysis[],
    options: { model?: string; timeout?: number }
): Promise<ThemeCrossCuttingAnalysis> {
    const service = getCopilotSDKService();

    const articleSummaries = articleAnalyses.map(a =>
        `### ${a.slug}\n` +
        `Key concepts: ${a.keyConcepts.map(c => c.name).join(', ') || 'none'}\n` +
        `Data flow: ${a.dataFlow || 'not described'}\n` +
        `Details: ${a.internalDetails || 'none'}\n`
    ).join('\n');

    const moduleIds = outline.involvedComponents.map(m => m.componentId);

    const prompt = buildCrossCuttingPrompt(
        outline.title, outline.themeId, articleSummaries, moduleIds
    );

    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        usePool: false,
        timeoutMs: options.timeout ?? DEFAULT_CROSS_CUTTING_TIMEOUT_MS,
    };

    if (options.model) {
        sendOptions.model = options.model;
    }

    printInfo(`    Running cross-cutting analysis ${gray(`(${articleAnalyses.length} articles)`)}`);

    try {
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            printWarning(`    Cross-cutting analysis failed: ${result.error || 'empty response'}`);
            return makeDefaultCrossCutting();
        }

        return parseCrossCuttingResponse(result.response);
    } catch (error) {
        printWarning(`    Cross-cutting analysis error: ${getErrorMessage(error)}`);
        return makeDefaultCrossCutting();
    }
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse AI response into a ThemeArticleAnalysis.
 */
function parseArticleAnalysisResponse(response: string, expectedSlug: string): ThemeArticleAnalysis {
    const obj = parseAIJsonResponse(response, { context: 'article-analysis', repair: true });

    return {
        slug: typeof obj.slug === 'string' ? obj.slug : expectedSlug,
        keyConcepts: parseKeyConcepts(obj.keyConcepts),
        dataFlow: typeof obj.dataFlow === 'string' ? obj.dataFlow : '',
        codeExamples: parseCodeExamples(obj.codeExamples),
        internalDetails: typeof obj.internalDetails === 'string' ? obj.internalDetails : '',
    };
}

/**
 * Parse AI response into a ThemeCrossCuttingAnalysis.
 */
function parseCrossCuttingResponse(response: string): ThemeCrossCuttingAnalysis {
    const obj = parseAIJsonResponse(response, { context: 'cross-cutting-analysis', repair: true });

    return {
        architecture: typeof obj.architecture === 'string' ? obj.architecture : '',
        dataFlow: typeof obj.dataFlow === 'string' ? obj.dataFlow : '',
        suggestedDiagram: typeof obj.suggestedDiagram === 'string' ? obj.suggestedDiagram : '',
        configuration: typeof obj.configuration === 'string' ? obj.configuration : undefined,
        relatedThemes: parseStringArray(obj.relatedThemes),
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build module context string from existing analyses and probe results.
 * Used to enrich per-article prompts with cached module data.
 */
function buildModuleContext(
    outline: ThemeOutline,
    probeResult: EnrichedProbeResult,
    existingAnalyses?: ComponentAnalysis[]
): string {
    if (!existingAnalyses || existingAnalyses.length === 0) {
        // Fall back to probe-level info
        return outline.involvedComponents.map(m =>
            `- ${m.componentId}: ${m.role} (files: ${m.keyFiles.join(', ')})`
        ).join('\n');
    }

    const analysisMap = new Map(existingAnalyses.map(a => [a.componentId, a]));
    const involvedIds = new Set(outline.involvedComponents.map(m => m.componentId));

    const lines: string[] = [];
    for (const moduleId of involvedIds) {
        const cached = analysisMap.get(moduleId);
        if (cached) {
            lines.push(
                `- ${moduleId}: ${cached.overview}\n` +
                `  Key concepts: ${cached.keyConcepts.map(c => c.name).join(', ')}\n` +
                `  Data flow: ${cached.dataFlow}`
            );
        } else {
            const probeModule = probeResult.probeResult.foundComponents.find(m => m.id === moduleId);
            lines.push(`- ${moduleId}: ${probeModule?.purpose || 'unknown'}`);
        }
    }

    return lines.join('\n');
}

function parseKeyConcepts(raw: unknown): ThemeArticleAnalysis['keyConcepts'] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).name === 'string'
        )
        .map(item => ({
            name: item.name as string,
            description: typeof item.description === 'string' ? item.description : '',
            codeRef: typeof item.codeRef === 'string' ? item.codeRef : undefined,
        }));
}

function parseCodeExamples(raw: unknown): ThemeArticleAnalysis['codeExamples'] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).title === 'string'
        )
        .map(item => ({
            title: item.title as string,
            code: typeof item.code === 'string' ? item.code : '',
            file: typeof item.file === 'string' ? item.file : '',
        }));
}

function parseStringArray(raw: unknown): string[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const arr = raw.filter(item => typeof item === 'string').map(item => String(item));
    return arr.length > 0 ? arr : undefined;
}

function makeFailedArticleAnalysis(slug: string): ThemeArticleAnalysis {
    return {
        slug,
        keyConcepts: [],
        dataFlow: '',
        codeExamples: [],
        internalDetails: 'Analysis failed — no data available.',
    };
}

function makeDefaultCrossCutting(): ThemeCrossCuttingAnalysis {
    return {
        architecture: '',
        dataFlow: '',
        suggestedDiagram: '',
        configuration: undefined,
        relatedThemes: undefined,
    };
}

/**
 * Writing Module — Public API
 *
 * Phase 3 (Article Generation) entry point. Converts ModuleAnalysis results
 * into markdown wiki articles and generates index/architecture overview pages.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WritingOptions, WikiOutput } from '../types';
import type { AIInvoker, JobProgress } from '@plusplusoneplusplus/pipeline-core';
import { runArticleExecutor } from './article-executor';

// Re-export for convenience
export { buildModuleArticlePrompt, buildModuleArticlePromptTemplate, buildSimplifiedGraph, getArticleStyleGuide } from './prompts';
export { buildReducePromptTemplate, getReduceOutputFields, buildModuleSummaryForReduce } from './reduce-prompts';
export { runArticleExecutor, analysisToPromptItem, generateStaticIndexPages } from './article-executor';
export { writeWikiOutput, getArticleFilePath, slugify, normalizeLineEndings } from './file-writer';
export type { ArticleExecutorOptions, ArticleExecutorResult } from './article-executor';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate wiki articles from module analyses.
 *
 * Runs a map-reduce job:
 * - Map: Per-module article generation (text mode, raw markdown)
 * - Reduce: AI-generated index, architecture, and getting-started pages
 *
 * @param options Writing options
 * @param aiInvoker Configured AI invoker for writing (session pool)
 * @param onProgress Optional progress callback
 * @param isCancelled Optional cancellation check
 * @returns Wiki output with all articles
 */
export async function generateArticles(
    options: WritingOptions,
    aiInvoker: AIInvoker,
    onProgress?: (progress: JobProgress) => void,
    isCancelled?: () => boolean,
): Promise<WikiOutput> {
    const startTime = Date.now();

    const result = await runArticleExecutor({
        aiInvoker,
        graph: options.graph,
        analyses: options.analyses,
        depth: options.depth || 'normal',
        concurrency: options.concurrency || 10,
        timeoutMs: options.timeout || 120_000,
        model: options.model,
        onProgress,
        isCancelled,
    });

    return {
        articles: result.articles,
        duration: Date.now() - startTime,
    };
}

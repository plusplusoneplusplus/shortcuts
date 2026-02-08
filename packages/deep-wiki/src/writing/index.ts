/**
 * Writing Module — Public API
 *
 * Phase 3 (Article Generation) entry point. Converts ModuleAnalysis results
 * into markdown wiki articles and generates index/architecture overview pages.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { WritingOptions, WikiOutput } from '../types';
import type { AIInvoker, JobProgress, ItemCompleteCallback } from '@plusplusoneplusplus/pipeline-core';
import { runArticleExecutor } from './article-executor';

// Re-export for convenience
export { buildModuleArticlePrompt, buildModuleArticlePromptTemplate, buildSimplifiedGraph, getArticleStyleGuide, buildCrossLinkRules } from './prompts';
export { buildReducePromptTemplate, getReduceOutputFields, buildModuleSummaryForReduce, buildAreaReducePromptTemplate, getAreaReduceOutputFields, buildHierarchicalReducePromptTemplate } from './reduce-prompts';
export { runArticleExecutor, analysisToPromptItem, generateStaticIndexPages, generateStaticAreaPages, generateStaticHierarchicalIndexPages } from './article-executor';
export { writeWikiOutput, getArticleFilePath, slugify, normalizeLineEndings } from './file-writer';
export { generateWebsite, generateEmbeddedData, generateHtmlTemplate, readModuleGraph, readMarkdownFiles, stableStringify } from './website-generator';
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
 * @param onItemComplete Optional per-item completion callback for incremental saving
 * @returns Wiki output with all articles
 */
export async function generateArticles(
    options: WritingOptions,
    aiInvoker: AIInvoker,
    onProgress?: (progress: JobProgress) => void,
    isCancelled?: () => boolean,
    onItemComplete?: ItemCompleteCallback,
): Promise<WikiOutput> {
    const startTime = Date.now();

    const result = await runArticleExecutor({
        aiInvoker,
        graph: options.graph,
        analyses: options.analyses,
        depth: options.depth || 'normal',
        concurrency: options.concurrency || 5,
        timeoutMs: options.timeout || 120_000,
        model: options.model,
        onProgress,
        isCancelled,
        onItemComplete,
    });

    return {
        articles: result.articles,
        duration: Date.now() - startTime,
    };
}

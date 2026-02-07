/**
 * Article Executor
 *
 * Orchestrates Phase 3 (Article Generation) using the MapReduceExecutor
 * from pipeline-core. Runs two stages:
 * 1. Map: Generate per-module markdown articles (text mode, no structured output)
 * 2. Reduce: AI generates index, architecture, and getting-started pages
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    createPromptMapJob,
    createPromptMapInput,
    createExecutor,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    AIInvoker,
    PromptItem,
    PromptMapOutput,
    JobProgress,
    ItemCompleteCallback,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    ModuleGraph,
    ModuleAnalysis,
    GeneratedArticle,
} from '../types';
import { buildModuleArticlePromptTemplate, buildSimplifiedGraph } from './prompts';
import { buildReducePromptTemplate, getReduceOutputFields, buildModuleSummaryForReduce } from './reduce-prompts';
import { normalizeModuleId } from '../schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the article executor.
 */
export interface ArticleExecutorOptions {
    /** AI invoker for writing (session pool, no tools) */
    aiInvoker: AIInvoker;
    /** Module graph from Phase 1 */
    graph: ModuleGraph;
    /** Per-module analyses from Phase 2 */
    analyses: ModuleAnalysis[];
    /** Article depth */
    depth: 'shallow' | 'normal' | 'deep';
    /** Maximum concurrent AI sessions (default: 10) */
    concurrency?: number;
    /** Timeout per article in milliseconds */
    timeoutMs?: number;
    /** AI model to use */
    model?: string;
    /** Progress callback */
    onProgress?: (progress: JobProgress) => void;
    /** Cancellation check */
    isCancelled?: () => boolean;
    /**
     * Optional callback invoked after each individual article completes.
     * Useful for incremental per-article cache writes during long-running generation.
     */
    onItemComplete?: ItemCompleteCallback;
}

/**
 * Result of the article executor.
 */
export interface ArticleExecutorResult {
    /** Generated articles (module + index pages) */
    articles: GeneratedArticle[];
    /** Module IDs that failed article generation */
    failedModuleIds: string[];
    /** Total duration in milliseconds */
    duration: number;
}

// ============================================================================
// Analysis → PromptItem Conversion
// ============================================================================

/**
 * Convert an analysis into a PromptItem for the article template.
 * Uses text mode (no output fields) so the AI returns raw markdown.
 */
export function analysisToPromptItem(
    analysis: ModuleAnalysis,
    graph: ModuleGraph
): PromptItem {
    const moduleInfo = graph.modules.find(m => m.id === analysis.moduleId);
    const moduleName = moduleInfo?.name || analysis.moduleId;

    return {
        moduleId: analysis.moduleId,
        moduleName,
        analysis: JSON.stringify(analysis, null, 2),
        moduleGraph: buildSimplifiedGraph(graph),
    };
}

// ============================================================================
// Article Executor
// ============================================================================

/**
 * Run the article executor to generate wiki articles.
 *
 * @param options Executor options
 * @returns Generated articles
 */
export async function runArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const startTime = Date.now();
    const {
        aiInvoker,
        graph,
        analyses,
        depth,
        concurrency = 10,
        timeoutMs,
        model,
        onProgress,
        isCancelled,
        onItemComplete,
    } = options;

    if (analyses.length === 0) {
        return { articles: [], failedModuleIds: [], duration: 0 };
    }

    // Convert analyses to PromptItems
    const items: PromptItem[] = analyses.map(a => analysisToPromptItem(a, graph));

    // Build the article prompt template (text mode — no output fields)
    const promptTemplate = buildModuleArticlePromptTemplate(depth);
    const outputFields: string[] = []; // Text mode: empty output fields

    // Build reduce prompt for index/architecture/getting-started
    const reducePrompt = buildReducePromptTemplate();
    const reduceOutputFields = getReduceOutputFields();

    // Build reduce parameters from project info
    const reduceParameters: Record<string, string> = {
        projectName: graph.project.name,
        projectDescription: graph.project.description || 'No description available',
        buildSystem: graph.project.buildSystem || 'Unknown',
        language: graph.project.language || 'Unknown',
    };

    // Create prompt map input
    const input = createPromptMapInput(items, promptTemplate, outputFields);

    // Create the job with AI reduce
    const job = createPromptMapJob({
        aiInvoker,
        outputFormat: 'ai',
        model,
        maxConcurrency: concurrency,
        aiReducePrompt: reducePrompt,
        aiReduceOutput: reduceOutputFields,
        aiReduceModel: model,
        aiReduceParameters: reduceParameters,
    });

    // Create the executor
    const executor = createExecutor({
        aiInvoker,
        maxConcurrency: concurrency,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        timeoutMs,
        jobName: 'Article Generation',
        onProgress,
        isCancelled,
        onItemComplete,
    });

    // Execute map-reduce
    const result = await executor.execute(job, input);

    // Collect articles
    const articles: GeneratedArticle[] = [];
    const failedModuleIds: string[] = [];

    // Process map results (per-module articles)
    if (result.output) {
        const output = result.output as PromptMapOutput;
        for (const mapResult of output.results) {
            const moduleId = mapResult.item.moduleId;
            const moduleInfo = graph.modules.find(m => m.id === moduleId);
            const moduleName = moduleInfo?.name || moduleId;

            if (mapResult.success && (mapResult.rawText || mapResult.rawResponse)) {
                const content = mapResult.rawText || mapResult.rawResponse || '';
                articles.push({
                    type: 'module',
                    slug: normalizeModuleId(moduleId),
                    title: moduleName,
                    content,
                    moduleId,
                });
            } else {
                failedModuleIds.push(moduleId);
            }
        }

        // Process reduce result (index pages)
        const formattedOutput = output.formattedOutput;
        if (formattedOutput) {
            try {
                const reduceResult = JSON.parse(formattedOutput) as Record<string, string>;

                if (reduceResult.index) {
                    articles.push({
                        type: 'index',
                        slug: 'index',
                        title: `${graph.project.name} Wiki`,
                        content: reduceResult.index,
                    });
                }

                if (reduceResult.architecture) {
                    articles.push({
                        type: 'architecture',
                        slug: 'architecture',
                        title: 'Architecture Overview',
                        content: reduceResult.architecture,
                    });
                }

                if (reduceResult.gettingStarted) {
                    articles.push({
                        type: 'getting-started',
                        slug: 'getting-started',
                        title: 'Getting Started',
                        content: reduceResult.gettingStarted,
                    });
                }
            } catch {
                // Reduce failed — generate static fallback
                articles.push(...generateStaticIndexPages(graph, analyses));
            }
        } else {
            // No reduce output — generate static fallback
            articles.push(...generateStaticIndexPages(graph, analyses));
        }
    }

    return {
        articles,
        failedModuleIds,
        duration: Date.now() - startTime,
    };
}

// ============================================================================
// Static Fallback
// ============================================================================

/**
 * Generate static index pages when AI reduce fails.
 * Produces a basic TOC and architecture placeholder.
 */
export function generateStaticIndexPages(
    graph: ModuleGraph,
    analyses: ModuleAnalysis[]
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Static index
    const indexLines: string[] = [
        `# ${graph.project.name}`,
        '',
        graph.project.description || '',
        '',
        '## Modules',
        '',
    ];

    // Group by category
    const byCategory = new Map<string, ModuleAnalysis[]>();
    for (const a of analyses) {
        const mod = graph.modules.find(m => m.id === a.moduleId);
        const category = mod?.category || 'uncategorized';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(a);
    }

    for (const [category, mods] of byCategory) {
        indexLines.push(`### ${category}`, '');
        for (const a of mods) {
            const mod = graph.modules.find(m => m.id === a.moduleId);
            const name = mod?.name || a.moduleId;
            const slug = normalizeModuleId(a.moduleId);
            indexLines.push(`- [${name}](./modules/${slug}.md) — ${a.overview.substring(0, 100)}`);
        }
        indexLines.push('');
    }

    articles.push({
        type: 'index',
        slug: 'index',
        title: `${graph.project.name} Wiki`,
        content: indexLines.join('\n'),
    });

    // Static architecture placeholder
    articles.push({
        type: 'architecture',
        slug: 'architecture',
        title: 'Architecture Overview',
        content: [
            '# Architecture Overview',
            '',
            `${graph.project.name} is built with ${graph.project.language} using ${graph.project.buildSystem}.`,
            '',
            graph.architectureNotes || 'No architecture notes available.',
        ].join('\n'),
    });

    return articles;
}

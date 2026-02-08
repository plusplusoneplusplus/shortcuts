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
import {
    buildReducePromptTemplate,
    getReduceOutputFields,
    buildModuleSummaryForReduce,
    buildAreaReducePromptTemplate,
    getAreaReduceOutputFields,
    buildHierarchicalReducePromptTemplate,
} from './reduce-prompts';
import { normalizeModuleId } from '../schemas';
import type { AreaInfo } from '../types';

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
 * Detects if `graph.areas` exists (large repo mode) and switches to hierarchical execution:
 * - If areas: group analyses by area → per-area map-reduce → project-level reduce
 * - If no areas: existing flat map-reduce (backward compat)
 *
 * @param options Executor options
 * @returns Generated articles
 */
export async function runArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const { graph } = options;

    // Detect hierarchical mode
    if (graph.areas && graph.areas.length > 0) {
        return runHierarchicalArticleExecutor(options);
    }

    return runFlatArticleExecutor(options);
}

/**
 * Flat article executor — original behavior for small repos without areas.
 */
async function runFlatArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const startTime = Date.now();
    const {
        aiInvoker,
        graph,
        analyses,
        depth,
        concurrency = 5,
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
// Hierarchical Article Executor (Large Repos with Areas)
// ============================================================================

/**
 * Hierarchical article executor for large repos with areas.
 * Runs a 2-tier reduce:
 *   1. Map: Generate per-module articles (grouped by area)
 *   2. Per-area reduce: Generate area index + area architecture
 *   3. Project-level reduce: Generate project index + architecture + getting-started
 */
async function runHierarchicalArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const startTime = Date.now();
    const {
        aiInvoker,
        graph,
        analyses,
        depth,
        concurrency = 5,
        timeoutMs,
        model,
        onProgress,
        isCancelled,
        onItemComplete,
    } = options;

    if (analyses.length === 0) {
        return { articles: [], failedModuleIds: [], duration: 0 };
    }

    const areas = graph.areas!;
    const allArticles: GeneratedArticle[] = [];
    const allFailedModuleIds: string[] = [];

    // Build module-to-area mapping
    const moduleAreaMap = new Map<string, string>();
    for (const area of areas) {
        for (const moduleId of area.modules) {
            moduleAreaMap.set(moduleId, area.id);
        }
    }

    // Group analyses by area
    const analysesByArea = new Map<string, ModuleAnalysis[]>();
    const unassignedAnalyses: ModuleAnalysis[] = [];
    for (const analysis of analyses) {
        const areaId = moduleAreaMap.get(analysis.moduleId);
        if (areaId) {
            if (!analysesByArea.has(areaId)) {
                analysesByArea.set(areaId, []);
            }
            analysesByArea.get(areaId)!.push(analysis);
        } else {
            unassignedAnalyses.push(analysis);
        }
    }

    // ================================================================
    // Step 1: Generate per-module articles (all areas in one map phase)
    // ================================================================

    // Build area-aware prompt template
    const promptTemplatesByArea = new Map<string, string>();
    for (const area of areas) {
        promptTemplatesByArea.set(area.id, buildModuleArticlePromptTemplate(depth, area.id));
    }
    // Default template for unassigned modules
    const defaultPromptTemplate = buildModuleArticlePromptTemplate(depth);

    // Convert all analyses to PromptItems (with area context embedded)
    const allItems: PromptItem[] = analyses.map(a => analysisToPromptItem(a, graph));

    // Use a single map phase for all modules with the flat prompt (area-aware linking is per-module)
    const input = createPromptMapInput(allItems, defaultPromptTemplate, []);

    // For the map phase, use list reduce (we handle area/project reduce separately)
    const job = createPromptMapJob({
        aiInvoker,
        outputFormat: 'list',
        model,
        maxConcurrency: concurrency,
    });

    const executor = createExecutor({
        aiInvoker,
        maxConcurrency: concurrency,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        timeoutMs,
        jobName: 'Article Generation (Hierarchical)',
        onProgress,
        isCancelled,
        onItemComplete,
    });

    const mapResult = await executor.execute(job, input);

    // Process map results into articles tagged with area
    if (mapResult.output) {
        const output = mapResult.output as PromptMapOutput;
        for (const result of output.results) {
            const moduleId = result.item.moduleId;
            const moduleInfo = graph.modules.find(m => m.id === moduleId);
            const moduleName = moduleInfo?.name || moduleId;
            const areaId = moduleAreaMap.get(moduleId);

            if (result.success && (result.rawText || result.rawResponse)) {
                const content = result.rawText || result.rawResponse || '';
                allArticles.push({
                    type: 'module',
                    slug: normalizeModuleId(moduleId),
                    title: moduleName,
                    content,
                    moduleId,
                    areaId,
                });
            } else {
                allFailedModuleIds.push(moduleId);
            }
        }
    }

    // ================================================================
    // Step 2: Per-area reduce (area index + area architecture)
    // ================================================================

    const areaSummaries: Array<{ areaId: string; name: string; description: string; summary: string; moduleCount: number }> = [];

    for (const area of areas) {
        const areaAnalyses = analysesByArea.get(area.id) || [];
        if (areaAnalyses.length === 0) { continue; }

        // Build module summary items for this area
        const areaModuleSummaries = areaAnalyses.map(a => {
            const mod = graph.modules.find(m => m.id === a.moduleId);
            return buildModuleSummaryForReduce(
                a.moduleId,
                mod?.name || a.moduleId,
                mod?.category || 'uncategorized',
                a.overview
            );
        });

        // Run area-level reduce as a standalone AI call
        const areaReducePrompt = buildAreaReducePromptTemplate();
        const areaReduceInput = createPromptMapInput(
            areaModuleSummaries.map((summary, i) => ({
                summary,
                moduleId: areaAnalyses[i].moduleId,
            })),
            '{{summary}}', // Simple passthrough — items are pre-formatted summaries
            []
        );

        const areaReduceJob = createPromptMapJob({
            aiInvoker,
            outputFormat: 'ai',
            model,
            maxConcurrency: 1,
            aiReducePrompt: areaReducePrompt,
            aiReduceOutput: getAreaReduceOutputFields(),
            aiReduceModel: model,
            aiReduceParameters: {
                areaName: area.name,
                areaDescription: area.description,
                areaPath: area.path,
                projectName: graph.project.name,
            },
        });

        const areaReduceExecutor = createExecutor({
            aiInvoker,
            maxConcurrency: 1,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs,
            jobName: `Area Reduce: ${area.name}`,
            isCancelled,
        });

        try {
            const areaResult = await areaReduceExecutor.execute(areaReduceJob, areaReduceInput);
            const areaOutput = areaResult.output as PromptMapOutput | undefined;
            const formattedOutput = areaOutput?.formattedOutput;

            if (formattedOutput) {
                const parsed = JSON.parse(formattedOutput) as Record<string, string>;

                if (parsed.index) {
                    allArticles.push({
                        type: 'area-index',
                        slug: 'index',
                        title: `${area.name} — Overview`,
                        content: parsed.index,
                        areaId: area.id,
                    });
                    // Save area summary for project-level reduce
                    areaSummaries.push({
                        areaId: area.id,
                        name: area.name,
                        description: area.description,
                        summary: parsed.index.substring(0, 1000),
                        moduleCount: areaAnalyses.length,
                    });
                }

                if (parsed.architecture) {
                    allArticles.push({
                        type: 'area-architecture',
                        slug: 'architecture',
                        title: `${area.name} — Architecture`,
                        content: parsed.architecture,
                        areaId: area.id,
                    });
                }
            } else {
                // Static fallback for area
                allArticles.push(...generateStaticAreaPages(area, areaAnalyses, graph));
                areaSummaries.push({
                    areaId: area.id,
                    name: area.name,
                    description: area.description,
                    summary: area.description,
                    moduleCount: areaAnalyses.length,
                });
            }
        } catch {
            // Area reduce failed — static fallback
            const areaAnalysesForFallback = analysesByArea.get(area.id) || [];
            allArticles.push(...generateStaticAreaPages(area, areaAnalysesForFallback, graph));
            areaSummaries.push({
                areaId: area.id,
                name: area.name,
                description: area.description,
                summary: area.description,
                moduleCount: areaAnalysesForFallback.length,
            });
        }
    }

    // ================================================================
    // Step 3: Project-level reduce (project index + architecture + getting-started)
    // ================================================================

    const projectReduceItems = areaSummaries.map(s => ({
        areaId: s.areaId,
        areaName: s.name,
        summary: JSON.stringify(s),
    }));

    const projectReduceInput = createPromptMapInput(
        projectReduceItems,
        '{{summary}}',
        []
    );

    const projectReducePrompt = buildHierarchicalReducePromptTemplate();
    const projectReduceJob = createPromptMapJob({
        aiInvoker,
        outputFormat: 'ai',
        model,
        maxConcurrency: 1,
        aiReducePrompt: projectReducePrompt,
        aiReduceOutput: getReduceOutputFields(),
        aiReduceModel: model,
        aiReduceParameters: {
            projectName: graph.project.name,
            projectDescription: graph.project.description || 'No description available',
            buildSystem: graph.project.buildSystem || 'Unknown',
            language: graph.project.language || 'Unknown',
        },
    });

    const projectReduceExecutor = createExecutor({
        aiInvoker,
        maxConcurrency: 1,
        reduceMode: 'deterministic',
        showProgress: false,
        retryOnFailure: false,
        timeoutMs,
        jobName: 'Project Reduce',
        isCancelled,
    });

    try {
        const projectResult = await projectReduceExecutor.execute(projectReduceJob, projectReduceInput);
        const projectOutput = projectResult.output as PromptMapOutput | undefined;
        const formattedOutput = projectOutput?.formattedOutput;

        if (formattedOutput) {
            const parsed = JSON.parse(formattedOutput) as Record<string, string>;

            if (parsed.index) {
                allArticles.push({
                    type: 'index',
                    slug: 'index',
                    title: `${graph.project.name} Wiki`,
                    content: parsed.index,
                });
            }

            if (parsed.architecture) {
                allArticles.push({
                    type: 'architecture',
                    slug: 'architecture',
                    title: 'Architecture Overview',
                    content: parsed.architecture,
                });
            }

            if (parsed.gettingStarted) {
                allArticles.push({
                    type: 'getting-started',
                    slug: 'getting-started',
                    title: 'Getting Started',
                    content: parsed.gettingStarted,
                });
            }
        } else {
            allArticles.push(...generateStaticHierarchicalIndexPages(graph, areas, areaSummaries));
        }
    } catch {
        allArticles.push(...generateStaticHierarchicalIndexPages(graph, areas, areaSummaries));
    }

    return {
        articles: allArticles,
        failedModuleIds: allFailedModuleIds,
        duration: Date.now() - startTime,
    };
}

// ============================================================================
// Static Fallback
// ============================================================================

/**
 * Generate static area-level pages when area AI reduce fails.
 */
export function generateStaticAreaPages(
    area: AreaInfo,
    analyses: ModuleAnalysis[],
    graph: ModuleGraph
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Area index
    const indexLines: string[] = [
        `# ${area.name}`,
        '',
        area.description || '',
        '',
        '## Modules',
        '',
    ];

    for (const a of analyses) {
        const mod = graph.modules.find(m => m.id === a.moduleId);
        const name = mod?.name || a.moduleId;
        const slug = normalizeModuleId(a.moduleId);
        indexLines.push(`- [${name}](./modules/${slug}.md) — ${a.overview.substring(0, 100)}`);
    }

    articles.push({
        type: 'area-index',
        slug: 'index',
        title: `${area.name} — Overview`,
        content: indexLines.join('\n'),
        areaId: area.id,
    });

    // Area architecture placeholder
    articles.push({
        type: 'area-architecture',
        slug: 'architecture',
        title: `${area.name} — Architecture`,
        content: [
            `# ${area.name} — Architecture`,
            '',
            area.description || 'No architecture description available.',
        ].join('\n'),
        areaId: area.id,
    });

    return articles;
}

/**
 * Generate static project-level index pages for hierarchical layout.
 */
export function generateStaticHierarchicalIndexPages(
    graph: ModuleGraph,
    areas: AreaInfo[],
    areaSummaries: Array<{ areaId: string; name: string; description: string; moduleCount: number }>
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Project index
    const indexLines: string[] = [
        `# ${graph.project.name}`,
        '',
        graph.project.description || '',
        '',
        '## Areas',
        '',
    ];

    for (const summary of areaSummaries) {
        indexLines.push(`- [${summary.name}](./areas/${summary.areaId}/index.md) — ${summary.description} (${summary.moduleCount} modules)`);
    }

    articles.push({
        type: 'index',
        slug: 'index',
        title: `${graph.project.name} Wiki`,
        content: indexLines.join('\n'),
    });

    // Architecture placeholder
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

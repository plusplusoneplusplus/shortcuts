/**
 * Article Executor
 *
 * Orchestrates Phase 4 (Article Generation) using the MapReduceExecutor
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
    buildDomainReducePromptTemplate,
    getDomainReduceOutputFields,
    buildHierarchicalReducePromptTemplate,
} from './reduce-prompts';
import { normalizeModuleId } from '../schemas';
import type { DomainInfo } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the article executor.
 */
export interface ArticleExecutorOptions {
    /** AI invoker for writing (session pool, no tools) */
    aiInvoker: AIInvoker;
    /** Module graph from Phase 1 (Discovery) */
    graph: ModuleGraph;
    /** Per-module analyses from Phase 3 (Analysis) */
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
 * Detects if `graph.domains` exists (large repo mode) and switches to hierarchical execution:
 * - If domains: group analyses by domain → per-domain map-reduce → project-level reduce
 * - If no domains: existing flat map-reduce (backward compat)
 *
 * @param options Executor options
 * @returns Generated articles
 */
export async function runArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const { graph } = options;

    // Detect hierarchical mode
    if (graph.domains && graph.domains.length > 0) {
        return runHierarchicalArticleExecutor(options);
    }

    return runFlatArticleExecutor(options);
}

/**
 * Flat article executor — original behavior for small repos without domains.
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

    // Create prompt map input
    const input = createPromptMapInput(items, promptTemplate, []);

    // Map phase only — reduce is done separately with module summaries
    // to avoid exceeding token limits (full articles can be very large)
    const job = createPromptMapJob({
        aiInvoker,
        outputFormat: 'list',
        model,
        maxConcurrency: concurrency,
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

    // Execute map phase
    const result = await executor.execute(job, input);

    // Collect module articles from map results
    const articles: GeneratedArticle[] = [];
    const failedModuleIds: string[] = [];

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
    }

    // Separate reduce phase: use compact module summaries (not full articles)
    // to stay within model token limits
    const moduleSummaries = analyses.map(a => {
        const mod = graph.modules.find(m => m.id === a.moduleId);
        return buildModuleSummaryForReduce(
            a.moduleId,
            mod?.name || a.moduleId,
            mod?.category || 'uncategorized',
            a.overview
        );
    });

    const reduceInput = createPromptMapInput(
        moduleSummaries.map((summary, i) => ({
            summary,
            moduleId: analyses[i].moduleId,
        })),
        '{{summary}}',
        []
    );

    const reduceJob = createPromptMapJob({
        aiInvoker,
        outputFormat: 'ai',
        model,
        maxConcurrency: 1,
        aiReducePrompt: buildReducePromptTemplate(),
        aiReduceOutput: getReduceOutputFields(),
        aiReduceModel: model,
        aiReduceParameters: {
            projectName: graph.project.name,
            projectDescription: graph.project.description || 'No description available',
            buildSystem: graph.project.buildSystem || 'Unknown',
            language: graph.project.language || 'Unknown',
        },
    });

    const reduceExecutor = createExecutor({
        aiInvoker,
        maxConcurrency: 1,
        reduceMode: 'deterministic',
        showProgress: false,
        retryOnFailure: false,
        timeoutMs,
        jobName: 'Index Generation',
        onProgress,
        isCancelled,
    });

    try {
        const reduceResult = await reduceExecutor.execute(reduceJob, reduceInput);
        const reduceOutput = reduceResult.output as PromptMapOutput | undefined;
        const formattedOutput = reduceOutput?.formattedOutput;

        if (formattedOutput) {
            const parsed = JSON.parse(formattedOutput) as Record<string, string>;

            if (parsed.index) {
                articles.push({
                    type: 'index',
                    slug: 'index',
                    title: `${graph.project.name} Wiki`,
                    content: parsed.index,
                });
            }

            if (parsed.architecture) {
                articles.push({
                    type: 'architecture',
                    slug: 'architecture',
                    title: 'Architecture Overview',
                    content: parsed.architecture,
                });
            }

            if (parsed.gettingStarted) {
                articles.push({
                    type: 'getting-started',
                    slug: 'getting-started',
                    title: 'Getting Started',
                    content: parsed.gettingStarted,
                });
            }
        } else {
            articles.push(...generateStaticIndexPages(graph, analyses));
        }
    } catch {
        articles.push(...generateStaticIndexPages(graph, analyses));
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

/** Result of grouping analyses by domain. */
export interface DomainGrouping {
    moduleDomainMap: Map<string, string>;
    analysesByDomain: Map<string, ModuleAnalysis[]>;
    unassignedAnalyses: ModuleAnalysis[];
}

/** Result of the module map phase. */
interface ModuleMapResult {
    articles: GeneratedArticle[];
    failedIds: Set<string>;
}

/** Result of a single domain reduce phase. */
interface DomainReduceResult {
    articles: GeneratedArticle[];
    domainSummary: { domainId: string; name: string; description: string; summary: string; moduleCount: number };
}

/**
 * Group analyses by their domain assignment.
 * Builds module→domain mapping and buckets analyses accordingly.
 */
export function groupAnalysesByDomain(
    analyses: ModuleAnalysis[],
    domains: DomainInfo[]
): DomainGrouping {
    const moduleDomainMap = new Map<string, string>();
    for (const domain of domains) {
        for (const moduleId of domain.modules) {
            moduleDomainMap.set(moduleId, domain.id);
        }
    }

    const analysesByDomain = new Map<string, ModuleAnalysis[]>();
    const unassignedAnalyses: ModuleAnalysis[] = [];
    for (const analysis of analyses) {
        const domainId = moduleDomainMap.get(analysis.moduleId);
        if (domainId) {
            if (!analysesByDomain.has(domainId)) {
                analysesByDomain.set(domainId, []);
            }
            analysesByDomain.get(domainId)!.push(analysis);
        } else {
            unassignedAnalyses.push(analysis);
        }
    }

    return { moduleDomainMap, analysesByDomain, unassignedAnalyses };
}

/**
 * Run the unified map phase across all modules, tagging results with their domain.
 */
async function runModuleMapPhase(
    options: ArticleExecutorOptions,
    analyses: ModuleAnalysis[],
    graph: ModuleGraph,
    moduleDomainMap: Map<string, string>
): Promise<ModuleMapResult> {
    const {
        aiInvoker,
        depth,
        concurrency = 5,
        timeoutMs,
        model,
        onProgress,
        isCancelled,
        onItemComplete,
    } = options;

    const allItems: PromptItem[] = analyses.map(a => analysisToPromptItem(a, graph));
    const defaultPromptTemplate = buildModuleArticlePromptTemplate(depth);
    const input = createPromptMapInput(allItems, defaultPromptTemplate, []);

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

    const articles: GeneratedArticle[] = [];
    const failedIds = new Set<string>();

    if (mapResult.output) {
        const output = mapResult.output as PromptMapOutput;
        for (const result of output.results) {
            const moduleId = result.item.moduleId;
            const moduleInfo = graph.modules.find(m => m.id === moduleId);
            const moduleName = moduleInfo?.name || moduleId;
            const domainId = moduleDomainMap.get(moduleId);

            if (result.success && (result.rawText || result.rawResponse)) {
                const content = result.rawText || result.rawResponse || '';
                articles.push({
                    type: 'module',
                    slug: normalizeModuleId(moduleId),
                    title: moduleName,
                    content,
                    moduleId,
                    domainId,
                });
            } else {
                failedIds.add(moduleId);
            }
        }
    }

    return { articles, failedIds };
}

/**
 * Run reduce for a single domain: generates domain index and architecture articles.
 * Falls back to static pages on failure.
 */
async function runDomainReducePhase(
    domain: DomainInfo,
    domainAnalyses: ModuleAnalysis[],
    graph: ModuleGraph,
    options: ArticleExecutorOptions
): Promise<DomainReduceResult> {
    const { aiInvoker, timeoutMs, model, isCancelled } = options;

    const domainModuleSummaries = domainAnalyses.map(a => {
        const mod = graph.modules.find(m => m.id === a.moduleId);
        return buildModuleSummaryForReduce(
            a.moduleId,
            mod?.name || a.moduleId,
            mod?.category || 'uncategorized',
            a.overview
        );
    });

    const domainReduceInput = createPromptMapInput(
        domainModuleSummaries.map((summary, i) => ({
            summary,
            moduleId: domainAnalyses[i].moduleId,
        })),
        '{{summary}}',
        []
    );

    const domainReduceJob = createPromptMapJob({
        aiInvoker,
        outputFormat: 'ai',
        model,
        maxConcurrency: 1,
        aiReducePrompt: buildDomainReducePromptTemplate(),
        aiReduceOutput: getDomainReduceOutputFields(),
        aiReduceModel: model,
        aiReduceParameters: {
            domainName: domain.name,
            domainDescription: domain.description,
            domainPath: domain.path,
            projectName: graph.project.name,
        },
    });

    const domainReduceExecutor = createExecutor({
        aiInvoker,
        maxConcurrency: 1,
        reduceMode: 'deterministic',
        showProgress: false,
        retryOnFailure: false,
        timeoutMs,
        jobName: `Domain Reduce: ${domain.name}`,
        isCancelled,
    });

    const fallbackSummary = {
        domainId: domain.id,
        name: domain.name,
        description: domain.description,
        summary: domain.description,
        moduleCount: domainAnalyses.length,
    };

    try {
        const domainResult = await domainReduceExecutor.execute(domainReduceJob, domainReduceInput);
        const domainOutput = domainResult.output as PromptMapOutput | undefined;
        const formattedOutput = domainOutput?.formattedOutput;

        if (formattedOutput) {
            const parsed = JSON.parse(formattedOutput) as Record<string, string>;
            const articles: GeneratedArticle[] = [];

            let domainSummary = fallbackSummary;
            if (parsed.index) {
                articles.push({
                    type: 'domain-index',
                    slug: 'index',
                    title: `${domain.name} — Overview`,
                    content: parsed.index,
                    domainId: domain.id,
                });
                domainSummary = {
                    domainId: domain.id,
                    name: domain.name,
                    description: domain.description,
                    summary: parsed.index.substring(0, 1000),
                    moduleCount: domainAnalyses.length,
                };
            }

            if (parsed.architecture) {
                articles.push({
                    type: 'domain-architecture',
                    slug: 'architecture',
                    title: `${domain.name} — Architecture`,
                    content: parsed.architecture,
                    domainId: domain.id,
                });
            }

            return { articles, domainSummary };
        } else {
            return {
                articles: generateStaticDomainPages(domain, domainAnalyses, graph),
                domainSummary: fallbackSummary,
            };
        }
    } catch {
        return {
            articles: generateStaticDomainPages(domain, domainAnalyses, graph),
            domainSummary: fallbackSummary,
        };
    }
}

/**
 * Run project-level reduce across all domain summaries.
 * Generates top-level index, architecture, and getting-started articles.
 * Falls back to static pages on failure.
 */
async function runProjectReducePhase(
    domainSummaries: Array<{ domainId: string; name: string; description: string; summary: string; moduleCount: number }>,
    domains: DomainInfo[],
    graph: ModuleGraph,
    options: ArticleExecutorOptions
): Promise<GeneratedArticle[]> {
    const { aiInvoker, timeoutMs, model, isCancelled } = options;

    const projectReduceItems = domainSummaries.map(s => ({
        domainId: s.domainId,
        domainName: s.name,
        summary: JSON.stringify(s),
    }));

    const projectReduceInput = createPromptMapInput(
        projectReduceItems,
        '{{summary}}',
        []
    );

    const projectReduceJob = createPromptMapJob({
        aiInvoker,
        outputFormat: 'ai',
        model,
        maxConcurrency: 1,
        aiReducePrompt: buildHierarchicalReducePromptTemplate(),
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
            const articles: GeneratedArticle[] = [];

            if (parsed.index) {
                articles.push({
                    type: 'index',
                    slug: 'index',
                    title: `${graph.project.name} Wiki`,
                    content: parsed.index,
                });
            }

            if (parsed.architecture) {
                articles.push({
                    type: 'architecture',
                    slug: 'architecture',
                    title: 'Architecture Overview',
                    content: parsed.architecture,
                });
            }

            if (parsed.gettingStarted) {
                articles.push({
                    type: 'getting-started',
                    slug: 'getting-started',
                    title: 'Getting Started',
                    content: parsed.gettingStarted,
                });
            }

            return articles;
        } else {
            return generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);
        }
    } catch {
        return generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);
    }
}

/**
 * Hierarchical article executor for large repos with domains.
 * Orchestrates a 3-step pipeline:
 *   1. Map: Generate per-module articles (grouped by domain)
 *   2. Per-domain reduce: Generate domain index + domain architecture
 *   3. Project-level reduce: Generate project index + architecture + getting-started
 */
async function runHierarchicalArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const startTime = Date.now();
    const { graph, analyses } = options;

    if (analyses.length === 0) {
        return { articles: [], failedModuleIds: [], duration: 0 };
    }

    const domains = graph.domains!;

    // Step 1: Group analyses by domain
    const { moduleDomainMap, analysesByDomain } = groupAnalysesByDomain(analyses, domains);

    // Step 2: Generate per-module articles
    const mapResult = await runModuleMapPhase(options, analyses, graph, moduleDomainMap);

    // Step 3: Per-domain reduce
    const domainSummaries: Array<{ domainId: string; name: string; description: string; summary: string; moduleCount: number }> = [];
    for (const domain of domains) {
        const domainAnalyses = analysesByDomain.get(domain.id) || [];
        if (domainAnalyses.length === 0) { continue; }

        const result = await runDomainReducePhase(domain, domainAnalyses, graph, options);
        mapResult.articles.push(...result.articles);
        domainSummaries.push(result.domainSummary);
    }

    // Step 4: Project-level reduce
    const projectArticles = await runProjectReducePhase(domainSummaries, domains, graph, options);
    mapResult.articles.push(...projectArticles);

    return {
        articles: mapResult.articles,
        failedModuleIds: [...mapResult.failedIds],
        duration: Date.now() - startTime,
    };
}

// ============================================================================
// Static Fallback
// ============================================================================

/**
 * Generate static domain-level pages when domain AI reduce fails.
 */
export function generateStaticDomainPages(
    domain: DomainInfo,
    analyses: ModuleAnalysis[],
    graph: ModuleGraph
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Area index
    const indexLines: string[] = [
        `# ${domain.name}`,
        '',
        domain.description || '',
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
        type: 'domain-index',
        slug: 'index',
        title: `${domain.name} — Overview`,
        content: indexLines.join('\n'),
        domainId: domain.id,
    });

    // Area architecture placeholder
    articles.push({
        type: 'domain-architecture',
        slug: 'architecture',
        title: `${domain.name} — Architecture`,
        content: [
            `# ${domain.name} — Architecture`,
            '',
            domain.description || 'No architecture description available.',
        ].join('\n'),
        domainId: domain.id,
    });

    return articles;
}

/**
 * Generate static project-level index pages for hierarchical layout.
 */
export function generateStaticHierarchicalIndexPages(
    graph: ModuleGraph,
    domains: DomainInfo[],
    domainSummaries: Array<{ domainId: string; name: string; description: string; moduleCount: number }>
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Project index
    const indexLines: string[] = [
        `# ${graph.project.name}`,
        '',
        graph.project.description || '',
        '',
        '## Domains',
        '',
    ];

    for (const summary of domainSummaries) {
        indexLines.push(`- [${summary.name}](./domains/${summary.domainId}/index.md) — ${summary.description} (${summary.moduleCount} modules)`);
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

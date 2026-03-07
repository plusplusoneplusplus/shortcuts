/**
 * Article Executor
 *
 * Orchestrates Phase 4 (Article Generation) using direct AI invocation
 * with concurrency-limited map and AI-powered reduce phases:
 * 1. Map: Generate per-component markdown articles (text mode, no structured output)
 * 2. Reduce: AI generates index, architecture, and getting-started pages
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    ConcurrencyLimiter,
    substituteVariables,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    AIInvoker,
    PromptItem,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    ComponentGraph,
    ComponentAnalysis,
    GeneratedArticle,
} from '../types';
import { buildComponentArticlePromptTemplate, buildSimplifiedGraph } from './prompts';
import {
    buildReducePromptTemplate,
    getReduceOutputFields,
    buildComponentSummaryForReduce,
    buildDomainReducePromptTemplate,
    getDomainReduceOutputFields,
    buildHierarchicalReducePromptTemplate,
} from './reduce-prompts';
import { normalizeComponentId } from '../schemas';
import type { DomainInfo } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Progress information for article generation. */
export interface ArticleProgress {
    phase: 'mapping' | 'reducing';
    completedItems: number;
    totalItems: number;
    percentage: number;
}

/** Result of a single mapped item. */
interface MapItemResult {
    item: PromptItem;
    success: boolean;
    text?: string;
    error?: string;
}

/** Callback invoked after each individual item completes during the map phase. */
export type ArticleItemCompleteCallback = (item: PromptItem, result: MapItemResult) => void;

/**
 * Options for the article executor.
 */
export interface ArticleExecutorOptions {
    /** AI invoker for writing (session pool, no tools) */
    aiInvoker: AIInvoker;
    /** Component graph from Phase 1 (Discovery) */
    graph: ComponentGraph;
    /** Per-component analyses from Phase 3 (Analysis) */
    analyses: ComponentAnalysis[];
    /** Article depth */
    depth: 'shallow' | 'normal' | 'deep';
    /** Maximum concurrent AI sessions (default: 10) */
    concurrency?: number;
    /** Timeout per article in milliseconds */
    timeoutMs?: number;
    /** AI model to use */
    model?: string;
    /** Progress callback */
    onProgress?: (progress: ArticleProgress) => void;
    /** Cancellation check */
    isCancelled?: () => boolean;
    /**
     * Optional callback invoked after each individual article completes.
     * Useful for incremental per-article cache writes during long-running generation.
     */
    onItemComplete?: ArticleItemCompleteCallback;
}

/**
 * Result of the article executor.
 */
export interface ArticleExecutorResult {
    /** Generated articles (component + index pages) */
    articles: GeneratedArticle[];
    /** Component IDs that failed article generation */
    failedComponentIds: string[];
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
    analysis: ComponentAnalysis,
    graph: ComponentGraph
): PromptItem {
    const componentInfo = graph.components.find(m => m.id === analysis.componentId);
    const componentName = componentInfo?.name || analysis.componentId;

    return {
        componentId:  analysis.componentId,
        componentName,
        analysis: JSON.stringify(analysis, null, 2),
        componentGraph: buildSimplifiedGraph(graph),
    };
}

// ============================================================================
// Map & Reduce Helpers
// ============================================================================

/**
 * Run a prompt-map phase: substitute template variables per item, invoke AI concurrently.
 * Returns per-item results with the original item, success flag, and text.
 */
async function runPromptMap(
    items: PromptItem[],
    promptTemplate: string,
    aiInvoker: AIInvoker,
    options: {
        concurrency: number;
        model?: string;
        timeoutMs?: number;
        onProgress?: (progress: ArticleProgress) => void;
        onItemComplete?: ArticleItemCompleteCallback;
        isCancelled?: () => boolean;
    }
): Promise<MapItemResult[]> {
    const limiter = new ConcurrencyLimiter(options.concurrency);
    const results: MapItemResult[] = new Array(items.length);
    let completed = 0;

    const tasks = items.map((item, index) => limiter.run(async () => {
        if (options.isCancelled?.()) {
            results[index] = { item, success: false, error: 'Cancelled' };
            return;
        }

        try {
            const prompt = substituteVariables(promptTemplate, item, {
                strict: false,
                missingValueBehavior: 'preserve',
            });
            const aiResult = await aiInvoker(prompt, { model: options.model });
            const mapResult: MapItemResult = {
                item,
                success: aiResult.success,
                text: aiResult.response,
                error: aiResult.success ? undefined : (aiResult.error || 'AI invocation failed'),
            };
            results[index] = mapResult;
            options.onItemComplete?.(item, mapResult);
        } catch (err) {
            results[index] = { item, success: false, error: String(err) };
        }

        completed++;
        options.onProgress?.({
            phase: 'mapping',
            completedItems: completed,
            totalItems: items.length,
            percentage: Math.round((completed / items.length) * 100),
        });
    }));

    await Promise.all(tasks);
    return results;
}

/**
 * Run an AI-powered reduce phase: combine item summaries and ask AI to generate structured output.
 * Returns the parsed JSON fields from the AI response, or undefined on failure.
 */
async function runAIReduce(
    itemSummaries: string[],
    reducePromptTemplate: string,
    outputFields: string[],
    parameters: Record<string, string>,
    aiInvoker: AIInvoker,
    options: { model?: string; timeoutMs?: number }
): Promise<Record<string, string> | undefined> {
    const resultsBlock = itemSummaries.map((s, i) => `--- Item ${i + 1} ---\n${s}`).join('\n\n');
    const allVars: Record<string, string> = {
        ...parameters,
        RESULTS: resultsBlock,
        COUNT: String(itemSummaries.length),
    };

    const prompt = substituteVariables(reducePromptTemplate, allVars, {
        strict: false,
        missingValueBehavior: 'preserve',
    });

    const result = await aiInvoker(prompt, { model: options.model });
    if (!result.success || !result.response) { return undefined; }

    // Try to parse structured output from AI response
    try {
        // Extract JSON from the response (may be wrapped in markdown code fences)
        const jsonMatch = result.response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result.response];
        const parsed = JSON.parse(jsonMatch[1]!.trim());
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, string>;
        }
    } catch {
        // Try direct parse of the entire response
        try {
            const parsed = JSON.parse(result.response);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed as Record<string, string>;
            }
        } catch {
            // AI didn't return valid JSON
        }
    }

    return undefined;
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
        return { articles: [], failedComponentIds: [], duration: 0 };
    }

    // Convert analyses to PromptItems
    const items: PromptItem[] = analyses.map(a => analysisToPromptItem(a, graph));

    // Build the article prompt template (text mode — no output fields)
    const promptTemplate = buildComponentArticlePromptTemplate(depth);

    // Run map phase
    const mapResults = await runPromptMap(items, promptTemplate, aiInvoker, {
        concurrency,
        model,
        timeoutMs,
        onProgress,
        onItemComplete,
        isCancelled,
    });

    // Collect component articles from map results
    const articles: GeneratedArticle[] = [];
    const failedComponentIds: string[] = [];

    for (const mapResult of mapResults) {
        const componentId = mapResult.item.componentId;
        const componentInfo = graph.components.find(m => m.id === componentId);
        const componentName = componentInfo?.name || componentId;

        if (mapResult.success && mapResult.text) {
            articles.push({
                type: 'component',
                slug: normalizeComponentId(componentId),
                title: componentName,
                content: mapResult.text,
                componentId: componentId,
            });
        } else {
            failedComponentIds.push(componentId);
        }
    }

    // Separate reduce phase: use compact component summaries (not full articles)
    // to stay within model token limits
    const componentSummaries = analyses.map(a => {
        const mod = graph.components.find(m => m.id === a.componentId);
        return buildComponentSummaryForReduce(
            a.componentId,
            mod?.name || a.componentId,
            mod?.category || 'uncategorized',
            a.overview
        );
    });

    onProgress?.({
        phase: 'reducing',
        completedItems: 0,
        totalItems: 1,
        percentage: 0,
    });

    try {
        const parsed = await runAIReduce(
            componentSummaries,
            buildReducePromptTemplate(),
            getReduceOutputFields(),
            {
                projectName: graph.project.name,
                projectDescription: graph.project.description || 'No description available',
                buildSystem: graph.project.buildSystem || 'Unknown',
                language: graph.project.language || 'Unknown',
            },
            aiInvoker,
            { model, timeoutMs }
        );

        if (parsed) {
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
        failedComponentIds,
        duration: Date.now() - startTime,
    };
}

// ============================================================================
// Hierarchical Article Executor (Large Repos with Areas)
// ============================================================================

/** Result of grouping analyses by domain. */
export interface DomainGrouping {
    componentDomainMap: Map<string, string>;
    analysesByDomain: Map<string, ComponentAnalysis[]>;
    unassignedAnalyses: ComponentAnalysis[];
}

/** Result of the component map phase. */
interface ComponentMapResult {
    articles: GeneratedArticle[];
    failedIds: Set<string>;
}

/** Result of a single domain reduce phase. */
interface DomainReduceResult {
    articles: GeneratedArticle[];
    domainSummary: { domainId: string; name: string; description: string; summary: string; componentCount: number };
}

/**
 * Group analyses by their domain assignment.
 * Builds component→domain mapping and buckets analyses accordingly.
 */
export function groupAnalysesByDomain(
    analyses: ComponentAnalysis[],
    domains: DomainInfo[]
): DomainGrouping {
    const componentDomainMap = new Map<string, string>();
    for (const domain of domains) {
        for (const compId of domain.components) {
            componentDomainMap.set(compId, domain.id);
        }
    }

    const analysesByDomain = new Map<string, ComponentAnalysis[]>();
    const unassignedAnalyses: ComponentAnalysis[] = [];
    for (const analysis of analyses) {
        const domainId = componentDomainMap.get(analysis.componentId);
        if (domainId) {
            if (!analysesByDomain.has(domainId)) {
                analysesByDomain.set(domainId, []);
            }
            analysesByDomain.get(domainId)!.push(analysis);
        } else {
            unassignedAnalyses.push(analysis);
        }
    }

    return { componentDomainMap, analysesByDomain, unassignedAnalyses };
}

/**
 * Run the unified map phase across all components, tagging results with their domain.
 */
async function runComponentMapPhase(
    options: ArticleExecutorOptions,
    analyses: ComponentAnalysis[],
    graph: ComponentGraph,
    componentDomainMap: Map<string, string>
): Promise<ComponentMapResult> {
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
    const promptTemplate = buildComponentArticlePromptTemplate(depth);

    const mapResults = await runPromptMap(allItems, promptTemplate, aiInvoker, {
        concurrency,
        model,
        timeoutMs,
        onProgress,
        onItemComplete,
        isCancelled,
    });

    const articles: GeneratedArticle[] = [];
    const failedIds = new Set<string>();

    for (const result of mapResults) {
        const componentId = result.item.componentId;
        const componentInfo = graph.components.find(m => m.id === componentId);
        const componentName = componentInfo?.name || componentId;
        const domainId = componentDomainMap.get(componentId);

        if (result.success && result.text) {
            articles.push({
                type: 'component',
                slug: normalizeComponentId(componentId),
                title: componentName,
                content: result.text,
                componentId: componentId,
                domainId,
            });
        } else {
            failedIds.add(componentId);
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
    domainAnalyses: ComponentAnalysis[],
    graph: ComponentGraph,
    options: ArticleExecutorOptions
): Promise<DomainReduceResult> {
    const { aiInvoker, timeoutMs, model } = options;

    const domainComponentSummaries = domainAnalyses.map(a => {
        const mod = graph.components.find(m => m.id === a.componentId);
        return buildComponentSummaryForReduce(
            a.componentId,
            mod?.name || a.componentId,
            mod?.category || 'uncategorized',
            a.overview
        );
    });

    const fallbackSummary = {
        domainId: domain.id,
        name: domain.name,
        description: domain.description,
        summary: domain.description,
        componentCount: domainAnalyses.length,
    };

    try {
        const parsed = await runAIReduce(
            domainComponentSummaries,
            buildDomainReducePromptTemplate(),
            getDomainReduceOutputFields(),
            {
                domainName: domain.name,
                domainDescription: domain.description,
                domainPath: domain.path,
                projectName: graph.project.name,
            },
            aiInvoker,
            { model, timeoutMs }
        );

        if (parsed) {
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
                    componentCount: domainAnalyses.length,
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
    domainSummaries: Array<{ domainId: string; name: string; description: string; summary: string; componentCount: number }>,
    domains: DomainInfo[],
    graph: ComponentGraph,
    options: ArticleExecutorOptions
): Promise<GeneratedArticle[]> {
    const { aiInvoker, timeoutMs, model } = options;

    const projectSummaryStrings = domainSummaries.map(s => JSON.stringify(s));

    try {
        const parsed = await runAIReduce(
            projectSummaryStrings,
            buildHierarchicalReducePromptTemplate(),
            getReduceOutputFields(),
            {
                projectName: graph.project.name,
                projectDescription: graph.project.description || 'No description available',
                buildSystem: graph.project.buildSystem || 'Unknown',
                language: graph.project.language || 'Unknown',
            },
            aiInvoker,
            { model, timeoutMs }
        );

        if (parsed) {
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
 *   1. Map: Generate per-component articles (grouped by domain)
 *   2. Per-domain reduce: Generate domain index + domain architecture
 *   3. Project-level reduce: Generate project index + architecture + getting-started
 */
async function runHierarchicalArticleExecutor(
    options: ArticleExecutorOptions
): Promise<ArticleExecutorResult> {
    const startTime = Date.now();
    const { graph, analyses } = options;

    if (analyses.length === 0) {
        return { articles: [], failedComponentIds: [], duration: 0 };
    }

    const domains = graph.domains!;

    // Step 1: Group analyses by domain
    const { componentDomainMap, analysesByDomain } = groupAnalysesByDomain(analyses, domains);

    // Step 2: Generate per-component articles
    const mapResult = await runComponentMapPhase(options, analyses, graph, componentDomainMap);

    // Step 3: Per-domain reduce
    const domainSummaries: Array<{ domainId: string; name: string; description: string; summary: string; componentCount: number }> = [];
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
        failedComponentIds: [...mapResult.failedIds],
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
    analyses: ComponentAnalysis[],
    graph: ComponentGraph
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Area index
    const indexLines: string[] = [
        `# ${domain.name}`,
        '',
        domain.description || '',
        '',
        '## Components',
        '',
    ];

    for (const a of analyses) {
        const mod = graph.components.find(m => m.id === a.componentId);
        const name = mod?.name || a.componentId;
        const slug = normalizeComponentId(a.componentId);
        indexLines.push(`- [${name}](./components/${slug}.md) — ${a.overview.substring(0, 100)}`);
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
    graph: ComponentGraph,
    domains: DomainInfo[],
    domainSummaries: Array<{ domainId: string; name: string; description: string; componentCount: number }>
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
        indexLines.push(`- [${summary.name}](./domains/${summary.domainId}/index.md) — ${summary.description} (${summary.componentCount} components)`);
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
    graph: ComponentGraph,
    analyses: ComponentAnalysis[]
): GeneratedArticle[] {
    const articles: GeneratedArticle[] = [];

    // Static index
    const indexLines: string[] = [
        `# ${graph.project.name}`,
        '',
        graph.project.description || '',
        '',
        '## Components',
        '',
    ];

    // Group by category
    const byCategory = new Map<string, ComponentAnalysis[]>();
    for (const a of analyses) {
        const mod = graph.components.find(m => m.id === a.componentId);
        const category = mod?.category || 'uncategorized';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(a);
    }

    for (const [category, mods] of byCategory) {
        indexLines.push(`### ${category}`, '');
        for (const a of mods) {
            const mod = graph.components.find(m => m.id === a.componentId);
            const name = mod?.name || a.componentId;
            const slug = normalizeComponentId(a.componentId);
            indexLines.push(`- [${name}](./components/${slug}.md) — ${a.overview.substring(0, 100)}`);
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

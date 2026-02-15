/**
 * Phase 3: Deep Analysis
 *
 * Performs AI-powered analysis of each component, with incremental caching support.
 */

import type { GenerateCommandOptions, ComponentGraph, ComponentAnalysis } from '../../types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { resolvePhaseModel, resolvePhaseTimeout, resolvePhaseConcurrency, resolvePhaseDepth } from '../../config-loader';
import { analyzeComponents, parseAnalysisResponse } from '../../analysis';
import { createAnalysisInvoker } from '../../ai-invoker';
import { UsageTracker } from '../../usage-tracker';
import {
    getCachedAnalyses,
    saveAllAnalyses,
    getComponentsNeedingReanalysis,
    getCachedAnalysis,
    saveAnalysis,
    getFolderHeadHash,
    scanIndividualAnalysesCache,
    scanIndividualAnalysesCacheAny,
} from '../../cache';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
} from '../../logger';
import { getErrorMessage } from '../../utils/error-utils';
import { EXIT_CODES } from '../../cli';

// ============================================================================
// Types
// ============================================================================

export interface Phase3AnalysisResult {
    analyses?: ComponentAnalysis[];
    duration: number;
    exitCode?: number;
    /** Component IDs that were re-analyzed (not loaded from cache) in this run.
     *  Empty array means all components were cached; undefined means unknown. */
    reanalyzedComponentIds?: string[];
}

// ============================================================================
// Phase 3: Deep Analysis
// ============================================================================

export async function runPhase3Analysis(
    repoPath: string,
    graph: ComponentGraph,
    options: GenerateCommandOptions,
    isCancelled: () => boolean,
    usageTracker?: UsageTracker
): Promise<Phase3AnalysisResult> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 3: Deep Analysis');

    // Resolve per-phase settings for analysis
    const analysisModel = resolvePhaseModel(options, 'analysis');
    const analysisTimeout = resolvePhaseTimeout(options, 'analysis');
    const analysisConcurrency = resolvePhaseConcurrency(options, 'analysis') || 5;
    const analysisDepth = resolvePhaseDepth(options, 'analysis');
    const concurrency = analysisConcurrency;

    // Determine which components need analysis
    let componentsToAnalyze = graph.components;
    let cachedAnalyses: ComponentAnalysis[] = [];

    if (!options.force) {
        if (options.useCache) {
            // --use-cache: load all cached analyses regardless of git hash
            const allComponentIds = graph.components.map(m => m.id);
            const { found, missing } = scanIndividualAnalysesCacheAny(
                allComponentIds, options.output
            );

            if (found.length > 0) {
                cachedAnalyses = found;
                componentsToAnalyze = graph.components.filter(
                    m => missing.includes(m.id)
                );

                if (missing.length === 0) {
                    printSuccess(`All ${found.length} component analyses loaded from cache`);
                } else {
                    printInfo(`Loaded ${found.length} cached analyses, ${missing.length} remaining`);
                }
            }
        } else {
        // Try incremental rebuild
        const needingReanalysis = await getComponentsNeedingReanalysis(
            graph, options.output, repoPath
        );

        if (needingReanalysis !== null) {
            if (needingReanalysis.length === 0) {
                // All components are up-to-date
                const allCached = getCachedAnalyses(options.output);
                if (allCached && allCached.length > 0) {
                    printSuccess(`All ${allCached.length} component analyses are up-to-date (cached)`);
                    usageTracker?.markCached('analysis');
                    return { analyses: allCached, duration: Date.now() - startTime, reanalyzedComponentIds: [] };
                }
            } else {
                // Partial rebuild
                printInfo(`${needingReanalysis.length} components changed, ${graph.components.length - needingReanalysis.length} cached`);

                // Load cached analyses for unchanged components
                for (const comp of graph.components) {
                    if (!needingReanalysis.includes(comp.id)) {
                        const cached = getCachedAnalysis(comp.id, options.output);
                        if (cached) {
                            cachedAnalyses.push(cached);
                        } else {
                            // Cache miss for this component — add to re-analyze list
                            needingReanalysis.push(comp.id);
                        }
                    }
                }

                // Only analyze changed components
                componentsToAnalyze = graph.components.filter(
                    m => needingReanalysis.includes(m.id)
                );
            }
        } else {
            // No metadata (full rebuild indicated) — but check for partial cache
            // from a previous interrupted run that saved components incrementally.
            const currentHash = await getFolderHeadHash(repoPath);
            if (currentHash) {
                const allComponentIds = graph.components.map(m => m.id);
                const { found, missing } = scanIndividualAnalysesCache(
                    allComponentIds, options.output, currentHash
                );

                if (found.length > 0) {
                    printInfo(`Recovered ${found.length} component analyses from partial cache, ${missing.length} remaining`);
                    cachedAnalyses = found;
                    componentsToAnalyze = graph.components.filter(
                        m => missing.includes(m.id)
                    );
                }
            }
        }
        }
    }

    if (componentsToAnalyze.length === 0 && cachedAnalyses.length > 0) {
        printSuccess(`All analyses loaded from cache (${cachedAnalyses.length} components)`);
        usageTracker?.markCached('analysis');
        return { analyses: cachedAnalyses, duration: Date.now() - startTime, reanalyzedComponentIds: [] };
    }

    // Create analysis invoker (MCP-enabled, direct sessions)
    const baseAnalysisInvoker = createAnalysisInvoker({
        repoPath,
        model: analysisModel,
        timeoutMs: analysisTimeout ? analysisTimeout * 1000 : undefined,
    });

    // Wrap invoker to capture token usage
    const analysisInvoker: AIInvoker = async (prompt, opts) => {
        const result = await baseAnalysisInvoker(prompt, opts);
        usageTracker?.addUsage('analysis', result.tokenUsage);
        return result;
    };

    // Get git hash once upfront for per-component incremental saves (subfolder-scoped)
    let gitHash: string | null = null;
    try {
        gitHash = await getFolderHeadHash(repoPath);
    } catch {
        // Non-fatal: incremental saves won't work but analysis continues
    }

    const spinner = new Spinner();
    spinner.start(`Analyzing ${componentsToAnalyze.length} components (${concurrency} parallel)...`);

    try {
        // Build a sub-graph with only the components to analyze
        const subGraph = {
            ...graph,
            components: componentsToAnalyze,
        };

        const result = await analyzeComponents(
            {
                graph: subGraph,
                model: analysisModel,
                timeout: analysisTimeout ? analysisTimeout * 1000 : undefined,
                concurrency,
                depth: analysisDepth,
                repoPath,
            },
            analysisInvoker,
            (progress) => {
                if (progress.phase === 'mapping') {
                    spinner.update(
                        `Analyzing components: ${progress.completedItems}/${progress.totalItems} ` +
                        `(${progress.failedItems} failed)`
                    );
                }
            },
            isCancelled,
            // Per-component incremental save callback
            (item, mapResult) => {
                if (!gitHash || !mapResult.success || !mapResult.output) {
                    return;
                }
                try {
                    // Extract componentId and rawResponse from the PromptMapResult
                    const output = mapResult.output as { item?: { componentId?: string }; rawResponse?: string };
                    const componentId = output?.item?.componentId;
                    const rawResponse = output?.rawResponse;
                    if (componentId && rawResponse) {
                        const analysis = parseAnalysisResponse(rawResponse, componentId);
                        saveAnalysis(componentId, analysis, options.output, gitHash);
                    }
                } catch {
                    // Non-fatal: per-component save failed, bulk save at end will catch it
                }
            },
        );

        // Merge fresh + cached
        const allAnalyses = [...cachedAnalyses, ...result.analyses];

        if (result.analyses.length === 0 && componentsToAnalyze.length > 0) {
            spinner.fail('All component analyses failed');
            printError('No components could be analyzed. Check your AI SDK setup or try reducing scope with --focus.');
            return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
        }

        const failedCount = componentsToAnalyze.length - result.analyses.length;
        if (failedCount > 0) {
            spinner.warn(`Analysis complete — ${result.analyses.length} succeeded, ${failedCount} failed`);

            // Strict mode: fail the phase if any component failed after retries
            if (options.strict !== false) {
                // Determine which components failed
                const succeededIds = new Set(result.analyses.map(a => a.componentId));
                const failedComponentIds = componentsToAnalyze
                    .filter(m => !succeededIds.has(m.id))
                    .map(m => m.id);
                printError(
                    `Strict mode: ${failedCount} component(s) failed analysis: ${failedComponentIds.join(', ')}. ` +
                    `Use --no-strict to continue with partial results.`
                );
                return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
            }
        } else {
            spinner.succeed(`Analysis complete — ${result.analyses.length} components analyzed`);
        }

        // Save to cache (writes metadata + any components not yet saved incrementally)
        try {
            await saveAllAnalyses(allAnalyses, options.output, repoPath);
        } catch {
            if (options.verbose) {
                printWarning('Failed to cache analyses (non-fatal)');
            }
        }

        return {
            analyses: allAnalyses,
            duration: Date.now() - startTime,
            reanalyzedComponentIds: componentsToAnalyze.map(m => m.id),
        };
    } catch (error) {
        spinner.fail('Analysis failed');
        printError(getErrorMessage(error));
        return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
    }
}

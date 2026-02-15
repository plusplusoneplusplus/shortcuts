/**
 * Phase 4: Article Generation (Writing)
 *
 * Generates wiki articles from module analyses, with incremental caching and reduce-phase support.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ComponentGraph, ComponentAnalysis, GeneratedArticle } from '../../types';
import { extractJSON, type AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { resolvePhaseModel, resolvePhaseTimeout, resolvePhaseConcurrency, resolvePhaseDepth } from '../../config-loader';
import {
    generateArticles,
    writeWikiOutput,
    buildReducePromptTemplate,
    generateStaticIndexPages,
} from '../../writing';
import { createWritingInvoker } from '../../ai-invoker';
import { normalizeComponentId } from '../../schemas';
import { UsageTracker } from '../../usage-tracker';
import {
    saveArticle,
    saveAllArticles,
    scanIndividualArticlesCache,
    scanIndividualArticlesCacheAny,
    getCachedReduceArticles,
    saveReduceArticles,
    getFolderHeadHash,
    restampArticles,
} from '../../cache';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    bold,
    gray,
} from '../../logger';
import { EXIT_CODES } from '../../cli';
import { getErrorMessage } from '../../utils/error-utils';
import { initWikiGitRepo } from '../../utils/git-init';

// ============================================================================
// Types
// ============================================================================

export interface Phase4WritingResult {
    articlesWritten: number;
    duration: number;
    exitCode?: number;
}

// ============================================================================
// Phase 4: Article Generation
// ============================================================================

export async function runPhase4Writing(
    repoPath: string,
    graph: ComponentGraph,
    analyses: ComponentAnalysis[],
    options: GenerateCommandOptions,
    isCancelled: () => boolean,
    usageTracker?: UsageTracker,
    reanalyzedModuleIds?: string[]
): Promise<Phase4WritingResult> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 4: Article Generation');

    // Resolve per-phase settings for writing
    const writingModel = resolvePhaseModel(options, 'writing');
    const writingTimeout = resolvePhaseTimeout(options, 'writing');
    const writingConcurrency = resolvePhaseConcurrency(options, 'writing');
    const writingDepth = resolvePhaseDepth(options, 'writing');
    const concurrency = writingConcurrency ? Math.min(writingConcurrency * 2, 20) : 5;

    // Get git hash once upfront for per-article incremental saves (subfolder-scoped)
    let gitHash: string | null = null;
    try {
        gitHash = await getFolderHeadHash(repoPath);
    } catch {
        // Non-fatal: incremental saves won't work but generation continues
    }

    // Determine which modules need article generation
    let analysesToGenerate = analyses;
    let cachedArticles: GeneratedArticle[] = [];

    if (!options.force) {
        const componentIds = analyses
            .map(a => a.componentId)
            .filter(id => !!id);

        // Re-stamp unchanged module articles with the new git hash BEFORE scanning.
        // This is the key to Phase 4 incremental invalidation: modules that were NOT
        // re-analyzed in Phase 3 get their cached articles re-stamped so they pass
        // the git hash validation in scanIndividualArticlesCache().
        //
        // Skip re-stamping when:
        // - No git hash available
        // - reanalyzedModuleIds is undefined (Phase 3 was skipped)
        // - reanalyzedModuleIds is empty (nothing changed, articles already valid)
        // - --use-cache mode (articles are loaded regardless of hash)
        if (gitHash && reanalyzedModuleIds !== undefined && reanalyzedModuleIds.length > 0 && !options.useCache) {
            const unchangedModuleIds = componentIds.filter(
                id => !reanalyzedModuleIds.includes(id)
            );
            if (unchangedModuleIds.length > 0) {
                const restamped = restampArticles(unchangedModuleIds, options.output, gitHash);
                if (restamped > 0 && options.verbose) {
                    printInfo(`Re-stamped ${restamped} unchanged module articles with current git hash`);
                }
            }
        }

        // Scan for individually cached articles (handles crash recovery too)
        const { found, missing } = options.useCache
            ? scanIndividualArticlesCacheAny(componentIds, options.output)
            : gitHash
                ? scanIndividualArticlesCache(componentIds, options.output, gitHash)
                : { found: [] as GeneratedArticle[], missing: [...componentIds] };

        if (found.length > 0) {
            cachedArticles = found;

            if (missing.length === 0) {
                // All module articles are cached — skip map phase
                printSuccess(`All ${found.length} module articles loaded from cache`);
            } else {
                printInfo(`Recovered ${found.length} cached articles, ${missing.length} remaining`);
            }

            // Only generate articles for modules NOT in cache
            analysesToGenerate = analyses.filter(
                a => missing.includes(a.componentId)
            );
        }
    }

    // Create writing invoker (session pool, no tools)
    const baseWritingInvoker = createWritingInvoker({
        repoPath,
        model: writingModel,
        timeoutMs: writingTimeout ? writingTimeout * 1000 : undefined,
    });

    // Wrap invoker to capture token usage
    const writingInvoker: AIInvoker = async (prompt, opts) => {
        const result = await baseWritingInvoker(prompt, opts);
        usageTracker?.addUsage('writing', result.tokenUsage);
        return result;
    };

    const spinner = new Spinner();

    try {
        let freshArticles: GeneratedArticle[] = [];

        if (analysesToGenerate.length > 0) {
            // Generate articles for modules that are not cached
            spinner.start(`Generating articles for ${analysesToGenerate.length} modules...`);

            const wikiOutput = await generateArticles(
                {
                    graph,
                    analyses: analysesToGenerate,
                    model: writingModel,
                    concurrency,
                    timeout: writingTimeout ? writingTimeout * 1000 : undefined,
                    depth: writingDepth,
                },
                writingInvoker,
                (progress) => {
                    if (progress.phase === 'mapping') {
                        spinner.update(
                            `Generating articles: ${progress.completedItems}/${progress.totalItems}`
                        );
                    } else if (progress.phase === 'reducing') {
                        spinner.update('Generating index and overview pages...');
                    }
                },
                isCancelled,
                // Per-article incremental save callback
                (item, mapResult) => {
                    if (!gitHash || !mapResult.success) {
                        return;
                    }
                    try {
                        const output = mapResult.output as { item?: { componentId?: string }; rawText?: string; rawResponse?: string };
                        const componentId = output?.item?.componentId;
                        const content = output?.rawText || output?.rawResponse;
                        if (componentId && content) {
                            const moduleInfo = graph.components.find(m => m.id === componentId);
                            const article: GeneratedArticle = {
                                type: 'component',
                                slug: normalizeComponentId(componentId),
                                title: moduleInfo?.name || componentId,
                                content,
                                componentId,
                                domainId: moduleInfo?.domain,
                            };
                            saveArticle(componentId, article, options.output, gitHash);
                        }
                    } catch {
                        // Non-fatal: per-article save failed, bulk save at end will catch it
                    }
                },
            );

            // Separate module articles from reduce-generated articles
            freshArticles = wikiOutput.articles;

            // Check for failed articles
            const failedArticleModuleIds = wikiOutput.failedComponentIds || [];
            if (failedArticleModuleIds.length > 0) {
                spinner.warn(
                    `Article generation: ${freshArticles.length} succeeded, ${failedArticleModuleIds.length} failed`
                );

                // Strict mode: fail the phase if any article failed
                if (options.strict !== false) {
                    printError(
                        `Strict mode: ${failedArticleModuleIds.length} module(s) failed article generation: ` +
                        `${failedArticleModuleIds.join(', ')}. Use --no-strict to continue with partial results.`
                    );
                    return {
                        articlesWritten: 0,
                        duration: Date.now() - startTime,
                        exitCode: EXIT_CODES.EXECUTION_ERROR,
                    };
                }
            } else {
                spinner.succeed(`Generated ${freshArticles.length} articles`);
            }
        }

        // Merge cached + fresh module articles
        // Module-type articles are the per-module ones; all others are reduce/domain artifacts
        const moduleTypes = new Set(['component']);
        const freshModuleArticles = freshArticles.filter(a => moduleTypes.has(a.type));
        const reduceArticles = freshArticles.filter(a => !moduleTypes.has(a.type));
        const allModuleArticles = [...cachedArticles, ...freshModuleArticles];

        // If we had cached articles but skipped generation, we still need the reduce phase
        // (index/architecture/getting-started) which depends on ALL module articles.
        // Try to load reduce articles from cache first — skip reduce phase if cached.
        //
        // Reduce skip criteria:
        // - Skip reduce ONLY when NO modules were re-analyzed (truly nothing changed)
        // - When reanalyzedModuleIds is undefined (Phase 3 was skipped via --phase 4),
        //   fall back to old behavior: skip reduce when all articles are cached
        const nothingChanged = reanalyzedModuleIds !== undefined
            ? reanalyzedModuleIds.length === 0
            : analysesToGenerate.length === 0;

        if (nothingChanged && cachedArticles.length > 0) {
            // Try loading cached reduce articles
            let cachedReduceArticles: GeneratedArticle[] | null = null;
            if (!options.force) {
                cachedReduceArticles = options.useCache
                    ? getCachedReduceArticles(options.output)
                    : (gitHash ? getCachedReduceArticles(options.output, gitHash) : null);
            }

            if (cachedReduceArticles && cachedReduceArticles.length > 0) {
                // All reduce articles loaded from cache — skip reduce phase entirely
                reduceArticles.push(...cachedReduceArticles);
                printSuccess(
                    `All ${cachedArticles.length} module articles + ${cachedReduceArticles.length} reduce articles loaded from cache`
                );
            } else {
                // Reduce articles not cached — generate them (reduce-only; don't re-generate module articles)
                spinner.start('Generating index and overview pages...');

                const reduceOnly = await generateReduceOnlyArticles(
                    graph,
                    analyses,
                    writingInvoker,
                    writingModel,
                    writingTimeout ? writingTimeout * 1000 : undefined,
                );
                reduceArticles.push(...reduceOnly);

                // Cache the newly generated reduce articles
                if (gitHash && reduceOnly.length > 0) {
                    try {
                        saveReduceArticles(reduceOnly, options.output, gitHash);
                    } catch {
                        if (options.verbose) {
                            printWarning('Failed to cache reduce articles (non-fatal)');
                        }
                    }
                }

                spinner.succeed('Generated index and overview pages');
            }
        } else if (analysesToGenerate.length === 0 && cachedArticles.length > 0 && !nothingChanged) {
            // Modules were re-analyzed but all articles were re-stamped/cached.
            // We still need to regenerate reduce articles because module content changed.
            spinner.start('Regenerating index and overview pages (module content changed)...');

            const reduceOnly = await generateReduceOnlyArticles(
                graph,
                analyses,
                writingInvoker,
                writingModel,
                writingTimeout ? writingTimeout * 1000 : undefined,
            );
            reduceArticles.push(...reduceOnly);

            // Cache the newly generated reduce articles
            if (gitHash && reduceOnly.length > 0) {
                try {
                    saveReduceArticles(reduceOnly, options.output, gitHash);
                } catch {
                    if (options.verbose) {
                        printWarning('Failed to cache reduce articles (non-fatal)');
                    }
                }
            }

            spinner.succeed('Regenerated index and overview pages');
        }

        // Cache reduce articles from the map+reduce pass (when articles were freshly generated)
        if (reduceArticles.length > 0 && analysesToGenerate.length > 0 && gitHash) {
            try {
                saveReduceArticles(reduceArticles, options.output, gitHash);
            } catch {
                if (options.verbose) {
                    printWarning('Failed to cache reduce articles (non-fatal)');
                }
            }
        }

        // Combine all articles for writing
        const allArticles = [...allModuleArticles, ...reduceArticles];

        // Write to disk
        const outputDir = path.resolve(options.output);
        try {
            const wikiOutput = { articles: allArticles, duration: Date.now() - startTime };
            const writtenPaths = writeWikiOutput(wikiOutput, outputDir);
            printSuccess(`Wrote ${writtenPaths.length} files to ${bold(outputDir)}`);

            // Initialize wiki output directory as a Git repository
            initWikiGitRepo(outputDir, {
                info: (msg) => { if (options.verbose) { printInfo(msg); } },
                warn: (msg) => printWarning(msg),
            });

            if (options.verbose) {
                for (const p of writtenPaths) {
                    printInfo(`  ${gray(path.relative(outputDir, p))}`);
                }
            }
        } catch (writeError) {
            printError(`Failed to write files: ${getErrorMessage(writeError)}`);
            return {
                articlesWritten: 0,
                duration: Date.now() - startTime,
                exitCode: EXIT_CODES.EXECUTION_ERROR,
            };
        }

        // Save article cache metadata (marks cache as "complete")
        try {
            await saveAllArticles(allModuleArticles, options.output, repoPath);
        } catch {
            if (options.verbose) {
                printWarning('Failed to cache articles (non-fatal)');
            }
        }

        return {
            articlesWritten: allArticles.length,
            duration: Date.now() - startTime,
        };
    } catch (error) {
        spinner.fail('Article generation failed');
        printError(getErrorMessage(error));
        return {
            articlesWritten: 0,
            duration: Date.now() - startTime,
            exitCode: EXIT_CODES.EXECUTION_ERROR,
        };
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate reduce-only articles (index/architecture/getting-started) without re-generating module articles.
 */
export async function generateReduceOnlyArticles(
    graph: ComponentGraph,
    analyses: ComponentAnalysis[],
    writingInvoker: AIInvoker,
    model?: string,
    timeoutMs?: number,
): Promise<GeneratedArticle[]> {
    if (analyses.length === 0) {
        return [];
    }

    // Provide compact per-module summaries to the reducer (avoid re-generating module articles).
    const resultsForPrompt = analyses.map(a => {
        const mod = graph.components.find(m => m.id === a.componentId);
        return {
            id: a.componentId,
            name: mod?.name || a.componentId,
            category: mod?.category || 'uncategorized',
            overview: (a.overview || '').substring(0, 500),
        };
    });

    const resultsString = JSON.stringify(resultsForPrompt, null, 2);

    let prompt = buildReducePromptTemplate();

    prompt = prompt
        .replace(/\{\{RESULTS\}\}/g, resultsString)
        .replace(/\{\{COUNT\}\}/g, String(resultsForPrompt.length))
        .replace(/\{\{SUCCESS_COUNT\}\}/g, String(resultsForPrompt.length))
        .replace(/\{\{FAILURE_COUNT\}\}/g, '0');

    const reduceParameters: Record<string, string> = {
        projectName: graph.project.name,
        projectDescription: graph.project.description || 'No description available',
        buildSystem: graph.project.buildSystem || 'Unknown',
        language: graph.project.language || 'Unknown',
    };

    for (const [key, value] of Object.entries(reduceParameters)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    const aiResult = await writingInvoker(prompt, { model, timeoutMs });
    if (!aiResult.success || !aiResult.response) {
        return generateStaticIndexPages(graph, analyses);
    }

    const jsonStr = extractJSON(aiResult.response);
    if (!jsonStr) {
        return generateStaticIndexPages(graph, analyses);
    }

    try {
        const parsed = JSON.parse(jsonStr) as Record<string, string>;
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

        return articles.length > 0 ? articles : generateStaticIndexPages(graph, analyses);
    } catch {
        return generateStaticIndexPages(graph, analyses);
    }
}

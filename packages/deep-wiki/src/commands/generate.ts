/**
 * Generate Command
 *
 * Implements the `deep-wiki generate <repo-path>` command.
 * Full three-phase wiki generation:
 *   Phase 1: Discovery → ModuleGraph
 *   Phase 2: Analysis  → ModuleAnalysis[] (incremental with cache)
 *   Phase 3: Writing   → Wiki articles on disk
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ModuleGraph, ModuleAnalysis, GeneratedArticle } from '../types';
import { discoverModuleGraph } from '../discovery';
import { analyzeModules, parseAnalysisResponse } from '../analysis';
import {
    generateArticles,
    writeWikiOutput,
    generateWebsite,
    buildReducePromptTemplate,
    generateStaticIndexPages,
} from '../writing';
import { checkAIAvailability, createAnalysisInvoker, createWritingInvoker } from '../ai-invoker';
import { extractJSON, type AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { normalizeModuleId } from '../schemas';
import {
    getCachedGraph,
    getCachedGraphAny,
    saveGraph,
    getCachedAnalyses,
    saveAllAnalyses,
    getModulesNeedingReanalysis,
    getCachedAnalysis,
    getAnalysesCacheMetadata,
    saveAnalysis,
    getRepoHeadHash,
    scanIndividualAnalysesCache,
    scanIndividualAnalysesCacheAny,
    saveArticle,
    saveAllArticles,
    scanIndividualArticlesCache,
    scanIndividualArticlesCacheAny,
    getCachedReduceArticles,
    saveReduceArticles,
} from '../cache';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
    bold,
    green,
    cyan,
    yellow,
    gray,
} from '../logger';
import { EXIT_CODES } from '../cli';

// ============================================================================
// Execute Generate Command
// ============================================================================

/**
 * Execute the generate command — full three-phase wiki generation.
 *
 * @param repoPath - Path to the local git repository
 * @param options - Command options
 * @returns Exit code
 */
export async function executeGenerate(
    repoPath: string,
    options: GenerateCommandOptions
): Promise<number> {
    const startTime = Date.now();

    // Resolve to absolute path
    const absoluteRepoPath = path.resolve(repoPath);

    // Validate the repo path exists
    if (!fs.existsSync(absoluteRepoPath)) {
        printError(`Repository path does not exist: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    if (!fs.statSync(absoluteRepoPath).isDirectory()) {
        printError(`Repository path is not a directory: ${absoluteRepoPath}`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    // Validate phase option
    const startPhase = options.phase || 1;
    if (startPhase < 1 || startPhase > 3) {
        printError(`Invalid --phase value: ${startPhase}. Must be 1, 2, or 3.`);
        return EXIT_CODES.CONFIG_ERROR;
    }

    // Print header
    printHeader('Deep Wiki — Full Generation');
    printKeyValue('Repository', absoluteRepoPath);
    printKeyValue('Output', path.resolve(options.output));
    printKeyValue('Depth', options.depth);
    if (options.focus) { printKeyValue('Focus', options.focus); }
    if (options.model) { printKeyValue('Model', options.model); }
    if (options.concurrency) { printKeyValue('Concurrency', String(options.concurrency)); }
    if (startPhase > 1) { printKeyValue('Starting Phase', String(startPhase)); }
    if (options.force) { printKeyValue('Force', 'yes (ignoring all caches)'); }
    if (options.useCache) { printKeyValue('Use Cache', 'yes (ignoring git hash)'); }
    process.stderr.write('\n');

    // Check AI availability
    const availability = await checkAIAvailability();
    if (!availability.available) {
        printError(`Copilot SDK is not available: ${availability.reason || 'Unknown reason'}`);
        printInfo('Setup instructions:');
        printInfo('  1. Install GitHub Copilot extension');
        printInfo('  2. Sign in with your GitHub account');
        printInfo('  3. Ensure Copilot has SDK access');
        return EXIT_CODES.AI_UNAVAILABLE;
    }

    // Set up cancellation
    let cancelled = false;
    const isCancelled = () => cancelled;
    const sigintHandler = () => {
        if (cancelled) {
            process.exit(EXIT_CODES.CANCELLED);
        }
        cancelled = true;
        printWarning('Cancellation requested — finishing current operations...');
    };
    process.on('SIGINT', sigintHandler);

    try {
        // ================================================================
        // Phase 1: Discovery
        // ================================================================
        let graph: ModuleGraph;
        let phase1Duration = 0;

        if (startPhase <= 1) {
            const phase1Result = await runPhase1(absoluteRepoPath, options, isCancelled);
            if (phase1Result.exitCode !== undefined) {
                return phase1Result.exitCode;
            }
            graph = phase1Result.graph!;
            phase1Duration = phase1Result.duration;
        } else {
            // Load from cache
            const cached = options.useCache
                ? getCachedGraphAny(options.output)
                : await getCachedGraph(absoluteRepoPath, options.output);
            if (!cached) {
                printError(`No cached module graph found. Run with --phase 1 (or without --phase) first.`);
                return EXIT_CODES.CONFIG_ERROR;
            }
            graph = cached.graph;
            printSuccess(`Loaded cached module graph (${graph.modules.length} modules)`);
        }

        if (isCancelled()) {
            return EXIT_CODES.CANCELLED;
        }

        // ================================================================
        // Phase 2: Deep Analysis
        // ================================================================
        let analyses: ModuleAnalysis[];
        let phase2Duration = 0;

        if (startPhase <= 2) {
            const phase2Result = await runPhase2(
                absoluteRepoPath, graph, options, isCancelled
            );
            if (phase2Result.exitCode !== undefined) {
                return phase2Result.exitCode;
            }
            analyses = phase2Result.analyses!;
            phase2Duration = phase2Result.duration;
        } else {
            // Load from cache
            const cached = getCachedAnalyses(options.output);
            if (!cached || cached.length === 0) {
                printError(`No cached analyses found. Run with --phase 2 (or without --phase) first.`);
                return EXIT_CODES.CONFIG_ERROR;
            }
            analyses = cached;
            printSuccess(`Loaded ${analyses.length} cached module analyses`);
        }

        if (isCancelled()) {
            return EXIT_CODES.CANCELLED;
        }

        // ================================================================
        // Phase 3: Article Generation
        // ================================================================
        const phase3Result = await runPhase3(
            absoluteRepoPath, graph, analyses, options, isCancelled
        );
        if (phase3Result.exitCode !== undefined) {
            return phase3Result.exitCode;
        }

        // ================================================================
        // Phase 4: Website Generation
        // ================================================================
        let websiteGenerated = false;
        let phase4Duration = 0;

        if (!options.skipWebsite) {
            const phase4Result = runPhase4(options);
            websiteGenerated = phase4Result.success;
            phase4Duration = phase4Result.duration;
        }

        // ================================================================
        // Summary
        // ================================================================
        const totalDuration = Date.now() - startTime;
        process.stderr.write('\n');
        printHeader('Generation Summary');
        printKeyValue('Modules Discovered', String(graph.modules.length));
        if (graph.areas && graph.areas.length > 0) {
            printKeyValue('Areas', String(graph.areas.length));
            printKeyValue('Layout', 'Hierarchical (3-level)');
        }
        printKeyValue('Modules Analyzed', String(analyses.length));
        printKeyValue('Articles Written', String(phase3Result.articlesWritten));
        if (websiteGenerated) {
            printKeyValue('Website', 'Generated');
        }
        if (phase1Duration > 0) { printKeyValue('Phase 1 Duration', formatDuration(phase1Duration)); }
        if (phase2Duration > 0) { printKeyValue('Phase 2 Duration', formatDuration(phase2Duration)); }
        printKeyValue('Phase 3 Duration', formatDuration(phase3Result.duration));
        if (phase4Duration > 0) { printKeyValue('Phase 4 Duration', formatDuration(phase4Duration)); }
        printKeyValue('Total Duration', formatDuration(totalDuration));
        process.stderr.write('\n');
        printSuccess(`Wiki generated at ${bold(path.resolve(options.output))}`);
        if (websiteGenerated) {
            printSuccess(`Website: ${bold(path.join(path.resolve(options.output), 'index.html'))}`);
        }

        return EXIT_CODES.SUCCESS;

    } finally {
        process.removeListener('SIGINT', sigintHandler);
    }
}

// ============================================================================
// Phase 1: Discovery
// ============================================================================

interface Phase1Result {
    graph?: ModuleGraph;
    duration: number;
    exitCode?: number;
}

async function runPhase1(
    repoPath: string,
    options: GenerateCommandOptions,
    isCancelled: () => boolean
): Promise<Phase1Result> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 1: Discovery');

    // Check cache (unless --force)
    if (!options.force) {
        try {
            const cached = options.useCache
                ? getCachedGraphAny(options.output)
                : await getCachedGraph(repoPath, options.output);
            if (cached) {
                const duration = Date.now() - startTime;
                printSuccess(`Using cached module graph (${cached.graph.modules.length} modules)`);
                return { graph: cached.graph, duration };
            }
        } catch {
            // Cache read failed — continue with discovery
        }
    }

    const spinner = new Spinner();
    spinner.start('Discovering module graph...');

    try {
        const result = await discoverModuleGraph({
            repoPath,
            model: options.model,
            timeout: options.timeout ? options.timeout * 1000 : undefined,
            focus: options.focus,
        });

        spinner.succeed(`Discovery complete — ${result.graph.modules.length} modules found`);

        // Save to cache
        try {
            await saveGraph(repoPath, result.graph, options.output, options.focus);
        } catch {
            if (options.verbose) {
                printWarning('Failed to cache module graph (non-fatal)');
            }
        }

        // Also write module-graph.json to output
        const outputDir = path.resolve(options.output);
        const outputFile = path.join(outputDir, 'module-graph.json');
        try {
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(outputFile, JSON.stringify(result.graph, null, 2), 'utf-8');
        } catch {
            // Non-fatal
        }

        return { graph: result.graph, duration: Date.now() - startTime };
    } catch (error) {
        spinner.fail('Discovery failed');
        printError((error as Error).message);
        return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
    }
}

// ============================================================================
// Phase 2: Deep Analysis
// ============================================================================

interface Phase2Result {
    analyses?: ModuleAnalysis[];
    duration: number;
    exitCode?: number;
}

async function runPhase2(
    repoPath: string,
    graph: ModuleGraph,
    options: GenerateCommandOptions,
    isCancelled: () => boolean
): Promise<Phase2Result> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 2: Deep Analysis');

    const concurrency = options.concurrency || 5;

    // Determine which modules need analysis
    let modulesToAnalyze = graph.modules;
    let cachedAnalyses: ModuleAnalysis[] = [];

    if (!options.force) {
        if (options.useCache) {
            // --use-cache: load all cached analyses regardless of git hash
            const allModuleIds = graph.modules.map(m => m.id);
            const { found, missing } = scanIndividualAnalysesCacheAny(
                allModuleIds, options.output
            );

            if (found.length > 0) {
                cachedAnalyses = found;
                modulesToAnalyze = graph.modules.filter(
                    m => missing.includes(m.id)
                );

                if (missing.length === 0) {
                    printSuccess(`All ${found.length} module analyses loaded from cache`);
                } else {
                    printInfo(`Loaded ${found.length} cached analyses, ${missing.length} remaining`);
                }
            }
        } else {
        // Try incremental rebuild
        const needingReanalysis = await getModulesNeedingReanalysis(
            graph, options.output, repoPath
        );

        if (needingReanalysis !== null) {
            if (needingReanalysis.length === 0) {
                // All modules are up-to-date
                const allCached = getCachedAnalyses(options.output);
                if (allCached && allCached.length > 0) {
                    printSuccess(`All ${allCached.length} module analyses are up-to-date (cached)`);
                    return { analyses: allCached, duration: Date.now() - startTime };
                }
            } else {
                // Partial rebuild
                printInfo(`${needingReanalysis.length} modules changed, ${graph.modules.length - needingReanalysis.length} cached`);

                // Load cached analyses for unchanged modules
                for (const module of graph.modules) {
                    if (!needingReanalysis.includes(module.id)) {
                        const cached = getCachedAnalysis(module.id, options.output);
                        if (cached) {
                            cachedAnalyses.push(cached);
                        } else {
                            // Cache miss for this module — add to re-analyze list
                            needingReanalysis.push(module.id);
                        }
                    }
                }

                // Only analyze changed modules
                modulesToAnalyze = graph.modules.filter(
                    m => needingReanalysis.includes(m.id)
                );
            }
        } else {
            // No metadata (full rebuild indicated) — but check for partial cache
            // from a previous interrupted run that saved modules incrementally.
            const currentHash = await getRepoHeadHash(repoPath);
            if (currentHash) {
                const allModuleIds = graph.modules.map(m => m.id);
                const { found, missing } = scanIndividualAnalysesCache(
                    allModuleIds, options.output, currentHash
                );

                if (found.length > 0) {
                    printInfo(`Recovered ${found.length} module analyses from partial cache, ${missing.length} remaining`);
                    cachedAnalyses = found;
                    modulesToAnalyze = graph.modules.filter(
                        m => missing.includes(m.id)
                    );
                }
            }
        }
        }
    }

    if (modulesToAnalyze.length === 0 && cachedAnalyses.length > 0) {
        printSuccess(`All analyses loaded from cache (${cachedAnalyses.length} modules)`);
        return { analyses: cachedAnalyses, duration: Date.now() - startTime };
    }

    // Create analysis invoker (MCP-enabled, direct sessions)
    const analysisInvoker = createAnalysisInvoker({
        repoPath,
        model: options.model,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    });

    // Get git hash once upfront for per-module incremental saves
    let gitHash: string | null = null;
    try {
        gitHash = await getRepoHeadHash(repoPath);
    } catch {
        // Non-fatal: incremental saves won't work but analysis continues
    }

    const spinner = new Spinner();
    spinner.start(`Analyzing ${modulesToAnalyze.length} modules (${concurrency} parallel)...`);

    try {
        // Build a sub-graph with only the modules to analyze
        const subGraph = {
            ...graph,
            modules: modulesToAnalyze,
        };

        const result = await analyzeModules(
            {
                graph: subGraph,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                concurrency,
                depth: options.depth,
                repoPath,
            },
            analysisInvoker,
            (progress) => {
                if (progress.phase === 'mapping') {
                    spinner.update(
                        `Analyzing modules: ${progress.completedItems}/${progress.totalItems} ` +
                        `(${progress.failedItems} failed)`
                    );
                }
            },
            isCancelled,
            // Per-module incremental save callback
            (item, mapResult) => {
                if (!gitHash || !mapResult.success || !mapResult.output) {
                    return;
                }
                try {
                    // Extract moduleId and rawResponse from the PromptMapResult
                    const output = mapResult.output as { item?: { moduleId?: string }; rawResponse?: string };
                    const moduleId = output?.item?.moduleId;
                    const rawResponse = output?.rawResponse;
                    if (moduleId && rawResponse) {
                        const analysis = parseAnalysisResponse(rawResponse, moduleId);
                        saveAnalysis(moduleId, analysis, options.output, gitHash);
                    }
                } catch {
                    // Non-fatal: per-module save failed, bulk save at end will catch it
                }
            },
        );

        // Merge fresh + cached
        const allAnalyses = [...cachedAnalyses, ...result.analyses];

        if (result.analyses.length === 0 && modulesToAnalyze.length > 0) {
            spinner.fail('All module analyses failed');
            printError('No modules could be analyzed. Check your AI SDK setup or try reducing scope with --focus.');
            return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
        }

        const failedCount = modulesToAnalyze.length - result.analyses.length;
        if (failedCount > 0) {
            spinner.warn(`Analysis complete — ${result.analyses.length} succeeded, ${failedCount} failed`);
        } else {
            spinner.succeed(`Analysis complete — ${result.analyses.length} modules analyzed`);
        }

        // Save to cache (writes metadata + any modules not yet saved incrementally)
        try {
            await saveAllAnalyses(allAnalyses, options.output, repoPath);
        } catch {
            if (options.verbose) {
                printWarning('Failed to cache analyses (non-fatal)');
            }
        }

        return { analyses: allAnalyses, duration: Date.now() - startTime };
    } catch (error) {
        spinner.fail('Analysis failed');
        printError((error as Error).message);
        return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
    }
}

// ============================================================================
// Phase 3: Article Generation
// ============================================================================

interface Phase3Result {
    articlesWritten: number;
    duration: number;
    exitCode?: number;
}

async function runPhase3(
    repoPath: string,
    graph: ModuleGraph,
    analyses: ModuleAnalysis[],
    options: GenerateCommandOptions,
    isCancelled: () => boolean
): Promise<Phase3Result> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 3: Article Generation');

    const concurrency = options.concurrency ? Math.min(options.concurrency * 2, 20) : 5;

    // Get git hash once upfront for per-article incremental saves
    let gitHash: string | null = null;
    try {
        gitHash = await getRepoHeadHash(repoPath);
    } catch {
        // Non-fatal: incremental saves won't work but generation continues
    }

    // Determine which modules need article generation
    let analysesToGenerate = analyses;
    let cachedArticles: GeneratedArticle[] = [];

    if (!options.force) {
        // Scan for individually cached articles (handles crash recovery too)
        const moduleIds = analyses
            .map(a => a.moduleId)
            .filter(id => !!id);

        const { found, missing } = options.useCache
            ? scanIndividualArticlesCacheAny(moduleIds, options.output)
            : gitHash
                ? scanIndividualArticlesCache(moduleIds, options.output, gitHash)
                : { found: [] as GeneratedArticle[], missing: [...moduleIds] };

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
                a => missing.includes(a.moduleId)
            );
        }
    }

    // Create writing invoker (session pool, no tools)
    const writingInvoker = createWritingInvoker({
        model: options.model,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    });

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
                    model: options.model,
                    concurrency,
                    timeout: options.timeout ? options.timeout * 1000 : undefined,
                    depth: options.depth,
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
                        const output = mapResult.output as { item?: { moduleId?: string }; rawText?: string; rawResponse?: string };
                        const moduleId = output?.item?.moduleId;
                        const content = output?.rawText || output?.rawResponse;
                        if (moduleId && content) {
                            const moduleInfo = graph.modules.find(m => m.id === moduleId);
                            const article: GeneratedArticle = {
                                type: 'module',
                                slug: normalizeModuleId(moduleId),
                                title: moduleInfo?.name || moduleId,
                                content,
                                moduleId,
                                areaId: moduleInfo?.area,
                            };
                            saveArticle(moduleId, article, options.output, gitHash);
                        }
                    } catch {
                        // Non-fatal: per-article save failed, bulk save at end will catch it
                    }
                },
            );

            // Separate module articles from reduce-generated articles
            freshArticles = wikiOutput.articles;

            spinner.succeed(`Generated ${freshArticles.length} articles`);
        }

        // Merge cached + fresh module articles
        // Module-type articles are the per-module ones; all others are reduce/area artifacts
        const moduleTypes = new Set(['module']);
        const freshModuleArticles = freshArticles.filter(a => moduleTypes.has(a.type));
        const reduceArticles = freshArticles.filter(a => !moduleTypes.has(a.type));
        const allModuleArticles = [...cachedArticles, ...freshModuleArticles];

        // If we had cached articles but skipped generation, we still need the reduce phase
        // (index/architecture/getting-started) which depends on ALL module articles.
        // Try to load reduce articles from cache first — skip reduce phase if cached.
        if (analysesToGenerate.length === 0 && cachedArticles.length > 0) {
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
                    options.model,
                    options.timeout ? options.timeout * 1000 : undefined,
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

            if (options.verbose) {
                for (const p of writtenPaths) {
                    printInfo(`  ${gray(path.relative(outputDir, p))}`);
                }
            }
        } catch (writeError) {
            printError(`Failed to write files: ${(writeError as Error).message}`);
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
        printError((error as Error).message);
        return {
            articlesWritten: 0,
            duration: Date.now() - startTime,
            exitCode: EXIT_CODES.EXECUTION_ERROR,
        };
    }
}

// ============================================================================
// Phase 4: Website Generation
// ============================================================================

interface Phase4Result {
    success: boolean;
    duration: number;
}

function runPhase4(options: GenerateCommandOptions): Phase4Result {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 4: Website Generation');

    const spinner = new Spinner();
    spinner.start('Generating website...');

    try {
        const outputDir = path.resolve(options.output);
        const files = generateWebsite(outputDir, {
            theme: options.theme,
            title: options.title,
        });

        spinner.succeed(`Website generated (${files.length} files)`);
        return { success: true, duration: Date.now() - startTime };
    } catch (error) {
        spinner.fail('Website generation failed');
        printWarning(`Website generation failed: ${(error as Error).message}`);
        printWarning('Wiki markdown files were still written successfully.');
        return { success: false, duration: Date.now() - startTime };
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate reduce-only articles (index/architecture/getting-started) without re-generating module articles.
 */
async function generateReduceOnlyArticles(
    graph: ModuleGraph,
    analyses: ModuleAnalysis[],
    writingInvoker: AIInvoker,
    model?: string,
    timeoutMs?: number,
): Promise<GeneratedArticle[]> {
    if (analyses.length === 0) {
        return [];
    }

    // Provide compact per-module summaries to the reducer (avoid re-generating module articles).
    const resultsForPrompt = analyses.map(a => {
        const mod = graph.modules.find(m => m.id === a.moduleId);
        return {
            id: a.moduleId,
            name: mod?.name || a.moduleId,
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

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

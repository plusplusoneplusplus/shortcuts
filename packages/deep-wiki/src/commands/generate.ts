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
import type { GenerateCommandOptions, ModuleGraph, ModuleAnalysis } from '../types';
import { discoverModuleGraph } from '../discovery';
import { analyzeModules } from '../analysis';
import { generateArticles, writeWikiOutput } from '../writing';
import { checkAIAvailability, createAnalysisInvoker, createWritingInvoker } from '../ai-invoker';
import {
    getCachedGraph,
    saveGraph,
    getCachedAnalyses,
    saveAllAnalyses,
    getModulesNeedingReanalysis,
    getCachedAnalysis,
    getAnalysesCacheMetadata,
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
            const cached = await getCachedGraph(absoluteRepoPath, options.output);
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
            graph, analyses, options, isCancelled
        );
        if (phase3Result.exitCode !== undefined) {
            return phase3Result.exitCode;
        }

        // ================================================================
        // Summary
        // ================================================================
        const totalDuration = Date.now() - startTime;
        process.stderr.write('\n');
        printHeader('Generation Summary');
        printKeyValue('Modules Discovered', String(graph.modules.length));
        printKeyValue('Modules Analyzed', String(analyses.length));
        printKeyValue('Articles Written', String(phase3Result.articlesWritten));
        if (phase1Duration > 0) { printKeyValue('Phase 1 Duration', formatDuration(phase1Duration)); }
        if (phase2Duration > 0) { printKeyValue('Phase 2 Duration', formatDuration(phase2Duration)); }
        printKeyValue('Phase 3 Duration', formatDuration(phase3Result.duration));
        printKeyValue('Total Duration', formatDuration(totalDuration));
        process.stderr.write('\n');
        printSuccess(`Wiki generated at ${bold(path.resolve(options.output))}`);

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
            const cached = await getCachedGraph(repoPath, options.output);
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

        // Save to cache
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
    graph: ModuleGraph,
    analyses: ModuleAnalysis[],
    options: GenerateCommandOptions,
    isCancelled: () => boolean
): Promise<Phase3Result> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 3: Article Generation');

    const concurrency = options.concurrency ? Math.min(options.concurrency * 2, 20) : 10;

    // Create writing invoker (session pool, no tools)
    const writingInvoker = createWritingInvoker({
        model: options.model,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    });

    const spinner = new Spinner();
    spinner.start(`Generating articles for ${analyses.length} modules...`);

    try {
        const wikiOutput = await generateArticles(
            {
                graph,
                analyses,
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
        );

        spinner.succeed(`Generated ${wikiOutput.articles.length} articles`);

        // Write to disk
        const outputDir = path.resolve(options.output);
        try {
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

        return {
            articlesWritten: wikiOutput.articles.length,
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
// Helpers
// ============================================================================

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

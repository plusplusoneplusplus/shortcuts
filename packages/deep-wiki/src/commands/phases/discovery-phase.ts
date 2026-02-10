/**
 * Phase 1: Discovery
 *
 * Discovers the module graph of a repository using AI-powered analysis.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { GenerateCommandOptions, ModuleGraph } from '../../types';
import type { TokenUsage } from '@plusplusoneplusplus/pipeline-core';
import { resolvePhaseModel, resolvePhaseTimeout, resolvePhaseConcurrency } from '../../config-loader';
import { discoverModuleGraph, runIterativeDiscovery } from '../../discovery';
import { generateTopicSeeds, parseSeedFile } from '../../seeds';
import {
    getCachedGraph,
    getCachedGraphAny,
    saveGraph,
    getFolderHeadHash,
    saveSeedsCache,
    getCachedSeeds,
    getCachedSeedsAny,
    clearDiscoveryCache,
} from '../../cache';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
} from '../../logger';
import { EXIT_CODES } from '../../cli';
import { getErrorMessage } from '../../utils/error-utils';

// ============================================================================
// Types
// ============================================================================

export interface Phase1Result {
    graph?: ModuleGraph;
    duration: number;
    exitCode?: number;
    tokenUsage?: TokenUsage;
}

// ============================================================================
// Phase 1: Discovery
// ============================================================================

export async function runPhase1(
    repoPath: string,
    options: GenerateCommandOptions,
    isCancelled: () => boolean
): Promise<Phase1Result> {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 1: Discovery');

    // Get git hash for cache operations (subfolder-scoped when applicable)
    let currentGitHash: string | null = null;
    try {
        currentGitHash = await getFolderHeadHash(repoPath);
    } catch {
        // Non-fatal
    }

    // Clear discovery cache if --force
    if (options.force) {
        clearDiscoveryCache(options.output);
    }

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
        let result;

        // Resolve per-phase settings for discovery
        const discoveryModel = resolvePhaseModel(options, 'discovery');
        const discoveryTimeout = resolvePhaseTimeout(options, 'discovery');
        const discoveryConcurrency = resolvePhaseConcurrency(options, 'discovery');

        // Check if iterative discovery is requested
        if (options.seeds) {
            // Load or generate seeds
            let seeds;
            if (options.seeds === 'auto') {
                // Check for cached seeds first
                if (!options.force && currentGitHash) {
                    const cachedSeeds = options.useCache
                        ? getCachedSeedsAny(options.output)
                        : getCachedSeeds(options.output, currentGitHash);
                    if (cachedSeeds && cachedSeeds.length > 0) {
                        seeds = cachedSeeds;
                        printInfo(`Using ${seeds.length} cached seeds`);
                    }
                }

                if (!seeds) {
                    spinner.update('Generating topic seeds...');
                    seeds = await generateTopicSeeds(repoPath, {
                        maxTopics: 50,
                        model: discoveryModel,
                        verbose: options.verbose,
                    });

                    // Cache the generated seeds
                    if (currentGitHash) {
                        try {
                            saveSeedsCache(seeds, options.output, currentGitHash);
                        } catch {
                            // Non-fatal
                        }
                    }
                }

                spinner.succeed(`Generated ${seeds.length} topic seeds`);
                spinner.start('Running iterative discovery...');
            } else {
                // Parse seed file (file-based seeds don't need caching)
                seeds = parseSeedFile(options.seeds);
                printInfo(`Loaded ${seeds.length} seeds from ${options.seeds}`);
                spinner.update('Running iterative discovery...');
            }

            // Run iterative discovery with cache options
            const graph = await runIterativeDiscovery({
                repoPath,
                seeds,
                model: discoveryModel,
                probeTimeout: discoveryTimeout ? discoveryTimeout * 1000 : undefined,
                mergeTimeout: discoveryTimeout ? discoveryTimeout * 1000 * 1.5 : undefined, // Merge takes longer
                concurrency: discoveryConcurrency || 5,
                maxRounds: 3,
                coverageThreshold: 0.8,
                focus: options.focus,
                outputDir: options.output,
                gitHash: currentGitHash ?? undefined,
                useCache: options.useCache,
            });

            result = {
                graph,
                duration: 0, // Iterative discovery doesn't track duration yet
            };
        } else {
            // Standard discovery (pass cache options for large-repo handler)
            result = await discoverModuleGraph({
                repoPath,
                model: discoveryModel,
                timeout: discoveryTimeout ? discoveryTimeout * 1000 : undefined,
                focus: options.focus,
                outputDir: options.output,
                gitHash: currentGitHash ?? undefined,
                useCache: options.useCache,
            });
        }

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

        return { graph: result.graph, duration: Date.now() - startTime, tokenUsage: result.tokenUsage };
    } catch (error) {
        spinner.fail('Discovery failed');
        printError(getErrorMessage(error));
        return { duration: Date.now() - startTime, exitCode: EXIT_CODES.EXECUTION_ERROR };
    }
}

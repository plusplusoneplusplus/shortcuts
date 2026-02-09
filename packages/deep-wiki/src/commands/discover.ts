/**
 * Discover Command
 *
 * Implements the `deep-wiki discover <repo-path>` command.
 * Runs Phase 1 (Discovery) to produce a ModuleGraph JSON.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { DiscoverCommandOptions } from '../types';
import { discoverModuleGraph, DiscoveryError, runIterativeDiscovery } from '../discovery';
import { getCachedGraph, getCachedGraphAny, saveGraph } from '../cache';
import { generateTopicSeeds, parseSeedFile } from '../seeds';
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
    gray,
} from '../logger';
import { EXIT_CODES } from '../cli';

// ============================================================================
// Execute Discover Command
// ============================================================================

/**
 * Execute the discover command.
 *
 * @param repoPath - Path to the local git repository
 * @param options - Command options
 * @returns Exit code
 */
export async function executeDiscover(
    repoPath: string,
    options: DiscoverCommandOptions
): Promise<number> {
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

    // Print header
    printHeader('Deep Wiki — Discovery Phase');
    printKeyValue('Repository', absoluteRepoPath);
    if (options.focus) {
        printKeyValue('Focus', options.focus);
    }
    if (options.model) {
        printKeyValue('Model', options.model);
    }
    process.stderr.write('\n');

    // Check cache (unless --force)
    if (!options.force) {
        try {
            const cached = options.useCache
                ? getCachedGraphAny(options.output)
                : await getCachedGraph(absoluteRepoPath, options.output);
            if (cached) {
                printSuccess('Found cached module graph (git hash matches)');
                printKeyValue('Modules', String(cached.graph.modules.length));
                printKeyValue('Categories', String(cached.graph.categories.length));

                // Output JSON to stdout
                const jsonOutput = JSON.stringify(cached.graph, null, 2);
                process.stdout.write(jsonOutput + '\n');

                return EXIT_CODES.SUCCESS;
            }
        } catch {
            // Cache check failed, continue with fresh discovery
        }
    }

    // Run discovery
    const spinner = new Spinner();
    spinner.start('Discovering module graph...');

    try {
        let result;

        // Check if iterative discovery is requested
        if (options.seeds) {
            // Load or generate seeds
            let seeds;
            if (options.seeds === 'auto') {
                spinner.update('Generating topic seeds...');
                seeds = await generateTopicSeeds(absoluteRepoPath, {
                    maxTopics: 50,
                    model: options.model,
                    verbose: options.verbose,
                });
                spinner.update('Running iterative discovery...');
            } else {
                // Parse seed file
                seeds = parseSeedFile(options.seeds);
                spinner.update('Running iterative discovery...');
            }

            // Run iterative discovery
            const graph = await runIterativeDiscovery({
                repoPath: absoluteRepoPath,
                seeds,
                model: options.model,
                probeTimeout: options.timeout ? options.timeout * 1000 : undefined,
                mergeTimeout: options.timeout ? options.timeout * 1000 * 1.5 : undefined, // Merge takes longer
                concurrency: 5,
                maxRounds: 3,
                coverageThreshold: 0.8,
                focus: options.focus,
            });

            result = {
                graph,
                duration: 0, // Iterative discovery doesn't track duration yet
            };
        } else {
            // Standard discovery
            result = await discoverModuleGraph({
                repoPath: absoluteRepoPath,
                model: options.model,
                timeout: options.timeout ? options.timeout * 1000 : undefined,
                focus: options.focus,
            });
        }

        spinner.succeed('Discovery complete');

        // Print summary to stderr
        const { graph, duration } = result;
        process.stderr.write('\n');
        printHeader('Discovery Summary');
        printKeyValue('Project', graph.project.name);
        printKeyValue('Language', graph.project.language);
        printKeyValue('Build System', graph.project.buildSystem);
        printKeyValue('Modules', String(graph.modules.length));
        printKeyValue('Categories', String(graph.categories.length));
        printKeyValue('Duration', formatDuration(duration));

        if (options.verbose) {
            process.stderr.write('\n');
            printInfo('Modules:');
            for (const mod of graph.modules) {
                process.stderr.write(
                    `  ${cyan(mod.id)} ${gray('—')} ${mod.purpose} ${gray(`[${mod.complexity}]`)}\n`
                );
            }
        }

        // Save to cache
        try {
            await saveGraph(absoluteRepoPath, graph, options.output, options.focus);
            if (options.verbose) {
                printInfo('Cached module graph for future use');
            }
        } catch {
            if (options.verbose) {
                printWarning('Failed to cache module graph (non-fatal)');
            }
        }

        // Write output file
        const jsonOutput = JSON.stringify(graph, null, 2);
        const outputDir = path.resolve(options.output);
        const outputFile = path.join(outputDir, 'module-graph.json');

        try {
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(outputFile, jsonOutput, 'utf-8');
            process.stderr.write('\n');
            printSuccess(`Module graph written to ${bold(outputFile)}`);
        } catch (writeError) {
            printWarning(`Could not write to file: ${(writeError as Error).message}`);
            printInfo('Outputting to stdout instead');
        }

        // Also write to stdout for piping
        process.stdout.write(jsonOutput + '\n');

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        spinner.fail('Discovery failed');

        if (error instanceof DiscoveryError) {
            switch (error.code) {
                case 'sdk-unavailable':
                    printError(error.message);
                    printInfo('Setup instructions:');
                    printInfo('  1. Install GitHub Copilot extension');
                    printInfo('  2. Sign in with your GitHub account');
                    printInfo('  3. Ensure Copilot has SDK access');
                    return EXIT_CODES.AI_UNAVAILABLE;

                case 'timeout':
                    printError(error.message);
                    return EXIT_CODES.EXECUTION_ERROR;

                default:
                    printError(error.message);
                    return EXIT_CODES.EXECUTION_ERROR;
            }
        }

        printError((error as Error).message);
        if (options.verbose && error instanceof Error && error.stack) {
            process.stderr.write(`${gray(error.stack)}\n`);
        }
        return EXIT_CODES.EXECUTION_ERROR;
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

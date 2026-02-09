/**
 * Seeds Command
 *
 * Implements the `deep-wiki seeds <repo-path>` command.
 * Generates topic seeds for breadth-first discovery (Phase 0).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SeedsCommandOptions, SeedsOutput } from '../types';
import { generateTopicSeeds, SeedsError } from '../seeds';
import {
    Spinner,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
    bold,
    cyan,
    gray,
} from '../logger';
import { EXIT_CODES } from '../cli';

// ============================================================================
// Constants
// ============================================================================

/** Deep-wiki version for seeds output */
const DEEP_WIKI_VERSION = '1.0.0';

// ============================================================================
// Execute Seeds Command
// ============================================================================

/**
 * Execute the seeds command.
 *
 * @param repoPath - Path to the local git repository
 * @param options - Command options
 * @returns Exit code
 */
export async function executeSeeds(
    repoPath: string,
    options: SeedsCommandOptions
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
    printHeader('Deep Wiki — Seeds Generation (Phase 0)');
    printKeyValue('Repository', absoluteRepoPath);
    printKeyValue('Output File', options.output);
    printKeyValue('Max Topics', String(options.maxTopics));
    if (options.model) {
        printKeyValue('Model', options.model);
    }
    process.stderr.write('\n');

    // Run seed generation
    const spinner = new Spinner();
    spinner.start('Generating topic seeds...');

    try {
        const seeds = await generateTopicSeeds(absoluteRepoPath, {
            maxTopics: options.maxTopics,
            model: options.model,
            verbose: options.verbose,
        });

        spinner.succeed('Seeds generation complete');

        // Print summary to stderr
        process.stderr.write('\n');
        printHeader('Seeds Summary');
        printKeyValue('Topics Found', String(seeds.length));

        if (options.verbose) {
            process.stderr.write('\n');
            printInfo('Topics:');
            for (const seed of seeds) {
                process.stderr.write(
                    `  ${cyan(seed.topic)} ${gray('—')} ${seed.description}\n`
                );
            }
        } else {
            // Print topic list to stderr (non-verbose)
            process.stderr.write('\n');
            printInfo('Topics:');
            for (const seed of seeds) {
                process.stderr.write(`  ${cyan(seed.topic)}\n`);
            }
        }

        // Create output structure
        const output: SeedsOutput = {
            version: DEEP_WIKI_VERSION,
            timestamp: Date.now(),
            repoPath: absoluteRepoPath,
            topics: seeds,
        };

        // Write output file
        const outputPath = path.resolve(options.output);
        const outputDir = path.dirname(outputPath);

        try {
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
            process.stderr.write('\n');
            printSuccess(`Seeds written to ${bold(outputPath)}`);
        } catch (writeError) {
            printWarning(`Could not write to file: ${(writeError as Error).message}`);
            printInfo('Outputting to stdout instead');
            // Fall back to stdout
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        }

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        spinner.fail('Seeds generation failed');

        if (error instanceof SeedsError) {
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

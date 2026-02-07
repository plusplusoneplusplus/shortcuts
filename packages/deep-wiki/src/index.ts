#!/usr/bin/env node

/**
 * Deep Wiki Generator CLI Entry Point
 *
 * Standalone CLI tool for auto-generating comprehensive wikis for any codebase.
 * Uses @plusplusoneplusplus/pipeline-core for AI interactions and SDK management.
 *
 * Usage:
 *   deep-wiki discover <repo-path>   Discover module graph for a repository
 *   deep-wiki generate <repo-path>   Generate full wiki (stub, future phases)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { createProgram, EXIT_CODES } from './cli';
import { printError } from './logger';

async function main(): Promise<void> {
    try {
        const program = createProgram();
        await program.parseAsync(process.argv);
    } catch (error) {
        if (error instanceof Error) {
            printError(error.message);
        } else {
            printError(String(error));
        }
        process.exit(EXIT_CODES.EXECUTION_ERROR);
    }
}

main();

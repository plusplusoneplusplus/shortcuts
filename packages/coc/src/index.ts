#!/usr/bin/env node

/**
 * CoC (Copilot of Copilot) CLI Entry Point
 *
 * Standalone CLI tool for executing YAML-based AI pipelines.
 * Uses @plusplusoneplusplus/pipeline-core for pipeline execution.
 *
 * Usage:
 *   coc run <path>       Execute a pipeline
 *   coc validate <path>  Validate a pipeline YAML
 *   coc list [dir]       List pipeline packages
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

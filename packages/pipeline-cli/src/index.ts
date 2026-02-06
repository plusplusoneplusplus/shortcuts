#!/usr/bin/env node

/**
 * Pipeline CLI Entry Point
 *
 * Standalone CLI tool for executing YAML-based AI pipelines.
 * Uses @plusplusoneplusplus/pipeline-core for pipeline execution.
 *
 * Usage:
 *   pipeline run <path>       Execute a pipeline
 *   pipeline validate <path>  Validate a pipeline YAML
 *   pipeline list [dir]       List pipeline packages
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

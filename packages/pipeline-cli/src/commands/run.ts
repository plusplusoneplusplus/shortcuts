/**
 * Run Command
 *
 * Executes a pipeline from a YAML file.
 * Handles input loading, AI invocation, progress display, and output formatting.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    parsePipelineYAMLSync,
    executePipeline,
    setLogger,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    PipelineConfig,
    JobProgress,
    PipelineExecutionResult,
} from '@plusplusoneplusplus/pipeline-core';
import {
    createCLIAIInvoker,
    createDryRunAIInvoker,
} from '../ai-invoker';
import type { CLIAIInvokerOptions } from '../ai-invoker';
import {
    Spinner,
    ProgressDisplay,
    createCLILogger,
    printSuccess,
    printError,
    printInfo,
    printKeyValue,
    printHeader,
    green,
    bold,
} from '../logger';
import { formatResults, formatSummary, formatDuration } from '../output-formatter';
import type { OutputFormat } from '../output-formatter';
import { resolvePipelinePath } from './validate';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the run command
 */
export interface RunCommandOptions {
    /** Override AI model */
    model?: string;
    /** Override parallelism limit */
    parallel?: number;
    /** Output format */
    output: OutputFormat;
    /** Write results to file */
    outputFile?: string;
    /** Workspace root for skill resolution */
    workspaceRoot?: string;
    /** Pipeline parameters as key=value pairs */
    params: Record<string, string>;
    /** Verbose output */
    verbose: boolean;
    /** Dry run (parse and validate only) */
    dryRun: boolean;
    /** Overall timeout in seconds */
    timeout?: number;
    /** Disable colors */
    noColor: boolean;
    /** Auto-approve AI permissions */
    approvePermissions: boolean;
}

// ============================================================================
// Run Command
// ============================================================================

/**
 * Execute the run command
 *
 * @param pipelinePath Path to pipeline.yaml or directory
 * @param options Run options
 * @returns exit code
 */
export async function executeRun(
    pipelinePath: string,
    options: RunCommandOptions
): Promise<number> {
    // 1. Resolve pipeline path
    const yamlPath = resolvePipelinePath(pipelinePath);
    if (!yamlPath) {
        printError(`Pipeline file not found: ${pipelinePath}`);
        return 2;
    }

    const pipelineDir = path.dirname(yamlPath);

    // 2. Parse pipeline YAML
    let config: PipelineConfig;
    try {
        const content = fs.readFileSync(yamlPath, 'utf-8');
        config = parsePipelineYAMLSync(content);
    } catch (error) {
        printError(`Failed to parse pipeline: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }

    // 3. Apply CLI overrides
    if (options.model) {
        config.map.model = options.model;
    }
    if (options.parallel) {
        config.map.parallel = options.parallel;
    }

    // Apply parameter overrides
    if (Object.keys(options.params).length > 0) {
        if (!config.input.parameters) {
            config.input.parameters = [];
        }
        for (const [key, value] of Object.entries(options.params)) {
            const existing = config.input.parameters.find(p => p.name === key);
            if (existing) {
                existing.value = value;
            } else {
                config.input.parameters.push({ name: key, value });
            }
        }
    }

    // 4. Print pipeline info
    printHeader(`Pipeline: ${config.name}`);
    printKeyValue('File', yamlPath);
    if (config.map.model || options.model) {
        printKeyValue('Model', config.map.model || options.model || 'default');
    }
    printKeyValue('Parallel', String(config.map.parallel || 5));
    if (options.dryRun) {
        printKeyValue('Mode', 'Dry Run');
    }
    process.stderr.write('\n');

    // 5. Set up logger
    setLogger(createCLILogger());

    // 6. Create AI invoker
    const invokerOptions: CLIAIInvokerOptions = {
        model: config.map.model || options.model,
        approvePermissions: options.approvePermissions,
        workingDirectory: options.workspaceRoot || pipelineDir,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    };

    const aiInvoker = options.dryRun
        ? createDryRunAIInvoker()
        : createCLIAIInvoker(invokerOptions);

    // 7. Execute pipeline with progress
    let cancelled = false;

    // Handle SIGINT for graceful cancellation
    const sigintHandler = () => {
        if (cancelled) {
            process.exit(130);
        }
        cancelled = true;
        process.stderr.write('\n');
        printInfo('Cancelling... (press Ctrl+C again to force exit)');
    };
    process.on('SIGINT', sigintHandler);

    const spinner = new Spinner();
    let progressDisplay: ProgressDisplay | null = null;
    const startTime = Date.now();

    try {
        spinner.start('Starting pipeline execution...');

        const result = await executePipeline(config, {
            aiInvoker,
            pipelineDirectory: pipelineDir,
            workspaceRoot: options.workspaceRoot,
            isCancelled: () => cancelled,
            onProgress: (progress: JobProgress) => {
                handleProgress(progress, spinner, progressDisplay, options.verbose);
                if (progress.totalItems && !progressDisplay) {
                    progressDisplay = new ProgressDisplay({
                        total: progress.totalItems,
                        label: 'Mapping',
                    });
                }
            },
        });

        spinner.stop();

        // 8. Handle results
        const elapsed = Date.now() - startTime;
        return handleResults(result, options, elapsed, cancelled);
    } catch (error) {
        spinner.fail('Pipeline execution failed');
        const message = error instanceof Error ? error.message : String(error);
        printError(message);

        if (options.verbose && error instanceof Error && error.stack) {
            process.stderr.write(`\n${error.stack}\n`);
        }

        return 1;
    } finally {
        process.removeListener('SIGINT', sigintHandler);
    }
}

// ============================================================================
// Progress Handling
// ============================================================================

function handleProgress(
    progress: JobProgress,
    spinner: Spinner,
    progressDisplay: ProgressDisplay | null,
    verbose: boolean
): void {
    const message = progress.message || `Processing item ${progress.completedItems}/${progress.totalItems}`;

    if (progressDisplay && progress.completedItems !== undefined && progress.totalItems) {
        progressDisplay.update(progress.completedItems, progress.message);
    } else if (spinner.isRunning) {
        spinner.update(message);
    }
}

// ============================================================================
// Result Handling
// ============================================================================

function handleResults(
    result: PipelineExecutionResult,
    options: RunCommandOptions,
    elapsed: number,
    cancelled: boolean
): number {
    // Print summary to stderr
    const summary = formatSummary(result);
    process.stderr.write(summary + '\n');
    process.stderr.write(`\n  ${green(bold('Done'))} in ${formatDuration(elapsed)}\n`);

    if (cancelled) {
        printInfo('Pipeline was cancelled');
    }

    // Format and write results
    const formatted = formatResults(result, options.output);

    if (options.outputFile) {
        try {
            const outputPath = path.resolve(options.outputFile);
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(outputPath, formatted + '\n', 'utf-8');
            printSuccess(`Results written to ${outputPath}`);
        } catch (error) {
            printError(`Failed to write output file: ${error instanceof Error ? error.message : String(error)}`);
            // Still output to stdout as fallback
            process.stdout.write(formatted + '\n');
        }
    } else {
        // Write formatted results to stdout
        process.stdout.write(formatted + '\n');
    }

    // Return appropriate exit code
    if (result.executionStats.failedMaps > 0 && result.executionStats.successfulMaps === 0) {
        return 1;
    }

    return 0;
}

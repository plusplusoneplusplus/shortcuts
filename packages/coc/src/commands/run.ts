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
    compileToWorkflow,
    executeWorkflow,
    flattenWorkflowResult,
    setLogger,
    FileProcessStore,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    WorkflowConfig,
    WorkflowProgressEvent,
    FlatWorkflowResult,
    AIProcess,
} from '@plusplusoneplusplus/pipeline-core';
import {
    createCLIAIInvoker,
    createDryRunAIInvoker,
} from '../ai-invoker';
import type { CLIAIInvokerOptions } from '../ai-invoker';
import {
    Spinner,
    ProgressDisplay,
    printSuccess,
    printError,
    printInfo,
    printKeyValue,
    printHeader,
    green,
    bold,
} from '../logger';
import { createCLIPinoLogger, pinoAdapterForPipelineCore } from '../pino-setup';
import { resolveLoggingConfig, loadConfigFile } from '../config';
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
    /** Save run results to the process store (default: true) */
    persist: boolean;
    /** Data directory for process store (overrides config) */
    dataDir?: string;
    /** Log level (default: 'info'). Overridden by verbose: true → 'debug'. */
    logLevel?: string;
    /** Directory for .ndjson log files. No file logging when undefined. */
    logDir?: string;
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
        printError(`Workflow file not found: ${pipelinePath}`);
        return 2;
    }

    const pipelineDir = path.dirname(yamlPath);

    // 2. Parse pipeline YAML
    let config: WorkflowConfig;
    try {
        const content = fs.readFileSync(yamlPath, 'utf-8');
        config = compileToWorkflow(content);
    } catch (error) {
        printError(`Failed to parse workflow: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }

    // 3. Print pipeline info
    printHeader(`Workflow: ${config.name}`);
    printKeyValue('File', yamlPath);
    if (options.model) {
        printKeyValue('Model', options.model);
    }
    if (options.parallel) {
        printKeyValue('Parallel', String(options.parallel));
    }
    if (options.dryRun) {
        printKeyValue('Mode', 'Dry Run');
    }
    process.stderr.write('\n');

    // 4. Set up logger
    const fileConfig = loadConfigFile();
    const { ai } = createCLIPinoLogger(resolveLoggingConfig(
        { logLevel: options.logLevel, logDir: options.logDir, verbose: options.verbose },
        fileConfig?.logging
    ));
    setLogger(pinoAdapterForPipelineCore(ai));

    // 5. Create AI invoker
    // Working directory priority:
    // 1. --workspace-root CLI flag (explicit override)
    // 2. pipeline directory (default fallback)
    let workingDirectory: string;
    if (options.workspaceRoot) {
        workingDirectory = options.workspaceRoot;
    } else {
        workingDirectory = pipelineDir;
    }

    const invokerOptions: CLIAIInvokerOptions = {
        model: options.model,
        approvePermissions: options.approvePermissions,
        workingDirectory,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    };

    const aiInvoker = options.dryRun
        ? createDryRunAIInvoker()
        : createCLIAIInvoker(invokerOptions);

    // 6. Execute pipeline with progress
    const controller = new AbortController();

    // Handle SIGINT for graceful cancellation
    const sigintHandler = () => {
        if (controller.signal.aborted) {
            process.exit(130);
        }
        controller.abort();
        process.stderr.write('\n');
        printInfo('Cancelling... (press Ctrl+C again to force exit)');
    };
    process.on('SIGINT', sigintHandler);

    const spinner = new Spinner();
    let progressDisplay: ProgressDisplay | null = null;
    const startTime = Date.now();

    try {
        spinner.start('Starting workflow execution...');

        const workflowResult = await executeWorkflow(config, {
            aiInvoker,
            workflowDirectory: pipelineDir,
            workspaceRoot: options.workspaceRoot,
            model: options.model,
            concurrency: options.parallel,
            timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
            signal: controller.signal,
            parameters: Object.keys(options.params).length > 0
                ? { ...config.parameters, ...options.params }
                : undefined,
            onProgress: (event: WorkflowProgressEvent) => {
                handleProgress(event, spinner, progressDisplay, options.verbose);
                if (event.itemProgress && !progressDisplay) {
                    progressDisplay = new ProgressDisplay({
                        total: event.itemProgress.total,
                        label: 'Processing',
                    });
                }
            },
        });

        const result = flattenWorkflowResult(workflowResult, config);
        spinner.stop();

        // 8. Handle results
        const elapsed = Date.now() - startTime;
        const exitCode = handleResults(result, options, elapsed, controller.signal.aborted);

        // 9. Persist to process store
        if (options.persist) {
            await persistProcess(config, yamlPath, result, exitCode, startTime, elapsed, options);
        }

        return exitCode;
    } catch (error) {
        spinner.fail('Workflow execution failed');
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
    event: WorkflowProgressEvent,
    spinner: Spinner,
    progressDisplay: ProgressDisplay | null,
    verbose: boolean
): void {
    const progress = event.itemProgress;
    const message = progress
        ? `Processing item ${progress.completed}/${progress.total}`
        : `Node ${event.nodeId}: ${event.phase}`;

    if (progressDisplay && progress) {
        progressDisplay.update(progress.completed);
    } else if (spinner.isRunning) {
        spinner.update(message);
    }
}

// ============================================================================
// Result Handling
// ============================================================================

function handleResults(
    result: FlatWorkflowResult,
    options: RunCommandOptions,
    elapsed: number,
    cancelled: boolean,
): number {
    // Print summary to stderr
    const summary = formatSummary(result);
    process.stderr.write(summary + '\n');
    process.stderr.write(`\n  ${green(bold('Done'))} in ${formatDuration(elapsed)}\n`);

    if (cancelled) {
        printInfo('Workflow was cancelled');
    }

    // Format and write results
    let formatted: string;
    if (result.formattedOutput) {
        // Use pre-formatted output (e.g., from reduce or single-job)
        formatted = result.formattedOutput;
    } else {
        formatted = formatResults(result, options.output);
    }

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
    if (result.stats.failedMaps > 0 && result.stats.successfulMaps === 0) {
        return 1;
    }

    return 0;
}

// ============================================================================
// Process Persistence
// ============================================================================

async function persistProcess(
    config: WorkflowConfig,
    yamlPath: string,
    result: FlatWorkflowResult,
    exitCode: number,
    startTime: number,
    elapsed: number,
    options: RunCommandOptions
): Promise<void> {
    try {
        const endTime = new Date();
        const formatted = formatResults(result, options.output);
        const process: AIProcess = {
            id: `cli-pipeline-${Date.now()}`,
            type: 'pipeline-execution',
            promptPreview: config.name,
            fullPrompt: yamlPath,
            status: exitCode === 0 ? 'completed' : 'failed',
            startTime: new Date(startTime),
            endTime,
            result: formatted.length > 100_000 ? formatted.slice(0, 100_000) + '\n... (truncated)' : formatted,
            metadata: {
                type: 'cli-pipeline',
                pipelineName: config.name,
                itemCount: result.stats.totalItems,
                successCount: result.stats.successfulMaps,
                failCount: result.stats.failedMaps,
            },
        };
        const store = new FileProcessStore({
            dataDir: options.dataDir,
        });
        await store.addProcess(process);
    } catch (err) {
        // Persistence errors should never fail the run command
        printError(`Failed to persist process: ${err instanceof Error ? err.message : String(err)}`);
    }
}

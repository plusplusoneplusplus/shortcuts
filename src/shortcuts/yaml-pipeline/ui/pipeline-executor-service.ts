/**
 * Pipeline Executor Service
 *
 * Provides VSCode integration for executing YAML pipelines.
 * Bridges the core pipeline executor with the VSCode UI and AI process tracking.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    IAIProcessManager,
    getAIModelSetting,
    createAIInvoker
} from '../../ai-service';
import {
    executePipeline,
    executePipelineWithItems as coreExecutePipelineWithItems,
    parsePipelineYAML,
    PipelineExecutionResult,
    PipelineConfig,
    AIInvoker,
    AIInvokerResult,
    JobProgress,
    ProcessTracker,
    PromptItem,
    SessionMetadata
} from '@plusplusoneplusplus/pipeline-core';
import { PipelineInfo } from './types';

/**
 * Resolve the working directory for AI SDK sessions.
 * 
 * Priority:
 * 1. If config.workingDirectory is set:
 *    - Absolute paths are used as-is
 *    - Relative paths are resolved relative to the pipeline package directory
 * 2. Otherwise, fall back to the provided workspaceRoot
 * 
 * @param config Pipeline configuration (may have workingDirectory)
 * @param packagePath Pipeline package directory (for resolving relative paths)
 * @param workspaceRoot Workspace root as default fallback
 * @returns Resolved working directory path
 */
export function resolveWorkingDirectory(
    config: PipelineConfig,
    packagePath: string,
    workspaceRoot: string
): string {
    if (config.workingDirectory) {
        return path.resolve(packagePath, config.workingDirectory);
    }
    return workspaceRoot;
}

/**
 * Options for pipeline execution
 */
export interface PipelineExecutionOptions {
    /** The pipeline info from the tree view */
    pipeline: PipelineInfo;
    /** Workspace root for resolving paths */
    workspaceRoot: string;
    /** AI Process manager for tracking */
    processManager?: IAIProcessManager;
    /** Optional progress callback */
    onProgress?: (progress: JobProgress) => void;
}

/**
 * Result from pipeline execution in VSCode context
 */
export interface VSCodePipelineResult {
    /** Whether execution was successful */
    success: boolean;
    /** The execution result if successful */
    result?: PipelineExecutionResult;
    /** Error message if failed */
    error?: string;
    /** Process ID in the AI process manager */
    processId?: string;
    /** The parsed pipeline configuration (for retry support) */
    pipelineConfig?: PipelineConfig;
    /** The pipeline directory path (for retry support) */
    pipelineDirectory?: string;
}

/**
 * Execute a pipeline and track it in the AI process manager
 *
 * @param options Execution options
 * @returns Pipeline execution result
 */
export async function executeVSCodePipeline(
    options: PipelineExecutionOptions
): Promise<VSCodePipelineResult> {
    const { pipeline, workspaceRoot, processManager, onProgress } = options;

    // Read and parse the pipeline YAML
    let config: PipelineConfig;
    try {
        const yamlContent = fs.readFileSync(pipeline.filePath, 'utf8');
        config = await parsePipelineYAML(yamlContent);
    } catch (error) {
        const errorMsg = `Failed to parse pipeline: ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, error: errorMsg };
    }

    // Register a process group for tracking
    let groupProcessId: string | undefined;
    if (processManager) {
        groupProcessId = processManager.registerProcessGroup(
            `Pipeline: ${config.name}`,
            {
                type: 'pipeline-execution',
                idPrefix: 'pipeline',
                metadata: {
                    pipelineName: config.name,
                    pipelinePath: pipeline.relativePath,
                    packageName: pipeline.packageName
                }
            }
        );
    }

    // Resolve working directory: config.workingDirectory takes precedence over workspaceRoot
    const effectiveWorkingDirectory = resolveWorkingDirectory(config, pipeline.packagePath, workspaceRoot);

    // Create AI invoker using the unified factory
    // The invoker receives per-item model from options (resolved from template like {{model}})
    const defaultModel = getAIModelSetting();

    const aiInvoker: AIInvoker = createAIInvoker({
        usePool: true, // Use session pool for parallel pipeline execution
        workingDirectory: effectiveWorkingDirectory,
        model: defaultModel,
        featureName: 'Pipeline'
    });

    // Create process tracker if we have a process manager
    let tracker: ProcessTracker | undefined;
    if (processManager && groupProcessId) {
        tracker = createProcessTracker(processManager, groupProcessId);
    }

    // Execute with progress reporting
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing pipeline: ${config.name}`,
        cancellable: true
    }, async (progress, token) => {
        // Track cancellation
        let cancelled = false;
        token.onCancellationRequested(() => {
            cancelled = true;
            if (processManager && groupProcessId) {
                processManager.cancelProcess(groupProcessId);
            }
        });

        try {
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: pipeline.packagePath,
                processTracker: tracker,
                isCancelled: () => cancelled,
                onProgress: (jobProgress) => {
                    // Update VSCode progress
                    const message = getProgressMessage(jobProgress);
                    progress.report({
                        message,
                        increment: calculateIncrement(jobProgress)
                    });

                    // Call optional callback
                    onProgress?.(jobProgress);

                    // Check for cancellation (also throw for immediate feedback)
                    if (cancelled) {
                        throw new Error('Pipeline execution cancelled');
                    }
                }
            });

            // Complete the process group
            if (processManager && groupProcessId) {
                const summary = formatExecutionSummary(result);
                // Store the full result for the enhanced viewer
                processManager.completeProcessGroup(groupProcessId, {
                    result: summary,
                    structuredResult: JSON.stringify(result), // Store full result, not just output
                    executionStats: {
                        totalItems: result.executionStats.totalItems,
                        successfulMaps: result.executionStats.successfulMaps,
                        failedMaps: result.executionStats.failedMaps,
                        mapPhaseTimeMs: result.executionStats.mapPhaseTimeMs,
                        reducePhaseTimeMs: result.executionStats.reducePhaseTimeMs,
                        maxConcurrency: result.executionStats.maxConcurrency
                    }
                });
            }

            return {
                success: result.success,
                result,
                processId: groupProcessId,
                pipelineConfig: config,
                pipelineDirectory: pipeline.packagePath
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Mark process as failed
            if (processManager && groupProcessId) {
                processManager.failProcess(groupProcessId, errorMsg);
            }

            return {
                success: false,
                error: errorMsg,
                processId: groupProcessId,
                pipelineConfig: config,
                pipelineDirectory: pipeline.packagePath
            };
        }
    });
}

/**
 * Options for pipeline execution with pre-approved items
 */
export interface PipelineExecutionWithItemsOptions extends PipelineExecutionOptions {
    /** Pre-approved items to use instead of loading from input config */
    items: PromptItem[];
}

/**
 * Execute a pipeline with pre-approved items (from the generate & review flow)
 * This bypasses the normal input loading and uses the provided items directly.
 *
 * @param options Execution options including the pre-approved items
 * @returns Pipeline execution result
 */
export async function executeVSCodePipelineWithItems(
    options: PipelineExecutionWithItemsOptions
): Promise<VSCodePipelineResult> {
    const { pipeline, workspaceRoot, processManager, onProgress, items } = options;

    // Read and parse the pipeline YAML
    let config: PipelineConfig;
    try {
        const yamlContent = fs.readFileSync(pipeline.filePath, 'utf8');
        // Parse but don't validate (since generate config will fail validation)
        const yaml = await import('js-yaml');
        config = yaml.load(yamlContent) as PipelineConfig;
        
        if (!config || !config.name) {
            return { success: false, error: 'Invalid pipeline configuration: missing name' };
        }
    } catch (error) {
        const errorMsg = `Failed to parse pipeline: ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, error: errorMsg };
    }

    // Register a process group for tracking
    let groupProcessId: string | undefined;
    if (processManager) {
        groupProcessId = processManager.registerProcessGroup(
            `Pipeline: ${config.name}`,
            {
                type: 'pipeline-execution',
                idPrefix: 'pipeline',
                metadata: {
                    pipelineName: config.name,
                    pipelinePath: pipeline.relativePath,
                    packageName: pipeline.packageName,
                    itemCount: items.length
                }
            }
        );
    }

    // Resolve working directory: config.workingDirectory takes precedence over workspaceRoot
    const effectiveWorkingDirectory = resolveWorkingDirectory(config, pipeline.packagePath, workspaceRoot);

    // Create AI invoker using the unified factory
    const defaultModel = getAIModelSetting();

    const aiInvoker: AIInvoker = createAIInvoker({
        usePool: true, // Use session pool for parallel pipeline execution
        workingDirectory: effectiveWorkingDirectory,
        model: defaultModel,
        featureName: 'Pipeline'
    });

    // Create process tracker if we have a process manager
    let tracker: ProcessTracker | undefined;
    if (processManager && groupProcessId) {
        tracker = createProcessTracker(processManager, groupProcessId);
    }

    // Execute with progress reporting
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing pipeline: ${config.name}`,
        cancellable: true
    }, async (progress, token) => {
        // Track cancellation
        let cancelled = false;
        token.onCancellationRequested(() => {
            cancelled = true;
            if (processManager && groupProcessId) {
                processManager.cancelProcess(groupProcessId);
            }
        });

        try {
            const result = await coreExecutePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: pipeline.packagePath,
                processTracker: tracker,
                isCancelled: () => cancelled,
                onProgress: (jobProgress) => {
                    // Update VSCode progress
                    const message = getProgressMessage(jobProgress);
                    progress.report({
                        message,
                        increment: calculateIncrement(jobProgress)
                    });

                    // Call optional callback
                    onProgress?.(jobProgress);

                    // Check for cancellation (also throw for immediate feedback)
                    if (cancelled) {
                        throw new Error('Pipeline execution cancelled');
                    }
                }
            });

            // Complete the process group
            if (processManager && groupProcessId) {
                const summary = formatExecutionSummary(result);
                processManager.completeProcessGroup(groupProcessId, {
                    result: summary,
                    structuredResult: JSON.stringify(result),
                    executionStats: {
                        totalItems: result.executionStats.totalItems,
                        successfulMaps: result.executionStats.successfulMaps,
                        failedMaps: result.executionStats.failedMaps,
                        mapPhaseTimeMs: result.executionStats.mapPhaseTimeMs,
                        reducePhaseTimeMs: result.executionStats.reducePhaseTimeMs,
                        maxConcurrency: result.executionStats.maxConcurrency
                    }
                });
            }

            return {
                success: result.success,
                result,
                processId: groupProcessId,
                pipelineConfig: config,
                pipelineDirectory: pipeline.packagePath
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Mark process as failed
            if (processManager && groupProcessId) {
                processManager.failProcess(groupProcessId, errorMsg);
            }

            return {
                success: false,
                error: errorMsg,
                processId: groupProcessId,
                pipelineConfig: config,
                pipelineDirectory: pipeline.packagePath
            };
        }
    });
}

/**
 * Create a process tracker that bridges to the AI process manager.
 * 
 * The key insight here is that we already have a parent pipeline-execution group,
 * so we don't need to create another nested group when the executor asks for one.
 * Instead, we return the parent group ID, which ensures child processes are
 * registered directly under the pipeline-execution process visible in the tree view.
 */
function createProcessTracker(
    processManager: IAIProcessManager,
    parentGroupId: string
): ProcessTracker {
    return {
        registerProcess(description: string, parentId?: string): string {
            // If parentId is provided and it's the same as parentGroupId, use parentGroupId
            // Otherwise use the provided parentId or fall back to parentGroupId
            const effectiveParentId = parentId === parentGroupId ? parentGroupId : (parentId || parentGroupId);
            
            return processManager.registerTypedProcess(
                description,
                {
                    type: 'pipeline-item',
                    idPrefix: 'pipeline-item',
                    parentProcessId: effectiveParentId,
                    metadata: { type: 'pipeline-item', description }
                }
            );
        },

        updateProcess(
            processId: string,
            status: 'running' | 'completed' | 'failed',
            response?: string,
            error?: string,
            structuredResult?: string
        ): void {
            if (status === 'completed') {
                processManager.completeProcess(processId, response);
                if (structuredResult) {
                    processManager.updateProcessStructuredResult(processId, structuredResult);
                }
            } else if (status === 'failed') {
                processManager.failProcess(processId, error || 'Unknown error');
            }
            // 'running' status is set on registration
        },

        attachSessionMetadata(processId: string, metadata: SessionMetadata): void {
            // Attach session metadata for session resume functionality
            if (metadata.sessionId) {
                processManager.attachSdkSessionId(processId, metadata.sessionId);
            }
            if (metadata.backend) {
                processManager.attachSessionMetadata(processId, metadata.backend, metadata.workingDirectory);
            }
        },

        registerGroup(_description: string): string {
            // Don't create a nested group - return the parent group ID so that
            // child processes are registered directly under the pipeline-execution process.
            // This ensures they appear in the tree view when the user expands the pipeline.
            return parentGroupId;
        },

        completeGroup(
            groupId: string,
            _summary: string,
            _stats: { totalItems: number; successfulMaps: number; failedMaps: number }
        ): void {
            // If the groupId is the parentGroupId, don't complete it here
            // because it will be completed by the main executor after the full pipeline finishes.
            // This prevents early completion of the parent process.
            if (groupId === parentGroupId) {
                return;
            }
            // For any other group (shouldn't happen with current implementation),
            // complete it normally
            processManager.completeProcessGroup(groupId, {
                result: _summary,
                structuredResult: JSON.stringify(_stats),
                executionStats: {
                    totalItems: _stats.totalItems,
                    successfulMaps: _stats.successfulMaps,
                    failedMaps: _stats.failedMaps,
                    mapPhaseTimeMs: 0,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 5
                }
            });
        }
    };
}

/**
 * Get a user-friendly progress message
 */
function getProgressMessage(progress: JobProgress): string {
    switch (progress.phase) {
        case 'splitting':
            return 'Preparing items...';
        case 'mapping':
            return `Processing ${progress.completedItems}/${progress.totalItems} items (${progress.percentage}%)`;
        case 'reducing':
            return 'Aggregating results...';
        case 'complete':
            return 'Complete!';
        default:
            return progress.message || 'Processing...';
    }
}

/**
 * Calculate progress increment for VSCode progress bar
 */
function calculateIncrement(progress: JobProgress): number | undefined {
    if (progress.totalItems === 0) {
        return undefined;
    }

    // Only report increments during mapping phase
    if (progress.phase === 'mapping' && progress.completedItems > 0) {
        // Return increment per item (as percentage of 100)
        return (100 / progress.totalItems);
    }

    return undefined;
}

/**
 * Format execution result summary for display
 */
function formatExecutionSummary(result: PipelineExecutionResult): string {
    const stats = result.executionStats;
    const lines: string[] = [];

    lines.push('# Pipeline Execution Results\n');

    // Summary stats
    lines.push('## Summary\n');
    lines.push(`- **Total Items**: ${stats.totalItems}`);
    lines.push(`- **Successful**: ${stats.successfulMaps}`);
    lines.push(`- **Failed**: ${stats.failedMaps}`);
    lines.push(`- **Total Time**: ${formatDuration(result.totalTimeMs)}`);
    lines.push('');

    // Output section
    if (result.output) {
        lines.push('## Output\n');
        if (result.output.formattedOutput) {
            lines.push(result.output.formattedOutput);
        } else {
            lines.push('```json');
            lines.push(JSON.stringify(result.output, null, 2));
            lines.push('```');
        }
    }

    // Errors section
    if (stats.failedMaps > 0 && result.mapResults) {
        lines.push('\n## Errors\n');
        const failedResults = result.mapResults.filter(r => !r.success);
        for (const failed of failedResults.slice(0, 10)) {
            lines.push(`- **${failed.workItemId}**: ${failed.error || 'Unknown error'}`);
        }
        if (failedResults.length > 10) {
            lines.push(`\n... and ${failedResults.length - 10} more errors`);
        }
    }

    return lines.join('\n');
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * URI scheme for pipeline results
 */
export const PIPELINE_RESULTS_SCHEME = 'pipeline-results';

import {
    createSchemeUri,
    MemoryContentStrategy,
    ReadOnlyDocumentProvider,
} from '../../shared';

/**
 * Document content provider for pipeline results.
 * Provides readonly virtual documents that don't require saving.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with MemoryContentStrategy.
 */
export class PipelineResultsDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private static instance: PipelineResultsDocumentProvider | undefined;
    private readonly provider: ReadOnlyDocumentProvider;
    private readonly strategy: MemoryContentStrategy;

    readonly onDidChange: vscode.Event<vscode.Uri>;

    private constructor() {
        this.provider = new ReadOnlyDocumentProvider();
        this.strategy = new MemoryContentStrategy({
            defaultContent: '# No results available',
        });
        this.provider.registerScheme(PIPELINE_RESULTS_SCHEME, this.strategy);
        this.onDidChange = this.provider.onDidChange;
    }

    static getInstance(): PipelineResultsDocumentProvider {
        if (!PipelineResultsDocumentProvider.instance) {
            PipelineResultsDocumentProvider.instance =
                new PipelineResultsDocumentProvider();
        }
        return PipelineResultsDocumentProvider.instance;
    }

    /**
     * Store results and return a URI for viewing
     */
    storeResults(pipelineName: string, content: string): vscode.Uri {
        const timestamp = Date.now();
        const safeName = pipelineName.replace(/[^a-zA-Z0-9-_]/g, '-');
        const uri = createSchemeUri(
            PIPELINE_RESULTS_SCHEME,
            `${safeName}-${timestamp}.md`
        );
        this.strategy.store(uri, content);
        return uri;
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        return this.provider.provideTextDocumentContent(uri);
    }

    dispose(): void {
        this.provider.dispose();
        PipelineResultsDocumentProvider.instance = undefined;
    }
}

/**
 * Register the pipeline results document provider
 * Call this during extension activation
 */
export function registerPipelineResultsProvider(
    context: vscode.ExtensionContext
): vscode.Disposable {
    const provider = PipelineResultsDocumentProvider.getInstance();
    const disposable = vscode.workspace.registerTextDocumentContentProvider(
        PIPELINE_RESULTS_SCHEME,
        provider
    );

    // Ensure cleanup on context disposal
    context.subscriptions.push(provider);

    return disposable;
}

/**
 * Show pipeline results in a readonly text editor
 */
export async function showPipelineResults(
    result: PipelineExecutionResult,
    pipelineName: string
): Promise<void> {
    const content = formatExecutionSummary(result);

    // Use the document provider to create a readonly virtual document
    const provider = PipelineResultsDocumentProvider.getInstance();
    const uri = provider.storeResults(pipelineName, content);

    // Open the document - it will be readonly since it uses our custom scheme
    const doc = await vscode.workspace.openTextDocument(uri);

    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

/**
 * Copy pipeline results to clipboard
 */
export async function copyPipelineResults(
    result: PipelineExecutionResult
): Promise<void> {
    const content = formatExecutionSummary(result);
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Pipeline results copied to clipboard');
}

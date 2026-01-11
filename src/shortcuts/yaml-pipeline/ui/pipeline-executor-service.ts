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
import { AIProcessManager, invokeCopilotCLI, getAIModelSetting } from '../../ai-service';
import {
    executePipeline,
    parsePipelineYAML,
    PipelineExecutionResult,
    PipelineConfig,
    AIInvoker,
    AIInvokerResult,
    JobProgress,
    ProcessTracker
} from '../index';
import { PipelineInfo } from './types';

/**
 * Options for pipeline execution
 */
export interface PipelineExecutionOptions {
    /** The pipeline info from the tree view */
    pipeline: PipelineInfo;
    /** Workspace root for resolving paths */
    workspaceRoot: string;
    /** AI Process manager for tracking */
    processManager?: AIProcessManager;
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

    // Create AI invoker that uses Copilot CLI
    const aiInvoker: AIInvoker = async (prompt: string): Promise<AIInvokerResult> => {
        const result = await invokeCopilotCLI(
            prompt,
            workspaceRoot,
            undefined, // Don't track individual prompts - the group tracks them
            undefined,
            config.map.model || getAIModelSetting()
        );

        return {
            success: result.success,
            response: result.response,
            error: result.error
        };
    };

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
                onProgress: (jobProgress) => {
                    // Update VSCode progress
                    const message = getProgressMessage(jobProgress);
                    progress.report({
                        message,
                        increment: calculateIncrement(jobProgress)
                    });

                    // Call optional callback
                    onProgress?.(jobProgress);

                    // Check for cancellation
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
                    structuredResult: JSON.stringify(result.output || {}),
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
                processId: groupProcessId
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
                processId: groupProcessId
            };
        }
    });
}

/**
 * Create a process tracker that bridges to the AI process manager
 */
function createProcessTracker(
    processManager: AIProcessManager,
    parentGroupId: string
): ProcessTracker {
    return {
        registerProcess(description: string, parentId?: string): string {
            return processManager.registerTypedProcess(
                description,
                {
                    type: 'pipeline-item',
                    idPrefix: 'pipeline-item',
                    parentProcessId: parentId || parentGroupId,
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

        registerGroup(description: string): string {
            return processManager.registerProcessGroup(description, {
                type: 'pipeline-batch',
                idPrefix: 'pipeline-batch',
                metadata: { description }
            });
        },

        completeGroup(
            groupId: string,
            summary: string,
            stats: { totalItems: number; successfulMaps: number; failedMaps: number }
        ): void {
            processManager.completeProcessGroup(groupId, {
                result: summary,
                structuredResult: JSON.stringify(stats),
                executionStats: {
                    totalItems: stats.totalItems,
                    successfulMaps: stats.successfulMaps,
                    failedMaps: stats.failedMaps,
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

/**
 * Document content provider for pipeline results
 * Provides readonly virtual documents that don't require saving
 */
export class PipelineResultsDocumentProvider implements vscode.TextDocumentContentProvider {
    private static instance: PipelineResultsDocumentProvider | undefined;
    private results: Map<string, string> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    static getInstance(): PipelineResultsDocumentProvider {
        if (!PipelineResultsDocumentProvider.instance) {
            PipelineResultsDocumentProvider.instance = new PipelineResultsDocumentProvider();
        }
        return PipelineResultsDocumentProvider.instance;
    }

    /**
     * Store results and return a URI for viewing
     */
    storeResults(pipelineName: string, content: string): vscode.Uri {
        const timestamp = Date.now();
        const safeName = pipelineName.replace(/[^a-zA-Z0-9-_]/g, '-');
        const uri = vscode.Uri.parse(`${PIPELINE_RESULTS_SCHEME}:${safeName}-${timestamp}.md`);
        this.results.set(uri.toString(), content);
        return uri;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.results.get(uri.toString()) || '# No results available';
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.results.clear();
    }
}

/**
 * Register the pipeline results document provider
 * Call this during extension activation
 */
export function registerPipelineResultsProvider(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = PipelineResultsDocumentProvider.getInstance();
    return vscode.workspace.registerTextDocumentContentProvider(PIPELINE_RESULTS_SCHEME, provider);
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

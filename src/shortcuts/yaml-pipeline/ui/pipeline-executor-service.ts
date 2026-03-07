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
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import {
    IAIProcessManager,
    getAIModelSetting,
    createAIInvoker
} from '../../ai-service';
import {
    compileToWorkflow,
    executeWorkflow,
    flattenWorkflowResult,
    WorkflowConfig,
    FlatWorkflowResult,
    WorkflowProgressEvent,
    PipelineConfig,
    AIInvoker,
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
    onProgress?: (event: WorkflowProgressEvent) => void;
}

/**
 * Result from pipeline execution in VSCode context
 */
export interface VSCodePipelineResult {
    /** Whether execution was successful */
    success: boolean;
    /** The flattened execution result if successful */
    result?: FlatWorkflowResult;
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

    // Read and compile the pipeline YAML
    let workflowConfig: WorkflowConfig;
    let rawConfig: PipelineConfig;
    try {
        const yamlContent = fs.readFileSync(pipeline.filePath, 'utf8');
        workflowConfig = compileToWorkflow(yamlContent);
        rawConfig = yaml.load(yamlContent) as PipelineConfig;
    } catch (error) {
        const errorMsg = `Failed to parse workflow: ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, error: errorMsg };
    }

    // Register a process group for tracking
    let groupProcessId: string | undefined;
    if (processManager) {
        groupProcessId = processManager.registerProcessGroup(
            `Workflow: ${workflowConfig.name}`,
            {
                type: 'pipeline-execution',
                idPrefix: 'pipeline',
                metadata: {
                    pipelineName: workflowConfig.name,
                    pipelinePath: pipeline.relativePath,
                    packageName: pipeline.packageName
                }
            }
        );
    }

    // Resolve working directory: config.workingDirectory takes precedence over workspaceRoot
    const effectiveWorkingDirectory = resolveWorkingDirectory(rawConfig, pipeline.packagePath, workspaceRoot);

    // Create AI invoker using the unified factory
    const defaultModel = getAIModelSetting();

    const aiInvoker: AIInvoker = createAIInvoker({
        workingDirectory: effectiveWorkingDirectory,
        model: defaultModel,
        featureName: 'Workflow'
    });

    // Create process tracker if we have a process manager
    let tracker: ProcessTracker | undefined;
    if (processManager && groupProcessId) {
        tracker = createProcessTracker(processManager, groupProcessId);
    }

    // Execute with progress reporting
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing workflow: ${workflowConfig.name}`,
        cancellable: true
    }, async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
            controller.abort();
            if (processManager && groupProcessId) {
                processManager.cancelProcess(groupProcessId);
            }
        });

        try {
            const workflowResult = await executeWorkflow(workflowConfig, {
                aiInvoker,
                workflowDirectory: pipeline.packagePath,
                workspaceRoot,
                workingDirectory: effectiveWorkingDirectory,
                model: defaultModel,
                processTracker: tracker,
                signal: controller.signal,
                onProgress: (event: WorkflowProgressEvent) => {
                    // Update VSCode progress
                    const message = getProgressMessage(event);
                    progress.report({
                        message,
                        increment: calculateIncrement(event)
                    });

                    // Call optional callback
                    onProgress?.(event);
                }
            });

            const result = flattenWorkflowResult(workflowResult, workflowConfig);

            // Complete the process group
            if (processManager && groupProcessId) {
                const summary = formatExecutionSummary(result);
                // Store the full result for the enhanced viewer
                processManager.completeProcessGroup(groupProcessId, {
                    result: summary,
                    structuredResult: JSON.stringify(result),
                    executionStats: {
                        totalItems: result.stats.totalItems,
                        successfulMaps: result.stats.successfulMaps,
                        failedMaps: result.stats.failedMaps,
                        mapPhaseTimeMs: result.stats.mapDurationMs ?? 0,
                        reducePhaseTimeMs: result.stats.reduceDurationMs ?? 0,
                        maxConcurrency: workflowConfig.settings?.concurrency ?? 5
                    }
                });
            }

            return {
                success: result.success,
                result,
                processId: groupProcessId,
                pipelineConfig: rawConfig,
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
                pipelineConfig: rawConfig,
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

    // Read and compile the pipeline YAML
    let workflowConfig: WorkflowConfig;
    let rawConfig: PipelineConfig;
    try {
        const yamlContent = fs.readFileSync(pipeline.filePath, 'utf8');
        workflowConfig = compileToWorkflow(yamlContent);
        rawConfig = yaml.load(yamlContent) as PipelineConfig;

        if (!workflowConfig.name) {
            return { success: false, error: 'Invalid workflow configuration: missing name' };
        }
    } catch (error) {
        const errorMsg = `Failed to parse workflow: ${error instanceof Error ? error.message : String(error)}`;
        return { success: false, error: errorMsg };
    }

    // Inject the pre-approved items into the workflow config's load node
    workflowConfig = injectInlineItems(workflowConfig, items);

    // Register a process group for tracking
    let groupProcessId: string | undefined;
    if (processManager) {
        groupProcessId = processManager.registerProcessGroup(
            `Workflow: ${workflowConfig.name}`,
            {
                type: 'pipeline-execution',
                idPrefix: 'pipeline',
                metadata: {
                    pipelineName: workflowConfig.name,
                    pipelinePath: pipeline.relativePath,
                    packageName: pipeline.packageName,
                    itemCount: items.length
                }
            }
        );
    }

    // Resolve working directory: config.workingDirectory takes precedence over workspaceRoot
    const effectiveWorkingDirectory = resolveWorkingDirectory(rawConfig, pipeline.packagePath, workspaceRoot);

    // Create AI invoker using the unified factory
    const defaultModel = getAIModelSetting();

    const aiInvoker: AIInvoker = createAIInvoker({
        workingDirectory: effectiveWorkingDirectory,
        model: defaultModel,
        featureName: 'Workflow'
    });

    // Create process tracker if we have a process manager
    let tracker: ProcessTracker | undefined;
    if (processManager && groupProcessId) {
        tracker = createProcessTracker(processManager, groupProcessId);
    }

    // Execute with progress reporting
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Executing workflow: ${workflowConfig.name}`,
        cancellable: true
    }, async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
            controller.abort();
            if (processManager && groupProcessId) {
                processManager.cancelProcess(groupProcessId);
            }
        });

        try {
            const workflowResult = await executeWorkflow(workflowConfig, {
                aiInvoker,
                workflowDirectory: pipeline.packagePath,
                workspaceRoot,
                workingDirectory: effectiveWorkingDirectory,
                model: defaultModel,
                processTracker: tracker,
                signal: controller.signal,
                onProgress: (event: WorkflowProgressEvent) => {
                    // Update VSCode progress
                    const message = getProgressMessage(event);
                    progress.report({
                        message,
                        increment: calculateIncrement(event)
                    });

                    // Call optional callback
                    onProgress?.(event);
                }
            });

            const result = flattenWorkflowResult(workflowResult, workflowConfig);

            // Complete the process group
            if (processManager && groupProcessId) {
                const summary = formatExecutionSummary(result);
                processManager.completeProcessGroup(groupProcessId, {
                    result: summary,
                    structuredResult: JSON.stringify(result),
                    executionStats: {
                        totalItems: result.stats.totalItems,
                        successfulMaps: result.stats.successfulMaps,
                        failedMaps: result.stats.failedMaps,
                        mapPhaseTimeMs: result.stats.mapDurationMs ?? 0,
                        reducePhaseTimeMs: result.stats.reduceDurationMs ?? 0,
                        maxConcurrency: workflowConfig.settings?.concurrency ?? 5
                    }
                });
            }

            return {
                success: result.success,
                result,
                processId: groupProcessId,
                pipelineConfig: rawConfig,
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
                pipelineConfig: rawConfig,
                pipelineDirectory: pipeline.packagePath
            };
        }
    });
}

/**
 * Clone a WorkflowConfig and replace the first load node's source with inline items.
 */
function injectInlineItems(config: WorkflowConfig, items: PromptItem[]): WorkflowConfig {
    const cloned: WorkflowConfig = JSON.parse(JSON.stringify(config));
    for (const node of Object.values(cloned.nodes)) {
        if (node.type === 'load') {
            (node as any).source = { type: 'inline', items };
            break;
        }
    }
    return cloned;
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
function getProgressMessage(event: WorkflowProgressEvent): string {
    if (event.itemProgress) {
        const { completed, total } = event.itemProgress;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        return `Processing ${completed}/${total} items (${pct}%)`;
    }
    switch (event.phase) {
        case 'running':
            return `Processing node: ${event.nodeId}...`;
        case 'completed':
            return 'Complete!';
        case 'failed':
            return `Failed: ${event.error || 'Unknown error'}`;
        default:
            return 'Processing...';
    }
}

/**
 * Calculate progress increment for VSCode progress bar
 */
function calculateIncrement(event: WorkflowProgressEvent): number | undefined {
    if (event.itemProgress && event.itemProgress.total > 0) {
        return (100 / event.itemProgress.total);
    }
    return undefined;
}

/**
 * Format execution result summary for display
 */
function formatExecutionSummary(result: FlatWorkflowResult): string {
    const stats = result.stats;
    const lines: string[] = [];

    lines.push('# Workflow Execution Results\n');

    // Summary stats
    lines.push('## Summary\n');
    lines.push(`- **Total Items**: ${stats.totalItems}`);
    lines.push(`- **Successful**: ${stats.successfulMaps}`);
    lines.push(`- **Failed**: ${stats.failedMaps}`);
    lines.push(`- **Total Time**: ${formatDuration(stats.totalDurationMs)}`);
    lines.push('');

    // Output section
    if (result.formattedOutput) {
        lines.push('## Output\n');
        lines.push(result.formattedOutput);
    } else if (result.leafOutput.length > 0) {
        lines.push('## Output\n');
        lines.push('```json');
        lines.push(JSON.stringify(result.leafOutput, null, 2));
        lines.push('```');
    }

    // Errors section
    if (stats.failedMaps > 0 && result.items) {
        lines.push('\n## Errors\n');
        const failedResults = result.items.filter(r => !r.success);
        for (const failed of failedResults.slice(0, 10)) {
            lines.push(`- **Item ${failed.index}**: ${failed.error || 'Unknown error'}`);
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
    result: FlatWorkflowResult,
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
    result: FlatWorkflowResult
): Promise<void> {
    const content = formatExecutionSummary(result);
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Workflow results copied to clipboard');
}

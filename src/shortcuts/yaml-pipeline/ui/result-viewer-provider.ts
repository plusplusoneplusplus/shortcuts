/**
 * Pipeline Result Viewer Provider
 *
 * WebviewPanel provider for displaying pipeline execution results.
 * Provides an enhanced view with individual result nodes that can be clicked
 * to display full details. Leverages shared preview components.
 *
 * Uses shared webview utilities:
 * - WebviewSetupHelper for webview configuration
 * - WebviewMessageRouter for type-safe message handling
 *
 * Supports retry functionality for failed map items.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerMessage,
    ResultViewerExtensionMessage,
    RetryState,
    mapResultToNode
} from './result-viewer-types';
import { getResultViewerContent } from './result-viewer-content';
import {
    PipelineExecutionResult,
    MapResult,
    AIInvoker,
    ExecutionStats,
    PromptMapResult,
    PromptMapOutput,
    PromptItem,
    PipelineConfig,
    ConcurrencyLimiter
} from '@plusplusoneplusplus/pipeline-core';
import { getWorkspaceRoot } from '../../shared/workspace-utils';
import { WebviewSetupHelper, WebviewMessageRouter } from '../../shared/webview/extension-webview-utils';
import { createAIInvoker, getAIModelSetting } from '../../ai-service';
import { DEFAULT_AI_TIMEOUT_MS } from '../../shared/ai-timeouts';

/**
 * URI scheme for exporting results
 */
export const PIPELINE_RESULTS_EXPORT_SCHEME = 'pipeline-results-export';

/**
 * Manages Pipeline Result Viewer webview panels
 * 
 * Uses shared webview utilities for consistent setup and message handling.
 * Supports retry functionality for failed map items.
 */
export class PipelineResultViewerProvider {
    public static readonly viewType = 'pipelineResultViewer';

    private static currentPanel: vscode.WebviewPanel | undefined;
    private static currentData: PipelineResultViewData | undefined;
    private static currentRouter: WebviewMessageRouter<ResultViewerMessage> | undefined;
    private static retryState: RetryState = {
        isRetrying: false,
        completedCount: 0,
        totalCount: 0,
        retryingItemIds: [],
        cancelled: false
    };
    
    /** Shared webview setup helper */
    private readonly setupHelper: WebviewSetupHelper;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.setupHelper = new WebviewSetupHelper(extensionUri);
    }

    /**
     * Show pipeline results in a webview panel
     *
     * @param result Pipeline execution result
     * @param pipelineName Name of the pipeline
     * @param packageName Package name of the pipeline
     * @param viewColumn View column to show the panel in
     * @param pipelineConfig Optional pipeline configuration for retry support
     * @param pipelineDirectory Optional pipeline directory for retry support
     */
    public async showResults(
        result: PipelineExecutionResult,
        pipelineName: string,
        packageName: string,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
        pipelineConfig?: PipelineConfig,
        pipelineDirectory?: string
    ): Promise<void> {
        // Reset retry state
        PipelineResultViewerProvider.retryState = {
            isRetrying: false,
            completedCount: 0,
            totalCount: 0,
            retryingItemIds: [],
            cancelled: false
        };

        // Convert execution result to view data
        const viewData = this.convertToViewData(result, pipelineName, packageName, pipelineConfig, pipelineDirectory);
        PipelineResultViewerProvider.currentData = viewData;

        // Reuse existing panel or create a new one
        if (PipelineResultViewerProvider.currentPanel) {
            PipelineResultViewerProvider.currentPanel.reveal(viewColumn);
            this.updatePanelContent(PipelineResultViewerProvider.currentPanel, viewData);
            // Update message router handlers with new data
            this.setupMessageRouter(PipelineResultViewerProvider.currentPanel, viewData);
        } else {
            // Use shared setup helper for consistent webview options
            const panel = vscode.window.createWebviewPanel(
                PipelineResultViewerProvider.viewType,
                `Results: ${pipelineName}`,
                viewColumn,
                this.setupHelper.getWebviewPanelOptions()
            );

            PipelineResultViewerProvider.currentPanel = panel;

            // Update content
            this.updatePanelContent(panel, viewData);

            // Setup type-safe message router
            this.setupMessageRouter(panel, viewData);

            // Clean up on close
            panel.onDidDispose(() => {
                PipelineResultViewerProvider.currentPanel = undefined;
                PipelineResultViewerProvider.currentData = undefined;
                PipelineResultViewerProvider.currentRouter?.dispose();
                PipelineResultViewerProvider.currentRouter = undefined;
            });
        }
    }

    /**
     * Setup message router with type-safe handlers
     */
    private setupMessageRouter(panel: vscode.WebviewPanel, data: PipelineResultViewData): void {
        // Dispose previous router if exists
        PipelineResultViewerProvider.currentRouter?.dispose();

        // Create new router with type-safe handlers
        const router = new WebviewMessageRouter<ResultViewerMessage>({
            logUnhandledMessages: false // Don't log client-side only messages
        });

        // Register handlers
        // Note: ResultViewerMessage uses a single interface with optional payload,
        // not discriminated unions, so we access payload directly
        router
            .on('exportResults', async (message: ResultViewerMessage) => {
                await this.handleExport(data, message.payload?.exportFormat || 'json');
            })
            .on('copyResults', async () => {
                await this.handleCopy(data);
            })
            .on('ready', () => {
                // Webview is ready - handled client-side
            })
            .on('nodeClick', () => {
                // Node selection - handled client-side
            })
            .on('filterResults', () => {
                // Filtering - handled client-side
            })
            .on('retryFailed', async () => {
                await this.handleRetryFailed(panel);
            })
            .on('retryItem', async (message: ResultViewerMessage) => {
                const itemId = message.payload?.nodeId;
                if (itemId) {
                    await this.handleRetryItem(panel, itemId);
                }
            })
            .on('retrySelected', async (message: ResultViewerMessage) => {
                const itemIds = message.payload?.itemIds;
                if (itemIds && itemIds.length > 0) {
                    await this.handleRetrySelected(panel, itemIds);
                }
            })
            .on('cancelRetry', () => {
                this.handleCancelRetry(panel);
            });

        // Connect router to panel
        panel.webview.onDidReceiveMessage(
            (message: ResultViewerMessage) => router.route(message)
        );

        PipelineResultViewerProvider.currentRouter = router;
    }

    /**
     * Update panel content with new data
     */
    private updatePanelContent(
        panel: vscode.WebviewPanel,
        data: PipelineResultViewData
    ): void {
        panel.title = `Results: ${data.pipelineName}`;
        panel.webview.html = getResultViewerContent(
            panel.webview,
            this.extensionUri,
            data
        );
    }

    /**
     * Convert pipeline execution result to view data
     */
    private convertToViewData(
        result: PipelineExecutionResult,
        pipelineName: string,
        packageName: string,
        pipelineConfig?: PipelineConfig,
        pipelineDirectory?: string
    ): PipelineResultViewData {
        // Convert map results to item result nodes
        const itemResults: PipelineItemResultNode[] = [];

        if (result.mapResults) {
            result.mapResults.forEach((mapResult: MapResult<PromptMapResult>, index: number) => {
                if (mapResult.output) {
                    itemResults.push(
                        mapResultToNode(mapResult.output, index, mapResult.executionTimeMs)
                    );
                } else {
                    // Handle case where output is missing (e.g., executor timeout)
                    // Note: rawResponse is not available in this case because the AI call
                    // never completed (timeout occurred before mapper returned)
                    itemResults.push({
                        id: mapResult.workItemId || `item-${index}`,
                        index,
                        input: {},
                        output: {},
                        success: false,
                        error: mapResult.error || 'Unknown error',
                        executionTimeMs: mapResult.executionTimeMs,
                        rawResponse: undefined
                    });
                }
            });
        }

        return {
            pipelineName,
            packageName,
            success: result.success,
            totalTimeMs: result.totalTimeMs,
            executionStats: result.executionStats,
            reduceStats: result.reduceStats,
            output: result.output as PromptMapOutput | undefined,
            itemResults,
            error: result.error,
            completedAt: new Date(),
            pipelineConfig,
            pipelineDirectory
        };
    }

    /**
     * Handle export command
     */
    private async handleExport(
        data: PipelineResultViewData,
        format: 'json' | 'csv' | 'markdown'
    ): Promise<void> {
        let content: string;
        let fileExtension: string;

        switch (format) {
            case 'csv':
                content = this.formatAsCSV(data);
                fileExtension = 'csv';
                break;
            case 'markdown':
                content = this.formatAsMarkdown(data);
                fileExtension = 'md';
                break;
            default:
                content = JSON.stringify(this.formatAsJSON(data), null, 2);
                fileExtension = 'json';
        }

        // Ask user where to save
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const defaultUri = vscode.Uri.file(
            path.join(
                getWorkspaceRoot() || '',
                `${data.pipelineName}-results-${timestamp}.${fileExtension}`
            )
        );

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: {
                [format.toUpperCase()]: [fileExtension]
            }
        });

        if (saveUri) {
            await vscode.workspace.fs.writeFile(
                saveUri,
                Buffer.from(content, 'utf8')
            );
            vscode.window.showInformationMessage(`Results exported to ${saveUri.fsPath}`);
        }
    }

    /**
     * Handle copy command
     */
    private async handleCopy(data: PipelineResultViewData): Promise<void> {
        const content = this.formatAsMarkdown(data);
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage('Results copied to clipboard');
    }

    /**
     * Handle retry all failed items
     */
    private async handleRetryFailed(panel: vscode.WebviewPanel): Promise<void> {
        const data = PipelineResultViewerProvider.currentData;
        if (!data) {
            vscode.window.showErrorMessage('No result data available for retry');
            return;
        }

        // Get all failed item IDs
        const failedItemIds = data.itemResults
            .filter(r => !r.success)
            .map(r => r.id);

        if (failedItemIds.length === 0) {
            vscode.window.showInformationMessage('No failed items to retry');
            return;
        }

        await this.executeRetry(panel, failedItemIds);
    }

    /**
     * Handle retry single item
     */
    private async handleRetryItem(panel: vscode.WebviewPanel, itemId: string): Promise<void> {
        await this.executeRetry(panel, [itemId]);
    }

    /**
     * Handle retry selected items
     */
    private async handleRetrySelected(panel: vscode.WebviewPanel, itemIds: string[]): Promise<void> {
        await this.executeRetry(panel, itemIds);
    }

    /**
     * Handle cancel retry
     */
    private handleCancelRetry(panel: vscode.WebviewPanel): void {
        PipelineResultViewerProvider.retryState.cancelled = true;
        
        // Notify webview
        this.sendToWebview(panel, {
            type: 'retryCancelled',
            payload: {
                completed: PipelineResultViewerProvider.retryState.completedCount,
                total: PipelineResultViewerProvider.retryState.totalCount
            }
        });
    }

    /**
     * Execute retry for specified items
     */
    private async executeRetry(panel: vscode.WebviewPanel, itemIds: string[]): Promise<void> {
        const data = PipelineResultViewerProvider.currentData;
        if (!data) {
            vscode.window.showErrorMessage('No result data available for retry');
            return;
        }

        // Check if retry is already in progress
        if (PipelineResultViewerProvider.retryState.isRetrying) {
            vscode.window.showWarningMessage('Retry already in progress');
            return;
        }

        // Check if pipeline config is available
        if (!data.pipelineConfig) {
            vscode.window.showErrorMessage('Pipeline configuration not available. Cannot retry.');
            return;
        }

        // Get max retry attempts from settings
        const maxRetryAttempts = vscode.workspace.getConfiguration('workspaceShortcuts.pipeline')
            .get<number>('maxRetryAttempts', 2);

        // Filter items that can be retried (failed and under max retry count)
        const itemsToRetry = data.itemResults.filter(r => 
            itemIds.includes(r.id) && 
            !r.success && 
            (r.retryCount ?? 0) < maxRetryAttempts
        );

        if (itemsToRetry.length === 0) {
            vscode.window.showInformationMessage('No items available for retry (max attempts reached or all succeeded)');
            return;
        }

        // Initialize retry state
        PipelineResultViewerProvider.retryState = {
            isRetrying: true,
            completedCount: 0,
            totalCount: itemsToRetry.length,
            retryingItemIds: itemsToRetry.map(r => r.id),
            cancelled: false
        };

        // Notify webview that retry is starting
        this.sendToWebview(panel, {
            type: 'retryStarted',
            payload: {
                total: itemsToRetry.length,
                itemIds: itemsToRetry.map(r => r.id)
            }
        });

        // Create AI invoker
        const workspaceRoot = getWorkspaceRoot() || '';
        const defaultModel = getAIModelSetting();
        const aiInvoker: AIInvoker = createAIInvoker({
            usePool: true,
            workingDirectory: data.pipelineDirectory || workspaceRoot,
            model: data.pipelineConfig.map.model || defaultModel,
            featureName: 'Pipeline Retry'
        });

        // Get concurrency from pipeline config
        const parallelLimit = data.pipelineConfig.map.parallel ?? 5;
        const limiter = new ConcurrencyLimiter(parallelLimit);

        // Create retry tasks
        const retryTasks = itemsToRetry.map(item => {
            return async () => {
                // Check for cancellation
                if (PipelineResultViewerProvider.retryState.cancelled) {
                    return null;
                }

                try {
                    const result = await this.retryMapItem(
                        item,
                        data.pipelineConfig!,
                        aiInvoker
                    );

                    // Update the item in the data
                    const itemIndex = data.itemResults.findIndex(r => r.id === item.id);
                    if (itemIndex !== -1) {
                        data.itemResults[itemIndex] = result;
                    }

                    // Update retry state
                    PipelineResultViewerProvider.retryState.completedCount++;

                    // Notify webview of item result
                    this.sendToWebview(panel, {
                        type: 'itemRetryResult',
                        payload: {
                            itemId: item.id,
                            result,
                            completed: PipelineResultViewerProvider.retryState.completedCount,
                            total: PipelineResultViewerProvider.retryState.totalCount
                        }
                    });

                    // Send progress update
                    this.sendToWebview(panel, {
                        type: 'retryProgress',
                        payload: {
                            completed: PipelineResultViewerProvider.retryState.completedCount,
                            total: PipelineResultViewerProvider.retryState.totalCount
                        }
                    });

                    return result;
                } catch (error) {
                    // Update retry state even on error
                    PipelineResultViewerProvider.retryState.completedCount++;

                    // Create failed result
                    const failedResult: PipelineItemResultNode = {
                        ...item,
                        success: false,
                        error: `Retry failed: ${error instanceof Error ? error.message : String(error)}`,
                        retryCount: (item.retryCount ?? 0) + 1,
                        originalError: item.originalError || item.error,
                        retriedAt: new Date()
                    };

                    // Update the item in the data
                    const itemIndex = data.itemResults.findIndex(r => r.id === item.id);
                    if (itemIndex !== -1) {
                        data.itemResults[itemIndex] = failedResult;
                    }

                    // Notify webview
                    this.sendToWebview(panel, {
                        type: 'itemRetryResult',
                        payload: {
                            itemId: item.id,
                            result: failedResult,
                            completed: PipelineResultViewerProvider.retryState.completedCount,
                            total: PipelineResultViewerProvider.retryState.totalCount
                        }
                    });

                    return failedResult;
                }
            };
        });

        try {
            // Execute retries with concurrency limit
            await limiter.all(retryTasks, () => PipelineResultViewerProvider.retryState.cancelled);

            // Update execution stats
            const successfulMaps = data.itemResults.filter(r => r.success).length;
            const failedMaps = data.itemResults.filter(r => !r.success).length;
            data.executionStats = {
                ...data.executionStats,
                successfulMaps,
                failedMaps
            };
            data.success = failedMaps === 0;
            data.lastRetryAt = new Date();

            // Notify webview of completion
            this.sendToWebview(panel, {
                type: 'retryComplete',
                payload: {
                    stats: data.executionStats,
                    completed: PipelineResultViewerProvider.retryState.completedCount,
                    total: PipelineResultViewerProvider.retryState.totalCount
                }
            });

            // Show completion message
            const retrySuccessCount = itemsToRetry.filter(item => {
                const updated = data.itemResults.find(r => r.id === item.id);
                return updated?.success;
            }).length;

            if (PipelineResultViewerProvider.retryState.cancelled) {
                vscode.window.showWarningMessage(
                    `Retry cancelled - ${PipelineResultViewerProvider.retryState.completedCount} of ${itemsToRetry.length} items completed`
                );
            } else if (retrySuccessCount === itemsToRetry.length) {
                vscode.window.showInformationMessage(
                    `All ${itemsToRetry.length} items succeeded on retry`
                );
            } else {
                vscode.window.showInformationMessage(
                    `Retry complete - ${retrySuccessCount} of ${itemsToRetry.length} items succeeded`
                );
            }
        } catch (error) {
            // Notify webview of error
            this.sendToWebview(panel, {
                type: 'retryError',
                payload: {
                    error: error instanceof Error ? error.message : String(error)
                }
            });

            vscode.window.showErrorMessage(
                `Retry failed: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            // Reset retry state
            PipelineResultViewerProvider.retryState.isRetrying = false;
        }
    }

    /**
     * Retry a single map item
     */
    private async retryMapItem(
        item: PipelineItemResultNode,
        config: PipelineConfig,
        aiInvoker: AIInvoker
    ): Promise<PipelineItemResultNode> {
        const timeoutMs = config.map.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
        const outputFields = config.map.output || [];
        const isTextMode = outputFields.length === 0;

        // Build the prompt with template substitution
        // Note: For promptFile, the prompt should have been resolved before calling this function
        let prompt = config.map.prompt || '';
        for (const [key, value] of Object.entries(item.input)) {
            prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        // Add output format instruction for structured mode
        if (!isTextMode) {
            prompt = `${prompt}\n\nReturn JSON with these fields: ${outputFields.join(', ')}`;
        }

        // Resolve model template if needed
        let model = config.map.model;
        if (model) {
            for (const [key, value] of Object.entries(item.input)) {
                model = model.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
            }
        }

        const startTime = Date.now();

        // Execute with timeout
        const result = await Promise.race([
            aiInvoker(prompt, { model, timeoutMs }),
            new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);

        const executionTimeMs = Date.now() - startTime;

        if (result.success && result.response) {
            if (isTextMode) {
                // Text mode - return raw response
                return {
                    ...item,
                    output: {},
                    rawText: result.response,
                    success: true,
                    error: undefined,
                    rawResponse: result.response,
                    executionTimeMs,
                    retryCount: (item.retryCount ?? 0) + 1,
                    originalError: item.originalError || item.error,
                    retriedAt: new Date()
                };
            }

            // Structured mode - parse JSON
            try {
                const output = this.parseAIResponse(result.response, outputFields);
                return {
                    ...item,
                    output,
                    success: true,
                    error: undefined,
                    rawResponse: result.response,
                    executionTimeMs,
                    retryCount: (item.retryCount ?? 0) + 1,
                    originalError: item.originalError || item.error,
                    retriedAt: new Date()
                };
            } catch (parseError) {
                return {
                    ...item,
                    success: false,
                    error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                    rawResponse: result.response,
                    executionTimeMs,
                    retryCount: (item.retryCount ?? 0) + 1,
                    originalError: item.originalError || item.error,
                    retriedAt: new Date()
                };
            }
        }

        return {
            ...item,
            success: false,
            error: result.error || 'AI invocation failed',
            rawResponse: result.response,
            executionTimeMs,
            retryCount: (item.retryCount ?? 0) + 1,
            originalError: item.originalError || item.error,
            retriedAt: new Date()
        };
    }

    /**
     * Parse AI response to extract output fields
     */
    private parseAIResponse(response: string, outputFields: string[]): Record<string, unknown> {
        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const output: Record<string, unknown> = {};

        for (const field of outputFields) {
            output[field] = parsed[field] ?? null;
        }

        return output;
    }

    /**
     * Send message to webview
     */
    private sendToWebview(panel: vscode.WebviewPanel, message: ResultViewerExtensionMessage): void {
        panel.webview.postMessage(message);
    }

    /**
     * Format data as JSON for export
     */
    private formatAsJSON(data: PipelineResultViewData): object {
        return {
            pipelineName: data.pipelineName,
            packageName: data.packageName,
            success: data.success,
            totalTimeMs: data.totalTimeMs,
            completedAt: data.completedAt.toISOString(),
            executionStats: data.executionStats,
            results: data.itemResults.map(r => ({
                index: r.index,
                input: r.input,
                output: r.output,
                rawText: r.rawText,
                success: r.success,
                error: r.error
            }))
        };
    }

    /**
     * Format data as CSV for export
     */
    private formatAsCSV(data: PipelineResultViewData): string {
        if (data.itemResults.length === 0) {
            return '';
        }

        // Collect all input and output keys
        const inputKeys = new Set<string>();
        const outputKeys = new Set<string>();
        let hasRawText = false;

        for (const result of data.itemResults) {
            Object.keys(result.input).forEach(k => inputKeys.add(k));
            Object.keys(result.output).forEach(k => outputKeys.add(k));
            if (result.rawText) {
                hasRawText = true;
            }
        }

        const inputKeysList = Array.from(inputKeys);
        const outputKeysList = Array.from(outputKeys);

        // Build headers - include rawText column if any result has text mode output
        const headers = [
            'index',
            ...inputKeysList.map(k => `input_${k}`),
            ...outputKeysList.map(k => `output_${k}`),
            ...(hasRawText ? ['rawText'] : []),
            'success',
            'error'
        ];

        // Build rows
        const rows = data.itemResults.map(r => {
            const values = [
                String(r.index + 1),
                ...inputKeysList.map(k => escapeCSV(String(r.input[k] || ''))),
                ...outputKeysList.map(k => escapeCSV(formatValue(r.output[k]))),
                ...(hasRawText ? [escapeCSV(r.rawText || '')] : []),
                r.success ? 'true' : 'false',
                escapeCSV(r.error || '')
            ];
            return values.join(',');
        });

        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Format data as Markdown for export/copy
     */
    private formatAsMarkdown(data: PipelineResultViewData): string {
        const lines: string[] = [];

        lines.push(`# Pipeline Results: ${data.pipelineName}`);
        lines.push('');
        lines.push(`**Package:** ${data.packageName}`);
        lines.push(`**Status:** ${data.success ? '✅ Completed' : '❌ Failed'}`);
        lines.push(`**Duration:** ${formatDuration(data.totalTimeMs)}`);
        lines.push(`**Completed:** ${data.completedAt.toISOString()}`);
        lines.push('');

        // Summary
        lines.push('## Summary');
        lines.push('');
        lines.push(`- **Total Items:** ${data.executionStats.totalItems}`);
        lines.push(`- **Successful:** ${data.executionStats.successfulMaps}`);
        lines.push(`- **Failed:** ${data.executionStats.failedMaps}`);
        lines.push('');

        // Results
        lines.push('## Results');
        lines.push('');

        for (const result of data.itemResults) {
            lines.push(`### Item #${result.index + 1} ${result.success ? '✅' : '❌'}`);
            lines.push('');

            lines.push('**Input:**');
            for (const [key, value] of Object.entries(result.input)) {
                lines.push(`- ${key}: ${value}`);
            }
            lines.push('');

            if (result.success) {
                lines.push('**Output:**');
                const outputEntries = Object.entries(result.output);
                if (outputEntries.length > 0) {
                    // Structured mode - show key-value pairs
                    for (const [key, value] of outputEntries) {
                        lines.push(`- ${key}: ${formatValue(value)}`);
                    }
                } else if (result.rawText) {
                    // Text mode - show raw text response
                    lines.push(result.rawText);
                } else {
                    lines.push('(empty)');
                }
            } else {
                lines.push(`**Error:** ${result.error || 'Unknown error'}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Get the current view data (for testing)
     */
    public static getCurrentData(): PipelineResultViewData | undefined {
        return PipelineResultViewerProvider.currentData;
    }

    /**
     * Close the current panel (for testing)
     */
    public static closeCurrentPanel(): void {
        if (PipelineResultViewerProvider.currentPanel) {
            PipelineResultViewerProvider.currentPanel.dispose();
        }
    }
}

/**
 * Escape value for CSV
 */
function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Format value for display
 */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value);
    }
    return JSON.stringify(value);
}

/**
 * Format duration
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
 * Register the Pipeline Result Viewer commands
 * Call this during extension activation
 */
export function registerPipelineResultViewer(
    context: vscode.ExtensionContext
): {
    provider: PipelineResultViewerProvider;
    disposables: vscode.Disposable[];
} {
    const provider = new PipelineResultViewerProvider(context.extensionUri);
    const disposables: vscode.Disposable[] = [];

    // Command to show results (can be called from commands.ts after execution)
    disposables.push(
        vscode.commands.registerCommand(
            'pipelinesViewer.showResults',
            async (
                result: PipelineExecutionResult,
                pipelineName: string,
                packageName: string
            ) => {
                await provider.showResults(result, pipelineName, packageName);
            }
        )
    );

    return { provider, disposables };
}

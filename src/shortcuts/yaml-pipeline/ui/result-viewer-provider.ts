/**
 * Pipeline Result Viewer Provider
 *
 * WebviewPanel provider for displaying pipeline execution results.
 * Provides an enhanced view with individual result nodes that can be clicked
 * to display full details. Leverages shared preview components.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerMessage,
    mapResultToNode
} from './result-viewer-types';
import { getResultViewerContent } from './result-viewer-content';
import { PipelineExecutionResult } from '../executor';
import { MapResult } from '../../map-reduce/types';
import { PromptMapResult, PromptMapOutput } from '../../map-reduce/jobs/prompt-map-job';

/**
 * URI scheme for exporting results
 */
export const PIPELINE_RESULTS_EXPORT_SCHEME = 'pipeline-results-export';

/**
 * Manages Pipeline Result Viewer webview panels
 */
export class PipelineResultViewerProvider {
    public static readonly viewType = 'pipelineResultViewer';

    private static currentPanel: vscode.WebviewPanel | undefined;
    private static currentData: PipelineResultViewData | undefined;

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Show pipeline results in a webview panel
     *
     * @param result Pipeline execution result
     * @param pipelineName Name of the pipeline
     * @param packageName Package name of the pipeline
     * @param viewColumn View column to show the panel in
     */
    public async showResults(
        result: PipelineExecutionResult,
        pipelineName: string,
        packageName: string,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside
    ): Promise<void> {
        // Convert execution result to view data
        const viewData = this.convertToViewData(result, pipelineName, packageName);
        PipelineResultViewerProvider.currentData = viewData;

        // Reuse existing panel or create a new one
        if (PipelineResultViewerProvider.currentPanel) {
            PipelineResultViewerProvider.currentPanel.reveal(viewColumn);
            this.updatePanelContent(PipelineResultViewerProvider.currentPanel, viewData);
        } else {
            const panel = vscode.window.createWebviewPanel(
                PipelineResultViewerProvider.viewType,
                `Results: ${pipelineName}`,
                viewColumn,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.extensionUri, 'media'),
                        vscode.Uri.joinPath(this.extensionUri, 'dist')
                    ]
                }
            );

            PipelineResultViewerProvider.currentPanel = panel;

            // Update content
            this.updatePanelContent(panel, viewData);

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                (message: ResultViewerMessage) => this.handleMessage(message, viewData),
                undefined,
                []
            );

            // Clean up on close
            panel.onDidDispose(() => {
                PipelineResultViewerProvider.currentPanel = undefined;
                PipelineResultViewerProvider.currentData = undefined;
            });
        }
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
        packageName: string
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
            completedAt: new Date()
        };
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(
        message: ResultViewerMessage,
        data: PipelineResultViewData
    ): Promise<void> {
        switch (message.type) {
            case 'exportResults':
                await this.handleExport(
                    data,
                    message.payload?.exportFormat || 'json'
                );
                break;

            case 'copyResults':
                await this.handleCopy(data);
                break;

            case 'nodeClick':
            case 'filterResults':
            case 'ready':
                // Handled client-side or informational
                break;
        }
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
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
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

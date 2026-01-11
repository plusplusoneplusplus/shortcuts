/**
 * Pipeline Preview Editor Provider
 *
 * CustomTextEditorProvider for Pipeline YAML files.
 * Opens pipeline.yaml files in a read-only visual preview using Mermaid diagrams.
 * Similar to how Markdown Review Editor works.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { PipelineConfig, CSVParseResult, PromptItem } from '../types';
import { readCSVFile, resolveCSVPath, getCSVPreview } from '../csv-reader';
import { PipelineInfo, ValidationResult } from './types';
import { PipelineManager } from './pipeline-manager';
import { PipelineItem } from './pipeline-item';
import {
    getPreviewContent,
    PreviewMessage,
    PipelinePreviewData
} from './preview-content';

/**
 * Pipeline Preview Editor - Custom editor provider for pipeline.yaml files
 * Opens as a read-only visual preview in the main editor area
 */
export class PipelinePreviewEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'pipelinePreviewEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly pipelineManager: PipelineManager
    ) {}

    /**
     * Register the Pipeline Preview Editor provider
     */
    public static register(
        context: vscode.ExtensionContext,
        pipelineManager: PipelineManager
    ): vscode.Disposable {
        const provider = new PipelinePreviewEditorProvider(context, pipelineManager);

        const providerRegistration = vscode.window.registerCustomEditorProvider(
            PipelinePreviewEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                    enableFindWidget: true
                },
                supportsMultipleEditorsPerDocument: false
            }
        );

        return providerRegistration;
    }

    /**
     * Called when a custom editor is opened
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Get the pipeline package directory (parent of pipeline.yaml)
        const packagePath = path.dirname(document.uri.fsPath);
        const packageName = path.basename(packagePath);

        // Set the tab title
        const fileName = path.basename(document.uri.fsPath);
        webviewPanel.title = `[Preview] ${packageName}`;

        // Setup webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
                vscode.Uri.file(packagePath) // Allow access to pipeline package resources
            ]
        };

        // Initial render
        await this.updateWebview(webviewPanel.webview, document, packagePath);

        // Handle document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(webviewPanel.webview, document, packagePath);
            }
        });

        // Handle messages from webview
        const messageSubscription = webviewPanel.webview.onDidReceiveMessage(
            (message: PreviewMessage) => this.handleMessage(message, document, packagePath)
        );

        // Clean up on close
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            messageSubscription.dispose();
        });
    }

    /**
     * Update the webview content
     */
    private async updateWebview(
        webview: vscode.Webview,
        document: vscode.TextDocument,
        packagePath: string
    ): Promise<void> {
        try {
            // Parse the pipeline YAML
            const content = document.getText();
            const config = yaml.load(content) as PipelineConfig;

            if (!config || !config.name) {
                // Invalid config, show error state
                webview.html = getPreviewContent(webview, this.context.extensionUri, undefined);
                return;
            }

            // Build pipeline info
            const pipelineInfo = await this.buildPipelineInfo(document, packagePath, config);

            // Validate the pipeline
            const validation = await this.pipelineManager.validatePipeline(document.uri.fsPath);

            // Try to read CSV info
            let csvInfo: CSVParseResult | undefined;
            let csvPreview: PromptItem[] | undefined;

            try {
                // Support both inline items and CSV source
                if (config.input?.from?.path) {
                    const csvPath = resolveCSVPath(config.input.from.path, packagePath);

                    if (fs.existsSync(csvPath)) {
                        csvInfo = await readCSVFile(csvPath, {
                            delimiter: config.input.from.delimiter
                        });
                        csvPreview = getCSVPreview(csvInfo, 5);
                    }
                } else if (config.input?.items && config.input.items.length > 0) {
                    // For inline items, we can create a pseudo-CSV info for preview
                    const items = config.input.items;
                    const headers = Object.keys(items[0]);
                    csvInfo = {
                        items: items,
                        headers: headers,
                        rowCount: items.length
                    };
                    csvPreview = items.slice(0, 5);
                }
            } catch (csvError) {
                console.warn('Failed to read input:', csvError);
            }

            // Build preview data
            const previewData: PipelinePreviewData = {
                config,
                info: pipelineInfo,
                validation,
                csvInfo,
                csvPreview
            };

            // Update webview content
            webview.html = getPreviewContent(webview, this.context.extensionUri, previewData);
        } catch (error) {
            console.error('Failed to update pipeline preview:', error);
            // Show empty/error state
            webview.html = getPreviewContent(webview, this.context.extensionUri, undefined);
        }
    }

    /**
     * Build PipelineInfo from document
     */
    private async buildPipelineInfo(
        document: vscode.TextDocument,
        packagePath: string,
        config: PipelineConfig
    ): Promise<PipelineInfo> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const stat = fs.statSync(document.uri.fsPath);

        // Get resource files in the package
        const resourceFiles = await this.getResourceFiles(packagePath);

        return {
            packageName: path.basename(packagePath),
            packagePath: packagePath,
            filePath: document.uri.fsPath,
            relativePath: path.relative(workspaceRoot, document.uri.fsPath),
            name: config.name || path.basename(packagePath),
            description: (config as any).description,
            lastModified: stat.mtime,
            size: stat.size,
            isValid: true, // Will be updated by validation
            resourceFiles
        };
    }

    /**
     * Get resource files in the pipeline package
     */
    private async getResourceFiles(packagePath: string): Promise<PipelineInfo['resourceFiles']> {
        const resources: PipelineInfo['resourceFiles'] = [];

        try {
            const entries = fs.readdirSync(packagePath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile() && entry.name !== 'pipeline.yaml' && entry.name !== 'pipeline.yml') {
                    const filePath = path.join(packagePath, entry.name);
                    const stat = fs.statSync(filePath);
                    const ext = path.extname(entry.name).toLowerCase();

                    let fileType: 'csv' | 'json' | 'txt' | 'template' | 'other' = 'other';
                    if (ext === '.csv') fileType = 'csv';
                    else if (ext === '.json') fileType = 'json';
                    else if (ext === '.txt') fileType = 'txt';
                    else if (ext === '.tpl' || ext === '.template') fileType = 'template';

                    resources.push({
                        fileName: entry.name,
                        filePath,
                        relativePath: entry.name,
                        size: stat.size,
                        fileType
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to read resource files:', error);
        }

        return resources;
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(
        message: PreviewMessage,
        document: vscode.TextDocument,
        packagePath: string
    ): Promise<void> {
        switch (message.type) {
            case 'edit':
                // Open the YAML file in the default text editor
                await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
                break;

            case 'execute':
                await this.handleExecute(document);
                break;

            case 'validate':
                await this.handleValidate(document);
                break;

            case 'refresh':
                // Document change listener will handle refresh
                break;

            case 'openFile':
                await this.handleOpenFile(message.payload?.filePath, packagePath);
                break;

            case 'nodeClick':
            case 'ready':
                // Handled client-side or informational
                break;
        }
    }

    /**
     * Handle execute command
     */
    private async handleExecute(document: vscode.TextDocument): Promise<void> {
        const packagePath = path.dirname(document.uri.fsPath);
        const packageName = path.basename(packagePath);

        // Find the pipeline and execute
        const pipelines = await this.pipelineManager.getPipelines();
        const pipeline = pipelines.find(p => p.packageName === packageName);

        if (pipeline) {
            const item = new PipelineItem(pipeline);
            await vscode.commands.executeCommand('pipelinesViewer.execute', item);
        }
    }

    /**
     * Handle validate command
     */
    private async handleValidate(document: vscode.TextDocument): Promise<void> {
        const packagePath = path.dirname(document.uri.fsPath);
        const packageName = path.basename(packagePath);

        const pipelines = await this.pipelineManager.getPipelines();
        const pipeline = pipelines.find(p => p.packageName === packageName);

        if (pipeline) {
            const item = new PipelineItem(pipeline);
            await vscode.commands.executeCommand('pipelinesViewer.validate', item);
        }
    }

    /**
     * Handle open file command
     */
    private async handleOpenFile(filePath?: string, packagePath?: string): Promise<void> {
        if (!filePath) {
            return;
        }

        // Resolve relative paths against the pipeline package
        let resolvedPath = filePath;
        if (!path.isAbsolute(filePath) && packagePath) {
            resolvedPath = path.resolve(packagePath, filePath);
        }

        if (fs.existsSync(resolvedPath)) {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolvedPath));
        } else {
            vscode.window.showWarningMessage(`File not found: ${filePath}`);
        }
    }
}

/**
 * Register the Pipeline Preview Editor and related commands
 */
export function registerPipelinePreview(
    context: vscode.ExtensionContext,
    pipelineManager: PipelineManager
): vscode.Disposable {
    // Register the custom editor provider
    const editorDisposable = PipelinePreviewEditorProvider.register(context, pipelineManager);

    // Register command to open preview for a pipeline from the tree view
    const previewCommandDisposable = vscode.commands.registerCommand(
        'pipelinesViewer.preview',
        async (item: PipelineItem) => {
            if (item?.pipeline?.filePath) {
                const uri = vscode.Uri.file(item.pipeline.filePath);
                await vscode.commands.executeCommand(
                    'vscode.openWith',
                    uri,
                    PipelinePreviewEditorProvider.viewType
                );
            }
        }
    );

    // Return a composite disposable
    return vscode.Disposable.from(editorDisposable, previewCommandDisposable);
}

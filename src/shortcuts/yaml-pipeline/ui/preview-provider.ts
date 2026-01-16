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
import { PipelineConfig, CSVParseResult, PromptItem, isCSVSource, isGenerateConfig, AIInvoker } from '../types';
import { readCSVFile, resolveCSVPath, getCSVPreview } from '../csv-reader';
import { PipelineInfo, ValidationResult } from './types';
import { PipelineManager } from './pipeline-manager';
import { PipelineItem } from './pipeline-item';
import {
    getPreviewContent,
    PreviewMessage,
    PipelinePreviewData,
    ExtensionMessage
} from './preview-content';
import {
    GenerateState,
    GeneratedItem,
    generateInputItems,
    toGeneratedItems,
    getSelectedItems,
    createEmptyItem
} from '../input-generator';
import { invokeCopilotCLI, getAIToolSetting, copyToClipboard } from '../../ai-service';

/**
 * Pipeline Preview Editor - Custom editor provider for pipeline.yaml files
 * Opens as a read-only visual preview in the main editor area
 */
export class PipelinePreviewEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'pipelinePreviewEditor';

    /** Track generate state per document */
    private generateStates = new Map<string, GenerateState>();
    /** Track generated items per document */
    private generatedItems = new Map<string, GeneratedItem[]>();
    /** Track webview panels per document for state updates */
    private webviewPanels = new Map<string, vscode.WebviewPanel>();

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
        const docKey = document.uri.toString();

        // Set the tab title
        const fileName = path.basename(document.uri.fsPath);
        webviewPanel.title = `[Preview] ${packageName}`;

        // Track webview panel
        this.webviewPanels.set(docKey, webviewPanel);

        // Initialize generate state if this is a generate pipeline
        if (!this.generateStates.has(docKey)) {
            this.generateStates.set(docKey, { status: 'initial' });
        }

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
            (message: PreviewMessage) => this.handleMessage(message, document, packagePath, webviewPanel)
        );

        // Clean up on close
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            messageSubscription.dispose();
            this.webviewPanels.delete(docKey);
            this.generateStates.delete(docKey);
            this.generatedItems.delete(docKey);
        });
    }

    /**
     * Send generate state update to webview without full re-render
     * This keeps the webview's local pipelineData in sync with the extension state
     */
    private sendGenerateStateUpdate(
        webview: vscode.Webview,
        docKey: string
    ): void {
        const generateState = this.generateStates.get(docKey);
        const generatedItems = this.generatedItems.get(docKey);
        
        const message: ExtensionMessage = {
            type: 'updateGenerateState',
            payload: {
                generateState: generateState || undefined,
                generatedItems: generatedItems || undefined
            }
        };
        
        webview.postMessage(message);
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
                // Support both inline items, CSV source, and inline array from
                if (isCSVSource(config.input?.from)) {
                    const csvPath = resolveCSVPath(config.input.from.path, packagePath);

                    if (fs.existsSync(csvPath)) {
                        csvInfo = await readCSVFile(csvPath, {
                            delimiter: config.input.from.delimiter
                        });
                        csvPreview = getCSVPreview(csvInfo, 5);
                    }
                } else if (Array.isArray(config.input?.from) && config.input.from.length > 0) {
                    // For inline array from, create pseudo-CSV info for preview
                    const items = config.input.from as PromptItem[];
                    const headers = Object.keys(items[0]);
                    csvInfo = {
                        items: items,
                        headers: headers,
                        rowCount: items.length
                    };
                    csvPreview = getCSVPreview(csvInfo, 5);
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

            // Get generate state for this document
            const docKey = document.uri.toString();
            const generateState = this.generateStates.get(docKey) || { status: 'initial' as const };
            const generatedItems = this.generatedItems.get(docKey);

            // Build preview data
            const previewData: PipelinePreviewData = {
                config,
                info: pipelineInfo,
                validation,
                csvInfo,
                csvPreview,
                generateState: isGenerateConfig(config.input?.generate) ? generateState : undefined,
                generatedItems: generatedItems
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
        packagePath: string,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const docKey = document.uri.toString();

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

            // Generate flow messages
            case 'generate':
                await this.handleGenerate(document, packagePath, webviewPanel);
                break;

            case 'regenerate':
                await this.handleGenerate(document, packagePath, webviewPanel);
                break;

            case 'cancelGenerate':
                this.generateStates.set(docKey, { status: 'initial' });
                this.generatedItems.delete(docKey);
                await this.updateWebview(webviewPanel.webview, document, packagePath);
                // Also send state update to keep webview's pipelineData in sync
                this.sendGenerateStateUpdate(webviewPanel.webview, docKey);
                break;

            case 'addRow':
                await this.handleAddRow(document, packagePath, webviewPanel);
                break;

            case 'deleteRows':
                await this.handleDeleteRows(document, packagePath, webviewPanel, message.payload?.indices || []);
                break;

            case 'updateCell':
                await this.handleUpdateCell(document, packagePath, webviewPanel, message.payload as { index: number; field: string; value: string } | undefined);
                break;

            case 'toggleRow':
                await this.handleToggleRow(document, packagePath, webviewPanel, message.payload as { index: number; selected: boolean } | undefined);
                break;

            case 'toggleAll':
                await this.handleToggleAll(document, packagePath, webviewPanel, message.payload?.selected || false);
                break;

            case 'runWithItems':
                await this.handleRunWithItems(document, message.payload?.items || []);
                break;
        }
    }

    /**
     * Handle generate command - invoke AI to generate items
     */
    private async handleGenerate(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const docKey = document.uri.toString();

        try {
            // Parse config to get generate settings
            const content = document.getText();
            const config = yaml.load(content) as PipelineConfig;

            if (!config.input?.generate || !isGenerateConfig(config.input.generate)) {
                vscode.window.showErrorMessage('Pipeline does not have a valid generate configuration');
                return;
            }

            const generateConfig = config.input.generate;

            // Update state to generating
            this.generateStates.set(docKey, { status: 'generating' });
            await this.updateWebview(webviewPanel.webview, document, packagePath);

            // Create AI invoker
            const aiTool = getAIToolSetting();
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || packagePath;

            const aiInvoker: AIInvoker = async (prompt: string, options?: { model?: string }): Promise<{ success: boolean; response?: string; error?: string }> => {
                if (aiTool === 'clipboard') {
                    await copyToClipboard(prompt);
                    // In clipboard mode, we can't get a response automatically
                    // Show a dialog for the user to paste the response
                    const response = await vscode.window.showInputBox({
                        prompt: 'Paste the AI response (JSON array)',
                        placeHolder: '[{"field1": "value1", ...}, ...]',
                        ignoreFocusOut: true
                    });
                    if (response) {
                        return { success: true, response };
                    }
                    return { success: false, error: 'No response provided' };
                } else {
                    // Use Copilot CLI with optional model
                    const result = await invokeCopilotCLI(prompt, workspaceRoot, undefined, undefined, options?.model);
                    return result;
                }
            };

            // Generate items
            const result = await generateInputItems(generateConfig, aiInvoker);

            if (result.success && result.items) {
                const items = toGeneratedItems(result.items);
                this.generatedItems.set(docKey, items);
                this.generateStates.set(docKey, { status: 'review', items });
            } else {
                this.generateStates.set(docKey, {
                    status: 'error',
                    message: result.error || 'Generation failed'
                });
            }

            await this.updateWebview(webviewPanel.webview, document, packagePath);
            // Also send state update to keep webview's pipelineData in sync
            this.sendGenerateStateUpdate(webviewPanel.webview, docKey);

        } catch (error) {
            this.generateStates.set(docKey, {
                status: 'error',
                message: error instanceof Error ? error.message : String(error)
            });
            await this.updateWebview(webviewPanel.webview, document, packagePath);
            // Also send state update to keep webview's pipelineData in sync
            this.sendGenerateStateUpdate(webviewPanel.webview, docKey);
        }
    }

    /**
     * Handle adding a new empty row
     */
    private async handleAddRow(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const docKey = document.uri.toString();
        const items = this.generatedItems.get(docKey);

        if (!items) return;

        // Get schema from config
        const content = document.getText();
        const config = yaml.load(content) as PipelineConfig;
        const schema = config.input?.generate?.schema || [];

        // Add empty item
        const newItem: GeneratedItem = {
            data: createEmptyItem(schema),
            selected: true
        };
        items.push(newItem);

        this.generatedItems.set(docKey, items);
        this.generateStates.set(docKey, { status: 'review', items });
        await this.updateWebview(webviewPanel.webview, document, packagePath);
        // Also send state update to keep webview's pipelineData in sync
        this.sendGenerateStateUpdate(webviewPanel.webview, docKey);
    }

    /**
     * Handle deleting selected rows
     */
    private async handleDeleteRows(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel,
        indices: number[]
    ): Promise<void> {
        const docKey = document.uri.toString();
        const items = this.generatedItems.get(docKey);

        if (!items) return;

        // Remove items at specified indices (in reverse order to maintain indices)
        const sortedIndices = [...indices].sort((a, b) => b - a);
        for (const idx of sortedIndices) {
            if (idx >= 0 && idx < items.length) {
                items.splice(idx, 1);
            }
        }

        this.generatedItems.set(docKey, items);
        this.generateStates.set(docKey, { status: 'review', items });
        await this.updateWebview(webviewPanel.webview, document, packagePath);
        // Also send state update to keep webview's pipelineData in sync
        this.sendGenerateStateUpdate(webviewPanel.webview, docKey);
    }

    /**
     * Handle updating a cell value
     */
    private async handleUpdateCell(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel,
        payload?: { index: number; field: string; value: string }
    ): Promise<void> {
        if (!payload) return;

        const docKey = document.uri.toString();
        const items = this.generatedItems.get(docKey);

        if (!items || payload.index < 0 || payload.index >= items.length) return;

        items[payload.index].data[payload.field] = payload.value;

        this.generatedItems.set(docKey, items);
        // Don't re-render the whole webview for cell updates - let the webview handle it locally
    }

    /**
     * Handle toggling a row's selection
     */
    private async handleToggleRow(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel,
        payload?: { index: number; selected: boolean }
    ): Promise<void> {
        if (!payload) return;

        const docKey = document.uri.toString();
        const items = this.generatedItems.get(docKey);

        if (!items || payload.index < 0 || payload.index >= items.length) return;

        items[payload.index].selected = payload.selected;

        this.generatedItems.set(docKey, items);
        // Don't re-render the whole webview - let the webview handle it locally
    }

    /**
     * Handle toggling all rows
     */
    private async handleToggleAll(
        document: vscode.TextDocument,
        packagePath: string,
        webviewPanel: vscode.WebviewPanel,
        selected: boolean
    ): Promise<void> {
        const docKey = document.uri.toString();
        const items = this.generatedItems.get(docKey);

        if (!items) return;

        for (const item of items) {
            item.selected = selected;
        }

        this.generatedItems.set(docKey, items);
        // Don't re-render the whole webview - let the webview handle it locally
    }

    /**
     * Handle running pipeline with the approved items
     */
    private async handleRunWithItems(
        document: vscode.TextDocument,
        items: PromptItem[]
    ): Promise<void> {
        const packagePath = path.dirname(document.uri.fsPath);
        const packageName = path.basename(packagePath);

        if (items.length === 0) {
            vscode.window.showWarningMessage('No items selected for execution');
            return;
        }

        // Find the pipeline and execute with the approved items
        const pipelines = await this.pipelineManager.getPipelines();
        const pipeline = pipelines.find(p => p.packageName === packageName);

        if (pipeline) {
            const item = new PipelineItem(pipeline);
            // Execute with the approved items
            await vscode.commands.executeCommand('pipelinesViewer.executeWithItems', item, items);
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

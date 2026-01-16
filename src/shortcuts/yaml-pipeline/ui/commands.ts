/**
 * Pipeline Commands
 *
 * Command handlers for the Pipelines Viewer.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import { IAIProcessManager } from '../../ai-service';
import { PipelineManager } from './pipeline-manager';
import { PipelinesTreeDataProvider } from './tree-data-provider';
import { PipelineItem, PipelineTreeItem } from './pipeline-item';
import {
    executeVSCodePipeline,
    executeVSCodePipelineWithItems,
    showPipelineResults,
    VSCodePipelineResult
} from './pipeline-executor-service';
import { PromptItem } from '../types';
import { PipelineResultViewerProvider } from './result-viewer-provider';
import { PipelineTemplateType, PIPELINE_TEMPLATES } from './types';

/**
 * Command handlers for the Pipelines Viewer
 */
export class PipelineCommands {
    private pipelinesTreeView?: vscode.TreeView<PipelineTreeItem>;
    private aiProcessManager?: IAIProcessManager;
    private workspaceRoot: string;
    private resultViewerProvider?: PipelineResultViewerProvider;

    constructor(
        private pipelineManager: PipelineManager,
        private treeDataProvider: PipelinesTreeDataProvider,
        private context: vscode.ExtensionContext
    ) {
        // Get workspace root for pipeline execution
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        // Initialize result viewer provider
        this.resultViewerProvider = new PipelineResultViewerProvider(context.extensionUri);
    }

    /**
     * Set the AI process manager for execution tracking
     */
    setAIProcessManager(manager: IAIProcessManager): void {
        this.aiProcessManager = manager;
    }

    /**
     * Set the tree view for multi-selection support
     */
    setTreeView(treeView: vscode.TreeView<PipelineTreeItem>): void {
        this.pipelinesTreeView = treeView;
    }

    /**
     * Register all pipelines viewer commands
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        disposables.push(
            vscode.commands.registerCommand('pipelinesViewer.create', () => this.createPipelineFromTemplate()),
            vscode.commands.registerCommand('pipelinesViewer.open', (item: PipelineItem) => this.openPipeline(item)),
            vscode.commands.registerCommand('pipelinesViewer.execute', (item: PipelineItem) => this.executePipeline(item)),
            vscode.commands.registerCommand('pipelinesViewer.executeWithItems', (item: PipelineItem, items: PromptItem[]) => this.executePipelineWithItems(item, items)),
            vscode.commands.registerCommand('pipelinesViewer.rename', (item: PipelineItem) => this.renamePipeline(item)),
            vscode.commands.registerCommand('pipelinesViewer.delete', (item: PipelineItem) => this.deletePipeline(item)),
            vscode.commands.registerCommand('pipelinesViewer.validate', (item: PipelineItem) => this.validatePipeline(item)),
            vscode.commands.registerCommand('pipelinesViewer.refresh', () => this.refreshPipelines()),
            vscode.commands.registerCommand('pipelinesViewer.openFolder', () => this.openPipelinesFolder())
        );

        return disposables;
    }

    /**
     * Create a new pipeline package from a template.
     * Shows template selection UI, then creates the pipeline with the selected template.
     */
    private async createPipelineFromTemplate(): Promise<void> {
        // Show template selection quick pick
        const templateItems: vscode.QuickPickItem[] = Object.values(PIPELINE_TEMPLATES).map(template => ({
            label: template.displayName,
            description: template.type,
            detail: template.description
        }));

        const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
            placeHolder: 'Select a pipeline template',
            title: 'Create Pipeline from Template'
        });

        if (!selectedTemplate) {
            return;
        }

        // Get the template type from the selection
        const templateType = selectedTemplate.description as PipelineTemplateType;

        // Ask for pipeline name
        const name = await vscode.window.showInputBox({
            prompt: `Enter pipeline name for ${selectedTemplate.label}`,
            placeHolder: this.getDefaultNameForTemplate(templateType),
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Pipeline name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Pipeline name cannot contain path separators';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        try {
            const filePath = await this.pipelineManager.createPipelineFromTemplate(name.trim(), templateType);
            this.treeDataProvider.refresh();

            // Open the new pipeline.yaml file
            await vscode.commands.executeCommand(
                'vscode.open',
                vscode.Uri.file(filePath)
            );

            vscode.window.showInformationMessage(
                `Pipeline "${name}" created from ${selectedTemplate.label} template`
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to create pipeline: ${err.message}`);
        }
    }

    /**
     * Get a default name suggestion for a template type
     */
    private getDefaultNameForTemplate(templateType: PipelineTemplateType): string {
        switch (templateType) {
            case 'data-fanout':
                return 'my-data-pipeline';
            case 'model-fanout':
                return 'my-model-comparison';
            case 'custom':
            default:
                return 'my-pipeline';
        }
    }

    /**
     * Open a pipeline file
     */
    private async openPipeline(item: PipelineItem): Promise<void> {
        if (!item?.pipeline?.filePath) {
            return;
        }

        try {
            await vscode.commands.executeCommand(
                'vscode.open',
                vscode.Uri.file(item.pipeline.filePath)
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to open pipeline: ${err.message}`);
        }
    }

    /**
     * Execute a pipeline with AI processing
     */
    private async executePipeline(item: PipelineItem): Promise<void> {
        if (!item?.pipeline) {
            return;
        }

        // Validate first
        const validation = await this.pipelineManager.validatePipeline(item.pipeline.filePath);
        if (!validation.valid) {
            const result = await vscode.window.showWarningMessage(
                `Pipeline "${item.pipeline.name}" has validation errors. Execute anyway?`,
                { modal: true, detail: validation.errors.join('\n') },
                'Execute Anyway',
                'Cancel'
            );

            if (result !== 'Execute Anyway') {
                return;
            }
        }

        // Check for workspace root
        if (!this.workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace to execute pipelines.');
            return;
        }

        // Execute the pipeline
        try {
            const executionResult: VSCodePipelineResult = await executeVSCodePipeline({
                pipeline: item.pipeline,
                workspaceRoot: this.workspaceRoot,
                processManager: this.aiProcessManager,
                onProgress: (progress) => {
                    // Progress is shown via VSCode's withProgress in the executor service
                }
            });

            if (executionResult.success && executionResult.result) {
                // Show success message with options
                const stats = executionResult.result.executionStats;
                const successMsg = `Pipeline "${item.pipeline.name}" completed: ${stats.successfulMaps}/${stats.totalItems} items processed`;

                const action = await vscode.window.showInformationMessage(
                    successMsg,
                    'View Results',
                    'Copy Results',
                    'Dismiss'
                );

                if (action === 'View Results') {
                    // Use the enhanced result viewer with individual nodes
                    if (this.resultViewerProvider) {
                        await this.resultViewerProvider.showResults(
                            executionResult.result,
                            item.pipeline.name,
                            item.pipeline.packageName
                        );
                    } else {
                        // Fallback to basic viewer
                        await showPipelineResults(executionResult.result, item.pipeline.name);
                    }
                } else if (action === 'Copy Results') {
                    const { copyPipelineResults } = await import('./pipeline-executor-service');
                    await copyPipelineResults(executionResult.result);
                }
            } else if (!executionResult.success) {
                // Check if it was cancelled
                if (executionResult.error?.includes('cancelled')) {
                    vscode.window.showWarningMessage(`Pipeline "${item.pipeline.name}" was cancelled.`);
                } else {
                    vscode.window.showErrorMessage(
                        `Pipeline "${item.pipeline.name}" failed: ${executionResult.error || 'Unknown error'}`
                    );
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to execute pipeline: ${errorMsg}`);
        }
    }

    /**
     * Execute a pipeline with pre-approved items (from the generate & review flow)
     * This bypasses the normal input loading and uses the provided items directly.
     */
    private async executePipelineWithItems(item: PipelineItem, items: PromptItem[]): Promise<void> {
        if (!item?.pipeline) {
            return;
        }

        if (!items || items.length === 0) {
            vscode.window.showWarningMessage('No items selected for execution');
            return;
        }

        // Check for workspace root
        if (!this.workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace to execute pipelines.');
            return;
        }

        // Execute the pipeline with the provided items
        try {
            const executionResult: VSCodePipelineResult = await executeVSCodePipelineWithItems({
                pipeline: item.pipeline,
                workspaceRoot: this.workspaceRoot,
                processManager: this.aiProcessManager,
                items,
                onProgress: (progress) => {
                    // Progress is shown via VSCode's withProgress in the executor service
                }
            });

            if (executionResult.success && executionResult.result) {
                // Show success message with options
                const stats = executionResult.result.executionStats;
                const successMsg = `Pipeline "${item.pipeline.name}" completed: ${stats.successfulMaps}/${stats.totalItems} items processed`;

                const action = await vscode.window.showInformationMessage(
                    successMsg,
                    'View Results',
                    'Copy Results',
                    'Dismiss'
                );

                if (action === 'View Results') {
                    // Use the enhanced result viewer with individual nodes
                    if (this.resultViewerProvider) {
                        await this.resultViewerProvider.showResults(
                            executionResult.result,
                            item.pipeline.name,
                            item.pipeline.packageName
                        );
                    } else {
                        // Fallback to basic viewer
                        await showPipelineResults(executionResult.result, item.pipeline.name);
                    }
                } else if (action === 'Copy Results') {
                    const { copyPipelineResults } = await import('./pipeline-executor-service');
                    await copyPipelineResults(executionResult.result);
                }
            } else if (!executionResult.success) {
                // Check if it was cancelled
                if (executionResult.error?.includes('cancelled')) {
                    vscode.window.showWarningMessage(`Pipeline "${item.pipeline.name}" was cancelled.`);
                } else {
                    vscode.window.showErrorMessage(
                        `Pipeline "${item.pipeline.name}" failed: ${executionResult.error || 'Unknown error'}`
                    );
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to execute pipeline: ${errorMsg}`);
        }
    }

    /**
     * Rename a pipeline package
     */
    private async renamePipeline(item: PipelineItem): Promise<void> {
        if (!item?.pipeline) {
            return;
        }

        const currentName = item.pipeline.packageName;
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new pipeline package name',
            value: currentName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Pipeline name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Pipeline name cannot contain path separators';
                }
                return null;
            }
        });

        if (!newName || newName === currentName) {
            return;
        }

        try {
            await this.pipelineManager.renamePipeline(item.pipeline.filePath, newName.trim());
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Pipeline package renamed to "${newName}"`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to rename pipeline: ${err.message}`);
        }
    }

    /**
     * Delete a pipeline package and all its contents
     */
    private async deletePipeline(item: PipelineItem): Promise<void> {
        if (!item?.pipeline) {
            return;
        }

        const pipelineName = item.pipeline.name;
        const resourceCount = item.pipeline.resourceFiles?.length || 0;
        const detail = resourceCount > 0
            ? `This will delete the package directory and ${resourceCount} resource file(s).`
            : 'This will delete the package directory.';

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${pipelineName}"?`,
            { modal: true, detail },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        try {
            await this.pipelineManager.deletePipeline(item.pipeline.filePath);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`Pipeline package "${pipelineName}" deleted`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to delete pipeline: ${err.message}`);
        }
    }

    /**
     * Validate a pipeline and show results
     */
    private async validatePipeline(item: PipelineItem): Promise<void> {
        if (!item?.pipeline) {
            return;
        }

        try {
            const validation = await this.pipelineManager.validatePipeline(item.pipeline.filePath);

            if (validation.valid) {
                let message = `✅ Pipeline "${item.pipeline.name}" is valid`;
                if (validation.warnings.length > 0) {
                    message += `\n\nWarnings:\n${validation.warnings.join('\n')}`;
                }
                vscode.window.showInformationMessage(message);
            } else {
                const message = `Pipeline "${item.pipeline.name}" has errors:\n\n${validation.errors.join('\n')}`;
                vscode.window.showWarningMessage(message);
            }

            // Refresh to update validation state in tree
            this.treeDataProvider.refresh();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to validate pipeline: ${err.message}`);
        }
    }

    /**
     * Refresh the pipelines view
     */
    private refreshPipelines(): void {
        this.treeDataProvider.refresh();
    }

    /**
     * Open the pipelines folder in the file explorer
     */
    private async openPipelinesFolder(): Promise<void> {
        const pipelinesFolder = this.pipelineManager.getPipelinesFolder();
        this.pipelineManager.ensurePipelinesFolderExists();

        const uri = vscode.Uri.file(pipelinesFolder);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }
}

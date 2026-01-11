/**
 * Pipelines Tree Data Provider
 *
 * Provides pipeline items to the VSCode tree view.
 */

import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from '../../shared';
import { PipelineManager } from './pipeline-manager';
import { PipelineItem } from './pipeline-item';
import { PipelineInfo } from './types';

/**
 * Tree data provider for the Pipelines Viewer
 * Displays pipeline YAML files from the configured pipelines folder
 */
export class PipelinesTreeDataProvider implements vscode.TreeDataProvider<PipelineItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<PipelineItem | undefined | null | void> =
        new vscode.EventEmitter<PipelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PipelineItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private filterText: string = '';
    private cachedPipelines: PipelineInfo[] = [];

    constructor(private pipelineManager: PipelineManager) {}

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: PipelineItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    async getChildren(element?: PipelineItem): Promise<PipelineItem[]> {
        try {
            if (element) {
                // Pipelines have no children
                return [];
            }

            // Return root level - all pipelines
            return await this.getRootItems();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error getting pipelines', err);
            vscode.window.showErrorMessage(`Error loading pipelines: ${err.message}`);
            return [];
        }
    }

    /**
     * Get the parent of an element
     */
    getParent(_element: PipelineItem): vscode.ProviderResult<PipelineItem> {
        // All pipelines are at root level, no parent
        return undefined;
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set filter text
     */
    setFilter(text: string): void {
        this.filterText = text.toLowerCase();
        this.refresh();
    }

    /**
     * Clear the filter
     */
    clearFilter(): void {
        this.filterText = '';
        this.refresh();
    }

    /**
     * Get current filter text
     */
    getFilter(): string {
        return this.filterText;
    }

    /**
     * Get the pipeline manager instance
     */
    getPipelineManager(): PipelineManager {
        return this.pipelineManager;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Get root items (all pipelines)
     */
    private async getRootItems(): Promise<PipelineItem[]> {
        let pipelines = await this.pipelineManager.getPipelines();

        // Apply filter
        if (this.filterText) {
            pipelines = pipelines.filter(pipeline =>
                pipeline.name.toLowerCase().includes(this.filterText) ||
                pipeline.fileName.toLowerCase().includes(this.filterText) ||
                (pipeline.description && pipeline.description.toLowerCase().includes(this.filterText))
            );
        }

        // Cache pipelines
        this.cachedPipelines = pipelines;

        // Sort pipelines
        pipelines = this.sortPipelines(pipelines);

        return pipelines.map(pipeline => new PipelineItem(pipeline));
    }

    /**
     * Sort pipelines according to settings
     */
    private sortPipelines(pipelines: PipelineInfo[]): PipelineInfo[] {
        const settings = this.pipelineManager.getSettings();

        return [...pipelines].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                // modifiedDate - newest first
                return b.lastModified.getTime() - a.lastModified.getTime();
            }
        });
    }
}

/**
 * Pipelines Tree Data Provider
 *
 * Provides pipeline package items to the VSCode tree view.
 * Supports hierarchical display of pipeline packages and their resource files.
 */

import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from '../../shared';
import { PipelineManager } from './pipeline-manager';
import { PipelineItem, ResourceItem, PipelineTreeItem } from './pipeline-item';
import { PipelineInfo } from './types';

/**
 * Tree data provider for the Pipelines Viewer.
 * Displays pipeline packages and their resource files from the configured pipelines folder.
 */
export class PipelinesTreeDataProvider implements vscode.TreeDataProvider<PipelineTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<PipelineTreeItem | undefined | null | void> =
        new vscode.EventEmitter<PipelineTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PipelineTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private filterText: string = '';
    private cachedPipelines: PipelineInfo[] = [];

    constructor(private pipelineManager: PipelineManager) {}

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: PipelineTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    async getChildren(element?: PipelineTreeItem): Promise<PipelineTreeItem[]> {
        try {
            if (!element) {
                // Return root level - all pipeline packages
                return await this.getRootItems();
            }

            // If element is a PipelineItem, return its resource files
            if (element.itemType === 'package') {
                const pipelineItem = element as PipelineItem;
                return this.getResourceItems(pipelineItem);
            }

            // ResourceItems have no children
            return [];
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
    getParent(element: PipelineTreeItem): vscode.ProviderResult<PipelineTreeItem> {
        if (element.itemType === 'resource') {
            const resourceItem = element as ResourceItem;
            // Find the parent pipeline item
            const parentPipeline = this.cachedPipelines.find(
                p => p.packageName === resourceItem.parentPipeline.packageName
            );
            if (parentPipeline) {
                return new PipelineItem(parentPipeline);
            }
        }
        // Pipeline packages are at root level
        return undefined;
    }

    /**
     * Get resource items for a pipeline package
     */
    private getResourceItems(pipelineItem: PipelineItem): ResourceItem[] {
        const resources = pipelineItem.pipeline.resourceFiles || [];
        return resources.map(resource => new ResourceItem(resource, pipelineItem.pipeline));
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
                pipeline.packageName.toLowerCase().includes(this.filterText) ||
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

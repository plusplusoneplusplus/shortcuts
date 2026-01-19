/**
 * Pipelines Tree Data Provider
 *
 * Provides pipeline package items to the VSCode tree view.
 * Supports hierarchical display of pipeline packages and their resource files.
 * Shows both bundled (read-only) and workspace (editable) pipelines in separate categories.
 */

import * as vscode from 'vscode';
import { LogCategory } from '../../shared';
import { FilterableTreeDataProvider } from '../../shared/filterable-tree-data-provider';
import { PipelineManager } from './pipeline-manager';
import { PipelineItem, ResourceItem, PipelineTreeItem, PipelineCategoryItem } from './pipeline-item';
import { PipelineInfo, PipelineSource } from './types';

/**
 * Tree data provider for the Pipelines Viewer.
 * Displays pipeline packages and their resource files from the configured pipelines folder.
 */
export class PipelinesTreeDataProvider extends FilterableTreeDataProvider<PipelineTreeItem> {
    private cachedPipelines: PipelineInfo[] = [];

    constructor(private pipelineManager: PipelineManager) {
        super();
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: PipelineTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Implementation of getChildren logic
     */
    protected async getChildrenImpl(element?: PipelineTreeItem): Promise<PipelineTreeItem[]> {
        if (!element) {
            // Return root level - category headers
            return await this.getRootItems();
        }

        // If element is a category, return pipelines in that category
        if (element.itemType === 'category') {
            const categoryItem = element as PipelineCategoryItem;
            return await this.getPipelinesInCategory(categoryItem.categoryType);
        }

        // If element is a PipelineItem, return its resource files
        if (element.itemType === 'package') {
            const pipelineItem = element as PipelineItem;
            return this.getResourceItems(pipelineItem);
        }

        // ResourceItems have no children
        return [];
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
     * Get the pipeline manager instance
     */
    getPipelineManager(): PipelineManager {
        return this.pipelineManager;
    }

    /**
     * Override to use EXTENSION log category
     */
    protected getLogCategory(): LogCategory {
        return LogCategory.EXTENSION;
    }

    /**
     * Get root items (category headers)
     */
    private async getRootItems(): Promise<PipelineTreeItem[]> {
        const items: PipelineTreeItem[] = [];
        const allPipelines = await this.pipelineManager.getAllPipelines();

        // Apply filter
        let filteredPipelines = allPipelines;
        if (this.hasFilter) {
            const filter = this.getFilter();
            filteredPipelines = allPipelines.filter(pipeline =>
                pipeline.name.toLowerCase().includes(filter) ||
                pipeline.packageName.toLowerCase().includes(filter) ||
                (pipeline.description && pipeline.description.toLowerCase().includes(filter))
            );
        }

        // Cache pipelines
        this.cachedPipelines = filteredPipelines;

        const bundled = filteredPipelines.filter(p => p.source === PipelineSource.Bundled);
        const workspace = filteredPipelines.filter(p => p.source === PipelineSource.Workspace);

        // Always show Bundled category (even if empty, for discoverability)
        if (bundled.length > 0 || !this.hasFilter) {
            items.push(new PipelineCategoryItem(
                'Bundled Pipelines',
                'bundled',
                bundled.length,
                'Pre-installed pipeline templates (read-only)'
            ));
        }

        // Show Workspace category if there are workspace pipelines or folder exists
        const workspaceFolderExists = await this.pipelineManager.workspaceFolderExists();
        if (workspace.length > 0 || workspaceFolderExists || !this.hasFilter) {
            items.push(new PipelineCategoryItem(
                'Workspace Pipelines',
                'workspace',
                workspace.length,
                `Pipelines in ${this.pipelineManager.getRelativePipelinesFolder()}`
            ));
        }

        return items;
    }

    /**
     * Get pipelines in a specific category
     */
    private async getPipelinesInCategory(category: 'bundled' | 'workspace'): Promise<PipelineItem[]> {
        const source = category === 'bundled' ? PipelineSource.Bundled : PipelineSource.Workspace;
        
        let pipelines = this.cachedPipelines.filter(p => p.source === source);
        
        // Sort pipelines
        pipelines = this.sortPipelines(pipelines);

        return pipelines.map(p => new PipelineItem(p));
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

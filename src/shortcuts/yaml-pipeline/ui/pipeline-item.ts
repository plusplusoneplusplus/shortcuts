/**
 * Pipeline Item
 *
 * Tree items representing pipelines, resources, and categories in the Pipelines Viewer.
 * Supports both bundled (read-only) and workspace (editable) pipelines.
 */

import * as vscode from 'vscode';
import { PipelineInfo, ResourceFileInfo, PipelineSource } from './types';

/**
 * Category header item (Bundled / Workspace)
 */
export class PipelineCategoryItem extends vscode.TreeItem {
    public readonly categoryType: 'bundled' | 'workspace';
    public readonly itemType: 'category' = 'category';

    constructor(
        label: string,
        categoryType: 'bundled' | 'workspace',
        count: number,
        tooltip: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.categoryType = categoryType;
        this.description = `(${count})`;
        this.tooltip = tooltip;
        this.contextValue = `pipelineCategory_${categoryType}`;
        this.iconPath = categoryType === 'bundled'
            ? new vscode.ThemeIcon('package')
            : new vscode.ThemeIcon('folder');
    }
}

/**
 * Tree item representing a pipeline package in the Pipelines Viewer.
 * A package is collapsible and contains the pipeline definition and resource files.
 * Supports both bundled (read-only) and workspace (editable) pipelines.
 */
export class PipelineItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly pipeline: PipelineInfo;
    public readonly itemType: 'package' = 'package';

    constructor(pipeline: PipelineInfo) {
        // Make collapsible if there are resource files
        const hasResources = pipeline.resourceFiles && pipeline.resourceFiles.length > 0;
        super(
            pipeline.name,
            hasResources
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        this.pipeline = pipeline;
        
        // Set context value based on source and validity
        if (pipeline.source === PipelineSource.Bundled) {
            this.contextValue = 'pipeline_bundled';
        } else {
            this.contextValue = pipeline.isValid ? 'pipeline' : 'pipeline_invalid';
        }
        
        // Show "(read-only)" for bundled pipelines, package name for workspace
        this.description = pipeline.source === PipelineSource.Bundled
            ? '(read-only)'
            : pipeline.packageName;
            
        this.tooltip = this.buildTooltip(pipeline);
        this.iconPath = this.getIconPath(pipeline);

        // Set resourceUri for potential drag-and-drop support
        this.resourceUri = vscode.Uri.file(pipeline.filePath);

        // Click to open the pipeline.yaml file
        this.command = {
            command: 'vscode.open',
            title: 'Open Pipeline',
            arguments: [vscode.Uri.file(pipeline.filePath)]
        };
    }

    /**
     * Build a rich tooltip for the pipeline package
     */
    private buildTooltip(pipeline: PipelineInfo): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;

        // Title with icon based on source
        const icon = pipeline.source === PipelineSource.Bundled ? '📦' : '📋';
        tooltip.appendMarkdown(`### ${icon} ${pipeline.name}\n\n`);

        // Description
        if (pipeline.description) {
            tooltip.appendMarkdown(`${pipeline.description}\n\n`);
        }

        // Source indicator
        if (pipeline.source === PipelineSource.Bundled) {
            tooltip.appendMarkdown(`📦 *Bundled with extension (read-only)*\n\n`);
            tooltip.appendMarkdown(`Right-click to copy to workspace for editing.\n\n`);
        } else {
            tooltip.appendMarkdown(`📁 *Workspace pipeline*\n\n`);
        }

        // Package info
        tooltip.appendMarkdown(`**Package:** \`${pipeline.packageName}\`\n\n`);
        tooltip.appendMarkdown(`**Path:** \`${pipeline.relativePath}\`\n\n`);
        tooltip.appendMarkdown(`**Modified:** ${this.formatModifiedTime(pipeline.lastModified)}\n\n`);

        // Resource files count
        if (pipeline.resourceFiles && pipeline.resourceFiles.length > 0) {
            tooltip.appendMarkdown(`**Resources:** ${pipeline.resourceFiles.length} file(s)\n\n`);
        }

        // Validation status (only for workspace pipelines)
        if (pipeline.source === PipelineSource.Workspace) {
            if (pipeline.isValid) {
                tooltip.appendMarkdown(`**Status:** ✅ Valid\n`);
            } else {
                tooltip.appendMarkdown(`**Status:** ⚠️ Invalid\n\n`);
                if (pipeline.validationErrors && pipeline.validationErrors.length > 0) {
                    tooltip.appendMarkdown(`**Errors:**\n`);
                    for (const error of pipeline.validationErrors) {
                        tooltip.appendMarkdown(`- ${error}\n`);
                    }
                }
            }
        }

        return tooltip;
    }

    /**
     * Get the icon for the pipeline package
     */
    private getIconPath(pipeline: PipelineInfo): vscode.ThemeIcon {
        if (!pipeline.isValid && pipeline.source === PipelineSource.Workspace) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        }
        
        // Use different icons for bundled vs workspace
        if (pipeline.source === PipelineSource.Bundled) {
            return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.purple'));
        }
        
        // Workspace pipeline
        return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.blue'));
    }

    /**
     * Format the modified time for display
     */
    private formatModifiedTime(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (minutes < 1) {
            return 'Just now';
        } else if (minutes < 60) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        } else if (hours < 24) {
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
            });
        }
    }

    /**
     * Format file size for display
     */
    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }
}

/**
 * Tree item representing a resource file within a pipeline package
 */
export class ResourceItem extends vscode.TreeItem {
    public readonly contextValue: string = 'resource';
    public readonly resource: ResourceFileInfo;
    public readonly parentPipeline: PipelineInfo;
    public readonly itemType: 'resource' = 'resource';

    constructor(resource: ResourceFileInfo, parentPipeline: PipelineInfo) {
        super(resource.relativePath, vscode.TreeItemCollapsibleState.None);

        this.resource = resource;
        this.parentPipeline = parentPipeline;
        this.description = this.formatFileSize(resource.size);
        this.tooltip = this.buildTooltip(resource);
        this.iconPath = this.getIconPath(resource);

        // Set resourceUri for file icon and drag-drop support
        this.resourceUri = vscode.Uri.file(resource.filePath);

        // Click to open the file
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(resource.filePath)]
        };
    }

    /**
     * Build tooltip for resource file
     */
    private buildTooltip(resource: ResourceFileInfo): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;

        tooltip.appendMarkdown(`### 📄 ${resource.fileName}\n\n`);
        tooltip.appendMarkdown(`**Path:** \`${resource.relativePath}\`\n\n`);
        tooltip.appendMarkdown(`**Size:** ${this.formatFileSize(resource.size)}\n\n`);
        tooltip.appendMarkdown(`**Type:** ${resource.fileType}\n`);

        return tooltip;
    }

    /**
     * Get icon for resource file based on type
     */
    private getIconPath(resource: ResourceFileInfo): vscode.ThemeIcon {
        switch (resource.fileType) {
            case 'csv':
                return new vscode.ThemeIcon('table');
            case 'json':
                return new vscode.ThemeIcon('json');
            case 'txt':
                return new vscode.ThemeIcon('file-text');
            case 'template':
                return new vscode.ThemeIcon('symbol-snippet');
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    /**
     * Format file size for display
     */
    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }
}

/** Union type for all tree item types */
export type PipelineTreeItem = PipelineCategoryItem | PipelineItem | ResourceItem;

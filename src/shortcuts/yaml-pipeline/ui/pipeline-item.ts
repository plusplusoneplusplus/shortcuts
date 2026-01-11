/**
 * Pipeline Item
 *
 * Tree item representing a pipeline in the Pipelines Viewer.
 */

import * as vscode from 'vscode';
import { PipelineInfo } from './types';

/**
 * Tree item representing a pipeline in the Pipelines Viewer
 */
export class PipelineItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly pipeline: PipelineInfo;

    constructor(pipeline: PipelineInfo) {
        super(pipeline.name, vscode.TreeItemCollapsibleState.None);

        this.pipeline = pipeline;
        this.contextValue = pipeline.isValid ? 'pipeline' : 'pipeline_invalid';
        this.description = pipeline.fileName;
        this.tooltip = this.buildTooltip(pipeline);
        this.iconPath = this.getIconPath(pipeline);

        // Set resourceUri for potential drag-and-drop support
        this.resourceUri = vscode.Uri.file(pipeline.filePath);

        // Click to open the YAML file
        this.command = {
            command: 'vscode.open',
            title: 'Open Pipeline',
            arguments: [vscode.Uri.file(pipeline.filePath)]
        };
    }

    /**
     * Build a rich tooltip for the pipeline
     */
    private buildTooltip(pipeline: PipelineInfo): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;

        // Title
        tooltip.appendMarkdown(`### 📋 ${pipeline.name}\n\n`);

        // Description
        if (pipeline.description) {
            tooltip.appendMarkdown(`${pipeline.description}\n\n`);
        }

        // File info
        tooltip.appendMarkdown(`**File:** \`${pipeline.fileName}\`\n\n`);
        tooltip.appendMarkdown(`**Path:** \`${pipeline.relativePath}\`\n\n`);
        tooltip.appendMarkdown(`**Modified:** ${this.formatModifiedTime(pipeline.lastModified)}\n\n`);
        tooltip.appendMarkdown(`**Size:** ${this.formatFileSize(pipeline.size)}\n\n`);

        // Validation status
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

        return tooltip;
    }

    /**
     * Get the icon for the pipeline item
     */
    private getIconPath(pipeline: PipelineInfo): vscode.ThemeIcon {
        if (!pipeline.isValid) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        }
        return new vscode.ThemeIcon('symbol-method');
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

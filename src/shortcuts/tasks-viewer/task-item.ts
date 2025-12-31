import * as vscode from 'vscode';
import { Task } from './types';

/**
 * Tree item representing a task in the Tasks Viewer
 */
export class TaskItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly filePath: string;
    public readonly isArchived: boolean;

    constructor(task: Task) {
        super(task.name, vscode.TreeItemCollapsibleState.None);

        this.filePath = task.filePath;
        this.isArchived = task.isArchived;
        this.contextValue = task.isArchived ? 'archivedTask' : 'task';
        this.tooltip = task.filePath;
        this.description = this.formatModifiedTime(task.modifiedTime);
        this.iconPath = this.getIconPath(task.isArchived);

        // Click to open in Markdown Review Editor
        this.command = {
            command: 'vscode.openWith',
            title: 'Open Task',
            arguments: [vscode.Uri.file(task.filePath), 'reviewEditorView']
        };
    }

    /**
     * Get the icon for the task item
     */
    private getIconPath(isArchived: boolean): vscode.ThemeIcon {
        if (isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }
        return new vscode.ThemeIcon('file-text');
    }

    /**
     * Format the modified time for display
     */
    private formatModifiedTime(date: Date): string {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            // Today - show time
            return date.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit'
            });
        } else if (days === 1) {
            return 'Yesterday';
        } else if (days < 7) {
            return `${days} days ago`;
        } else {
            // Show date
            return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric'
            });
        }
    }
}

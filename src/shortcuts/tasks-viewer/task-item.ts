import * as vscode from 'vscode';
import { Task, ReviewStatus } from './types';

/**
 * Tree item representing a task in the Tasks Viewer
 */
export class TaskItem extends vscode.TreeItem {
    public contextValue: string;
    public readonly filePath: string;
    public readonly isArchived: boolean;
    private _reviewStatus: ReviewStatus = 'unreviewed';

    constructor(task: Task) {
        super(task.name, vscode.TreeItemCollapsibleState.None);

        this.filePath = task.filePath;
        this.isArchived = task.isArchived;
        this.contextValue = task.isArchived ? 'archivedTask' : 'task';
        this.tooltip = task.filePath;
        this.description = this.formatModifiedTime(task.modifiedTime);
        this.iconPath = this.getIconPath(task.isArchived, 'unreviewed');

        // Set resourceUri for drag-and-drop support
        this.resourceUri = vscode.Uri.file(task.filePath);

        // Click to open in Markdown Review Editor
        this.command = {
            command: 'vscode.openWith',
            title: 'Open Task',
            arguments: [vscode.Uri.file(task.filePath), 'reviewEditorView']
        };
    }

    /**
     * Get the current review status
     */
    get reviewStatus(): ReviewStatus {
        return this._reviewStatus;
    }

    /**
     * Set the review status and update the icon
     */
    setReviewStatus(status: ReviewStatus): void {
        this._reviewStatus = status;
        this.iconPath = this.getIconPath(this.isArchived, status);
        // Update context value to enable/disable menu items
        if (this.isArchived) {
            this.contextValue = 'archivedTask';
        } else {
            this.contextValue = status === 'reviewed' ? 'task_reviewed' : 
                               status === 'needs-re-review' ? 'task_needsReReview' : 'task';
        }
    }

    /**
     * Get the icon for the task item
     */
    private getIconPath(isArchived: boolean, reviewStatus: ReviewStatus): vscode.ThemeIcon {
        if (isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }
        
        // Apply review status icon
        switch (reviewStatus) {
            case 'reviewed':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'needs-re-review':
                return new vscode.ThemeIcon('sync', new vscode.ThemeColor('editorWarning.foreground'));
            case 'unreviewed':
            default:
                return new vscode.ThemeIcon('file-text');
        }
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

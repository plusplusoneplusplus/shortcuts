import * as vscode from 'vscode';
import { Task, ReviewStatus, TaskStatus } from './types';

/**
 * Tree item representing a task in the Tasks Viewer
 */
export class TaskItem extends vscode.TreeItem {
    public contextValue: string;
    public readonly filePath: string;
    public readonly isArchived: boolean;
    public readonly taskStatus?: TaskStatus;
    private _reviewStatus: ReviewStatus = 'unreviewed';

    constructor(task: Task) {
        super(task.name, vscode.TreeItemCollapsibleState.None);

        this.filePath = task.filePath;
        this.isArchived = task.isArchived;
        this.taskStatus = task.status;
        this.contextValue = this.getContextValue(task.isArchived, task.status, 'unreviewed');
        this.tooltip = this.getTooltip(task);
        this.description = this.formatDescription(task);
        this.iconPath = this.getIconPath(task.isArchived, task.status, 'unreviewed');

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
        this.iconPath = this.getIconPath(this.isArchived, this.taskStatus, status);
        this.contextValue = this.getContextValue(this.isArchived, this.taskStatus, status);
    }

    /**
     * Get the context value for menu visibility
     */
    private getContextValue(isArchived: boolean, taskStatus: TaskStatus | undefined, reviewStatus: ReviewStatus): string {
        if (isArchived) {
            return 'archivedTask';
        }
        
        // Build context value based on task status and review status
        let base = 'task';
        
        // Add task status suffix for future tasks
        if (taskStatus === 'future') {
            base = 'task_future';
        } else if (taskStatus === 'in-progress') {
            base = 'task_inProgress';
        } else if (taskStatus === 'done') {
            base = 'task_done';
        }
        
        // Add review status suffix
        if (reviewStatus === 'reviewed') {
            return `${base}_reviewed`;
        } else if (reviewStatus === 'needs-re-review') {
            return `${base}_needsReReview`;
        }
        
        return base;
    }

    /**
     * Get the tooltip for the task
     */
    private getTooltip(task: Task): string {
        let tooltip = task.filePath;
        if (task.status) {
            tooltip += `\nStatus: ${task.status}`;
        }
        return tooltip;
    }

    /**
     * Format the description (modified time + optional status indicator)
     */
    private formatDescription(task: Task): string {
        const timeStr = this.formatModifiedTime(task.modifiedTime);
        // Add status indicator for future tasks
        if (task.status === 'future') {
            return `${timeStr} • future`;
        }
        if (task.status === 'in-progress') {
            return `${timeStr} • in-progress`;
        }
        if (task.status === 'done') {
            return `${timeStr} • done`;
        }
        return timeStr;
    }

    /**
     * Get the icon for the task item
     */
    private getIconPath(isArchived: boolean, taskStatus: TaskStatus | undefined, reviewStatus: ReviewStatus): vscode.ThemeIcon {
        if (isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }
        
        // Task status icons take priority over review status for visual distinction
        switch (taskStatus) {
            case 'future':
                return new vscode.ThemeIcon('calendar', new vscode.ThemeColor('disabledForeground'));
            case 'in-progress':
                return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.blue'));
            case 'done':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        }
        
        // Apply review status icon for pending/unspecified tasks
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

import * as vscode from 'vscode';
import { TaskDocument, ReviewStatus } from './types';

/**
 * Tree item representing a single task document within a document group
 * (e.g., "plan" representing task1.plan.md within the task1 group)
 */
export class TaskDocumentItem extends vscode.TreeItem {
    public contextValue: string;
    public readonly filePath: string;
    public readonly isArchived: boolean;
    public readonly docType?: string;
    public readonly baseName: string;
    private _reviewStatus: ReviewStatus = 'unreviewed';
    private document: TaskDocument;

    constructor(document: TaskDocument) {
        // Use docType as label if available, otherwise use baseName
        const displayLabel = document.docType || document.baseName;
        super(displayLabel, vscode.TreeItemCollapsibleState.None);

        this.document = document;
        this.filePath = document.filePath;
        this.isArchived = document.isArchived;
        this.docType = document.docType;
        this.baseName = document.baseName;
        this.contextValue = document.isArchived ? 'archivedTaskDocument' : 'taskDocument';
        this.tooltip = document.filePath;
        this.description = this.formatModifiedTime(document.modifiedTime);
        this.iconPath = this.getIconPath(document, 'unreviewed');

        // Set resourceUri for drag-and-drop support
        this.resourceUri = vscode.Uri.file(document.filePath);

        // Click to open in Markdown Review Editor
        this.command = {
            command: 'vscode.openWith',
            title: 'Open Document',
            arguments: [vscode.Uri.file(document.filePath), 'reviewEditorView']
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
        this.iconPath = this.getIconPath(this.document, status);
        // Update context value to enable/disable menu items
        if (this.isArchived) {
            this.contextValue = 'archivedTaskDocument';
        } else {
            this.contextValue = status === 'reviewed' ? 'taskDocument_reviewed' : 
                               status === 'needs-re-review' ? 'taskDocument_needsReReview' : 'taskDocument';
        }
    }

    /**
     * Get the icon based on document type and review status
     */
    private getIconPath(document: TaskDocument, reviewStatus: ReviewStatus): vscode.ThemeIcon {
        if (document.isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }

        // For reviewed/needs-re-review, show status icon instead of doc type icon
        switch (reviewStatus) {
            case 'reviewed':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'needs-re-review':
                return new vscode.ThemeIcon('sync', new vscode.ThemeColor('editorWarning.foreground'));
        }

        // Map doc types to icons for unreviewed documents
        const iconMap: Record<string, string> = {
            'plan': 'checklist',
            'spec': 'file-code',
            'test': 'beaker',
            'notes': 'note',
            'todo': 'tasklist',
            'readme': 'book',
            'design': 'lightbulb',
            'impl': 'code',
            'implementation': 'code',
            'review': 'comment-discussion',
            'checklist': 'checklist',
            'requirements': 'list-ordered',
            'analysis': 'graph',
            'research': 'search',
            'summary': 'file-text',
            'log': 'history',
            'draft': 'edit',
            'final': 'verified',
        };

        const docType = document.docType?.toLowerCase();
        if (docType && iconMap[docType]) {
            return new vscode.ThemeIcon(iconMap[docType]);
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

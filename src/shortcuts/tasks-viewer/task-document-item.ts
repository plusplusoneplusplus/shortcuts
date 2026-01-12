import * as vscode from 'vscode';
import { TaskDocument } from './types';

/**
 * Tree item representing a single task document within a document group
 * (e.g., "plan" representing task1.plan.md within the task1 group)
 */
export class TaskDocumentItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly filePath: string;
    public readonly isArchived: boolean;
    public readonly docType?: string;
    public readonly baseName: string;

    constructor(document: TaskDocument) {
        // Use docType as label if available, otherwise use baseName
        const displayLabel = document.docType || document.baseName;
        super(displayLabel, vscode.TreeItemCollapsibleState.None);

        this.filePath = document.filePath;
        this.isArchived = document.isArchived;
        this.docType = document.docType;
        this.baseName = document.baseName;
        this.contextValue = document.isArchived ? 'archivedTaskDocument' : 'taskDocument';
        this.tooltip = document.filePath;
        this.description = this.formatModifiedTime(document.modifiedTime);
        this.iconPath = this.getIconPath(document);

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
     * Get the icon based on document type
     */
    private getIconPath(document: TaskDocument): vscode.ThemeIcon {
        if (document.isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }

        // Map doc types to icons
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

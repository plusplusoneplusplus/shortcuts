import * as vscode from 'vscode';
import * as path from 'path';
import { TaskDocument } from './types';

/**
 * Tree item representing a group of related task documents
 * (e.g., task1.plan.md, task1.test.md, task1.spec.md all under "task1")
 */
export class TaskDocumentGroupItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly baseName: string;
    public readonly documents: TaskDocument[];
    public readonly isArchived: boolean;
    public readonly folderPath: string;

    constructor(baseName: string, documents: TaskDocument[], isArchived: boolean = false) {
        super(baseName, vscode.TreeItemCollapsibleState.Collapsed);

        this.baseName = baseName;
        this.documents = documents;
        this.isArchived = isArchived;
        this.contextValue = isArchived ? 'archivedTaskDocumentGroup' : 'taskDocumentGroup';
        
        // Use the folder path from the first document
        this.folderPath = documents.length > 0 ? path.dirname(documents[0].filePath) : '';
        
        // Show document count and types in description
        const docTypes = documents.map(d => d.docType || 'md').join(', ');
        this.description = `${documents.length} docs (${docTypes})`;
        
        this.tooltip = this.buildTooltip();
        this.iconPath = this.getIconPath();
    }

    /**
     * Build tooltip showing all documents in the group
     */
    private buildTooltip(): string {
        const lines = [`Task: ${this.baseName}`, '', 'Documents:'];
        for (const doc of this.documents) {
            const suffix = doc.docType ? `.${doc.docType}` : '';
            lines.push(`  - ${this.baseName}${suffix}.md`);
        }
        return lines.join('\n');
    }

    /**
     * Get the icon for the task document group
     */
    private getIconPath(): vscode.ThemeIcon {
        if (this.isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }
        return new vscode.ThemeIcon('folder-library');
    }
}

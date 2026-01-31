import * as vscode from 'vscode';
import * as path from 'path';
import { TaskDocument, ReviewStatus } from './types';

/**
 * Aggregate review status for a document group
 */
export type GroupReviewStatus = 'all-reviewed' | 'some-reviewed' | 'none-reviewed' | 'has-re-review';

/**
 * Tree item representing a group of related task documents
 * (e.g., task1.plan.md, task1.test.md, task1.spec.md all under "task1")
 */
export class TaskDocumentGroupItem extends vscode.TreeItem {
    public contextValue: string;
    public readonly baseName: string;
    public readonly documents: TaskDocument[];
    public readonly isArchived: boolean;
    public readonly folderPath: string;
    private _groupReviewStatus: GroupReviewStatus = 'none-reviewed';

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
        this.iconPath = this.getIconPath('none-reviewed');
    }

    /**
     * Get the current group review status
     */
    get groupReviewStatus(): GroupReviewStatus {
        return this._groupReviewStatus;
    }

    /**
     * Set the group review status based on individual document statuses
     * @param documentStatuses Map of file path to review status
     */
    setGroupReviewStatus(documentStatuses: Map<string, ReviewStatus>): void {
        let reviewedCount = 0;
        let needsReReviewCount = 0;

        for (const doc of this.documents) {
            const status = documentStatuses.get(doc.filePath) || 'unreviewed';
            if (status === 'reviewed') {
                reviewedCount++;
            } else if (status === 'needs-re-review') {
                needsReReviewCount++;
            }
        }

        if (needsReReviewCount > 0) {
            this._groupReviewStatus = 'has-re-review';
        } else if (reviewedCount === this.documents.length) {
            this._groupReviewStatus = 'all-reviewed';
        } else if (reviewedCount > 0) {
            this._groupReviewStatus = 'some-reviewed';
        } else {
            this._groupReviewStatus = 'none-reviewed';
        }

        this.iconPath = this.getIconPath(this._groupReviewStatus);
        
        // Update context value to enable/disable menu items
        if (this.isArchived) {
            this.contextValue = 'archivedTaskDocumentGroup';
        } else {
            switch (this._groupReviewStatus) {
                case 'all-reviewed':
                    this.contextValue = 'taskDocumentGroup_allReviewed';
                    break;
                case 'has-re-review':
                    this.contextValue = 'taskDocumentGroup_hasReReview';
                    break;
                default:
                    this.contextValue = 'taskDocumentGroup';
            }
        }
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
    private getIconPath(groupStatus: GroupReviewStatus): vscode.ThemeIcon {
        if (this.isArchived) {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }

        switch (groupStatus) {
            case 'all-reviewed':
                return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
            case 'has-re-review':
                return new vscode.ThemeIcon('sync', new vscode.ThemeColor('editorWarning.foreground'));
            case 'some-reviewed':
                return new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('charts.blue'));
            case 'none-reviewed':
            default:
                return new vscode.ThemeIcon('folder-library');
        }
    }
}

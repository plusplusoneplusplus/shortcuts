/**
 * Tree data provider for the Git Diff Comments section in the Git panel
 * Displays comments grouped by file, with filtering options
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiffCommentsManager } from './diff-comments-manager';
import { DiffComment, DiffCommentStatus, DiffGitContext } from './types';

/**
 * Tree item representing a file with diff comments
 */
export class DiffCommentFileItem extends vscode.TreeItem {
    public readonly contextValue = 'diffCommentFile';
    public readonly filePath: string;
    public readonly openCount: number;
    public readonly resolvedCount: number;
    public readonly gitContext?: DiffGitContext;

    constructor(
        filePath: string,
        openCount: number,
        resolvedCount: number,
        gitContext?: DiffGitContext
    ) {
        const fileName = path.basename(filePath);
        super(fileName, vscode.TreeItemCollapsibleState.Expanded);

        this.filePath = filePath;
        this.openCount = openCount;
        this.resolvedCount = resolvedCount;
        this.gitContext = gitContext;

        this.description = `${openCount} open${resolvedCount > 0 ? `, ${resolvedCount} resolved` : ''}`;
        this.tooltip = this.createTooltip();
        this.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.blue'));

        // Click to open diff review for this file
        this.command = {
            command: 'gitDiffComments.openFileWithReview',
            title: 'Open Diff Review',
            arguments: [this]
        };
    }

    private createTooltip(): string {
        const totalCount = this.openCount + this.resolvedCount;
        let tooltip = `${this.filePath}\n${totalCount} comment(s)`;
        if (this.gitContext) {
            const staged = this.gitContext.wasStaged ? 'Staged' : 'Unstaged';
            tooltip += `\n${staged} changes`;
        }
        return tooltip;
    }
}

/**
 * Tree item representing a single diff comment
 */
export class DiffCommentItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly comment: DiffComment;
    public readonly absoluteFilePath: string;

    constructor(comment: DiffComment, absoluteFilePath: string) {
        // Determine line range based on which side has the line numbers
        const startLine = comment.selection.newStartLine ?? comment.selection.oldStartLine ?? 0;
        const endLine = comment.selection.newEndLine ?? comment.selection.oldEndLine ?? 0;
        const lineRange = startLine === endLine
            ? `Line ${startLine}`
            : `Lines ${startLine}-${endLine}`;

        // Side indicator
        const sideLabel = comment.selection.side === 'old' ? '(-)' : 
                         comment.selection.side === 'new' ? '(+)' : '';

        // Truncate selected text for display
        const maxTextLength = 35;
        let selectedTextPreview = comment.selectedText.replace(/\n/g, ' ').trim();
        if (selectedTextPreview.length > maxTextLength) {
            selectedTextPreview = selectedTextPreview.substring(0, maxTextLength - 3) + '...';
        }

        super(`${sideLabel} ${lineRange}: "${selectedTextPreview}"`, vscode.TreeItemCollapsibleState.None);

        this.comment = comment;
        this.absoluteFilePath = absoluteFilePath;
        this.contextValue = `diffComment_${comment.status}`;

        // Comment content as description
        let commentPreview = comment.comment.replace(/\n/g, ' ').trim();
        if (commentPreview.length > 50) {
            commentPreview = commentPreview.substring(0, 47) + '...';
        }
        this.description = commentPreview;

        // Detailed tooltip
        this.tooltip = this.createTooltip();

        // Icon based on status and side
        this.iconPath = this.getIcon();

        // Command to navigate to the comment in diff view
        this.command = {
            command: 'gitDiffComments.goToComment',
            title: 'Go to Comment',
            arguments: [this]
        };
    }

    private createTooltip(): vscode.MarkdownString {
        const statusIcon = this.comment.status === 'resolved' ? '✓' : '○';
        const statusLabel = this.comment.status === 'resolved' ? 'Resolved' : 'Open';
        const sideLabel = this.comment.selection.side === 'old' ? 'Old version (deleted)' :
                         this.comment.selection.side === 'new' ? 'New version (added)' : 'Both sides';

        const tooltip = new vscode.MarkdownString(
            `**${statusLabel}** ${statusIcon}\n\n` +
            `**Side:** ${sideLabel}\n\n` +
            `**Selected text:**\n> ${this.comment.selectedText}\n\n` +
            `**Comment:**\n${this.comment.comment}\n\n` +
            `_Created: ${new Date(this.comment.createdAt).toLocaleString()}_`
        );
        tooltip.supportHtml = true;
        return tooltip;
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.comment.status === 'resolved') {
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        }
        
        // Use different colors based on which side of the diff
        if (this.comment.selection.side === 'old') {
            return new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.red'));
        } else if (this.comment.selection.side === 'new') {
            return new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.green'));
        }
        return new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.yellow'));
    }
}

/**
 * Tree data provider for git diff comments
 */
export class DiffCommentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private commentsManager: DiffCommentsManager;
    private showResolved: boolean = true;
    private filterStatus?: DiffCommentStatus;
    private disposables: vscode.Disposable[] = [];

    constructor(commentsManager: DiffCommentsManager) {
        this.commentsManager = commentsManager;

        // Listen for comment changes
        this.disposables.push(
            commentsManager.onDidChangeComments(() => {
                this.refresh();
            })
        );
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Toggle showing resolved comments
     */
    toggleShowResolved(): void {
        this.showResolved = !this.showResolved;
        this.refresh();
    }

    /**
     * Set whether to show resolved comments
     */
    setShowResolved(show: boolean): void {
        this.showResolved = show;
        this.refresh();
    }

    /**
     * Get whether resolved comments are shown
     */
    getShowResolved(): boolean {
        return this.showResolved;
    }

    /**
     * Set status filter
     */
    setFilterStatus(status?: DiffCommentStatus): void {
        this.filterStatus = status;
        this.refresh();
    }

    /**
     * Get tree item representation
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of an element
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Root level - return files with comments
            return this.getFileItems();
        }

        if (element instanceof DiffCommentFileItem) {
            // File level - return comments for this file
            return this.getCommentItems(element.filePath);
        }

        return [];
    }

    /**
     * Get file items at root level
     */
    private getFileItems(): DiffCommentFileItem[] {
        const groupedComments = this.commentsManager.getCommentsGroupedByFile();
        const items: DiffCommentFileItem[] = [];

        groupedComments.forEach((comments, filePath) => {
            // Filter comments based on settings
            let filteredComments = comments;
            if (!this.showResolved) {
                filteredComments = comments.filter(c => c.status !== 'resolved');
            }
            if (this.filterStatus) {
                filteredComments = filteredComments.filter(c => c.status === this.filterStatus);
            }

            // Skip files with no visible comments
            if (filteredComments.length === 0) {
                return;
            }

            const openCount = filteredComments.filter(c => c.status === 'open').length;
            const resolvedCount = filteredComments.filter(c => c.status === 'resolved').length;
            const absolutePath = this.commentsManager.getAbsolutePath(filePath);

            // Get git context from first comment (they should all have same context for same file)
            const gitContext = filteredComments[0]?.gitContext;

            items.push(new DiffCommentFileItem(absolutePath, openCount, resolvedCount, gitContext));
        });

        // Sort by file name
        items.sort((a, b) => path.basename(a.filePath).localeCompare(path.basename(b.filePath)));

        return items;
    }

    /**
     * Get comment items for a specific file
     */
    private getCommentItems(absoluteFilePath: string): DiffCommentItem[] {
        let comments = this.commentsManager.getCommentsForFile(absoluteFilePath);

        // Filter comments based on settings
        if (!this.showResolved) {
            comments = comments.filter(c => c.status !== 'resolved');
        }
        if (this.filterStatus) {
            comments = comments.filter(c => c.status === this.filterStatus);
        }

        // Sort by line number
        comments.sort((a, b) => {
            const aLine = a.selection.newStartLine ?? a.selection.oldStartLine ?? 0;
            const bLine = b.selection.newStartLine ?? b.selection.oldStartLine ?? 0;
            if (aLine !== bLine) {
                return aLine - bLine;
            }
            return a.selection.startColumn - b.selection.startColumn;
        });

        return comments.map(c => new DiffCommentItem(c, absoluteFilePath));
    }

    /**
     * Get parent of an element (for reveal support)
     */
    getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
        if (element instanceof DiffCommentItem) {
            const absolutePath = element.absoluteFilePath;
            const comments = this.commentsManager.getCommentsForFile(absolutePath);
            const openCount = comments.filter(c => c.status === 'open').length;
            const resolvedCount = comments.filter(c => c.status === 'resolved').length;
            const gitContext = comments[0]?.gitContext;
            return new DiffCommentFileItem(absolutePath, openCount, resolvedCount, gitContext);
        }
        return undefined;
    }

    /**
     * Get the total number of open comments
     */
    getOpenCommentCount(): number {
        return this.commentsManager.getOpenCommentCount();
    }

    /**
     * Get the total number of resolved comments
     */
    getResolvedCommentCount(): number {
        return this.commentsManager.getResolvedCommentCount();
    }

    /**
     * Get the total number of comments
     */
    getTotalCommentCount(): number {
        return this.commentsManager.getAllComments().length;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}


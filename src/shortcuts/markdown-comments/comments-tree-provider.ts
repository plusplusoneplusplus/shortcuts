/**
 * Tree data provider for the Markdown Comments panel
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { CommentStatus, MarkdownComment } from './types';

/**
 * Tree item representing a file with comments
 */
export class CommentFileItem extends vscode.TreeItem {
    public readonly contextValue = 'commentFile';
    public readonly filePath: string;
    public readonly openCount: number;
    public readonly resolvedCount: number;

    constructor(
        filePath: string,
        openCount: number,
        resolvedCount: number
    ) {
        const fileName = path.basename(filePath);
        const totalCount = openCount + resolvedCount;
        super(fileName, vscode.TreeItemCollapsibleState.Expanded);

        this.filePath = filePath;
        this.openCount = openCount;
        this.resolvedCount = resolvedCount;

        this.description = `${openCount} open${resolvedCount > 0 ? `, ${resolvedCount} resolved` : ''}`;
        this.tooltip = `${filePath}\n${totalCount} comment(s)`;
        this.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.blue'));

        // Click to open the file
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(filePath)]
        };
    }
}

/**
 * Tree item representing a single comment
 */
export class CommentItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly comment: MarkdownComment;
    public readonly absoluteFilePath: string;

    constructor(comment: MarkdownComment, absoluteFilePath: string) {
        const lineRange = comment.selection.startLine === comment.selection.endLine
            ? `Line ${comment.selection.startLine}`
            : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;

        // Truncate selected text for display
        const maxTextLength = 40;
        let selectedTextPreview = comment.selectedText.replace(/\n/g, ' ').trim();
        if (selectedTextPreview.length > maxTextLength) {
            selectedTextPreview = selectedTextPreview.substring(0, maxTextLength - 3) + '...';
        }

        super(`💬 ${lineRange}: "${selectedTextPreview}"`, vscode.TreeItemCollapsibleState.None);

        this.comment = comment;
        this.absoluteFilePath = absoluteFilePath;
        this.contextValue = `comment_${comment.status}`;

        // Comment content as description
        let commentPreview = comment.comment.replace(/\n/g, ' ').trim();
        if (commentPreview.length > 60) {
            commentPreview = commentPreview.substring(0, 57) + '...';
        }
        this.description = commentPreview;

        // Status indicator
        const statusIcon = comment.status === 'resolved' ? '✓' : '○';
        const statusLabel = comment.status === 'resolved' ? 'Resolved' : 'Open';

        // Detailed tooltip
        this.tooltip = new vscode.MarkdownString(
            `**${statusLabel}** ${statusIcon}\n\n` +
            `**Selected text:**\n> ${comment.selectedText}\n\n` +
            `**Comment:**\n${comment.comment}\n\n` +
            `_Created: ${new Date(comment.createdAt).toLocaleString()}_`
        );
        this.tooltip.supportHtml = true;

        // Icon based on status
        if (comment.status === 'resolved') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.yellow'));
        }

        // Command to navigate to the comment location
        this.command = {
            command: 'markdownComments.goToComment',
            title: 'Go to Comment',
            arguments: [this]
        };
    }
}

/**
 * Tree data provider for markdown comments
 */
export class MarkdownCommentsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private commentsManager: CommentsManager;
    private showResolved: boolean = true;
    private filterStatus?: CommentStatus;
    private disposables: vscode.Disposable[] = [];

    constructor(commentsManager: CommentsManager) {
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
    setFilterStatus(status?: CommentStatus): void {
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

        if (element instanceof CommentFileItem) {
            // File level - return comments for this file
            return this.getCommentItems(element.filePath);
        }

        return [];
    }

    /**
     * Get file items at root level
     */
    private getFileItems(): CommentFileItem[] {
        const groupedComments = this.commentsManager.getCommentsGroupedByFile();
        const items: CommentFileItem[] = [];

        Array.from(groupedComments.entries()).forEach(([filePath, comments]) => {
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

            items.push(new CommentFileItem(absolutePath, openCount, resolvedCount));
        });

        // Sort by file name
        items.sort((a, b) => path.basename(a.filePath).localeCompare(path.basename(b.filePath)));

        return items;
    }

    /**
     * Get comment items for a specific file
     */
    private getCommentItems(absoluteFilePath: string): CommentItem[] {
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
            if (a.selection.startLine !== b.selection.startLine) {
                return a.selection.startLine - b.selection.startLine;
            }
            return a.selection.startColumn - b.selection.startColumn;
        });

        return comments.map(c => new CommentItem(c, absoluteFilePath));
    }

    /**
     * Get parent of an element (for reveal support)
     */
    getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
        if (element instanceof CommentItem) {
            const absolutePath = element.absoluteFilePath;
            const comments = this.commentsManager.getCommentsForFile(absolutePath);
            const openCount = comments.filter(c => c.status === 'open').length;
            const resolvedCount = comments.filter(c => c.status === 'resolved').length;
            return new CommentFileItem(absolutePath, openCount, resolvedCount);
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
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

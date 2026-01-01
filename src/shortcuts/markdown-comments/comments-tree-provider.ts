/**
 * Tree data provider for the Markdown Comments panel
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentsTreeProviderBase } from '../shared/comments-tree-provider-base';
import { CommentsManager } from './comments-manager';
import { MarkdownComment } from './types';

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

        // Show first 2 lines of selected text, indicate if more
        const lines = comment.selectedText.split('\n').filter(l => l.trim() !== '');
        let selectedTextPreview: string;
        if (lines.length === 0) {
            selectedTextPreview = '';
        } else if (lines.length === 1) {
            selectedTextPreview = lines[0].trim();
        } else if (lines.length === 2) {
            selectedTextPreview = lines[0].trim() + ' | ' + lines[1].trim();
        } else {
            selectedTextPreview = lines[0].trim() + ' | ' + lines[1].trim() + ' (+' + (lines.length - 2) + ' more)';
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

        // Icon based on status and type
        if (comment.status === 'resolved') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else if (comment.type === 'ai-suggestion') {
            this.iconPath = new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.blue'));
        } else if (comment.type === 'ai-clarification') {
            this.iconPath = new vscode.ThemeIcon('lightbulb', new vscode.ThemeColor('charts.purple'));
        } else if (comment.type === 'ai-critique') {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
        } else if (comment.type === 'ai-question') {
            this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.cyan'));
        } else {
            // Default: user comment
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
export class MarkdownCommentsTreeDataProvider extends CommentsTreeProviderBase<CommentsManager> {
    constructor(commentsManager: CommentsManager) {
        super(commentsManager);
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

        for (const [filePath, comments] of groupedComments) {
            const filteredComments = this.filterComments(comments);

            // Skip files with no visible comments
            if (filteredComments.length === 0) {
                continue;
            }

            const { openCount, resolvedCount } = this.countByStatus(filteredComments);
            const absolutePath = this.commentsManager.getAbsolutePath(filePath);

            items.push(new CommentFileItem(absolutePath, openCount, resolvedCount));
        }

        // Sort by file name
        items.sort((a, b) => path.basename(a.filePath).localeCompare(path.basename(b.filePath)));

        return items;
    }

    /**
     * Get comment items for a specific file
     */
    private getCommentItems(absoluteFilePath: string): CommentItem[] {
        const comments = this.commentsManager.getCommentsForFile(absoluteFilePath);
        const filteredComments = this.filterComments(comments);

        // Sort by line number
        filteredComments.sort((a, b) => {
            if (a.selection.startLine !== b.selection.startLine) {
                return a.selection.startLine - b.selection.startLine;
            }
            return a.selection.startColumn - b.selection.startColumn;
        });

        return filteredComments.map(c => new CommentItem(c, absoluteFilePath));
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

}

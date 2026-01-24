/**
 * Tree data provider for the Git Diff Comments section in the Git panel
 * Displays comments grouped by category (Pending Changes, Committed), then by file
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentsTreeProviderBase } from '../shared/comments-tree-provider-base';
import { DiffCommentsManager } from './diff-comments-manager';
import { DiffComment, DiffGitContext } from './types';

/**
 * Comment category for grouping
 */
export type CommentCategory = 'pending' | 'committed';

/**
 * Tree item representing a comment category group (Pending Changes or Committed)
 */
export class DiffCommentCategoryItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly category: CommentCategory;
    public readonly commitHash?: string;
    public readonly openCount: number;
    public readonly resolvedCount: number;

    constructor(
        category: CommentCategory,
        openCount: number,
        resolvedCount: number,
        commitHash?: string
    ) {
        const label = category === 'pending'
            ? 'Pending Changes'
            : `Commit ${commitHash?.slice(0, 7) || 'unknown'}`;

        super(label, vscode.TreeItemCollapsibleState.Collapsed);

        this.category = category;
        this.commitHash = commitHash;
        this.openCount = openCount;
        this.resolvedCount = resolvedCount;

        // Context value includes whether there are open comments for conditional menu items
        // Format: diffCommentCategory_hasOpen or diffCommentCategory_noOpen
        this.contextValue = openCount > 0 ? 'diffCommentCategory_hasOpen' : 'diffCommentCategory_noOpen';

        this.description = this.createDescription();
        this.tooltip = this.createTooltip();
        this.iconPath = category === 'pending'
            ? new vscode.ThemeIcon('git-pull-request-create', new vscode.ThemeColor('charts.yellow'))
            : new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('charts.purple'));
    }

    private createDescription(): string {
        if (this.openCount === 0 && this.resolvedCount > 0) {
            return `0 open, ${this.resolvedCount} resolved`;
        }
        return `${this.openCount} open${this.resolvedCount > 0 ? `, ${this.resolvedCount} resolved` : ''}`;
    }

    private createTooltip(): string {
        const totalCount = this.openCount + this.resolvedCount;
        if (this.category === 'pending') {
            return `Comments on pending (staged/unstaged) changes\n${totalCount} comment(s)`;
        }
        return `Comments on commit ${this.commitHash || 'unknown'}\n${totalCount} comment(s)`;
    }
}

/**
 * Tree item representing a file with diff comments
 */
export class DiffCommentFileItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly filePath: string;
    public readonly openCount: number;
    public readonly resolvedCount: number;
    public readonly gitContext?: DiffGitContext;
    public readonly category?: CommentCategory;
    public readonly commitHash?: string;

    constructor(
        filePath: string,
        openCount: number,
        resolvedCount: number,
        gitContext?: DiffGitContext,
        category?: CommentCategory,
        commitHash?: string
    ) {
        const fileName = path.basename(filePath);
        super(fileName, vscode.TreeItemCollapsibleState.Expanded);

        this.filePath = filePath;
        this.openCount = openCount;
        this.resolvedCount = resolvedCount;
        this.gitContext = gitContext;
        this.category = category;
        this.commitHash = commitHash;

        // Context value includes whether there are open comments for conditional menu items
        // Format: diffCommentFile_hasOpen or diffCommentFile_noOpen
        this.contextValue = openCount > 0 ? 'diffCommentFile_hasOpen' : 'diffCommentFile_noOpen';

        this.description = this.createDescription();
        this.tooltip = this.createTooltip();
        this.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.blue'));

        // Click to open diff review for this file
        this.command = {
            command: 'gitDiffComments.openFileWithReview',
            title: 'Open Diff Review',
            arguments: [this]
        };
    }

    private createDescription(): string {
        if (this.openCount === 0 && this.resolvedCount > 0) {
            return `0 open, ${this.resolvedCount} resolved`;
        }
        return `${this.openCount} open${this.resolvedCount > 0 ? `, ${this.resolvedCount} resolved` : ''}`;
    }

    private createTooltip(): string {
        const totalCount = this.openCount + this.resolvedCount;
        let tooltip = `${this.filePath}\n${totalCount} comment(s)`;
        if (this.gitContext) {
            if (this.gitContext.commitHash) {
                tooltip += `\nCommit: ${this.gitContext.commitHash.slice(0, 7)}`;
            } else {
                const staged = this.gitContext.wasStaged ? 'Staged' : 'Unstaged';
                tooltip += `\n${staged} changes`;
            }
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
 * Grouped comments structure for organizing by category
 */
interface GroupedCommentsData {
    /** Comments on pending (staged/unstaged) changes */
    pending: Map<string, DiffComment[]>;
    /** Comments on committed changes, grouped by commit hash */
    committed: Map<string, Map<string, DiffComment[]>>;
}

/**
 * Tree data provider for git diff comments
 * Groups comments by category: Pending Changes and Committed (by commit hash)
 */
export class DiffCommentsTreeDataProvider extends CommentsTreeProviderBase<DiffCommentsManager> {
    constructor(commentsManager: DiffCommentsManager) {
        super(commentsManager);
    }

    /**
     * Get children of an element
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Root level - return category items (Pending Changes, Commit groups)
            return this.getCategoryItems();
        }

        if (element instanceof DiffCommentCategoryItem) {
            // Category level - return files within this category
            return this.getFileItemsForCategory(element);
        }

        if (element instanceof DiffCommentFileItem) {
            // File level - return comments for this file
            return this.getCommentItems(element.filePath, element.category, element.commitHash);
        }

        return [];
    }

    /**
     * Group comments by category (pending vs committed)
     */
    private getGroupedComments(): GroupedCommentsData {
        const allComments = this.commentsManager.getAllComments();
        const filteredComments = this.filterComments(allComments);
        const result: GroupedCommentsData = {
            pending: new Map(),
            committed: new Map()
        };

        for (const comment of filteredComments) {
            const filePath = comment.filePath;
            const commitHash = comment.gitContext.commitHash;

            if (commitHash) {
                // Committed comment - group by commit hash, then by file
                if (!result.committed.has(commitHash)) {
                    result.committed.set(commitHash, new Map());
                }
                const commitFiles = result.committed.get(commitHash)!;
                if (!commitFiles.has(filePath)) {
                    commitFiles.set(filePath, []);
                }
                commitFiles.get(filePath)!.push(comment);
            } else {
                // Pending comment (staged/unstaged)
                if (!result.pending.has(filePath)) {
                    result.pending.set(filePath, []);
                }
                result.pending.get(filePath)!.push(comment);
            }
        }

        return result;
    }

    /**
     * Get category items at root level
     */
    private getCategoryItems(): vscode.TreeItem[] {
        const grouped = this.getGroupedComments();
        const items: vscode.TreeItem[] = [];

        // Pending Changes category
        if (grouped.pending.size > 0) {
            const allPendingComments = Array.from(grouped.pending.values()).flat();
            const { openCount, resolvedCount } = this.countByStatus(allPendingComments);
            items.push(new DiffCommentCategoryItem('pending', openCount, resolvedCount));
        }

        // Committed categories (one per commit)
        const sortedCommits = Array.from(grouped.committed.entries());
        // Sort by commit hash for consistency (could also sort by date if available)
        sortedCommits.sort((a, b) => a[0].localeCompare(b[0]));

        for (const [commitHash, files] of sortedCommits) {
            const allCommitComments = Array.from(files.values()).flat();
            const { openCount, resolvedCount } = this.countByStatus(allCommitComments);
            items.push(new DiffCommentCategoryItem('committed', openCount, resolvedCount, commitHash));
        }

        return items;
    }

    /**
     * Get file items for a specific category
     */
    private getFileItemsForCategory(categoryItem: DiffCommentCategoryItem): DiffCommentFileItem[] {
        const grouped = this.getGroupedComments();
        const items: DiffCommentFileItem[] = [];

        if (categoryItem.category === 'pending') {
            for (const [filePath, comments] of grouped.pending) {
                const { openCount, resolvedCount } = this.countByStatus(comments);
                const absolutePath = this.commentsManager.getAbsolutePath(filePath);
                const gitContext = comments[0]?.gitContext;
                items.push(new DiffCommentFileItem(
                    absolutePath,
                    openCount,
                    resolvedCount,
                    gitContext,
                    'pending'
                ));
            }
        } else if (categoryItem.commitHash) {
            const commitFiles = grouped.committed.get(categoryItem.commitHash);
            if (commitFiles) {
                for (const [filePath, comments] of commitFiles) {
                    const { openCount, resolvedCount } = this.countByStatus(comments);
                    const absolutePath = this.commentsManager.getAbsolutePath(filePath);
                    const gitContext = comments[0]?.gitContext;
                    items.push(new DiffCommentFileItem(
                        absolutePath,
                        openCount,
                        resolvedCount,
                        gitContext,
                        'committed',
                        categoryItem.commitHash
                    ));
                }
            }
        }

        // Sort by file name
        items.sort((a, b) => path.basename(a.filePath).localeCompare(path.basename(b.filePath)));

        return items;
    }

    /**
     * Get comment items for a specific file within a category
     */
    private getCommentItems(
        absoluteFilePath: string,
        category?: CommentCategory,
        commitHash?: string
    ): DiffCommentItem[] {
        let comments = this.commentsManager.getCommentsForFile(absoluteFilePath);

        // Filter by category
        if (category === 'pending') {
            comments = comments.filter(c => !c.gitContext.commitHash);
        } else if (category === 'committed' && commitHash) {
            comments = comments.filter(c => c.gitContext.commitHash === commitHash);
        }

        // Apply status filters from base class
        comments = this.filterComments(comments);

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
            const comment = element.comment;
            const commitHash = comment.gitContext.commitHash;
            const category: CommentCategory = commitHash ? 'committed' : 'pending';

            // Get comments for this file in the same category
            let comments = this.commentsManager.getCommentsForFile(absolutePath);
            if (category === 'pending') {
                comments = comments.filter(c => !c.gitContext.commitHash);
            } else {
                comments = comments.filter(c => c.gitContext.commitHash === commitHash);
            }

            const { openCount, resolvedCount } = this.countByStatus(comments);
            const gitContext = comments[0]?.gitContext;
            return new DiffCommentFileItem(absolutePath, openCount, resolvedCount, gitContext, category, commitHash);
        }

        if (element instanceof DiffCommentFileItem) {
            const category = element.category;
            const commitHash = element.commitHash;

            if (category === 'pending') {
                const grouped = this.getGroupedComments();
                const allPendingComments = Array.from(grouped.pending.values()).flat();
                const { openCount, resolvedCount } = this.countByStatus(allPendingComments);
                return new DiffCommentCategoryItem('pending', openCount, resolvedCount);
            } else if (category === 'committed' && commitHash) {
                const grouped = this.getGroupedComments();
                const commitFiles = grouped.committed.get(commitHash);
                if (commitFiles) {
                    const allCommitComments = Array.from(commitFiles.values()).flat();
                    const { openCount, resolvedCount } = this.countByStatus(allCommitComments);
                    return new DiffCommentCategoryItem('committed', openCount, resolvedCount, commitHash);
                }
                return new DiffCommentCategoryItem('committed', 0, 0, commitHash);
            }
        }

        return undefined;
    }

    /**
     * Get the total number of comments
     */
    getTotalCommentCount(): number {
        return this.commentsManager.getAllComments().length;
    }
}


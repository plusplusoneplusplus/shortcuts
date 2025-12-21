/**
 * Commands for Git Diff Comments tree view context menus
 * Provides copy prompt, resolve, delete, and navigation actions
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiffCommentsManager } from './diff-comments-manager';
import {
    DiffCommentCategoryItem,
    DiffCommentFileItem,
    DiffCommentItem,
    DiffCommentsTreeDataProvider
} from './diff-comments-tree-provider';
import { DiffPromptGenerator } from './diff-prompt-generator';
import { DiffComment } from './types';

/**
 * Undo state for resolve operations
 */
interface ResolveUndoState {
    commentIds: string[];
    timestamp: number;
}

/**
 * Manages commands for the diff comments tree view
 */
export class DiffCommentsCommands implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private promptGenerator: DiffPromptGenerator;
    private lastResolveUndo?: ResolveUndoState;
    private static readonly UNDO_TIMEOUT_MS = 30000; // 30 seconds

    constructor(
        private readonly commentsManager: DiffCommentsManager,
        private readonly treeDataProvider: DiffCommentsTreeDataProvider,
        private readonly context: vscode.ExtensionContext
    ) {
        this.promptGenerator = new DiffPromptGenerator(commentsManager);
        this.registerCommands();
    }

    /**
     * Register all context menu commands
     */
    private registerCommands(): void {
        // Category-level commands
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.copyPromptCategory',
                (item: DiffCommentCategoryItem) => this.copyPromptForCategory(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.showPromptCategory',
                (item: DiffCommentCategoryItem) => this.showPromptInEditor(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.resolveAllCategory',
                (item: DiffCommentCategoryItem) => this.resolveAllInCategory(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.deleteAllCategory',
                (item: DiffCommentCategoryItem) => this.deleteAllInCategory(item)
            )
        );

        // File-level commands
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.copyPromptFile',
                (item: DiffCommentFileItem) => this.copyPromptForFile(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.showPromptFile',
                (item: DiffCommentFileItem) => this.showPromptInEditorForFile(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.resolveAllFile',
                (item: DiffCommentFileItem) => this.resolveAllInFile(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.deleteAllFile',
                (item: DiffCommentFileItem) => this.deleteAllInFile(item)
            )
        );

        // Comment-level commands
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.copyPromptComment',
                (item: DiffCommentItem) => this.copyPromptForComment(item)
            )
        );
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.editComment',
                (item: DiffCommentItem) => this.editComment(item)
            )
        );

        // Existing commands that need to be updated to work with tree items
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.goToComment',
                (item: DiffCommentItem) => this.goToComment(item)
            )
        );

        // Undo resolve command
        this.disposables.push(
            vscode.commands.registerCommand(
                'gitDiffComments.undoResolve',
                () => this.undoResolve()
            )
        );
    }

    /**
     * Copy prompt for all open comments in a category
     */
    private async copyPromptForCategory(item: DiffCommentCategoryItem): Promise<void> {
        const comments = this.getOpenCommentsForCategory(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments in this category.');
            return;
        }

        const prompt = this.promptGenerator.generatePromptForCategory(
            item.category,
            item.commitHash
        );

        await vscode.env.clipboard.writeText(prompt);

        const summary = this.promptGenerator.getCommentsSummary(comments);
        vscode.window.showInformationMessage(
            `✓ Copied prompt for ${comments.length} comment(s) to clipboard\n${summary}`
        );
    }

    /**
     * Show prompt in a new editor for a category
     */
    private async showPromptInEditor(item: DiffCommentCategoryItem): Promise<void> {
        const comments = this.getOpenCommentsForCategory(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments in this category.');
            return;
        }

        const prompt = this.promptGenerator.generatePromptForCategory(
            item.category,
            item.commitHash
        );

        const doc = await vscode.workspace.openTextDocument({
            content: prompt,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Resolve all comments in a category
     */
    private async resolveAllInCategory(item: DiffCommentCategoryItem): Promise<void> {
        const comments = this.getOpenCommentsForCategory(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments to resolve.');
            return;
        }

        const categoryLabel = item.category === 'pending'
            ? 'Pending Changes'
            : `Commit ${item.commitHash?.slice(0, 7)}`;

        // Resolve all comments
        const resolvedIds: string[] = [];
        for (const comment of comments) {
            await this.commentsManager.resolveComment(comment.id);
            resolvedIds.push(comment.id);
        }

        // Store undo state
        this.lastResolveUndo = {
            commentIds: resolvedIds,
            timestamp: Date.now()
        };

        // Show notification with undo option
        const action = await vscode.window.showInformationMessage(
            `✓ Resolved ${comments.length} comment(s) in ${categoryLabel}`,
            'Undo'
        );

        if (action === 'Undo') {
            await this.undoResolve();
        }
    }

    /**
     * Delete all comments in a category
     */
    private async deleteAllInCategory(item: DiffCommentCategoryItem): Promise<void> {
        const comments = this.getAllCommentsForCategory(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No comments to delete.');
            return;
        }

        const categoryLabel = item.category === 'pending'
            ? 'Pending Changes'
            : `Commit ${item.commitHash?.slice(0, 7)}`;

        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete all ${comments.length} comment(s) in ${categoryLabel}?`,
            { modal: true },
            'Delete All'
        );

        if (confirmed !== 'Delete All') {
            return;
        }

        for (const comment of comments) {
            await this.commentsManager.deleteComment(comment.id);
        }

        vscode.window.showInformationMessage(
            `🗑 Deleted ${comments.length} comment(s) from ${categoryLabel}`
        );
    }

    /**
     * Copy prompt for all open comments in a file
     */
    private async copyPromptForFile(item: DiffCommentFileItem): Promise<void> {
        const comments = this.getOpenCommentsForFile(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments for this file.');
            return;
        }

        const prompt = this.promptGenerator.generatePromptForFile(
            item.filePath,
            item.category,
            item.commitHash
        );

        await vscode.env.clipboard.writeText(prompt);

        const fileName = path.basename(item.filePath);
        vscode.window.showInformationMessage(
            `✓ Copied prompt for ${comments.length} comment(s) in ${fileName} to clipboard`
        );
    }

    /**
     * Show prompt in a new editor for a file
     */
    private async showPromptInEditorForFile(item: DiffCommentFileItem): Promise<void> {
        const comments = this.getOpenCommentsForFile(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments for this file.');
            return;
        }

        const prompt = this.promptGenerator.generatePromptForFile(
            item.filePath,
            item.category,
            item.commitHash
        );

        const doc = await vscode.workspace.openTextDocument({
            content: prompt,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Resolve all comments in a file
     */
    private async resolveAllInFile(item: DiffCommentFileItem): Promise<void> {
        const comments = this.getOpenCommentsForFile(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments to resolve.');
            return;
        }

        const fileName = path.basename(item.filePath);

        // Resolve all comments
        const resolvedIds: string[] = [];
        for (const comment of comments) {
            await this.commentsManager.resolveComment(comment.id);
            resolvedIds.push(comment.id);
        }

        // Store undo state
        this.lastResolveUndo = {
            commentIds: resolvedIds,
            timestamp: Date.now()
        };

        // Show notification with undo option
        const action = await vscode.window.showInformationMessage(
            `✓ Resolved ${comments.length} comment(s) in ${fileName}`,
            'Undo'
        );

        if (action === 'Undo') {
            await this.undoResolve();
        }
    }

    /**
     * Delete all comments in a file
     */
    private async deleteAllInFile(item: DiffCommentFileItem): Promise<void> {
        const comments = this.getAllCommentsForFile(item);
        if (comments.length === 0) {
            vscode.window.showInformationMessage('No comments to delete.');
            return;
        }

        const fileName = path.basename(item.filePath);

        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete all ${comments.length} comment(s) in ${fileName}?`,
            { modal: true },
            'Delete All'
        );

        if (confirmed !== 'Delete All') {
            return;
        }

        for (const comment of comments) {
            await this.commentsManager.deleteComment(comment.id);
        }

        vscode.window.showInformationMessage(
            `🗑 Deleted ${comments.length} comment(s) from ${fileName}`
        );
    }

    /**
     * Copy prompt for a single comment
     */
    private async copyPromptForComment(item: DiffCommentItem): Promise<void> {
        const prompt = this.promptGenerator.generatePromptForComment(item.comment.id);

        await vscode.env.clipboard.writeText(prompt);

        vscode.window.showInformationMessage('✓ Copied comment prompt to clipboard');
    }

    /**
     * Edit a comment's text
     */
    private async editComment(item: DiffCommentItem): Promise<void> {
        const currentText = item.comment.comment;

        const newText = await vscode.window.showInputBox({
            prompt: 'Edit comment',
            value: currentText,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Comment cannot be empty';
                }
                return null;
            }
        });

        if (newText === undefined || newText === currentText) {
            return; // Cancelled or no change
        }

        await this.commentsManager.updateComment(item.comment.id, {
            comment: newText.trim()
        });

        vscode.window.showInformationMessage('✓ Comment updated');
    }

    /**
     * Navigate to a comment in the diff review editor
     */
    private async goToComment(item: DiffCommentItem): Promise<void> {
        // Open the diff review editor and scroll to the comment
        await vscode.commands.executeCommand(
            'gitDiffComments.openWithReview',
            { filePath: item.absoluteFilePath, gitContext: item.comment.gitContext },
            item.comment.id
        );
    }

    /**
     * Undo the last resolve operation
     */
    private async undoResolve(): Promise<void> {
        if (!this.lastResolveUndo) {
            vscode.window.showInformationMessage('Nothing to undo.');
            return;
        }

        // Check if undo has expired
        if (Date.now() - this.lastResolveUndo.timestamp > DiffCommentsCommands.UNDO_TIMEOUT_MS) {
            vscode.window.showInformationMessage('Undo expired.');
            this.lastResolveUndo = undefined;
            return;
        }

        // Reopen all comments
        for (const commentId of this.lastResolveUndo.commentIds) {
            await this.commentsManager.reopenComment(commentId);
        }

        const count = this.lastResolveUndo.commentIds.length;
        this.lastResolveUndo = undefined;

        vscode.window.showInformationMessage(`↩ Reopened ${count} comment(s)`);
    }

    /**
     * Get open comments for a category
     */
    private getOpenCommentsForCategory(item: DiffCommentCategoryItem): DiffComment[] {
        const allComments = this.commentsManager.getAllComments();

        return allComments.filter(c => {
            if (c.status !== 'open') {
                return false;
            }
            if (item.category === 'pending') {
                return !c.gitContext.commitHash;
            } else {
                return c.gitContext.commitHash === item.commitHash;
            }
        });
    }

    /**
     * Get all comments (including resolved) for a category
     */
    private getAllCommentsForCategory(item: DiffCommentCategoryItem): DiffComment[] {
        const allComments = this.commentsManager.getAllComments();

        return allComments.filter(c => {
            if (item.category === 'pending') {
                return !c.gitContext.commitHash;
            } else {
                return c.gitContext.commitHash === item.commitHash;
            }
        });
    }

    /**
     * Get open comments for a file
     */
    private getOpenCommentsForFile(item: DiffCommentFileItem): DiffComment[] {
        let comments = this.commentsManager.getCommentsForFile(item.filePath)
            .filter(c => c.status === 'open');

        // Filter by category if specified
        if (item.category === 'pending') {
            comments = comments.filter(c => !c.gitContext.commitHash);
        } else if (item.category === 'committed' && item.commitHash) {
            comments = comments.filter(c => c.gitContext.commitHash === item.commitHash);
        }

        return comments;
    }

    /**
     * Get all comments (including resolved) for a file
     */
    private getAllCommentsForFile(item: DiffCommentFileItem): DiffComment[] {
        let comments = this.commentsManager.getCommentsForFile(item.filePath);

        // Filter by category if specified
        if (item.category === 'pending') {
            comments = comments.filter(c => !c.gitContext.commitHash);
        } else if (item.category === 'committed' && item.commitHash) {
            comments = comments.filter(c => c.gitContext.commitHash === item.commitHash);
        }

        return comments;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}


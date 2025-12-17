/**
 * Command handlers for markdown comments feature
 * These commands support the tree view panel and work with ReviewEditorView
 */

import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { CommentItem, MarkdownCommentsTreeDataProvider } from './comments-tree-provider';
import { PromptGenerator } from './prompt-generator';
import { ReviewEditorViewProvider } from './review-editor-view-provider';

/**
 * Command handler for markdown comments
 * Note: Add/Edit comment functionality is handled by ReviewEditorView inline
 */
export class MarkdownCommentsCommands {
    private commentsManager: CommentsManager;
    private treeDataProvider: MarkdownCommentsTreeDataProvider;
    private promptGenerator: PromptGenerator;
    private treeView?: vscode.TreeView<vscode.TreeItem>;

    constructor(
        commentsManager: CommentsManager,
        treeDataProvider: MarkdownCommentsTreeDataProvider,
        promptGenerator: PromptGenerator
    ) {
        this.commentsManager = commentsManager;
        this.treeDataProvider = treeDataProvider;
        this.promptGenerator = promptGenerator;
    }

    /**
     * Set the tree view reference for navigation
     */
    setTreeView(treeView: vscode.TreeView<vscode.TreeItem>): void {
        this.treeView = treeView;
    }

    /**
     * Register all command handlers
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // Resolve comment command (from tree view context menu)
        disposables.push(
            vscode.commands.registerCommand('markdownComments.resolveComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.resolveComment(id);
                }
            })
        );

        // Reopen comment command (from tree view context menu)
        disposables.push(
            vscode.commands.registerCommand('markdownComments.reopenComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.reopenComment(id);
                }
            })
        );

        // Delete comment command (from tree view context menu)
        disposables.push(
            vscode.commands.registerCommand('markdownComments.deleteComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.deleteComment(id);
                }
            })
        );

        // Resolve all comments command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.resolveAll', async () => {
                await this.resolveAllComments();
            })
        );

        // Generate AI prompt command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.generatePrompt', async () => {
                await this.generateAIPrompt();
            })
        );

        // Generate and copy prompt command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.generateAndCopyPrompt', async () => {
                await this.generateAndCopyPrompt();
            })
        );

        // Go to comment location - opens file in ReviewEditorView
        disposables.push(
            vscode.commands.registerCommand('markdownComments.goToComment', async (item: CommentItem) => {
                await this.goToComment(item);
            })
        );

        // Toggle show resolved in tree view
        disposables.push(
            vscode.commands.registerCommand('markdownComments.toggleShowResolved', () => {
                this.toggleShowResolved();
            })
        );

        // Refresh comments from disk
        disposables.push(
            vscode.commands.registerCommand('markdownComments.refresh', () => {
                this.refreshComments();
            })
        );

        // Open comments configuration
        disposables.push(
            vscode.commands.registerCommand('markdownComments.openConfig', async () => {
                await this.openConfig();
            })
        );

        return disposables;
    }

    /**
     * Resolve a comment
     */
    private async resolveComment(commentId: string): Promise<void> {
        try {
            await this.commentsManager.resolveComment(commentId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to resolve comment: ${err.message}`);
        }
    }

    /**
     * Reopen a resolved comment
     */
    private async reopenComment(commentId: string): Promise<void> {
        try {
            await this.commentsManager.reopenComment(commentId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to reopen comment: ${err.message}`);
        }
    }

    /**
     * Delete a comment
     */
    private async deleteComment(commentId: string): Promise<void> {
        const comment = this.commentsManager.getComment(commentId);
        if (!comment) {
            vscode.window.showErrorMessage('Comment not found');
            return;
        }

        const confirmed = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this comment?',
            { modal: true },
            'Delete'
        );

        if (confirmed !== 'Delete') {
            return;
        }

        try {
            await this.commentsManager.deleteComment(commentId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to delete comment: ${err.message}`);
        }
    }

    /**
     * Resolve all open comments
     */
    private async resolveAllComments(): Promise<void> {
        const openCount = this.commentsManager.getOpenCommentCount();
        if (openCount === 0) {
            vscode.window.showInformationMessage('No open comments to resolve');
            return;
        }

        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to resolve all ${openCount} open comment(s)?`,
            { modal: true },
            'Resolve All'
        );

        if (confirmed !== 'Resolve All') {
            return;
        }

        try {
            const count = await this.commentsManager.resolveAllComments();
            vscode.window.showInformationMessage(`Resolved ${count} comment(s)`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to resolve comments: ${err.message}`);
        }
    }

    /**
     * Generate AI prompt and show in preview.
     * Only includes user comments, excluding AI-generated comments.
     */
    private async generateAIPrompt(): Promise<void> {
        const openCount = this.commentsManager.getOpenUserCommentCount();
        if (openCount === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from');
            return;
        }

        // Show options for prompt generation
        const includeFileContent = await vscode.window.showQuickPick(
            ['No', 'Yes'],
            { placeHolder: 'Include full file content in prompt?' }
        );

        if (includeFileContent === undefined) {
            return; // User cancelled
        }

        const prompt = this.promptGenerator.generatePrompt({
            includeFullFileContent: includeFileContent === 'Yes',
            groupByFile: true,
            includeLineNumbers: true,
            outputFormat: 'markdown'
        });

        // Open in a new document
        const doc = await vscode.workspace.openTextDocument({
            content: prompt,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });

        // Show copy prompt
        const action = await vscode.window.showInformationMessage(
            `AI prompt generated with ${openCount} comment(s)`,
            'Copy to Clipboard'
        );

        if (action === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('Prompt copied to clipboard');
        }
    }

    /**
     * Generate prompt and copy directly to clipboard.
     * Only includes user comments, excluding AI-generated comments.
     */
    private async generateAndCopyPrompt(): Promise<void> {
        const openCount = this.commentsManager.getOpenUserCommentCount();
        if (openCount === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from');
            return;
        }

        const prompt = this.promptGenerator.generatePrompt({
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true,
            outputFormat: 'markdown'
        });

        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage(
            `AI prompt for ${openCount} comment(s) copied to clipboard`
        );
    }

    /**
     * Navigate to a comment's location - opens file in ReviewEditorView
     */
    private async goToComment(item: CommentItem): Promise<void> {
        if (!item || !item.comment) {
            return;
        }

        const filePath = item.absoluteFilePath;

        try {
            const uri = vscode.Uri.file(filePath);

            // Open the file in ReviewEditorView
            await vscode.commands.executeCommand(
                'vscode.openWith',
                uri,
                ReviewEditorViewProvider.viewType
            );
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to navigate to comment: ${err.message}`);
        }
    }

    /**
     * Toggle showing resolved comments in the tree view
     */
    private toggleShowResolved(): void {
        this.treeDataProvider.toggleShowResolved();
        const showing = this.treeDataProvider.getShowResolved();
        vscode.window.showInformationMessage(
            showing ? 'Showing resolved comments' : 'Hiding resolved comments'
        );
    }

    /**
     * Refresh comments from disk
     */
    private async refreshComments(): Promise<void> {
        await this.commentsManager.loadComments();
        vscode.window.showInformationMessage('Comments refreshed');
    }

    /**
     * Open the comments configuration file
     */
    private async openConfig(): Promise<void> {
        const configPath = this.commentsManager.getConfigPath();
        const uri = vscode.Uri.file(configPath);

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            // File doesn't exist, offer to create it
            const create = await vscode.window.showInformationMessage(
                'Comments configuration file does not exist. Create it?',
                'Create'
            );

            if (create === 'Create') {
                await this.commentsManager.saveComments();
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            }
        }
    }
}

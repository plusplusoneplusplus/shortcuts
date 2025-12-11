/**
 * Command handlers for markdown comments feature
 */

import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { CommentItem, MarkdownCommentsTreeDataProvider } from './comments-tree-provider';
import { PromptGenerator } from './prompt-generator';

/**
 * Command handler for markdown comments
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

        // Add comment command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.addComment', async () => {
                await this.addComment();
            })
        );

        // Edit comment command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.editComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.editComment(id);
                }
            })
        );

        // Delete comment command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.deleteComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.deleteComment(id);
                }
            })
        );

        // Resolve comment command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.resolveComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.resolveComment(id);
                }
            })
        );

        // Reopen comment command
        disposables.push(
            vscode.commands.registerCommand('markdownComments.reopenComment', async (commentId: string | CommentItem) => {
                const id = typeof commentId === 'string' ? commentId : commentId?.comment?.id;
                if (id) {
                    await this.reopenComment(id);
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

        // Go to comment location
        disposables.push(
            vscode.commands.registerCommand('markdownComments.goToComment', async (item: CommentItem) => {
                await this.goToComment(item);
            })
        );

        // Toggle show resolved
        disposables.push(
            vscode.commands.registerCommand('markdownComments.toggleShowResolved', () => {
                this.toggleShowResolved();
            })
        );

        // Refresh comments
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
     * Add a new comment at the current selection
     */
    private async addComment(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        // Check if it's a markdown file
        if (!this.isMarkdownFile(editor.document)) {
            vscode.window.showErrorMessage('Comments can only be added to markdown files');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('Please select some text to comment on');
            return;
        }

        // Get selected text
        const selectedText = editor.document.getText(selection);

        // Prompt for comment
        const comment = await vscode.window.showInputBox({
            prompt: 'Enter your comment',
            placeHolder: 'What feedback do you have for this section?',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Comment cannot be empty';
                }
                return null;
            }
        });

        if (!comment) {
            return; // User cancelled
        }

        // Convert 0-based positions to 1-based
        const selectionData = {
            startLine: selection.start.line + 1,
            startColumn: selection.start.character + 1,
            endLine: selection.end.line + 1,
            endColumn: selection.end.character + 1
        };

        try {
            await this.commentsManager.addComment(
                editor.document.uri.fsPath,
                selectionData,
                selectedText,
                comment.trim()
            );

            vscode.window.showInformationMessage('Comment added successfully');
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to add comment: ${err.message}`);
        }
    }

    /**
     * Edit an existing comment
     */
    private async editComment(commentId: string): Promise<void> {
        const comment = this.commentsManager.getComment(commentId);
        if (!comment) {
            vscode.window.showErrorMessage('Comment not found');
            return;
        }

        const newComment = await vscode.window.showInputBox({
            prompt: 'Edit your comment',
            value: comment.comment,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Comment cannot be empty';
                }
                return null;
            }
        });

        if (!newComment) {
            return; // User cancelled
        }

        try {
            await this.commentsManager.updateComment(commentId, { comment: newComment.trim() });
            vscode.window.showInformationMessage('Comment updated');
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to update comment: ${err.message}`);
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
            vscode.window.showInformationMessage('Comment deleted');
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to delete comment: ${err.message}`);
        }
    }

    /**
     * Resolve a comment
     */
    private async resolveComment(commentId: string): Promise<void> {
        try {
            await this.commentsManager.resolveComment(commentId);
            vscode.window.showInformationMessage('Comment resolved');
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
            vscode.window.showInformationMessage('Comment reopened');
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            vscode.window.showErrorMessage(`Failed to reopen comment: ${err.message}`);
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
     * Generate AI prompt and show in preview
     */
    private async generateAIPrompt(): Promise<void> {
        const openCount = this.commentsManager.getOpenCommentCount();
        if (openCount === 0) {
            vscode.window.showInformationMessage('No open comments to generate prompt from');
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
     * Generate prompt and copy directly to clipboard
     */
    private async generateAndCopyPrompt(): Promise<void> {
        const openCount = this.commentsManager.getOpenCommentCount();
        if (openCount === 0) {
            vscode.window.showInformationMessage('No open comments to generate prompt from');
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
     * Navigate to a comment's location in the file
     */
    private async goToComment(item: CommentItem): Promise<void> {
        if (!item || !item.comment) {
            return;
        }

        const comment = item.comment;
        const filePath = item.absoluteFilePath;

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // Convert 1-based to 0-based positions
            const startLine = Math.max(0, comment.selection.startLine - 1);
            const startColumn = Math.max(0, comment.selection.startColumn - 1);
            const endLine = Math.max(0, comment.selection.endLine - 1);
            const endColumn = Math.max(0, comment.selection.endColumn - 1);

            const range = new vscode.Range(
                new vscode.Position(startLine, startColumn),
                new vscode.Position(endLine, endColumn)
            );

            // Select the range and reveal it
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
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

    /**
     * Check if a document is a markdown file
     */
    private isMarkdownFile(document: vscode.TextDocument): boolean {
        return document.languageId === 'markdown' ||
            document.fileName.toLowerCase().endsWith('.md') ||
            document.fileName.toLowerCase().endsWith('.markdown');
    }
}

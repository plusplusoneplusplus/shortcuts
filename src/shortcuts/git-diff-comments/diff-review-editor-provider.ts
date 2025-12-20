/**
 * DiffReviewEditorProvider - Custom Editor Provider for Git diffs with inline comments
 * Provides a side-by-side diff view with commenting capability
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiffCommentsManager } from './diff-comments-manager';
import {
    createStagedGitContext,
    createUnstagedGitContext,
    createUntrackedGitContext,
    getDiffContent
} from './diff-content-provider';
import {
    DiffComment,
    DiffExtensionMessage,
    DiffGitContext,
    DiffSelection,
    DiffWebviewMessage
} from './types';

/**
 * DiffReviewEditorProvider - Custom readonly editor for diff review with comments
 */
export class DiffReviewEditorProvider implements vscode.Disposable {
    public static readonly viewType = 'gitDiffReviewEditor';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private activeWebviews: Map<string, vscode.WebviewPanel> = new Map();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: DiffCommentsManager
    ) {
        // Listen for comment changes to update all open webviews
        this.disposables.push(
            this.commentsManager.onDidChangeComments(event => {
                this.updateAllWebviews();
            })
        );
    }

    /**
     * Register the command to open diff review
     */
    public static registerCommands(
        context: vscode.ExtensionContext,
        commentsManager: DiffCommentsManager
    ): vscode.Disposable[] {
        const provider = new DiffReviewEditorProvider(context, commentsManager);
        
        const openCommand = vscode.commands.registerCommand(
            'gitDiffComments.openWithReview',
            async (item?: any) => {
                await provider.openDiffReview(item);
            }
        );

        const addCommentCommand = vscode.commands.registerCommand(
            'gitDiffComments.addComment',
            async () => {
                // This command is triggered by keybinding in the webview
                // The actual comment addition is handled by webview messages
            }
        );

        context.subscriptions.push(provider);

        return [openCommand, addCommentCommand, provider];
    }

    /**
     * Open a diff review for a git change item
     */
    async openDiffReview(item?: any): Promise<void> {
        if (!item) {
            vscode.window.showWarningMessage('Please select a git change to review.');
            return;
        }

        // Extract information from the git change item
        let filePath: string;
        let gitContext: DiffGitContext;
        let stage: 'staged' | 'unstaged' | 'untracked';

        // Handle different item types
        if (item.change) {
            // GitChangeItem from our tree view
            filePath = item.change.path;
            stage = item.change.stage;
            
            const repoRoot = item.change.repositoryRoot;
            const repoName = item.change.repositoryName;

            if (stage === 'staged') {
                gitContext = createStagedGitContext(repoRoot, repoName);
            } else if (stage === 'untracked') {
                gitContext = createUntrackedGitContext(repoRoot, repoName);
            } else {
                gitContext = createUnstagedGitContext(repoRoot, repoName);
            }
        } else if (item.resourceUri) {
            // VSCode SCM resource
            filePath = item.resourceUri.fsPath;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
            const repoRoot = workspaceFolder?.uri.fsPath || path.dirname(filePath);
            const repoName = path.basename(repoRoot);
            
            // Determine stage from context value or default to unstaged
            stage = 'unstaged';
            gitContext = createUnstagedGitContext(repoRoot, repoName);
        } else {
            vscode.window.showWarningMessage('Unable to determine file information.');
            return;
        }

        // Get diff content
        const relativePath = path.relative(gitContext.repositoryRoot, filePath);
        const diffResult = getDiffContent(relativePath, gitContext);

        if (diffResult.isBinary) {
            vscode.window.showWarningMessage('Cannot review binary files.');
            return;
        }

        if (diffResult.error) {
            vscode.window.showErrorMessage(`Error loading diff: ${diffResult.error}`);
            return;
        }

        // Create webview panel
        const fileName = path.basename(filePath);
        const panel = vscode.window.createWebviewPanel(
            DiffReviewEditorProvider.viewType,
            `[Diff Review] ${fileName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist')
                ]
            }
        );

        // Store reference
        this.activeWebviews.set(filePath, panel);

        // Set webview content
        panel.webview.html = this.getWebviewContent(
            panel.webview,
            relativePath,
            diffResult.oldContent,
            diffResult.newContent,
            gitContext
        );

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            async (message: DiffWebviewMessage) => {
                await this.handleWebviewMessage(
                    message,
                    relativePath,
                    gitContext,
                    diffResult.oldContent,
                    diffResult.newContent,
                    panel
                );
            },
            undefined,
            this.disposables
        );

        // Clean up when panel is closed
        panel.onDidDispose(() => {
            this.activeWebviews.delete(filePath);
        });
    }

    /**
     * Handle messages from the webview
     */
    private async handleWebviewMessage(
        message: DiffWebviewMessage,
        filePath: string,
        gitContext: DiffGitContext,
        oldContent: string,
        newContent: string,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'requestState':
                this.sendStateToWebview(panel, filePath, oldContent, newContent);
                break;

            case 'addComment':
                if (message.selection && message.comment && message.selectedText) {
                    const content = message.selection.side === 'old' ? oldContent : newContent;
                    await this.commentsManager.addComment(
                        filePath,
                        message.selection,
                        message.selectedText,
                        message.comment,
                        gitContext,
                        content
                    );
                }
                break;

            case 'editComment':
                if (message.commentId && message.comment !== undefined) {
                    await this.commentsManager.updateComment(message.commentId, {
                        comment: message.comment
                    });
                }
                break;

            case 'deleteComment':
                if (message.commentId) {
                    const confirmed = await vscode.window.showWarningMessage(
                        'Are you sure you want to delete this comment?',
                        { modal: true },
                        'Delete'
                    );
                    if (confirmed === 'Delete') {
                        await this.commentsManager.deleteComment(message.commentId);
                    }
                }
                break;

            case 'resolveComment':
                if (message.commentId) {
                    await this.commentsManager.resolveComment(message.commentId);
                }
                break;

            case 'reopenComment':
                if (message.commentId) {
                    await this.commentsManager.reopenComment(message.commentId);
                }
                break;
        }
    }

    /**
     * Send current state to webview
     */
    private sendStateToWebview(
        panel: vscode.WebviewPanel,
        filePath: string,
        oldContent: string,
        newContent: string
    ): void {
        const comments = this.commentsManager.getCommentsForFile(filePath);
        const settings = this.commentsManager.getSettings();

        const message: DiffExtensionMessage = {
            type: 'update',
            oldContent,
            newContent,
            comments,
            filePath,
            settings
        };

        panel.webview.postMessage(message);
    }

    /**
     * Update all open webviews with latest comments
     */
    private updateAllWebviews(): void {
        for (const [filePath, panel] of this.activeWebviews) {
            const comments = this.commentsManager.getCommentsForFile(filePath);
            const settings = this.commentsManager.getSettings();

            const message: DiffExtensionMessage = {
                type: 'update',
                comments,
                filePath,
                settings
            };

            panel.webview.postMessage(message);
        }
    }

    /**
     * Generate webview HTML content
     */
    private getWebviewContent(
        webview: vscode.Webview,
        filePath: string,
        oldContent: string,
        newContent: string,
        gitContext: DiffGitContext
    ): string {
        // Get URIs for styles
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles', 'diff-webview.css')
        );

        const commentsStyleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles', 'diff-comments.css')
        );

        // Get URI for script
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'diff-webview.js')
        );

        // Escape content for embedding in HTML
        const escapeHtml = (str: string) => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${commentsStyleUri}" rel="stylesheet">
    <title>Diff Review: ${escapeHtml(filePath)}</title>
</head>
<body>
    <div id="diff-container">
        <div class="diff-header">
            <h2 class="diff-title">${escapeHtml(filePath)}</h2>
            <div class="diff-info">
                <span class="diff-repo">${escapeHtml(gitContext.repositoryName)}</span>
                <span class="diff-refs">${escapeHtml(gitContext.oldRef)} → ${escapeHtml(gitContext.newRef)}</span>
                <button class="view-mode-toggle" id="view-mode-toggle" title="Toggle between split and inline view">
                    <span class="toggle-icon" id="toggle-icon">⫼</span>
                    <span class="toggle-label" id="toggle-label">Split</span>
                </button>
            </div>
        </div>
        <div class="diff-view-container" id="diff-view-container">
            <div class="diff-pane old-pane">
                <div class="pane-header">Old Version</div>
                <div class="pane-content" id="old-content"></div>
            </div>
            <div class="diff-pane new-pane">
                <div class="pane-header">New Version</div>
                <div class="pane-content" id="new-content"></div>
            </div>
            <div class="inline-diff-pane">
                <div class="pane-header">Unified Diff</div>
                <div class="pane-content" id="inline-content"></div>
            </div>
        </div>
    </div>

    <!-- Comment Panel (hidden by default) -->
    <div id="comment-panel" class="comment-panel hidden">
        <div class="comment-panel-header">
            <span class="comment-panel-title">Add Comment</span>
            <button class="comment-panel-close" id="close-panel">&times;</button>
        </div>
        <div class="comment-panel-body">
            <div class="selected-text-preview" id="selected-text-preview"></div>
            <textarea id="comment-input" placeholder="Enter your comment..."></textarea>
        </div>
        <div class="comment-panel-footer">
            <button class="btn btn-secondary" id="cancel-comment">Cancel</button>
            <button class="btn btn-primary" id="submit-comment">Add Comment</button>
        </div>
    </div>

    <!-- Existing Comments List -->
    <div id="comments-list" class="comments-list hidden">
        <div class="comments-list-header">
            <span>Comments</span>
            <button class="comments-list-close" id="close-comments-list">&times;</button>
        </div>
        <div class="comments-list-body" id="comments-list-body"></div>
    </div>

    <!-- Initial data -->
    <script nonce="${nonce}">
        window.initialData = {
            filePath: ${JSON.stringify(filePath)},
            oldContent: ${JSON.stringify(oldContent)},
            newContent: ${JSON.stringify(newContent)},
            gitContext: ${JSON.stringify(gitContext)}
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.activeWebviews.clear();
        this._onDidChangeCustomDocument.dispose();
    }
}


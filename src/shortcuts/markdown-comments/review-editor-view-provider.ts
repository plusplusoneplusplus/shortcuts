/**
 * Review Editor View - Custom Editor Provider for Markdown files with inline comments
 * Provides a rich editing experience with comments displayed alongside content
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { MarkdownComment } from './types';
import { getWebviewContent } from './webview-content';

/**
 * Message types from webview to extension
 */
interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
    'reopenComment' | 'updateContent' | 'ready' | 'generatePrompt' |
    'copyPrompt' | 'resolveAll' | 'requestState';
    commentId?: string;
    content?: string;
    selection?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
        selectedText: string;
    };
    comment?: string;
    promptOptions?: {
        includeFileContent: boolean;
        format: 'markdown' | 'json';
    };
}

/**
 * Review Editor View - Custom editor provider for markdown files with inline comments
 */
export class ReviewEditorViewProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'reviewEditorView';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: CommentsManager
    ) { }

    /**
     * Register the Review Editor View provider
     */
    public static register(
        context: vscode.ExtensionContext,
        commentsManager: CommentsManager
    ): vscode.Disposable {
        const provider = new ReviewEditorViewProvider(context, commentsManager);

        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ReviewEditorViewProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                    enableFindWidget: true
                },
                supportsMultipleEditorsPerDocument: false
            }
        );

        return providerRegistration;
    }

    /**
     * Called when a custom editor is opened
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        // Get the relative file path for comment lookup
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const relativePath = path.relative(workspaceRoot, document.uri.fsPath);

        // Initial state
        const updateWebview = () => {
            const comments = this.commentsManager.getCommentsForFile(relativePath);
            const settings = this.commentsManager.getSettings();

            webviewPanel.webview.postMessage({
                type: 'update',
                content: document.getText(),
                comments: comments,
                filePath: relativePath,
                settings: settings
            });
        };

        // Set HTML content
        webviewPanel.webview.html = getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri
        );

        // Handle messages from webview
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                await this.handleWebviewMessage(message, document, relativePath, webviewPanel, updateWebview);
            }
        );

        // Listen for document changes
        const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // Listen for comment changes
        const commentsChangeDisposable = this.commentsManager.onDidChangeComments(event => {
            if (!event.filePath || event.filePath === relativePath) {
                updateWebview();
            }
        });

        // Clean up when editor is closed
        webviewPanel.onDidDispose(() => {
            messageDisposable.dispose();
            documentChangeDisposable.dispose();
            commentsChangeDisposable.dispose();
        });

        // Initial update after webview is ready
        // The webview will send a 'ready' message when it's loaded
    }

    /**
     * Handle messages from the webview
     */
    private async handleWebviewMessage(
        message: WebviewMessage,
        document: vscode.TextDocument,
        relativePath: string,
        webviewPanel: vscode.WebviewPanel,
        updateWebview: () => void
    ): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'requestState':
                updateWebview();
                break;

            case 'addComment':
                if (message.selection && message.comment) {
                    await this.commentsManager.addComment(
                        relativePath,
                        {
                            startLine: message.selection.startLine,
                            startColumn: message.selection.startColumn,
                            endLine: message.selection.endLine,
                            endColumn: message.selection.endColumn
                        },
                        message.selection.selectedText,
                        message.comment
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

            case 'resolveAll':
                const count = await this.commentsManager.resolveAllComments();
                vscode.window.showInformationMessage(`Resolved ${count} comment(s).`);
                break;

            case 'updateContent':
                if (message.content !== undefined) {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        message.content
                    );
                    await vscode.workspace.applyEdit(edit);
                }
                break;

            case 'generatePrompt':
                await this.generateAndShowPrompt(relativePath, message.promptOptions);
                break;

            case 'copyPrompt':
                await this.generateAndCopyPrompt(relativePath, message.promptOptions);
                break;
        }
    }

    /**
     * Generate AI prompt and show in new document
     */
    private async generateAndShowPrompt(
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json' }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open');

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments to generate prompt from.');
            return;
        }

        const prompt = this.generatePromptText(comments, filePath, options);

        const doc = await vscode.workspace.openTextDocument({
            content: prompt,
            language: options?.format === 'json' ? 'json' : 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Generate AI prompt and copy to clipboard
     */
    private async generateAndCopyPrompt(
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json' }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open');

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open comments to generate prompt from.');
            return;
        }

        const prompt = this.generatePromptText(comments, filePath, options);
        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('AI prompt copied to clipboard!');
    }

    /**
     * Generate prompt text from comments
     */
    private generatePromptText(
        comments: MarkdownComment[],
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json' }
    ): string {
        const format = options?.format || 'markdown';

        if (format === 'json') {
            return JSON.stringify({
                task: 'Review and address the following comments in the markdown document',
                file: filePath,
                comments: comments.map(c => ({
                    id: c.id,
                    lineRange: c.selection.startLine === c.selection.endLine
                        ? `Line ${c.selection.startLine}`
                        : `Lines ${c.selection.startLine}-${c.selection.endLine}`,
                    selectedText: c.selectedText,
                    comment: c.comment,
                    author: c.author
                })),
                instructions: 'For each comment, modify the corresponding section to address the feedback.'
            }, null, 2);
        }

        // Markdown format
        const lines: string[] = [
            '# Document Revision Request',
            '',
            `**File:** ${filePath}`,
            `**Open Comments:** ${comments.length}`,
            '',
            '---',
            '',
            '## Comments to Address',
            ''
        ];

        comments.forEach((comment, index) => {
            const lineRange = comment.selection.startLine === comment.selection.endLine
                ? `Line ${comment.selection.startLine}`
                : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;

            lines.push(`### Comment ${index + 1}`);
            lines.push('');
            lines.push(`**Location:** ${lineRange}`);
            if (comment.author) {
                lines.push(`**Author:** ${comment.author}`);
            }
            lines.push('');
            lines.push('**Selected Text:**');
            lines.push('```');
            lines.push(comment.selectedText);
            lines.push('```');
            lines.push('');
            lines.push('**Comment:**');
            lines.push(`> ${comment.comment}`);
            lines.push('');
            lines.push('---');
            lines.push('');
        });

        lines.push('## Instructions');
        lines.push('');
        lines.push('For each comment above, modify the corresponding section in the document to address the feedback.');

        return lines.join('\n');
    }
}

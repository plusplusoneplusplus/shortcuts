/**
 * Review Editor View - Custom Editor Provider for Markdown files with inline comments
 * Provides a rich editing experience with comments displayed alongside content
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentsManager } from './comments-manager';
import { MarkdownComment } from './types';
import { getWebviewContent } from './webview-content';

import { MermaidContext } from './types';

/**
 * Message types from webview to extension
 */
interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
    'reopenComment' | 'updateContent' | 'ready' | 'generatePrompt' |
    'copyPrompt' | 'resolveAll' | 'deleteAll' | 'requestState' | 'resolveImagePath';
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
    mermaidContext?: MermaidContext;
    // Image resolution fields
    path?: string;
    imgId?: string;
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
        // Get the relative file path for comment lookup
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        const relativePath = path.relative(workspaceRoot, document.uri.fsPath);

        // Set the tab title to indicate this is the Review Editor
        const fileName = path.basename(document.uri.fsPath);
        webviewPanel.title = `[Review] ${fileName}`;
        const fileDir = path.dirname(document.uri.fsPath);

        // Setup webview with local resource roots including workspace folder for images
        const localResourceRoots: vscode.Uri[] = [
            vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            vscode.Uri.joinPath(this.context.extensionUri, 'dist') // For webview.js bundle
        ];

        // Add workspace folder to allow loading images from workspace
        if (workspaceUri) {
            localResourceRoots.push(workspaceUri);
        }

        // Add file's directory for relative image paths
        localResourceRoots.push(vscode.Uri.file(fileDir));

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots
        };

        // Track when changes originate from the webview to avoid re-rendering
        let isWebviewEdit = false;

        // Initial state
        const updateWebview = () => {
            const content = document.getText();
            const comments = this.commentsManager.getCommentsForFile(relativePath);
            const settings = this.commentsManager.getSettings();

            console.log('[Extension] updateWebview called - content length:', content.length);
            console.log('[Extension] updateWebview - content preview:', content.substring(0, 200));

            webviewPanel.webview.postMessage({
                type: 'update',
                content: content,
                comments: comments,
                filePath: relativePath,
                fileDir: fileDir,
                workspaceRoot: workspaceRoot,
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
                await this.handleWebviewMessage(message, document, relativePath, webviewPanel, updateWebview, () => isWebviewEdit = true);
            }
        );

        // Listen for document changes
        const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                console.log('[Extension] onDidChangeTextDocument - isWebviewEdit:', isWebviewEdit);
                // Skip re-rendering if the change came from the webview itself
                if (isWebviewEdit) {
                    console.log('[Extension] Skipping updateWebview (webview-initiated edit)');
                    isWebviewEdit = false;
                    return;
                }
                console.log('[Extension] Calling updateWebview (external change)');
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
        updateWebview: () => void,
        setWebviewEdit: () => void
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
                        message.comment,
                        undefined, // author
                        undefined, // tags
                        message.mermaidContext // mermaid context for diagram comments
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
                const resolveCount = await this.commentsManager.resolveAllComments();
                vscode.window.showInformationMessage(`Resolved ${resolveCount} comment(s).`);
                break;

            case 'deleteAll':
                const totalComments = this.commentsManager.getAllComments().length;
                if (totalComments === 0) {
                    vscode.window.showInformationMessage('No comments to delete.');
                    break;
                }
                const confirmed = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete all ${totalComments} comment(s)? This action cannot be undone.`,
                    { modal: true },
                    'Delete All'
                );
                if (confirmed === 'Delete All') {
                    const deleteCount = await this.commentsManager.deleteAllComments();
                    vscode.window.showInformationMessage(`Deleted ${deleteCount} comment(s).`);
                }
                break;

            case 'updateContent':
                if (message.content !== undefined) {
                    // Mark this as a webview-initiated edit to prevent re-rendering
                    setWebviewEdit();
                    const edit = new vscode.WorkspaceEdit();
                    // Use full document range to ensure all content is replaced
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(document.getText().length)
                    );
                    edit.replace(document.uri, fullRange, message.content);
                    await vscode.workspace.applyEdit(edit);
                }
                break;

            case 'generatePrompt':
                await this.generateAndShowPrompt(relativePath, message.promptOptions);
                break;

            case 'copyPrompt':
                await this.generateAndCopyPrompt(relativePath, message.promptOptions);
                break;

            case 'resolveImagePath':
                if (message.path && message.imgId) {
                    await this.resolveAndSendImagePath(
                        message.path,
                        message.imgId,
                        document,
                        webviewPanel
                    );
                }
                break;
        }
    }

    /**
     * Resolve an image path and send the webview URI back to the webview
     */
    private async resolveAndSendImagePath(
        imagePath: string,
        imgId: string,
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const fileDir = path.dirname(document.uri.fsPath);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

            let resolvedPath: string;

            // Check if it's an absolute path
            if (path.isAbsolute(imagePath)) {
                resolvedPath = imagePath;
            }
            // Check if it's relative to the file's directory
            else {
                resolvedPath = path.resolve(fileDir, imagePath);
            }

            // Check if file exists
            const fs = require('fs');
            if (fs.existsSync(resolvedPath)) {
                // Convert to webview URI
                const imageUri = vscode.Uri.file(resolvedPath);
                const webviewUri = webviewPanel.webview.asWebviewUri(imageUri);

                webviewPanel.webview.postMessage({
                    type: 'imageResolved',
                    imgId: imgId,
                    uri: webviewUri.toString(),
                    alt: path.basename(imagePath)
                });
            } else {
                // Try workspace-relative path
                const workspaceRelativePath = path.resolve(workspaceRoot, imagePath);
                if (fs.existsSync(workspaceRelativePath)) {
                    const imageUri = vscode.Uri.file(workspaceRelativePath);
                    const webviewUri = webviewPanel.webview.asWebviewUri(imageUri);

                    webviewPanel.webview.postMessage({
                        type: 'imageResolved',
                        imgId: imgId,
                        uri: webviewUri.toString(),
                        alt: path.basename(imagePath)
                    });
                } else {
                    // Image not found
                    webviewPanel.webview.postMessage({
                        type: 'imageResolved',
                        imgId: imgId,
                        uri: null,
                        error: `Image not found: ${imagePath}`
                    });
                }
            }
        } catch (error) {
            webviewPanel.webview.postMessage({
                type: 'imageResolved',
                imgId: imgId,
                uri: null,
                error: `Error resolving image: ${error}`
            });
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

/**
 * Review Editor View - Custom Editor Provider for Markdown files with inline comments
 * Provides a rich editing experience with comments displayed alongside content
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcessManager, getAICommandRegistry } from '../ai-service';
import { handleAIClarification } from './ai-clarification-handler';
import { CommentsManager } from './comments-manager';
import { isExternalUrl, isMarkdownFile, resolveFilePath } from './file-path-utils';
import { ClarificationContext, isUserComment, MarkdownComment, MermaidContext } from './types';
import { getWebviewContent } from './webview-content';

/**
 * Message types from webview to extension
 */
/**
 * Context data for AI clarification requests from the webview
 */
interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    /** Command ID from the AI command registry */
    instructionType: string;
    customInstruction?: string;
}

interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
    'reopenComment' | 'updateContent' | 'ready' | 'generatePrompt' |
    'copyPrompt' | 'resolveAll' | 'deleteAll' | 'requestState' | 'resolveImagePath' | 'openFile' | 'askAI';
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
    // AI clarification context
    context?: AskAIContext;
}

/**
 * Review Editor View - Custom editor provider for markdown files with inline comments
 */
export class ReviewEditorViewProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'reviewEditorView';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    // Track active webview panels by file path for external communication
    private static activeWebviews = new Map<string, vscode.WebviewPanel>();
    
    // Pending scroll requests (commentId to scroll to after file opens)
    private static pendingScrollRequests = new Map<string, string>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: CommentsManager,
        private readonly aiProcessManager?: AIProcessManager
    ) { }

    /**
     * Request to scroll to a comment when the file is opened
     * @param filePath The file path (can be absolute or relative)
     * @param commentId The comment ID to scroll to
     */
    public static requestScrollToComment(filePath: string, commentId: string): void {
        // Normalize the file path
        const normalizedPath = filePath.replace(/\\/g, '/');
        
        // Check if webview is already open for this file
        const existingWebview = this.activeWebviews.get(normalizedPath);
        if (existingWebview) {
            // Send scroll message immediately
            existingWebview.webview.postMessage({
                type: 'scrollToComment',
                commentId: commentId
            });
        } else {
            // Store as pending request - will be processed when file opens
            this.pendingScrollRequests.set(normalizedPath, commentId);
        }
    }

    /**
     * Register the Review Editor View provider
     */
    public static register(
        context: vscode.ExtensionContext,
        commentsManager: CommentsManager,
        aiProcessManager?: AIProcessManager
    ): vscode.Disposable {
        const provider = new ReviewEditorViewProvider(context, commentsManager, aiProcessManager);

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

        // Normalize file path for tracking (use forward slashes)
        const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/');
        
        // Track this webview panel for external communication
        ReviewEditorViewProvider.activeWebviews.set(normalizedFilePath, webviewPanel);

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
        // Using a timestamp instead of boolean to handle multiple document change events
        // that can fire for a single edit operation
        let webviewEditUntil = 0;

        // Track previous content for change detection
        let previousContent = document.getText();

        // Initial state - simple update without relocation
        const updateWebview = () => {
            const content = document.getText();
            const comments = this.commentsManager.getCommentsForFile(relativePath);
            const baseSettings = this.commentsManager.getSettings();

            // Add Ask AI enabled setting and commands from VS Code configuration
            const askAIEnabled = vscode.workspace.getConfiguration('workspaceShortcuts.aiService').get<boolean>('enabled', false);
            const aiCommands = getAICommandRegistry().getSerializedCommands();
            const settings = { ...baseSettings, askAIEnabled, aiCommands };

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

            previousContent = content;
        };

        // Update webview with comment relocation for external changes (undo/redo, external edits)
        const updateWebviewWithRelocation = async () => {
            const content = document.getText();
            const contentChanged = content !== previousContent;

            // Check if any comments need relocation based on anchors
            const needsRelocationIds = this.commentsManager.checkNeedsRelocation(relativePath, content);

            if (needsRelocationIds.length > 0) {
                console.log('[Extension] Relocating', needsRelocationIds.length, 'comments due to content change');
                // Relocate comments using anchor-based tracking
                const results = await this.commentsManager.relocateCommentsForFile(relativePath, content);

                // Log relocation results for debugging
                for (const [commentId, result] of results) {
                    console.log(`[Extension] Comment ${commentId}: ${result.reason} (confidence: ${result.confidence})`);
                }
            }

            // Now update the webview with relocated comments
            const comments = this.commentsManager.getCommentsForFile(relativePath);
            const baseSettings = this.commentsManager.getSettings();

            // Add Ask AI enabled setting and commands from VS Code configuration
            const askAIEnabled = vscode.workspace.getConfiguration('workspaceShortcuts.aiService').get<boolean>('enabled', false);
            const aiCommands = getAICommandRegistry().getSerializedCommands();
            const settings = { ...baseSettings, askAIEnabled, aiCommands };

            webviewPanel.webview.postMessage({
                type: 'update',
                content: content,
                comments: comments,
                filePath: relativePath,
                fileDir: fileDir,
                workspaceRoot: workspaceRoot,
                settings: settings,
                isExternalChange: contentChanged
            });

            previousContent = content;
        };

        // Set HTML content
        webviewPanel.webview.html = getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri
        );

        // Handle messages from webview
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                // Set a timestamp window (100ms) during which we ignore document changes
                // This handles multiple document change events that can fire for a single edit
                await this.handleWebviewMessage(message, document, relativePath, webviewPanel, updateWebview, () => {
                    webviewEditUntil = Date.now() + 100;
                });
            }
        );

        // Listen for document changes
        const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                const now = Date.now();
                const isWebviewEdit = now < webviewEditUntil;
                console.log('[Extension] onDidChangeTextDocument - isWebviewEdit:', isWebviewEdit, 'timeRemaining:', webviewEditUntil - now);
                // Skip re-rendering if the change came from the webview itself
                if (isWebviewEdit) {
                    console.log('[Extension] Skipping updateWebview (webview-initiated edit)');
                    return;
                }
                // For external changes (undo/redo, external edits), use relocation
                console.log('[Extension] Calling updateWebviewWithRelocation (external change)');
                updateWebviewWithRelocation();
            }
        });

        // Listen for comment changes
        const commentsChangeDisposable = this.commentsManager.onDidChangeComments(event => {
            if (!event.filePath || event.filePath === relativePath) {
                updateWebview();
            }
        });

        // Listen for configuration changes (especially AI service settings)
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('workspaceShortcuts.aiService')) {
                updateWebview();
            }
        });

        // Clean up when editor is closed
        webviewPanel.onDidDispose(() => {
            messageDisposable.dispose();
            documentChangeDisposable.dispose();
            commentsChangeDisposable.dispose();
            configChangeDisposable.dispose();
            
            // Remove from active webviews tracking
            ReviewEditorViewProvider.activeWebviews.delete(normalizedFilePath);
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
        // Normalize file path for pending scroll lookup
        const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/');
        
        switch (message.type) {
            case 'ready':
            case 'requestState':
                updateWebview();
                
                // Check for pending scroll request after webview is ready
                // Use a small delay to ensure the webview has rendered the content
                const pendingCommentId = ReviewEditorViewProvider.pendingScrollRequests.get(normalizedFilePath);
                if (pendingCommentId) {
                    ReviewEditorViewProvider.pendingScrollRequests.delete(normalizedFilePath);
                    // Delay the scroll to ensure content is fully rendered
                    setTimeout(() => {
                        webviewPanel.webview.postMessage({
                            type: 'scrollToComment',
                            commentId: pendingCommentId
                        });
                    }, 100);
                }
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
                    'Sign Off'
                );
                if (confirmed === 'Sign Off') {
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

            case 'openFile':
                if (message.path) {
                    await this.openFileFromPath(message.path, document);
                }
                break;

            case 'askAI':
                if (message.context) {
                    await this.handleAskAI(message.context, relativePath);
                }
                break;
        }
    }

    /**
     * Handle AI clarification request from the webview
     */
    private async handleAskAI(context: AskAIContext, filePath: string): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        // Convert webview context to ClarificationContext
        const clarificationContext: ClarificationContext = {
            selectedText: context.selectedText,
            selectionRange: {
                startLine: context.startLine,
                endLine: context.endLine
            },
            filePath: filePath,
            surroundingContent: context.surroundingLines,
            nearestHeading: context.nearestHeading,
            headings: context.allHeadings,
            instructionType: context.instructionType,
            customInstruction: context.customInstruction
        };

        // Delegate to the AI clarification handler
        const result = await handleAIClarification(clarificationContext, workspaceRoot, this.aiProcessManager);

        // If successful, automatically add clarification as a comment
        if (result.success && result.clarification) {
            // Determine the label based on instruction type
            const labelMap: Record<string, string> = {
                'clarify': '🤖 **AI Clarification:**',
                'go-deeper': '🔍 **AI Deep Analysis:**',
                'custom': '🤖 **AI Response:**'
            };
            const label = labelMap[context.instructionType] || '🤖 **AI Clarification:**';

            // Add the clarification as a comment on the selected text
            // Use 'ai-clarification' type for distinct visual styling
            await this.commentsManager.addComment(
                filePath,
                {
                    startLine: context.startLine,
                    startColumn: 1,
                    endLine: context.endLine,
                    endColumn: context.selectedText.length + 1
                },
                context.selectedText,
                `${label}\n\n${result.clarification}`,
                'AI Assistant',
                undefined,  // tags
                undefined,  // mermaidContext
                'ai-clarification'  // type
            );

            // Show a brief notification with option to copy
            vscode.window.showInformationMessage(
                'AI response added as comment.',
                'Copy to Clipboard'
            ).then(action => {
                if (action === 'Copy to Clipboard') {
                    vscode.env.clipboard.writeText(result.clarification!);
                }
            });
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
     * Open a file from a path in the markdown link
     * Supports absolute paths, paths relative to the file, and paths relative to workspace
     * For .md files, opens in Review Editor View; for other files, opens in text editor
     */
    private async openFileFromPath(
        filePath: string,
        document: vscode.TextDocument
    ): Promise<void> {
        try {
            const fileDir = path.dirname(document.uri.fsPath);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

            // Skip external URLs (http, https, mailto, etc.)
            if (isExternalUrl(filePath)) {
                // Open external URLs in browser
                await vscode.env.openExternal(vscode.Uri.parse(filePath));
                return;
            }

            // Resolve the file path
            const resolved = resolveFilePath(filePath, fileDir, workspaceRoot);

            if (resolved.exists) {
                const fileUri = vscode.Uri.file(resolved.resolvedPath);
                await this.openFileUri(fileUri);
            } else {
                // File not found
                vscode.window.showWarningMessage(`File not found: ${filePath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    /**
     * Open a file URI, using Review Editor View for markdown files
     */
    private async openFileUri(fileUri: vscode.Uri): Promise<void> {
        if (isMarkdownFile(fileUri.fsPath)) {
            // Open markdown files in Review Editor View
            await vscode.commands.executeCommand(
                'vscode.openWith',
                fileUri,
                ReviewEditorViewProvider.viewType
            );
        } else {
            // Open other files in regular text editor
            await vscode.window.showTextDocument(fileUri);
        }
    }

    /**
     * Generate AI prompt and show in new document.
     * Only includes user comments, excluding AI-generated comments.
     */
    private async generateAndShowPrompt(
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json' }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from.');
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
     * Generate AI prompt and copy to clipboard.
     * Only includes user comments, excluding AI-generated comments.
     */
    private async generateAndCopyPrompt(
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json' }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from.');
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

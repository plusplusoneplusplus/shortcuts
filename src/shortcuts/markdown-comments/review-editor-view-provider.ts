/**
 * Review Editor View - Custom Editor Provider for Markdown files with inline comments
 * Provides a rich editing experience with comments displayed alongside content.
 *
 * Business logic is delegated to EditorMessageRouter; platform calls go through VscodeEditorHost.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { 
    getAICommandRegistry, 
    IAIProcessManager
} from '../ai-service';
import { getPredefinedCommentRegistry } from '../shared/predefined-comment-registry';
import { getWorkspaceRoot, getWorkspaceRootUri } from '../shared/workspace-utils';
import { CodeBlockTheme } from './code-block-themes';
import { CommentsManager } from './comments-manager';
import { computeLineChanges } from './line-change-tracker';
import { getWebviewContent, WebviewContentOptions } from './webview-content';
import { MessageContext } from './editor-host';
import { EditorMessageRouter, WebviewMessage } from './editor-message-router';
import { VscodeEditorHost } from './vscode-editor-host';

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

    /** Storage key prefix for collapsed sections (per file) */
    private static readonly COLLAPSED_SECTIONS_KEY_PREFIX = 'mdReview.collapsedSections.';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: CommentsManager,
        private readonly aiProcessManager?: IAIProcessManager
    ) {}

    /**
     * Get collapsed sections for a file from storage
     */
    private getCollapsedSections(filePath: string): string[] {
        const key = ReviewEditorViewProvider.COLLAPSED_SECTIONS_KEY_PREFIX + filePath;
        return this.context.workspaceState.get<string[]>(key, []);
    }

    /**
     * Get webview content options based on current settings and theme
     */
    private getWebviewContentOptions(): WebviewContentOptions {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const codeBlockTheme = config.get<CodeBlockTheme>('codeBlockTheme', 'auto');

        // Get current VSCode theme kind
        const themeKind = vscode.window.activeColorTheme.kind;
        let vscodeThemeKind: WebviewContentOptions['vscodeThemeKind'];

        switch (themeKind) {
            case vscode.ColorThemeKind.Light:
                vscodeThemeKind = 'light';
                break;
            case vscode.ColorThemeKind.Dark:
                vscodeThemeKind = 'dark';
                break;
            case vscode.ColorThemeKind.HighContrast:
                vscodeThemeKind = 'high-contrast';
                break;
            case vscode.ColorThemeKind.HighContrastLight:
                vscodeThemeKind = 'high-contrast-light';
                break;
            default:
                vscodeThemeKind = 'dark';
        }

        return {
            codeBlockTheme,
            vscodeThemeKind
        };
    }

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
        aiProcessManager?: IAIProcessManager
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
        const workspaceRoot = getWorkspaceRoot() || '';
        const workspaceUri = getWorkspaceRootUri();
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
            const aiMenuConfig = getAICommandRegistry().getSerializedMenuConfig();
            const predefinedComments = getPredefinedCommentRegistry().getSerializedMarkdownComments();
            const collapsedSections = this.getCollapsedSections(relativePath);
            const settings = { ...baseSettings, askAIEnabled, aiCommands, aiMenuConfig, predefinedComments, collapsedSections };

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

            // Compute line-level changes for visual indicators
            const lineChanges = contentChanged
                ? computeLineChanges(previousContent, content)
                : [];

            if (lineChanges.length > 0) {
                console.log('[Extension] Detected', lineChanges.length, 'line changes');
            }

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
            const aiMenuConfig = getAICommandRegistry().getSerializedMenuConfig();
            const predefinedComments = getPredefinedCommentRegistry().getSerializedMarkdownComments();
            const collapsedSections = this.getCollapsedSections(relativePath);
            const settings = { ...baseSettings, askAIEnabled, aiCommands, aiMenuConfig, predefinedComments, collapsedSections };

            webviewPanel.webview.postMessage({
                type: 'update',
                content: content,
                comments: comments,
                filePath: relativePath,
                fileDir: fileDir,
                workspaceRoot: workspaceRoot,
                settings: settings,
                isExternalChange: contentChanged,
                lineChanges: lineChanges
            });

            previousContent = content;
        };

        // Set HTML content with code block theme
        webviewPanel.webview.html = getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
            this.getWebviewContentOptions()
        );

        // Create per-editor host and router instances
        const host = new VscodeEditorHost(webviewPanel, this.context, document);
        const router = new EditorMessageRouter(host, this.commentsManager, this.aiProcessManager);

        // Handle messages from webview
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                const ctx: MessageContext = {
                    documentText: document.getText(),
                    documentPath: document.uri.fsPath,
                    relativePath,
                    fileDir,
                    workspaceRoot
                };

                // Handle ready/requestState locally (needs updateWebview callback)
                if (message.type === 'ready' || message.type === 'requestState') {
                    updateWebview();
                    router.handlePendingScroll(
                        normalizedFilePath,
                        ReviewEditorViewProvider.pendingScrollRequests,
                        (msg) => webviewPanel.webview.postMessage(msg)
                    );
                    return;
                }

                const result = await router.dispatch(message, ctx);

                if (result.shouldMarkWebviewEdit) {
                    webviewEditUntil = Date.now() + 200;
                }
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

        // Listen for configuration changes (AI service settings and code block theme)
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('workspaceShortcuts.aiService')) {
                updateWebview();
            }
            // Update webview HTML when code block theme changes
            if (event.affectsConfiguration('workspaceShortcuts.markdownComments.codeBlockTheme')) {
                webviewPanel.webview.html = getWebviewContent(
                    webviewPanel.webview,
                    this.context.extensionUri,
                    this.getWebviewContentOptions()
                );
                updateWebview();
            }
        });

        // Listen for theme changes (for 'auto' mode)
        const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
            const codeBlockTheme = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments')
                .get<CodeBlockTheme>('codeBlockTheme', 'auto');
            // Only refresh if using 'auto' mode
            if (codeBlockTheme === 'auto') {
                webviewPanel.webview.html = getWebviewContent(
                    webviewPanel.webview,
                    this.context.extensionUri,
                    this.getWebviewContentOptions()
                );
                updateWebview();
            }
        });

        // Clean up when editor is closed
        webviewPanel.onDidDispose(() => {
            messageDisposable.dispose();
            documentChangeDisposable.dispose();
            commentsChangeDisposable.dispose();
            configChangeDisposable.dispose();
            themeChangeDisposable.dispose();

            // Remove from active webviews tracking
            ReviewEditorViewProvider.activeWebviews.delete(normalizedFilePath);
        });

        // Initial update after webview is ready
        // The webview will send a 'ready' message when it's loaded
    }

}

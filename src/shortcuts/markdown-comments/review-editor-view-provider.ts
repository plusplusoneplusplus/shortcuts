/**
 * Review Editor View - Custom Editor Provider for Markdown files with inline comments
 * Provides a rich editing experience with comments displayed alongside content
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IAIProcessManager, getAICommandRegistry, getInteractiveSessionManager } from '../ai-service';
import { getPredefinedCommentRegistry } from '../shared/predefined-comment-registry';
import { getPromptFiles } from '../shared/prompt-files-utils';
import { getSkills } from '../shared/skill-files-utils';
import { getWorkspaceRoot, getWorkspaceRootUri } from '../shared/workspace-utils';
import { handleAIClarification } from './ai-clarification-handler';
import { CodeBlockTheme } from './code-block-themes';
import { CommentsManager } from './comments-manager';
import { computeLineChanges } from './line-change-tracker';
import { isExternalUrl, isMarkdownFile, parseLineFragment, resolveFilePath } from './file-path-utils';
import { PromptGenerator } from './prompt-generator';
import { ClarificationContext, isUserComment, MarkdownComment, MermaidContext } from './types';
import { getWebviewContent, WebviewContentOptions } from './webview-content';

/**
 * Message types from webview to extension
 */
/**
 * Mode for AI command execution
 */
type AICommandMode = 'comment' | 'interactive';

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
    /** Mode for AI command execution ('comment' or 'interactive') */
    mode: AICommandMode;
    /** Optional path to prompt file to include as context */
    promptFilePath?: string;
    /** Optional skill name to use for this request */
    skillName?: string;
}

interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
    'reopenComment' | 'updateContent' | 'ready' | 'generatePrompt' |
    'copyPrompt' | 'sendToChat' | 'sendCommentToChat' | 'sendToCLIInteractive' | 'resolveAll' | 'deleteAll' | 'requestState' | 'resolveImagePath' | 'openFile' | 'askAI' | 'askAIInteractive' | 'collapsedSectionsChanged' | 'requestPromptFiles' | 'requestSkills' | 'executeWorkPlan' | 'promptSearch';
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
        newConversation?: boolean;
    };
    mermaidContext?: MermaidContext;
    // Image resolution fields
    path?: string;
    imgId?: string;
    // AI clarification context
    context?: AskAIContext;
    // Send comment to chat fields
    newConversation?: boolean;
    // Collapsed sections for heading collapse feature
    collapsedSections?: string[];
    // Execute Work Plan fields
    promptFilePath?: string;
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

    private readonly promptGenerator: PromptGenerator;

    /** Storage key prefix for collapsed sections (per file) */
    private static readonly COLLAPSED_SECTIONS_KEY_PREFIX = 'mdReview.collapsedSections.';
    
    /** Storage key for recent prompts */
    private static readonly RECENT_PROMPTS_KEY = 'workspaceShortcuts.recentPrompts';
    
    /** Maximum number of recent prompts to track */
    private static readonly MAX_RECENT_PROMPTS = 5;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: CommentsManager,
        private readonly aiProcessManager?: IAIProcessManager
    ) {
        this.promptGenerator = new PromptGenerator(commentsManager);
    }

    /**
     * Get collapsed sections for a file from storage
     */
    private getCollapsedSections(filePath: string): string[] {
        const key = ReviewEditorViewProvider.COLLAPSED_SECTIONS_KEY_PREFIX + filePath;
        return this.context.workspaceState.get<string[]>(key, []);
    }

    /**
     * Save collapsed sections for a file to storage
     */
    private async setCollapsedSections(filePath: string, sections: string[]): Promise<void> {
        const key = ReviewEditorViewProvider.COLLAPSED_SECTIONS_KEY_PREFIX + filePath;
        await this.context.workspaceState.update(key, sections);
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

        // Handle messages from webview
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                // Set a timestamp window (200ms) during which we ignore document changes
                // This handles multiple document change events that can fire for a single edit
                // Increased from 100ms to 200ms to better handle Ctrl+S save operations
                await this.handleWebviewMessage(message, document, relativePath, webviewPanel, updateWebview, () => {
                    webviewEditUntil = Date.now() + 200;
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

            case 'sendToChat':
                await this.generateAndSendToChat(relativePath, message.promptOptions);
                break;

            case 'sendCommentToChat':
                if (message.commentId) {
                    await this.generateAndSendCommentToChat(message.commentId, message.newConversation ?? true);
                }
                break;

            case 'sendToCLIInteractive':
                await this.generateAndSendToCLIInteractive(relativePath, message.promptOptions);
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

            case 'askAIInteractive':
                if (message.context) {
                    await this.handleAskAIInteractive(message.context, relativePath);
                }
                break;

            case 'collapsedSectionsChanged':
                if (message.collapsedSections) {
                    await this.setCollapsedSections(relativePath, message.collapsedSections);
                }
                break;

            case 'requestPromptFiles':
                await this.handleRequestPromptFiles(webviewPanel);
                break;

            case 'requestSkills':
                await this.handleRequestSkills(webviewPanel);
                break;

            case 'promptSearch':
                await this.handlePromptSearch(document);
                break;

            case 'executeWorkPlan':
                if (message.promptFilePath) {
                    await this.handleExecuteWorkPlan(document.uri.fsPath, message.promptFilePath);
                }
                break;
        }
    }

    /**
     * Handle AI clarification request from the webview
     */
    private async handleAskAI(context: AskAIContext, filePath: string): Promise<void> {
        const workspaceRoot = getWorkspaceRoot() || '';

        // Read prompt file content if specified
        let promptFileContent: string | undefined;
        if (context.promptFilePath) {
            promptFileContent = await this.readPromptFile(context.promptFilePath);
        }
        
        // Read skill prompt content if specified
        if (context.skillName && !promptFileContent) {
            promptFileContent = await this.readSkillPrompt(context.skillName);
        }

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
            customInstruction: context.customInstruction,
            promptFileContent,
            skillName: context.skillName
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
     * Handle AI interactive session request from the webview
     * Opens an interactive AI CLI session in an external terminal
     */
    private async handleAskAIInteractive(context: AskAIContext, filePath: string): Promise<void> {
        const workspaceRoot = getWorkspaceRoot() || '';

        // Read prompt file or skill content if specified
        let promptFileContent: string | undefined;
        if (context.promptFilePath) {
            promptFileContent = await this.readPromptFile(context.promptFilePath);
        } else if (context.skillName) {
            promptFileContent = await this.readSkillPrompt(context.skillName);
        }

        // Build the prompt from the context
        const promptParts: string[] = [];
        
        // If there's a prompt file or skill, include its content at the top
        if (promptFileContent) {
            promptParts.push('--- Instructions from template ---');
            promptParts.push(promptFileContent);
            promptParts.push('');
            promptParts.push('--- Document context ---');
        }
        
        // Add file context
        promptParts.push(`File: ${filePath}`);
        if (context.nearestHeading) {
            promptParts.push(`Section: ${context.nearestHeading}`);
        }
        promptParts.push(`Lines: ${context.startLine}-${context.endLine}`);
        promptParts.push('');
        
        // Add the selected text
        promptParts.push('Selected text:');
        promptParts.push('```');
        promptParts.push(context.selectedText);
        promptParts.push('```');
        promptParts.push('');
        
        // Add the instruction based on command type
        if (context.customInstruction) {
            promptParts.push(`Instruction: ${context.customInstruction}`);
        } else if (!promptFileContent) {
            // Only add default instructions if no prompt file/skill is specified
            const instructionMap: Record<string, string> = {
                'clarify': 'Please clarify and explain the selected text.',
                'go-deeper': 'Please provide a deep analysis of the selected text, including implications, edge cases, and related concepts.',
                'custom': 'Please help me understand the selected text.'
            };
            promptParts.push(instructionMap[context.instructionType] || instructionMap['clarify']);
        }
        
        // Add surrounding context if available
        if (context.surroundingLines) {
            promptParts.push('');
            promptParts.push('Surrounding context:');
            promptParts.push('```');
            promptParts.push(context.surroundingLines);
            promptParts.push('```');
        }

        const prompt = promptParts.join('\n');

        // Get the interactive session manager and start a session
        const sessionManager = getInteractiveSessionManager();
        
        // Determine the working directory (prefer src if it exists)
        const srcPath = path.join(workspaceRoot, 'src');
        const workingDirectory = await this.directoryExists(srcPath) ? srcPath : workspaceRoot;
        
        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool: 'copilot', // Default to copilot, could be made configurable
            initialPrompt: prompt
        });

        if (sessionId) {
            vscode.window.showInformationMessage('Interactive AI session started in external terminal.');
        } else {
            vscode.window.showErrorMessage('Failed to start interactive AI session. Please check that the AI CLI tool is installed.');
        }
    }

    /**
     * Check if a directory exists
     */
    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
            return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
            return false;
        }
    }

    /**
     * Read the content of a prompt file
     * @param promptFilePath - Absolute path to the prompt file
     * @returns The content of the prompt file, or undefined if it couldn't be read
     */
    private async readPromptFile(promptFilePath: string): Promise<string | undefined> {
        try {
            const content = await fs.promises.readFile(promptFilePath, 'utf-8');
            return content;
        } catch (error) {
            console.error(`Error reading prompt file: ${promptFilePath}`, error);
            return undefined;
        }
    }

    /**
     * Read the prompt content from a skill
     * Looks for prompt.md in the skill directory
     * @param skillName - Name of the skill
     * @returns The content of the skill's prompt.md, or undefined if not found
     */
    private async readSkillPrompt(skillName: string): Promise<string | undefined> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        // Look for prompt.md in the skill directory
        const skillPromptPath = path.join(workspaceRoot, '.github', 'skills', skillName, 'prompt.md');
        
        try {
            const content = await fs.promises.readFile(skillPromptPath, 'utf-8');
            return content;
        } catch {
            // If prompt.md doesn't exist, try SKILL.md as fallback
            const skillMdPath = path.join(workspaceRoot, '.github', 'skills', skillName, 'SKILL.md');
            try {
                const content = await fs.promises.readFile(skillMdPath, 'utf-8');
                return content;
            } catch {
                console.error(`No prompt file found for skill: ${skillName}`);
                return undefined;
            }
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
            const workspaceRoot = getWorkspaceRoot() || '';

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
     * Supports line number fragments like #L100 or #100
     * For .md files, opens in Review Editor View; for other files, opens in text editor
     */
    private async openFileFromPath(
        filePath: string,
        document: vscode.TextDocument
    ): Promise<void> {
        try {
            const fileDir = path.dirname(document.uri.fsPath);
            const workspaceRoot = getWorkspaceRoot() || '';

            // Skip external URLs (http, https, mailto, etc.)
            if (isExternalUrl(filePath)) {
                // Open external URLs in browser
                await vscode.env.openExternal(vscode.Uri.parse(filePath));
                return;
            }

            // Parse line number fragment from path (e.g., file.ts#L100)
            const { filePath: pathWithoutFragment, lineNumber } = parseLineFragment(filePath);

            // Resolve the file path (without fragment)
            const resolved = resolveFilePath(pathWithoutFragment, fileDir, workspaceRoot);

            if (resolved.exists) {
                const fileUri = vscode.Uri.file(resolved.resolvedPath);
                await this.openFileUri(fileUri, lineNumber);
            } else {
                // File not found
                vscode.window.showWarningMessage(`File not found: ${pathWithoutFragment}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    /**
     * Open a file URI, using Review Editor View for markdown files
     * @param fileUri - The URI of the file to open
     * @param lineNumber - Optional 1-based line number to navigate to
     */
    private async openFileUri(fileUri: vscode.Uri, lineNumber?: number): Promise<void> {
        if (isMarkdownFile(fileUri.fsPath)) {
            // Open markdown files in Review Editor View
            // Note: Line number navigation not supported for Review Editor View
            await vscode.commands.executeCommand(
                'vscode.openWith',
                fileUri,
                ReviewEditorViewProvider.viewType
            );
        } else {
            // Open other files in regular text editor
            if (lineNumber !== undefined && lineNumber > 0) {
                // Navigate to specific line (convert to 0-based index)
                const line = lineNumber - 1;
                const position = new vscode.Position(line, 0);
                const selection = new vscode.Selection(position, position);
                await vscode.window.showTextDocument(fileUri, { selection });
            } else {
                await vscode.window.showTextDocument(fileUri);
            }
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

        // Use the unified PromptGenerator with comment IDs
        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: options?.format || 'markdown',
            includeFullFileContent: options?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });

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

        // Use the unified PromptGenerator with comment IDs
        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: options?.format || 'markdown',
            includeFullFileContent: options?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });
        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('AI prompt copied to clipboard!');
    }

    /**
     * Generate AI prompt and send to VSCode Chat.
     * Only includes user comments, excluding AI-generated comments.
     * @param filePath - The file path for the comments
     * @param options - Options including format and whether to start a new conversation
     */
    private async generateAndSendToChat(
        filePath: string,
        options?: { includeFileContent: boolean; format: 'markdown' | 'json'; newConversation?: boolean }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from.');
            return;
        }

        // Use the unified PromptGenerator with comment IDs included
        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: options?.format || 'markdown',
            includeFullFileContent: options?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });
        const newConversation = options?.newConversation ?? true;

        try {
            if (newConversation) {
                // Start a new chat conversation (clears history) then send prompt
                await vscode.commands.executeCommand('workbench.action.chat.newChat');
                // Small delay to ensure new chat is ready
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            // Send prompt to chat (new or existing)
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: prompt
            });
        } catch {
            // Fallback: copy to clipboard and open chat
            await vscode.env.clipboard.writeText(prompt);
            try {
                if (newConversation) {
                    await vscode.commands.executeCommand('workbench.action.chat.newChat');
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                await vscode.commands.executeCommand('workbench.action.chat.open');
                vscode.window.showInformationMessage('Chat opened. Prompt copied to clipboard - paste to continue.');
            } catch {
                // If chat is not available, just notify the user
                vscode.window.showWarningMessage('Chat not available. Prompt copied to clipboard.');
            }
        }
    }

    /**
     * Generate AI prompt for a single comment and send to VSCode Chat.
     * @param commentId - The ID of the comment to send
     * @param newConversation - Whether to start a new conversation or use existing
     */
    private async generateAndSendCommentToChat(
        commentId: string,
        newConversation: boolean
    ): Promise<void> {
        // Get the specific comment
        const comment = this.commentsManager.getComment(commentId);
        if (!comment) {
            vscode.window.showWarningMessage('Comment not found.');
            return;
        }

        // Generate prompt for this single comment
        const prompt = this.promptGenerator.generatePromptForComments([commentId], {
            outputFormat: 'markdown',
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true
        });

        try {
            if (newConversation) {
                // Start a new chat conversation (clears history) then send prompt
                await vscode.commands.executeCommand('workbench.action.chat.newChat');
                // Small delay to ensure new chat is ready
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            // Send prompt to chat (new or existing)
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: prompt
            });
        } catch {
            // Fallback: copy to clipboard and open chat
            await vscode.env.clipboard.writeText(prompt);
            try {
                if (newConversation) {
                    await vscode.commands.executeCommand('workbench.action.chat.newChat');
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                await vscode.commands.executeCommand('workbench.action.chat.open');
                vscode.window.showInformationMessage('Chat opened. Prompt copied to clipboard - paste to continue.');
            } catch {
                // If chat is not available, just notify the user
                vscode.window.showWarningMessage('Chat not available. Prompt copied to clipboard.');
            }
        }
    }

    /**
     * Generate AI prompt and send to CLI interactive session.
     * Opens an interactive AI CLI session (copilot/claude) in an external terminal.
     * Only includes user comments, excluding AI-generated comments.
     * @param filePath - The file path for the comments
     * @param options - Options including format
     */
    private async generateAndSendToCLIInteractive(
        filePath: string,
        options?: { format: 'markdown' | 'json' }
    ): Promise<void> {
        const comments = this.commentsManager.getCommentsForFile(filePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            vscode.window.showInformationMessage('No open user comments to generate prompt from.');
            return;
        }

        // Use the unified PromptGenerator with comment IDs
        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: options?.format || 'markdown',
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true
        });

        const workspaceRoot = getWorkspaceRoot() || '';

        // Get the interactive session manager and start a session
        const sessionManager = getInteractiveSessionManager();

        // Determine the working directory (prefer src if it exists)
        const srcPath = path.join(workspaceRoot, 'src');
        const workingDirectory = await this.directoryExists(srcPath) ? srcPath : workspaceRoot;

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool: 'copilot', // Default to copilot, could be made configurable
            initialPrompt: prompt
        });

        if (sessionId) {
            vscode.window.showInformationMessage('Interactive AI session started in external terminal.');
        } else {
            // Fallback: copy to clipboard
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showWarningMessage('Failed to start interactive AI session. Prompt copied to clipboard.');
        }
    }

    /**
     * Handle request for prompt files from the webview.
     * Returns a list of available .prompt.md files from configured locations.
     * Also includes recent prompts for quick access.
     */
    private async handleRequestPromptFiles(webviewPanel: vscode.WebviewPanel): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);
        const recentPrompts = await this.getRecentPrompts();

        // Filter recent prompts to only include those still in promptFiles
        const validRecent = recentPrompts.filter(r =>
            promptFiles.some(f => f.absolutePath === r.absolutePath)
        );

        webviewPanel.webview.postMessage({
            type: 'promptFilesResponse',
            promptFiles: promptFiles.map(f => ({
                absolutePath: f.absolutePath,
                relativePath: f.relativePath,
                name: f.name,
                sourceFolder: f.sourceFolder
            })),
            recentPrompts: validRecent
        });
    }

    /**
     * Handle request for skills from the webview.
     * Returns a list of available skills from .github/skills/.
     */
    private async handleRequestSkills(webviewPanel: vscode.WebviewPanel): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        const skills = await getSkills(workspaceRoot || undefined);

        webviewPanel.webview.postMessage({
            type: 'skillsResponse',
            skills: skills.map(s => ({
                absolutePath: s.absolutePath,
                relativePath: s.relativePath,
                name: s.name
            }))
        });
    }

    /**
     * Handle prompt search request from webview.
     * Opens Quick Pick for searching all prompt files.
     */
    private async handlePromptSearch(document: vscode.TextDocument): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);

        if (promptFiles.length === 0) {
            vscode.window.showInformationMessage('No .prompt.md files found in configured locations.');
            return;
        }

        const items = promptFiles.map(f => ({
            label: `$(file) ${f.name}`,
            description: f.relativePath,
            detail: f.sourceFolder,
            absolutePath: f.absolutePath
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Search for a prompt file...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await this.handleExecuteWorkPlan(document.uri.fsPath, selected.absolutePath);
        }
    }

    /**
     * Get recent prompts from workspace state
     */
    private async getRecentPrompts(): Promise<Array<{
        absolutePath: string;
        relativePath: string;
        name: string;
        lastUsed: number;
    }>> {
        return this.context.workspaceState.get<Array<{
            absolutePath: string;
            relativePath: string;
            name: string;
            lastUsed: number;
        }>>(ReviewEditorViewProvider.RECENT_PROMPTS_KEY, []);
    }

    /**
     * Track prompt usage in workspace state
     */
    private async trackPromptUsage(absolutePath: string): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);
        const promptFile = promptFiles.find(f => f.absolutePath === absolutePath);
        
        if (!promptFile) {
            return;
        }

        const recent = await this.getRecentPrompts();
        
        // Remove if already exists
        const filtered = recent.filter(r => r.absolutePath !== absolutePath);
        
        // Add to front
        filtered.unshift({
            absolutePath,
            name: promptFile.name,
            relativePath: promptFile.relativePath,
            lastUsed: Date.now()
        });
        
        // Keep only MAX_RECENT_PROMPTS
        await this.context.workspaceState.update(
            ReviewEditorViewProvider.RECENT_PROMPTS_KEY,
            filtered.slice(0, ReviewEditorViewProvider.MAX_RECENT_PROMPTS)
        );
    }

    /**
     * Handle work plan execution request from webview.
     * Launches an interactive AI session with a simple prompt referencing both files.
     * 
     * @param planFilePath - Absolute path to the plan file (the current document)
     * @param promptFilePath - Absolute path to the selected prompt file
     */
    private async handleExecuteWorkPlan(
        planFilePath: string,
        promptFilePath: string
    ): Promise<void> {
        // Track prompt usage for recent list
        await this.trackPromptUsage(promptFilePath);

        // Prompt user for additional context/instructions
        const additionalMessage = await vscode.window.showInputBox({
            prompt: 'Additional context or instructions (optional)',
            placeHolder: 'e.g., "Focus on error handling" or "Use TypeScript strict mode"',
            ignoreFocusOut: true
        });

        // User cancelled
        if (additionalMessage === undefined) {
            return;
        }

        const sessionManager = getInteractiveSessionManager();

        // Build prompt with optional additional message
        let fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;
        if (additionalMessage && additionalMessage.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
        }

        // Get settings
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.workPlan');
        const tool = config.get<'copilot' | 'claude'>('defaultTool', 'copilot');
        const workingDirectory = this.resolveWorkPlanWorkingDirectory(planFilePath);

        // Launch interactive session
        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool,
            initialPrompt: fullPrompt
        });

        if (sessionId) {
            vscode.window.showInformationMessage(
                `Interactive session started: ${path.basename(promptFilePath)} → ${path.basename(planFilePath)}`
            );
        } else {
            vscode.window.showErrorMessage(
                'Failed to start interactive session. Please check that the AI CLI tool is installed.'
            );
        }
    }

    /**
     * Resolve working directory for work plan execution from settings or workspace root.
     * Supports {workspaceFolder} placeholder.
     * 
     * @param planFilePath - Path to the plan file (used as fallback)
     * @returns Resolved working directory path
     */
    private resolveWorkPlanWorkingDirectory(planFilePath: string): string {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.workPlan');
        const configPath = config.get<string>('workingDirectory', '{workspaceFolder}/src');

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return path.dirname(planFilePath);
        }

        // Replace {workspaceFolder} placeholder
        const resolved = configPath.replace('{workspaceFolder}', workspaceRoot);

        // Check if /src exists, fallback to workspace root
        if (resolved.endsWith('/src') && !fs.existsSync(resolved)) {
            return workspaceRoot;
        }

        return resolved;
    }
}

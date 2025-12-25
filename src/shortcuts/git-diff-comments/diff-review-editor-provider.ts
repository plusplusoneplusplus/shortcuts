/**
 * DiffReviewEditorProvider - Custom Editor Provider for Git diffs with inline comments
 * Provides a side-by-side diff view with commenting capability
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIProcessManager, getAICommandRegistry } from '../ai-service';
import { DiffCommentsManager } from './diff-comments-manager';
import {
    createCommittedGitContext,
    createStagedGitContext,
    createUnstagedGitContext,
    createUntrackedGitContext,
    getDiffContent
} from './diff-content-provider';
import { handleDiffAIClarification } from './diff-ai-clarification-handler';
import {
    DiffAskAIContext,
    DiffClarificationContext,
    DiffComment,
    DiffExtensionMessage,
    DiffGitContext,
    DiffSelection,
    DiffWebviewMessage,
    DiffWebviewState
} from './types';

/**
 * Check if the diff is editable (uncommitted changes to working tree)
 */
function isEditableDiff(gitContext: DiffGitContext): boolean {
    // Editable if the new version is the working tree (unstaged or untracked changes)
    return gitContext.newRef === 'WORKING_TREE';
}

/**
 * DiffReviewEditorProvider - Custom readonly editor for diff review with comments
 */
export class DiffReviewEditorProvider implements vscode.Disposable {
    public static readonly viewType = 'gitDiffReviewEditor';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<vscode.CustomDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private activeWebviews: Map<string, vscode.WebviewPanel> = new Map();
    /** Store state for each webview for restoration */
    private webviewStates: Map<string, DiffWebviewState> = new Map();
    /** Track dirty state per webview (keyed by filePath) */
    private dirtyStates: Map<string, boolean> = new Map();
    /** Store original titles per webview (keyed by filePath) */
    private originalTitles: Map<string, string> = new Map();
    private disposables: vscode.Disposable[] = [];
    /** AI process manager for tracking running AI processes */
    private aiProcessManager?: AIProcessManager;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly commentsManager: DiffCommentsManager,
        aiProcessManager?: AIProcessManager
    ) {
        this.aiProcessManager = aiProcessManager;
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
        commentsManager: DiffCommentsManager,
        aiProcessManager?: AIProcessManager
    ): vscode.Disposable[] {
        const provider = new DiffReviewEditorProvider(context, commentsManager, aiProcessManager);
        
        const openCommand = vscode.commands.registerCommand(
            'gitDiffComments.openWithReview',
            async (item?: any, scrollToCommentId?: string) => {
                await provider.openDiffReview(item, scrollToCommentId);
            }
        );

        const addCommentCommand = vscode.commands.registerCommand(
            'gitDiffComments.addComment',
            async () => {
                // This command is triggered by keybinding in the webview
                // The actual comment addition is handled by webview messages
            }
        );

        // Register webview panel serializer for restoring panels after restart
        const serializerDisposable = vscode.window.registerWebviewPanelSerializer(
            DiffReviewEditorProvider.viewType,
            {
                async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: DiffWebviewState) {
                    await provider.restoreWebviewPanel(panel, state);
                }
            }
        );

        context.subscriptions.push(provider);

        return [openCommand, addCommentCommand, serializerDisposable, provider];
    }

    /**
     * Restore a webview panel from serialized state
     */
    async restoreWebviewPanel(panel: vscode.WebviewPanel, state: DiffWebviewState): Promise<void> {
        if (!state || !state.filePath || !state.gitContext) {
            // Cannot restore without valid state, close the panel
            panel.dispose();
            return;
        }

        try {
            // Store the panel reference
            const fullPath = path.isAbsolute(state.filePath)
                ? state.filePath
                : path.join(state.gitContext.repositoryRoot, state.filePath);
            this.activeWebviews.set(fullPath, panel);
            this.webviewStates.set(fullPath, state);

            const isEditable = state.isEditable ?? isEditableDiff(state.gitContext);

            // Set webview content
            panel.webview.html = this.getWebviewContent(
                panel.webview,
                state.filePath,
                state.oldContent,
                state.newContent,
                state.gitContext,
                isEditable
            );

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                async (message: DiffWebviewMessage) => {
                    await this.handleWebviewMessage(
                        message,
                        fullPath,
                        state.filePath,
                        state.gitContext,
                        state.oldContent,
                        state.newContent,
                        panel,
                        undefined,
                        isEditable
                    );
                },
                undefined,
                this.disposables
            );

            // Clean up when panel is closed
            panel.onDidDispose(() => {
                this.activeWebviews.delete(fullPath);
                this.webviewStates.delete(fullPath);
                this.dirtyStates.delete(fullPath);
                this.originalTitles.delete(fullPath);
            });
        } catch (error) {
            console.error('Failed to restore diff review panel:', error);
            panel.dispose();
        }
    }

    /**
     * Open a diff review for a git change item
     * @param item The git change item, commit file, or comment item
     * @param scrollToCommentId Optional comment ID to scroll to after opening
     */
    async openDiffReview(item?: any, scrollToCommentId?: string): Promise<void> {
        if (!item) {
            vscode.window.showWarningMessage('Please select a git change to review.');
            return;
        }

        // Extract information from the git change item
        let filePath: string;
        let gitContext: DiffGitContext;

        // Handle different item types
        if (item.change) {
            // GitChangeItem from our tree view
            filePath = item.change.path;
            const stage = item.change.stage;
            
            const repoRoot = item.change.repositoryRoot;
            const repoName = item.change.repositoryName;

            if (stage === 'staged') {
                gitContext = createStagedGitContext(repoRoot, repoName);
            } else if (stage === 'untracked') {
                gitContext = createUntrackedGitContext(repoRoot, repoName);
            } else {
                gitContext = createUnstagedGitContext(repoRoot, repoName);
            }
        } else if (item.commitFile) {
            // GitCommitFile from commit tree view
            const file = item.commitFile;
            filePath = path.join(file.repositoryRoot, file.path);
            const repoName = path.basename(file.repositoryRoot);
            
            gitContext = createCommittedGitContext(
                file.repositoryRoot,
                repoName,
                file.commitHash,
                file.parentHash
            );
        } else if (item.resourceUri) {
            // VSCode SCM resource
            filePath = item.resourceUri.fsPath;
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri);
            const repoRoot = workspaceFolder?.uri.fsPath || path.dirname(filePath);
            const repoName = path.basename(repoRoot);
            
            // Determine stage from context value or default to unstaged
            gitContext = createUnstagedGitContext(repoRoot, repoName);
        } else {
            vscode.window.showWarningMessage('Unable to determine file information.');
            return;
        }

        // Check if a webview panel already exists for this file
        const existingPanel = this.activeWebviews.get(filePath);
        if (existingPanel) {
            // Reveal the existing panel
            existingPanel.reveal(vscode.ViewColumn.One);
            
            // Refresh the diff content in case the file has been updated externally
            const relativePath = path.relative(gitContext.repositoryRoot, filePath);
            const diffResult = getDiffContent(relativePath, gitContext);
            const isEditable = isEditableDiff(gitContext);
            
            if (!diffResult.isBinary && !diffResult.error) {
                // Update stored state
                const webviewState: DiffWebviewState = {
                    filePath: relativePath,
                    gitContext,
                    oldContent: diffResult.oldContent,
                    newContent: diffResult.newContent,
                    isEditable
                };
                this.webviewStates.set(filePath, webviewState);
                
                // Send updated content to the webview
                existingPanel.webview.postMessage({
                    type: 'update',
                    oldContent: diffResult.oldContent,
                    newContent: diffResult.newContent,
                    isEditable
                });
            }
            
            // If we need to scroll to a specific comment, send the message
            if (scrollToCommentId) {
                // Small delay to ensure webview is ready
                setTimeout(() => {
                    existingPanel.webview.postMessage({
                        type: 'scrollToComment',
                        scrollToCommentId
                    });
                }, 100);
            }
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

        // Store reference and state for serialization
        this.activeWebviews.set(filePath, panel);
        const isEditable = isEditableDiff(gitContext);
        const webviewState: DiffWebviewState = {
            filePath: relativePath,
            gitContext,
            oldContent: diffResult.oldContent,
            newContent: diffResult.newContent,
            isEditable
        };
        this.webviewStates.set(filePath, webviewState);

        // Set webview content
        panel.webview.html = this.getWebviewContent(
            panel.webview,
            relativePath,
            diffResult.oldContent,
            diffResult.newContent,
            gitContext,
            isEditable
        );

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            async (message: DiffWebviewMessage) => {
                await this.handleWebviewMessage(
                    message,
                    filePath,
                    relativePath,
                    gitContext,
                    diffResult.oldContent,
                    diffResult.newContent,
                    panel,
                    scrollToCommentId,
                    isEditable
                );
            },
            undefined,
            this.disposables
        );

        // Clean up when panel is closed
        panel.onDidDispose(() => {
            this.activeWebviews.delete(filePath);
            this.webviewStates.delete(filePath);
            this.dirtyStates.delete(filePath);
            this.originalTitles.delete(filePath);
        });
    }

    /**
     * Handle messages from the webview
     */
    private async handleWebviewMessage(
        message: DiffWebviewMessage,
        absoluteFilePath: string,
        relativeFilePath: string,
        gitContext: DiffGitContext,
        oldContent: string,
        newContent: string,
        panel: vscode.WebviewPanel,
        scrollToCommentId?: string,
        isEditable?: boolean
    ): Promise<void> {
        switch (message.type) {
            case 'ready':
            case 'requestState':
                this.sendStateToWebview(panel, relativeFilePath, oldContent, newContent, isEditable);
                // If we need to scroll to a specific comment, send the message after state is sent
                if (scrollToCommentId) {
                    setTimeout(() => {
                        panel.webview.postMessage({
                            type: 'scrollToComment',
                            scrollToCommentId
                        });
                    }, 100);
                }
                break;

            case 'addComment':
                if (message.selection && message.comment && message.selectedText) {
                    const content = message.selection.side === 'old' ? oldContent : newContent;
                    await this.commentsManager.addComment(
                        relativeFilePath,
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

            case 'openFile':
                if (message.fileToOpen) {
                    // Construct full file path
                    const fullPath = path.isAbsolute(message.fileToOpen)
                        ? message.fileToOpen
                        : path.join(gitContext.repositoryRoot, message.fileToOpen);
                    
                    try {
                        const uri = vscode.Uri.file(fullPath);
                        // Check if it's a markdown file - open with Review Editor
                        if (fullPath.toLowerCase().endsWith('.md')) {
                            await vscode.commands.executeCommand(
                                'vscode.openWith',
                                uri,
                                'reviewEditorView'
                            );
                        } else {
                            await vscode.commands.executeCommand('vscode.open', uri);
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Could not open file: ${message.fileToOpen}`);
                    }
                }
                break;

            case 'copyPath':
                if (message.pathToCopy) {
                    try {
                        await vscode.env.clipboard.writeText(message.pathToCopy);
                        vscode.window.showInformationMessage(`Copied: ${message.pathToCopy}`);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Could not copy path: ${message.pathToCopy}`);
                    }
                }
                break;

            case 'askAI':
                if (message.context) {
                    await this.handleAskAI(message.context, relativeFilePath, gitContext, oldContent, newContent, panel);
                }
                break;

            case 'saveContent':
                if (message.newContent !== undefined && isEditable) {
                    await this.handleSaveContent(absoluteFilePath, message.newContent, panel, gitContext);
                }
                break;

            case 'contentModified':
                if (message.isDirty !== undefined) {
                    this.updateTabTitle(absoluteFilePath, message.isDirty);
                }
                break;
        }
    }

    /**
     * Update the tab title to show dirty indicator (dot) following VS Code conventions
     */
    private updateTabTitle(filePath: string, isDirty: boolean): void {
        const panel = this.activeWebviews.get(filePath);
        if (!panel) return;

        // Store original title if not already stored
        if (!this.originalTitles.has(filePath)) {
            this.originalTitles.set(filePath, panel.title);
        }

        const originalTitle = this.originalTitles.get(filePath) || panel.title;
        
        // Update dirty state
        this.dirtyStates.set(filePath, isDirty);
        
        // Update panel title: add dot prefix for dirty state (VS Code convention)
        if (isDirty) {
            // VS Code shows dirty indicator as a dot before the title
            panel.title = `● ${originalTitle}`;
        } else {
            panel.title = originalTitle;
        }
    }

    /**
     * Handle saving content to the file (for editable diff view)
     */
    private async handleSaveContent(
        absoluteFilePath: string,
        newContent: string,
        panel: vscode.WebviewPanel,
        gitContext: DiffGitContext
    ): Promise<void> {
        try {
            // Write the content to the file
            fs.writeFileSync(absoluteFilePath, newContent, 'utf8');
            
            // Update the stored state
            const relativePath = path.relative(gitContext.repositoryRoot, absoluteFilePath);
            const state = this.webviewStates.get(absoluteFilePath);
            if (state) {
                state.newContent = newContent;
            }
            
            // No notification needed - the dirty indicator dot in the tab disappearing is sufficient
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save file: ${error.message}`);
        }
    }

    /**
     * Handle AI clarification request from the webview
     */
    private async handleAskAI(
        context: DiffAskAIContext,
        filePath: string,
        gitContext: DiffGitContext,
        oldContent: string,
        newContent: string,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        // Get workspace root from git context
        const workspaceRoot = gitContext.repositoryRoot;

        // Build clarification context
        const clarificationContext: DiffClarificationContext = {
            selectedText: context.selectedText,
            selectionRange: {
                startLine: context.startLine,
                endLine: context.endLine
            },
            side: context.side,
            filePath: filePath,
            surroundingContent: context.surroundingLines,
            instructionType: context.instructionType,
            customInstruction: context.customInstruction
        };

        const result = await handleDiffAIClarification(clarificationContext, workspaceRoot, this.aiProcessManager);

        // If successful, automatically add clarification as a comment
        if (result.success && result.clarification) {
            // Determine the label based on instruction type
            const labelMap: Record<string, string> = {
                'clarify': '🤖 **AI Clarification:**',
                'go-deeper': '🔍 **AI Deep Analysis:**',
                'custom': '🤖 **AI Response:**'
            };
            const label = labelMap[context.instructionType] || '🤖 **AI Clarification:**';

            // Determine the comment type based on instruction type
            const typeMap: Record<string, 'ai-clarification' | 'ai-suggestion'> = {
                'clarify': 'ai-clarification',
                'go-deeper': 'ai-clarification',
                'custom': 'ai-suggestion'
            };
            const commentType = typeMap[context.instructionType] || 'ai-clarification';

            // Build selection for the comment
            const selection: DiffSelection = {
                side: context.side,
                oldStartLine: context.side === 'old' ? context.startLine : null,
                oldEndLine: context.side === 'old' ? context.endLine : null,
                newStartLine: context.side === 'new' ? context.startLine : null,
                newEndLine: context.side === 'new' ? context.endLine : null,
                startColumn: 1,
                endColumn: context.selectedText.length + 1
            };

            // Get the content for the side
            const content = context.side === 'old' ? oldContent : newContent;

            // Add the clarification as a comment on the selected text with AI type
            await this.commentsManager.addComment(
                filePath,
                selection,
                context.selectedText,
                `${label}\n\n${result.clarification}`,
                gitContext,
                content,
                undefined, // author
                undefined, // tags
                commentType
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
     * Send current state to webview
     */
    private sendStateToWebview(
        panel: vscode.WebviewPanel,
        filePath: string,
        oldContent: string,
        newContent: string,
        isEditable?: boolean
    ): void {
        const comments = this.commentsManager.getCommentsForFile(filePath);
        const baseSettings = this.commentsManager.getSettings();

        // Get AI service enabled setting and commands
        const aiConfig = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
        const askAIEnabled = aiConfig.get<boolean>('enabled', false);
        const aiCommands = getAICommandRegistry().getSerializedCommands();

        // Extend settings with AI enabled flag and commands
        const settings = {
            ...baseSettings,
            askAIEnabled,
            aiCommands
        };

        const message: DiffExtensionMessage = {
            type: 'update',
            oldContent,
            newContent,
            comments,
            filePath,
            settings,
            isEditable
        };

        panel.webview.postMessage(message);
    }

    /**
     * Update all open webviews with latest comments
     */
    private updateAllWebviews(): void {
        // Get AI service enabled setting and commands
        const aiConfig = vscode.workspace.getConfiguration('workspaceShortcuts.aiService');
        const askAIEnabled = aiConfig.get<boolean>('enabled', false);
        const aiCommands = getAICommandRegistry().getSerializedCommands();

        for (const [filePath, panel] of this.activeWebviews) {
            const comments = this.commentsManager.getCommentsForFile(filePath);
            const baseSettings = this.commentsManager.getSettings();

            // Extend settings with AI enabled flag and commands
            const settings = {
                ...baseSettings,
                askAIEnabled,
                aiCommands
            };

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
        gitContext: DiffGitContext,
        isEditable: boolean = false
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${commentsStyleUri}" rel="stylesheet">
    <title>Diff Review: ${escapeHtml(filePath)}</title>
</head>
<body>
    <div id="diff-container">
        <div class="diff-header">
            <div class="diff-title-row">
                <h2 class="diff-title clickable-file" id="file-path-link" title="Click to open file">${escapeHtml(filePath)}</h2>
                <button class="copy-path-btn" id="copy-path-btn" title="Copy file path">
                    <span class="copy-icon">📋</span>
                </button>
            </div>
            <div class="diff-info">
                <span class="diff-repo">${escapeHtml(gitContext.repositoryName)}</span>
                <span class="diff-refs">${escapeHtml(gitContext.oldRef)} → ${escapeHtml(gitContext.newRef)}</span>
                <button class="whitespace-toggle" id="whitespace-toggle" title="Toggle whitespace diff visibility">
                    <span class="toggle-icon" id="whitespace-icon">␣</span>
                    <span class="toggle-label" id="whitespace-label">Show Whitespace</span>
                </button>
                <button class="view-mode-toggle" id="view-mode-toggle" title="Toggle between split and inline view">
                    <span class="toggle-icon" id="toggle-icon">⫼</span>
                    <span class="toggle-label" id="toggle-label">Split</span>
                </button>
            </div>
        </div>
        <div class="diff-view-wrapper">
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
            <div class="diff-indicator-bar" id="diff-indicator-bar">
                <div class="diff-indicator-bar-inner" id="diff-indicator-bar-inner">
                    <div class="diff-indicator-viewport" id="diff-indicator-viewport"></div>
                </div>
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

    <!-- Context Menu (hidden by default) -->
    <div id="custom-context-menu" class="context-menu hidden">
        <div class="context-menu-item" id="context-menu-add-comment">Add Comment</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item has-submenu" id="context-menu-ask-ai">
            Ask AI
            <div class="ask-ai-submenu" id="ask-ai-submenu">
                <div class="context-menu-item" id="ask-ai-clarify">
                    <span class="ai-icon">💡</span>
                    <span>Clarify</span>
                </div>
                <div class="context-menu-item" id="ask-ai-go-deeper">
                    <span class="ai-icon">🔍</span>
                    <span>Go Deeper</span>
                </div>
                <div class="context-menu-item" id="ask-ai-custom">
                    <span class="ai-icon">✏️</span>
                    <span>Custom...</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Custom Instruction Dialog (hidden by default) -->
    <div id="custom-instruction-dialog" class="custom-instruction-dialog hidden">
        <div class="custom-instruction-header">
            <h3>Custom AI Instruction</h3>
            <button class="custom-instruction-close" id="custom-instruction-close">&times;</button>
        </div>
        <div class="custom-instruction-body">
            <div class="custom-instruction-selection" id="custom-instruction-selection"></div>
            <label class="custom-instruction-label">Enter your instruction:</label>
            <textarea 
                id="custom-instruction-input" 
                class="custom-instruction-input" 
                placeholder="e.g., Explain the security implications of..."
            ></textarea>
        </div>
        <div class="custom-instruction-footer">
            <button class="btn btn-secondary" id="custom-instruction-cancel">Cancel</button>
            <button class="btn btn-primary" id="custom-instruction-submit">Ask AI</button>
        </div>
    </div>

    <!-- Initial data for webview initialization -->
    <script nonce="${nonce}">
        window.initialData = {
            filePath: ${JSON.stringify(filePath)},
            oldContent: ${JSON.stringify(oldContent)},
            newContent: ${JSON.stringify(newContent)},
            gitContext: ${JSON.stringify(gitContext)},
            isEditable: ${JSON.stringify(isEditable)}
        };
    </script>
    <!-- Load highlight.js from CDN for syntax highlighting -->
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
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
        this.webviewStates.clear();
        this.dirtyStates.clear();
        this.originalTitles.clear();
        this._onDidChangeCustomDocument.dispose();
    }
}


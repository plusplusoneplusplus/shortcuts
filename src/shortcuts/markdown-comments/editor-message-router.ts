/**
 * EditorMessageRouter — pure routing logic extracted from ReviewEditorViewProvider.
 * Has zero `import * as vscode` statements. All platform calls go through EditorHost.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCopilotSDKService, approveAllPermissions } from '@plusplusoneplusplus/pipeline-core';
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';
import {
    getAvailableModels,
    getInteractiveSessionManager,
    getWorkingDirectory,
    IAIProcessManager,
    FollowPromptExecutionOptions,
    getAIQueueService
} from '../ai-service';
import { getPromptFiles } from '../shared/prompt-files-utils';
import { getSkills } from '../shared/skill-files-utils';
import { getWorkspaceRoot } from '../shared/workspace-utils';
import { handleAIClarification } from './ai-clarification-handler';
import { normalizeAskAIContextForDocument } from './ask-ai-context-utils';
import { CommentsManager } from './comments-manager';
import { isExternalUrl, parseLineFragment, resolveFilePath } from './file-path-utils';
import { PromptGenerator } from './prompt-generator';
import { ClarificationContext, isUserComment, MermaidContext } from './types';
import { EditorHost, MessageContext, DispatchResult } from './editor-host';

/**
 * Mode for AI command execution
 */
type AICommandMode = 'comment' | 'interactive' | 'background' | 'queued';

/**
 * Context data for AI clarification requests from the webview
 */
export interface AskAIContext {
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

export interface WebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' | 'resolveCommentQueued' |
    'reopenComment' | 'updateContent' | 'ready' | 'generatePrompt' |
    'copyPrompt' | 'sendToChat' | 'sendCommentToChat' | 'sendToCLIInteractive' | 'sendToCLIBackground' | 'resolveAll' | 'deleteAll' | 'requestState' | 'resolveImagePath' | 'openFile' | 'askAI' | 'askAIInteractive' | 'askAIQueued' | 'collapsedSectionsChanged' | 'requestPromptFiles' | 'requestSkills' | 'executeWorkPlan' | 'executeWorkPlanWithSkill' | 'promptSearch' | 'followPromptDialogResult' | 'copyFollowPrompt' | 'requestUpdateDocumentDialog' | 'updateDocument' | 'requestRefreshPlanDialog' | 'refreshPlan' | 'chatInCLI' | 'copyWithContext' | 'readFilePreview';
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
    path?: string;
    imgId?: string;
    context?: AskAIContext;
    newConversation?: boolean;
    collapsedSections?: string[];
    promptFilePath?: string;
    skillName?: string;
    options?: FollowPromptExecutionOptions;
    additionalContext?: string;
    instruction?: string;
    selectedText?: string;
    filePath?: string;
    requestId?: string;
    full?: boolean;
    /** Optional override for the document path. Used when AI actions are triggered from the file-preview dialog. */
    targetDocumentPath?: string;
}

/** Storage key prefix for collapsed sections (per file) */
export const COLLAPSED_SECTIONS_KEY_PREFIX = 'mdReview.collapsedSections.';

/** Storage key for recent prompts */
const RECENT_PROMPTS_KEY = 'workspaceShortcuts.recentPrompts';

/** Storage key for recent skills */
const RECENT_SKILLS_KEY = 'workspaceShortcuts.recentSkills';

/** Maximum number of recent prompts to track */
const MAX_RECENT_PROMPTS = 5;

export class EditorMessageRouter {
    private readonly promptGenerator: PromptGenerator;

    constructor(
        private readonly host: EditorHost,
        private readonly commentsManager: CommentsManager,
        private readonly aiProcessManager?: IAIProcessManager
    ) {
        this.promptGenerator = new PromptGenerator(commentsManager);
    }

    /**
     * Dispatch a webview message to the appropriate handler.
     * Returns a DispatchResult indicating what the provider should do after.
     */
    async dispatch(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        switch (message.type) {
            case 'addComment':
                return this.handleAddComment(message, ctx);
            case 'editComment':
                return this.handleEditComment(message);
            case 'deleteComment':
                return this.handleDeleteComment(message);
            case 'resolveComment':
                return this.handleResolveComment(message);
            case 'resolveCommentQueued':
                return this.handleResolveCommentQueued(message, ctx);
            case 'reopenComment':
                return this.handleReopenComment(message);
            case 'resolveAll':
                return this.handleResolveAll();
            case 'deleteAll':
                return this.handleDeleteAll();
            case 'updateContent':
                return this.handleUpdateContent(message, ctx);
            case 'generatePrompt':
                return this.handleGeneratePrompt(message, ctx);
            case 'copyPrompt':
                return this.handleCopyPrompt(message, ctx);
            case 'sendToChat':
                return this.handleSendToChat(message, ctx);
            case 'sendCommentToChat':
                return this.handleSendCommentToChat(message);
            case 'sendToCLIInteractive':
                return this.handleSendToCLIInteractive(message, ctx);
            case 'sendToCLIBackground':
                return this.handleSendToCLIBackground(message, ctx);
            case 'resolveImagePath':
                return this.handleResolveImagePath(message, ctx);
            case 'openFile':
                return this.handleOpenFile(message, ctx);
            case 'askAI':
                return this.handleAskAI(message, ctx);
            case 'askAIInteractive':
                return this.handleAskAIInteractive(message, ctx);
            case 'askAIQueued':
                return this.handleAskAIQueued(message, ctx);
            case 'collapsedSectionsChanged':
                return this.handleCollapsedSectionsChanged(message, ctx);
            case 'requestPromptFiles':
                return this.handleRequestPromptFiles();
            case 'requestSkills':
                return this.handleRequestSkills();
            case 'promptSearch':
                return this.handlePromptSearch(message, ctx);
            case 'executeWorkPlan':
                return this.handleExecuteWorkPlan(message, ctx);
            case 'executeWorkPlanWithSkill':
                return this.handleExecuteWorkPlanWithSkill(message);
            case 'followPromptDialogResult':
                return this.handleFollowPromptDialogResult(message, ctx);
            case 'copyFollowPrompt':
                return this.handleCopyFollowPrompt(message, ctx);
            case 'requestUpdateDocumentDialog':
                return this.handleRequestUpdateDocumentDialog();
            case 'updateDocument':
                return this.handleUpdateDocument(message, ctx);
            case 'requestRefreshPlanDialog':
                return this.handleRequestRefreshPlanDialog();
            case 'refreshPlan':
                return this.handleRefreshPlan(message, ctx);
            case 'chatInCLI':
                return this.handleChatInCLI(message, ctx);
            case 'copyWithContext':
                return this.handleCopyWithContext(message, ctx);
            case 'readFilePreview':
                return this.handleReadFilePreview(message, ctx);
            default:
                return {};
        }
    }

    /**
     * Handle pending scroll request after webview is ready.
     * Called by the provider for 'ready'/'requestState' messages.
     */
    handlePendingScroll(
        normalizedFilePath: string,
        pendingScrollRequests: Map<string, string>,
        postMessageFn: (msg: unknown) => void
    ): void {
        const pendingCommentId = pendingScrollRequests.get(normalizedFilePath);
        if (pendingCommentId) {
            pendingScrollRequests.delete(normalizedFilePath);
            setTimeout(() => {
                postMessageFn({
                    type: 'scrollToComment',
                    commentId: pendingCommentId
                });
            }, 100);
        }
    }

    // --- Comment CRUD ---

    private async handleAddComment(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.selection && message.comment) {
            await this.commentsManager.addComment(
                ctx.relativePath,
                {
                    startLine: message.selection.startLine,
                    startColumn: message.selection.startColumn,
                    endLine: message.selection.endLine,
                    endColumn: message.selection.endColumn
                },
                message.selection.selectedText,
                message.comment,
                undefined,
                undefined,
                message.mermaidContext
            );
        }
        return {};
    }

    private async handleEditComment(message: WebviewMessage): Promise<DispatchResult> {
        if (message.commentId && message.comment !== undefined) {
            await this.commentsManager.updateComment(message.commentId, {
                comment: message.comment
            });
        }
        return {};
    }

    private async handleDeleteComment(message: WebviewMessage): Promise<DispatchResult> {
        if (message.commentId) {
            const confirmed = await this.host.showWarning(
                'Are you sure you want to delete this comment?',
                { modal: true },
                'Delete'
            );
            if (confirmed === 'Delete') {
                await this.commentsManager.deleteComment(message.commentId);
            }
        }
        return {};
    }

    private async handleResolveComment(message: WebviewMessage): Promise<DispatchResult> {
        if (message.commentId) {
            await this.commentsManager.resolveComment(message.commentId);
        }
        return {};
    }

    private async handleResolveCommentQueued(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.commentId) {
            return {};
        }

        // Always resolve the comment first
        await this.commentsManager.resolveComment(message.commentId);

        const queueService = getAIQueueService();
        if (!queueService) {
            this.host.showError('Queue service not available');
            return {};
        }

        if (!queueService.isEnabled()) {
            await this.host.showWarning(
                'Queue feature is disabled. Enable it in settings: workspaceShortcuts.queue.enabled'
            );
            return {};
        }

        const comment = this.commentsManager.getComment(message.commentId);
        if (!comment) {
            return {};
        }

        const prompt = [
            'You are reviewing a resolved comment in a document.',
            `File: ${ctx.relativePath}`,
            `Selected text (line ${comment.selection.startLine}–${comment.selection.endLine}):`,
            comment.selectedText,
            '',
            `Reviewer comment: ${comment.comment}`,
            '',
            'In ask/read-only mode, summarise whether the comment appears to be addressed in the document and note any remaining concerns.',
        ].join('\n');

        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);
        const snippet = message.commentId.slice(0, 8);
        const result = queueService.queueTask({
            type: 'ai-clarification',
            payload: {
                filePath: ctx.relativePath,
                prompt,
                workingDirectory,
                mode: 'ask',
            },
            priority: 'normal',
            displayName: `Resolve: ${snippet}`,
        });

        await this.host.showInfo(`Added to queue (#${result.position}): Resolve comment`);
        return {};
    }

    private async handleReopenComment(message: WebviewMessage): Promise<DispatchResult> {
        if (message.commentId) {
            await this.commentsManager.reopenComment(message.commentId);
        }
        return {};
    }

    private async handleResolveAll(): Promise<DispatchResult> {
        const resolveCount = await this.commentsManager.resolveAllComments();
        await this.host.showInfo(`Resolved ${resolveCount} comment(s).`);
        return {};
    }

    private async handleDeleteAll(): Promise<DispatchResult> {
        const totalComments = this.commentsManager.getAllComments().length;
        if (totalComments === 0) {
            await this.host.showInfo('No comments to delete.');
            return {};
        }
        const confirmed = await this.host.showWarning(
            `Are you sure you want to delete all ${totalComments} comment(s)? This action cannot be undone.`,
            { modal: true },
            'Sign Off'
        );
        if (confirmed === 'Sign Off') {
            const deleteCount = await this.commentsManager.deleteAllComments();
            await this.host.showInfo(`Deleted ${deleteCount} comment(s).`);
        }
        return {};
    }

    // --- Content update ---

    private async handleUpdateContent(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.content !== undefined) {
            await this.host.replaceDocumentContent(ctx.documentPath, message.content);
            return { shouldMarkWebviewEdit: true };
        }
        return {};
    }

    // --- Prompt generation ---

    private async handleGeneratePrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const comments = this.commentsManager.getCommentsForFile(ctx.relativePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            await this.host.showInfo('No open user comments to generate prompt from.');
            return {};
        }

        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: message.promptOptions?.format || 'markdown',
            includeFullFileContent: message.promptOptions?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });

        // Open as untitled document
        const language = message.promptOptions?.format === 'json' ? 'json' : 'markdown';
        await this.host.openUntitledDocument(prompt, language);
        return {};
    }

    private async handleCopyPrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const comments = this.commentsManager.getCommentsForFile(ctx.relativePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            await this.host.showInfo('No open user comments to generate prompt from.');
            return {};
        }

        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: message.promptOptions?.format || 'markdown',
            includeFullFileContent: message.promptOptions?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });
        await this.host.copyToClipboard(prompt);
        await this.host.showInfo('AI prompt copied to clipboard!');
        return {};
    }

    private async handleSendToChat(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const comments = this.commentsManager.getCommentsForFile(ctx.relativePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            await this.host.showInfo('No open user comments to generate prompt from.');
            return {};
        }

        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: message.promptOptions?.format || 'markdown',
            includeFullFileContent: message.promptOptions?.includeFileContent || false,
            groupByFile: true,
            includeLineNumbers: true
        });
        const newConversation = message.promptOptions?.newConversation ?? true;

        try {
            if (newConversation) {
                await this.host.executeCommand('workbench.action.chat.newChat');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            await this.host.executeCommand('workbench.action.chat.open', { query: prompt });
        } catch {
            await this.host.copyToClipboard(prompt);
            try {
                if (newConversation) {
                    await this.host.executeCommand('workbench.action.chat.newChat');
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                await this.host.executeCommand('workbench.action.chat.open');
                await this.host.showInfo('Chat opened. Prompt copied to clipboard - paste to continue.');
            } catch {
                await this.host.showWarning('Chat not available. Prompt copied to clipboard.');
            }
        }
        return {};
    }

    private async handleSendCommentToChat(message: WebviewMessage): Promise<DispatchResult> {
        if (!message.commentId) {
            return {};
        }
        const comment = this.commentsManager.getComment(message.commentId);
        if (!comment) {
            await this.host.showWarning('Comment not found.');
            return {};
        }

        const prompt = this.promptGenerator.generatePromptForComments([message.commentId], {
            outputFormat: 'markdown',
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true
        });
        const newConversation = message.newConversation ?? true;

        try {
            if (newConversation) {
                await this.host.executeCommand('workbench.action.chat.newChat');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            await this.host.executeCommand('workbench.action.chat.open', { query: prompt });
        } catch {
            await this.host.copyToClipboard(prompt);
            try {
                if (newConversation) {
                    await this.host.executeCommand('workbench.action.chat.newChat');
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                await this.host.executeCommand('workbench.action.chat.open');
                await this.host.showInfo('Chat opened. Prompt copied to clipboard - paste to continue.');
            } catch {
                await this.host.showWarning('Chat not available. Prompt copied to clipboard.');
            }
        }
        return {};
    }

    private async handleSendToCLIInteractive(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const comments = this.commentsManager.getCommentsForFile(ctx.relativePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            await this.host.showInfo('No open user comments to generate prompt from.');
            return {};
        }

        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: message.promptOptions?.format || 'markdown',
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true
        });

        const sessionManager = getInteractiveSessionManager();
        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool: 'copilot',
            initialPrompt: prompt
        });

        if (sessionId) {
            await this.host.showInfo('Interactive AI session started in external terminal.');
        } else {
            await this.host.copyToClipboard(prompt);
            await this.host.showWarning('Failed to start interactive AI session. Prompt copied to clipboard.');
        }
        return {};
    }

    private async handleChatInCLI(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const filePath = message.targetDocumentPath || ctx.documentPath;
        const prompt = [
            `The user has opened the file: ${filePath}`,
            ``,
            `Please ask the user what they would like to know or do with this file.`,
            `Be helpful and proactive — suggest relevant questions based on the file type and content.`
        ].join('\n');

        const sessionManager = getInteractiveSessionManager();
        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool: 'copilot',
            initialPrompt: prompt
        });

        if (sessionId) {
            await this.host.showInfo('CLI chat session started for this file.');
        } else {
            await this.host.copyToClipboard(prompt);
            await this.host.showWarning('Failed to start CLI session. Prompt copied to clipboard.');
        }
        return {};
    }

    private async handleCopyWithContext(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.type !== 'copyWithContext') return {};
        const { selectedText, filePath } = message;
        const formatted = `${filePath}\n\`\`\`\n${selectedText}\n\`\`\``;
        await this.host.copyToClipboard(formatted);
        await this.host.showInfo('Copied with context.');
        return {};
    }

    private async handleSendToCLIBackground(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const comments = this.commentsManager.getCommentsForFile(ctx.relativePath)
            .filter(c => c.status === 'open')
            .filter(c => isUserComment(c));

        if (comments.length === 0) {
            await this.host.showInfo('No open user comments to process.');
            return {};
        }

        const commentIds = comments.map(c => c.id);
        const prompt = this.promptGenerator.generatePromptForComments(commentIds, {
            outputFormat: message.promptOptions?.format || 'markdown',
            includeFullFileContent: false,
            groupByFile: true,
            includeLineNumbers: true
        });

        const sdkService = getCopilotSDKService();
        if (!sdkService.isAvailable()) {
            this.host.showError('Copilot SDK not available. Please ensure the SDK is configured.');
            return {};
        }

        const processId = this.aiProcessManager?.registerProcess(prompt);

        await this.host.showInfo(
            `Processing ${comments.length} comment(s) in background. Track progress in AI Processes panel.`
        );

        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

        try {
            const result = await sdkService.sendMessage({
                prompt,
                workingDirectory,
                onPermissionRequest: approveAllPermissions
            });

            const responseText = result.response || '';
            if (processId) {
                this.aiProcessManager?.completeProcess(processId, responseText);
            }

            const action = await this.host.showInfo(
                'AI response ready!',
                'Copy to Clipboard',
                'View Output'
            );

            if (action === 'Copy to Clipboard') {
                await this.host.copyToClipboard(responseText);
                await this.host.showInfo('Response copied to clipboard.');
            } else if (action === 'View Output' && processId) {
                await this.host.executeCommand('shortcuts.viewAIProcess', processId);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            if (processId) {
                this.aiProcessManager?.failProcess(processId, errorMsg);
            }
            this.host.showError(`Background AI request failed: ${errorMsg}`);
        }
        return {};
    }

    // --- Image resolution ---

    private async handleResolveImagePath(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.path || !message.imgId) {
            return {};
        }

        try {
            let resolvedPath: string;

            if (path.isAbsolute(message.path)) {
                resolvedPath = message.path;
            } else {
                resolvedPath = path.resolve(ctx.fileDir, message.path);
            }

            // Try file-relative path first
            let webviewUri = this.host.resolveImageToWebviewUri(resolvedPath);
            if (webviewUri) {
                this.host.postMessage({
                    type: 'imageResolved',
                    imgId: message.imgId,
                    uri: webviewUri,
                    alt: path.basename(message.path)
                });
                return {};
            }

            // Try workspace-relative path
            const workspaceRelativePath = path.resolve(ctx.workspaceRoot, message.path);
            webviewUri = this.host.resolveImageToWebviewUri(workspaceRelativePath);
            if (webviewUri) {
                this.host.postMessage({
                    type: 'imageResolved',
                    imgId: message.imgId,
                    uri: webviewUri,
                    alt: path.basename(message.path)
                });
                return {};
            }

            // Image not found
            this.host.postMessage({
                type: 'imageResolved',
                imgId: message.imgId,
                uri: null,
                error: `Image not found: ${message.path}`
            });
        } catch (error) {
            this.host.postMessage({
                type: 'imageResolved',
                imgId: message.imgId,
                uri: null,
                error: `Error resolving image: ${error}`
            });
        }
        return {};
    }

    // --- Open file ---

    private async handleOpenFile(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.path) {
            return {};
        }

        try {
            if (isExternalUrl(message.path)) {
                await this.host.openExternalUrl(message.path);
                return {};
            }

            const { filePath: pathWithoutFragment, lineNumber } = parseLineFragment(message.path);
            const resolved = resolveFilePath(pathWithoutFragment, ctx.fileDir, ctx.workspaceRoot);

            if (resolved.exists) {
                await this.host.openFile(resolved.resolvedPath, lineNumber);
            } else {
                await this.host.showWarning(`File not found: ${pathWithoutFragment}`);
            }
        } catch (error) {
            this.host.showError(`Error opening file: ${error}`);
        }
        return {};
    }

    // --- File preview ---

    private async handleReadFilePreview(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.path || !message.requestId) {
            return {};
        }

        const requestId = message.requestId as string;
        const filePath = message.path as string;
        const full = message.full === true;
        const maxLines = full ? 500 : 50;

        try {
            const { filePath: pathWithoutFragment, lineNumber } = parseLineFragment(filePath);
            const resolved = resolveFilePath(pathWithoutFragment, ctx.fileDir, ctx.workspaceRoot);

            if (!resolved.exists) {
                this.host.postMessage({
                    type: 'filePreviewResult',
                    requestId,
                    path: filePath,
                    content: undefined,
                    language: '',
                    lineCount: 0,
                    full,
                    error: 'File not found'
                });
                return {};
            }

            const result = await this.host.readFileLines(resolved.resolvedPath, maxLines);
            if (!result) {
                this.host.postMessage({
                    type: 'filePreviewResult',
                    requestId,
                    path: filePath,
                    content: undefined,
                    language: '',
                    lineCount: 0,
                    full,
                    error: 'Could not read file'
                });
                return {};
            }

            const ext = path.extname(resolved.resolvedPath).replace('.', '').toLowerCase();
            const languageMap: Record<string, string> = {
                ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
                py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
                cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
                md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
                html: 'html', css: 'css', scss: 'scss', less: 'less',
                sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
                sql: 'sql', xml: 'xml', toml: 'toml', ini: 'ini'
            };
            const language = languageMap[ext] || ext || 'plaintext';

            // If a line number anchor is specified, offset the content
            let content = result.content;
            if (lineNumber && lineNumber > 1 && !full) {
                const allLines = result.totalLines <= maxLines
                    ? result.content.split('\n')
                    : (await this.host.readFile(resolved.resolvedPath))?.split('\n');
                if (allLines) {
                    const start = Math.max(0, lineNumber - 1);
                    content = allLines.slice(start, start + maxLines).join('\n');
                }
            }

            this.host.postMessage({
                type: 'filePreviewResult',
                requestId,
                path: resolved.resolvedPath,
                content,
                language,
                lineCount: result.totalLines,
                full,
                error: undefined
            });
        } catch (error) {
            this.host.postMessage({
                type: 'filePreviewResult',
                requestId,
                path: filePath,
                content: undefined,
                language: '',
                lineCount: 0,
                full,
                error: `Error reading file: ${error}`
            });
        }
        return {};
    }

    // --- AI requests ---

    private async handleAskAI(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.context) {
            return {};
        }

        const context = message.context;
        const workspaceRoot = ctx.workspaceRoot;

        let promptFileContent: string | undefined;
        if (context.promptFilePath) {
            promptFileContent = await this.host.readFile(context.promptFilePath);
        }
        if (context.skillName && !promptFileContent) {
            promptFileContent = await this.readSkillPrompt(context.skillName);
        }

        const clarificationContext: ClarificationContext = {
            selectedText: context.selectedText,
            selectionRange: {
                startLine: context.startLine,
                endLine: context.endLine
            },
            filePath: ctx.relativePath,
            surroundingContent: context.surroundingLines,
            nearestHeading: context.nearestHeading,
            headings: context.allHeadings,
            instructionType: context.instructionType,
            customInstruction: context.customInstruction,
            promptFileContent,
            skillName: context.skillName
        };

        const result = await handleAIClarification(clarificationContext, workspaceRoot, this.aiProcessManager);

        if (result.success && result.clarification) {
            const labelMap: Record<string, string> = {
                'clarify': '🤖 **AI Clarification:**',
                'go-deeper': '🔍 **AI Deep Analysis:**',
                'custom': '🤖 **AI Response:**'
            };
            const label = labelMap[context.instructionType] || '🤖 **AI Clarification:**';

            await this.commentsManager.addComment(
                ctx.relativePath,
                {
                    startLine: context.startLine,
                    startColumn: 1,
                    endLine: context.endLine,
                    endColumn: context.selectedText.length + 1
                },
                context.selectedText,
                `${label}\n\n${result.clarification}`,
                'AI Assistant',
                undefined,
                undefined,
                'ai-clarification'
            );

            this.host.showInfo(
                'AI response added as comment.',
                'Copy to Clipboard'
            ).then(action => {
                if (action === 'Copy to Clipboard') {
                    this.host.copyToClipboard(result.clarification!);
                }
            });
        }
        return {};
    }

    private async handleAskAIInteractive(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.context) {
            return {};
        }

        const context = normalizeAskAIContextForDocument(
            message.context,
            ctx.documentText
        );

        let promptFileContent: string | undefined;
        if (context.promptFilePath) {
            promptFileContent = await this.host.readFile(context.promptFilePath);
        } else if (context.skillName) {
            promptFileContent = await this.readSkillPrompt(context.skillName);
        }

        const promptParts: string[] = [];

        if (promptFileContent) {
            promptParts.push('--- Instructions from template ---');
            promptParts.push(promptFileContent);
            promptParts.push('');
            promptParts.push('--- Document context ---');
        }

        promptParts.push(`File: ${ctx.relativePath}`);
        if (context.nearestHeading) {
            promptParts.push(`Section: ${context.nearestHeading}`);
        }
        promptParts.push(`Lines: ${context.startLine}-${context.endLine}`);
        promptParts.push('');

        promptParts.push('Selected text:');
        promptParts.push('```');
        promptParts.push(context.selectedText);
        promptParts.push('```');
        promptParts.push('');

        if (context.customInstruction) {
            promptParts.push(`Instruction: ${context.customInstruction}`);
        } else if (!promptFileContent) {
            const instructionMap: Record<string, string> = {
                'clarify': 'Please clarify and explain the selected text.',
                'go-deeper': 'Please provide a deep analysis of the selected text, including implications, edge cases, and related concepts.',
                'custom': 'Please help me understand the selected text.'
            };
            promptParts.push(instructionMap[context.instructionType] || instructionMap['clarify']);
        }

        if (context.surroundingLines) {
            promptParts.push('');
            promptParts.push('Surrounding context:');
            promptParts.push('```');
            promptParts.push(context.surroundingLines);
            promptParts.push('```');
        }

        const prompt = promptParts.join('\n');

        const sessionManager = getInteractiveSessionManager();
        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool: 'copilot',
            initialPrompt: prompt
        });

        if (sessionId) {
            await this.host.showInfo('Interactive AI session started in external terminal.');
        } else {
            this.host.showError('Failed to start interactive AI session. Please check that the AI CLI tool is installed.');
        }
        return {};
    }

    private async handleAskAIQueued(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.context) {
            return {};
        }

        const context = message.context;
        const queueService = getAIQueueService();

        if (!queueService) {
            this.host.showError('Queue service not available');
            return {};
        }

        if (!queueService.isEnabled()) {
            await this.host.showWarning(
                'Queue feature is disabled. Enable it in settings: workspaceShortcuts.queue.enabled'
            );
            return {};
        }

        let promptFileContent: string | undefined;
        if (context.promptFilePath) {
            promptFileContent = await this.host.readFile(context.promptFilePath);
        } else if (context.skillName) {
            promptFileContent = await this.readSkillPrompt(context.skillName);
        }

        const displayName = context.skillName
            ? `AI: ${context.skillName}`
            : `AI: ${context.instructionType}`;

        const workingDirectory = getWorkingDirectory(ctx.workspaceRoot);

        const result = queueService.queueTask({
            type: 'ai-clarification',
            payload: {
                selectedText: context.selectedText,
                filePath: ctx.relativePath,
                startLine: context.startLine,
                endLine: context.endLine,
                surroundingLines: context.surroundingLines,
                nearestHeading: context.nearestHeading,
                instructionType: context.instructionType,
                customInstruction: context.customInstruction,
                promptFileContent,
                skillName: context.skillName,
                workingDirectory
            },
            priority: 'normal',
            displayName: `${displayName} (${path.basename(ctx.relativePath)}:${context.startLine})`
        });

        await this.host.showInfo(
            `Added to queue (#${result.position}): ${displayName}`
        );
        return {};
    }

    // --- Collapsed sections state ---

    private async handleCollapsedSectionsChanged(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.collapsedSections) {
            const key = COLLAPSED_SECTIONS_KEY_PREFIX + ctx.relativePath;
            await this.host.setState(key, message.collapsedSections);
        }
        return {};
    }

    // --- Prompt files and skills ---

    private async handleRequestPromptFiles(): Promise<DispatchResult> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);
        const recentPrompts = await this.getRecentPrompts();

        const validRecent = recentPrompts.filter(r =>
            promptFiles.some(f => f.absolutePath === r.absolutePath)
        );

        const skills = await getSkills(workspaceRoot || undefined);
        const skillsWithDescriptions = await Promise.all(
            skills.map(async (skill) => {
                const description = await this.readSkillDescription(skill.absolutePath);
                return {
                    absolutePath: skill.absolutePath,
                    relativePath: skill.relativePath,
                    name: skill.name,
                    description
                };
            })
        );

        const recentSkills = await this.getRecentSkills();
        const validRecentSkills = recentSkills.filter(r =>
            skills.some(s => s.name === r.name)
        );

        const recentItems: Array<{
            type: 'prompt' | 'skill';
            identifier: string;
            name: string;
            relativePath?: string;
            lastUsed: number;
        }> = [];

        for (const rp of validRecent) {
            recentItems.push({
                type: 'prompt',
                identifier: rp.absolutePath,
                name: rp.name,
                relativePath: rp.relativePath,
                lastUsed: rp.lastUsed
            });
        }

        for (const rs of validRecentSkills) {
            recentItems.push({
                type: 'skill',
                identifier: rs.name,
                name: rs.name,
                lastUsed: rs.lastUsed
            });
        }

        recentItems.sort((a, b) => b.lastUsed - a.lastUsed);
        const limitedRecentItems = recentItems.slice(0, MAX_RECENT_PROMPTS);

        this.host.postMessage({
            type: 'promptFilesResponse',
            promptFiles: promptFiles.map(f => ({
                absolutePath: f.absolutePath,
                relativePath: f.relativePath,
                name: f.name,
                sourceFolder: f.sourceFolder
            })),
            recentPrompts: validRecent,
            recentItems: limitedRecentItems,
            skills: skillsWithDescriptions
        });
        return {};
    }

    private async handleRequestSkills(): Promise<DispatchResult> {
        const workspaceRoot = getWorkspaceRoot();
        const skills = await getSkills(workspaceRoot || undefined);

        const skillsWithDescriptions = await Promise.all(
            skills.map(async (skill) => {
                const description = await this.readSkillDescription(skill.absolutePath);
                return {
                    absolutePath: skill.absolutePath,
                    relativePath: skill.relativePath,
                    name: skill.name,
                    description
                };
            })
        );

        this.host.postMessage({
            type: 'skillsResponse',
            skills: skillsWithDescriptions
        });
        return {};
    }

    private async handlePromptSearch(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);

        if (promptFiles.length === 0) {
            await this.host.showInfo('No .prompt.md files found in configured locations.');
            return {};
        }

        const items = promptFiles.map(f => ({
            label: `$(file) ${f.name}`,
            description: f.relativePath,
            detail: f.sourceFolder,
            absolutePath: f.absolutePath
        }));

        const selected = await this.host.showQuickPick(items, {
            placeHolder: 'Search for a prompt file...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const documentPath = message.targetDocumentPath || ctx.documentPath;
            await this.handleExecuteWorkPlanLegacy(documentPath, (selected as { absolutePath: string }).absolutePath);
        }
        return {};
    }

    // --- Follow Prompt / Work Plan ---

    private async handleExecuteWorkPlan(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.promptFilePath) {
            return {};
        }
        await this.showFollowPromptDialog(
            message.promptFilePath,
            path.basename(message.promptFilePath, '.prompt.md'),
            undefined
        );
        return {};
    }

    private async handleExecuteWorkPlanWithSkill(message: WebviewMessage): Promise<DispatchResult> {
        if (!message.skillName) {
            return {};
        }
        const skillPromptPath = await this.getSkillPromptPath(message.skillName);
        if (skillPromptPath) {
            await this.showFollowPromptDialog(
                skillPromptPath,
                message.skillName,
                message.skillName
            );
        }
        return {};
    }

    private async handleFollowPromptDialogResult(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.promptFilePath && message.options) {
            const documentPath = message.targetDocumentPath || ctx.documentPath;
            await this.executeFollowPrompt(
                documentPath,
                message.promptFilePath,
                message.options,
                message.skillName
            );
        }
        return {};
    }

    private async handleCopyFollowPrompt(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (message.promptFilePath) {
            const documentPath = message.targetDocumentPath || ctx.documentPath;
            await this.copyFollowPromptToClipboard(
                documentPath,
                message.promptFilePath,
                message.additionalContext
            );
        }
        return {};
    }

    // --- Dialog requests ---

    private async handleRequestUpdateDocumentDialog(): Promise<DispatchResult> {
        this.host.postMessage({ type: 'showUpdateDocumentDialog' });
        return {};
    }

    private async handleRequestRefreshPlanDialog(): Promise<DispatchResult> {
        this.host.postMessage({ type: 'showRefreshPlanDialog' });
        return {};
    }

    // --- Document operations ---

    private async handleUpdateDocument(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        if (!message.instruction) {
            return {};
        }

        const documentPath = message.targetDocumentPath || ctx.documentPath;

        try {
            const fileName = path.basename(documentPath);
            const prompt = `The user wants to update the following markdown document:

File: ${fileName}
Path: ${documentPath}

## User Instruction
${message.instruction}

## Output Requirements

**CRITICAL:** Read the file and then edit it in-place at: ${documentPath}

- Make only the changes described in the instruction
- Preserve markdown format and any frontmatter
- Do NOT create new files or write to session state/temp directories
- Do NOT output the full file content to stdout`;

            const sessionManager = getInteractiveSessionManager();
            const tool = this.host.getConfig<'copilot' | 'claude'>('workspaceShortcuts.workPlan', 'defaultTool', 'copilot');
            const workingDirectory = this.resolveWorkPlanWorkingDirectory(documentPath);

            const sessionId = await sessionManager.startSession({
                workingDirectory,
                tool,
                initialPrompt: prompt
            });

            if (sessionId) {
                await this.host.showInfo(`Interactive session started for: ${path.basename(documentPath)}`);
            } else {
                this.host.showError('Failed to start interactive session. Please check that the AI CLI tool is installed.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.host.showError(`Failed to start Update Document session: ${errorMessage}`);
        }
        return {};
    }

    private async handleRefreshPlan(message: WebviewMessage, ctx: MessageContext): Promise<DispatchResult> {
        const documentPath = message.targetDocumentPath || ctx.documentPath;
        try {
            const planContent = await this.host.readFile(documentPath);
            if (!planContent) {
                this.host.showError(`Failed to read plan file: ${documentPath}`);
                return {};
            }

            const fileName = path.basename(documentPath);

            let prompt = `You are tasked with refreshing and regenerating a plan document based on the latest codebase state.

## Current Plan
File: ${fileName}
---
${planContent}
---

## Instructions
Please analyze the current state of the codebase and rewrite this plan to reflect:
1. What has already been completed (mark as done or remove)
2. What is still pending and needs to be updated based on current code
3. Any new tasks that should be added based on recent changes
4. Updated acceptance criteria if the requirements have evolved

Maintain the same general structure and format of the original plan, but update the content to be accurate and relevant.`;

            if (message.additionalContext && message.additionalContext.trim()) {
                prompt += `

## Additional Context from User
${message.additionalContext}

Please take this additional context into account when refreshing the plan.`;
            }

            prompt += `

## Output Requirements

**CRITICAL:** Edit the file in-place at: ${documentPath}

- Preserve markdown format and any frontmatter
- Do NOT create new files or write to session state/temp directories
- Do NOT output content to stdout`;

            const sessionManager = getInteractiveSessionManager();
            const tool = this.host.getConfig<'copilot' | 'claude'>('workspaceShortcuts.workPlan', 'defaultTool', 'copilot');
            const workingDirectory = this.resolveWorkPlanWorkingDirectory(documentPath);

            const sessionId = await sessionManager.startSession({
                workingDirectory,
                tool,
                initialPrompt: prompt
            });

            if (sessionId) {
                await this.host.showInfo(`Refresh Plan session started for: ${fileName}`);
            } else {
                this.host.showError('Failed to start interactive session. Please check that the AI CLI tool is installed.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.host.showError(`Failed to start Refresh Plan session: ${errorMessage}`);
        }
        return {};
    }

    // ===== Helper methods =====

    private async readSkillPrompt(skillName: string): Promise<string | undefined> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        const skillPromptPath = path.join(workspaceRoot, '.github', 'skills', skillName, 'SKILL.md');
        return this.host.readFile(skillPromptPath);
    }

    private async readSkillDescription(skillPath: string): Promise<string | undefined> {
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const content = await this.host.readFile(skillMdPath);
        if (!content) {
            return undefined;
        }

        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
            if (descriptionMatch) {
                return descriptionMatch[1].trim();
            }
        }
        return undefined;
    }

    private async getRecentPrompts(): Promise<Array<{
        absolutePath: string;
        relativePath: string;
        name: string;
        lastUsed: number;
    }>> {
        return this.host.getState<Array<{
            absolutePath: string;
            relativePath: string;
            name: string;
            lastUsed: number;
        }>>(RECENT_PROMPTS_KEY, []);
    }

    private async trackPromptUsage(absolutePath: string): Promise<void> {
        const workspaceRoot = getWorkspaceRoot();
        const promptFiles = await getPromptFiles(workspaceRoot || undefined);
        const promptFile = promptFiles.find(f => f.absolutePath === absolutePath);

        if (!promptFile) {
            return;
        }

        const recent = await this.getRecentPrompts();
        const filtered = recent.filter(r => r.absolutePath !== absolutePath);

        filtered.unshift({
            absolutePath,
            name: promptFile.name,
            relativePath: promptFile.relativePath,
            lastUsed: Date.now()
        });

        await this.host.setState(
            RECENT_PROMPTS_KEY,
            filtered.slice(0, MAX_RECENT_PROMPTS)
        );
    }

    private async getRecentSkills(): Promise<Array<{
        name: string;
        lastUsed: number;
    }>> {
        return this.host.getState<Array<{
            name: string;
            lastUsed: number;
        }>>(RECENT_SKILLS_KEY, []);
    }

    private async trackSkillUsage(skillName: string): Promise<void> {
        const recent = await this.getRecentSkills();
        const filtered = recent.filter(r => r.name !== skillName);

        filtered.unshift({
            name: skillName,
            lastUsed: Date.now()
        });

        await this.host.setState(
            RECENT_SKILLS_KEY,
            filtered.slice(0, MAX_RECENT_PROMPTS)
        );
    }

    private async showFollowPromptDialog(
        promptFilePath: string,
        promptName: string,
        skillName?: string
    ): Promise<void> {
        await this.trackPromptUsage(promptFilePath);

        if (skillName) {
            await this.trackSkillUsage(skillName);
        }

        const availableModels = getAvailableModels();
        const rememberSelection = this.host.getConfig<boolean>(
            'workspaceShortcuts.followPrompt', 'rememberSelection', false
        );

        let defaultMode = this.host.getConfig<'interactive' | 'background'>(
            'workspaceShortcuts.followPrompt', 'defaultMode', 'interactive'
        );
        let defaultModel = this.host.getConfig<string>(
            'workspaceShortcuts.followPrompt', 'defaultModel', ''
        );

        if (rememberSelection) {
            const lastSelection = this.getLastFollowPromptSelection();
            if (lastSelection) {
                defaultMode = lastSelection.mode;
                defaultModel = lastSelection.model;
            }
        }

        this.host.postMessage({
            type: 'showFollowPromptDialog',
            promptName,
            promptFilePath,
            skillName,
            availableModels: availableModels.map(m => ({
                id: m.id,
                label: m.label,
                description: m.description,
                isDefault: m.isDefault
            })),
            defaults: {
                mode: defaultMode,
                model: defaultModel
            }
        });
    }

    private async getSkillPromptPath(skillName: string): Promise<string | undefined> {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            this.host.showError('No workspace root found');
            return undefined;
        }

        const skillPath = path.join(workspaceRoot, '.github', 'skills', skillName);

        if (!await this.host.fileExists(skillPath)) {
            this.host.showError(`Skill not found: ${skillName}`);
            return undefined;
        }

        let promptFilePath = path.join(skillPath, 'prompt.md');
        if (!await this.host.fileExists(promptFilePath)) {
            promptFilePath = path.join(skillPath, 'SKILL.md');
            if (!await this.host.fileExists(promptFilePath)) {
                this.host.showError(`No prompt file found for skill: ${skillName}`);
                return undefined;
            }
        }

        return promptFilePath;
    }

    private async executeFollowPrompt(
        planFilePath: string,
        promptFilePath: string,
        options: FollowPromptExecutionOptions,
        skillName?: string
    ): Promise<void> {
        const rememberSelection = this.host.getConfig<boolean>(
            'workspaceShortcuts.followPrompt', 'rememberSelection', false
        );
        if (rememberSelection) {
            this.saveLastFollowPromptSelection(options.mode, options.model);
        }

        if (options.mode === 'background') {
            await this.executeFollowPromptInBackground(planFilePath, promptFilePath, options, skillName);
        } else {
            await this.executeFollowPromptInteractive(planFilePath, promptFilePath, options, skillName);
        }
    }

    private async executeFollowPromptInteractive(
        planFilePath: string,
        promptFilePath: string,
        options: FollowPromptExecutionOptions,
        skillName?: string
    ): Promise<void> {
        const sessionManager = getInteractiveSessionManager();

        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (options.additionalContext && options.additionalContext.trim()) {
            fullPrompt += `\n\nAdditional context: ${options.additionalContext.trim()}`;
        }

        const tool = this.host.getConfig<'copilot' | 'claude'>('workspaceShortcuts.workPlan', 'defaultTool', 'copilot');
        const workingDirectory = this.resolveWorkPlanWorkingDirectory(planFilePath);

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool,
            initialPrompt: fullPrompt
        });

        if (sessionId) {
            const displayName = skillName ? `Skill: ${skillName}` : path.basename(promptFilePath);
            await this.host.showInfo(
                `Interactive session started: ${displayName} → ${path.basename(planFilePath)}`
            );
        } else {
            this.host.showError(
                'Failed to start interactive session. Please check that the AI CLI tool is installed.'
            );
        }
    }

    private async copyFollowPromptToClipboard(
        planFilePath: string,
        promptFilePath: string,
        additionalContext?: string
    ): Promise<void> {
        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (additionalContext && additionalContext.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
        }

        await this.host.copyToClipboard(fullPrompt);
        await this.host.showInfo('Prompt copied to clipboard');
    }

    private async executeFollowPromptInBackground(
        planFilePath: string,
        promptFilePath: string,
        options: FollowPromptExecutionOptions,
        skillName?: string
    ): Promise<void> {
        const queueService = getAIQueueService();

        if (!queueService) {
            this.host.showError('Queue service not available');
            return;
        }

        if (!queueService.isEnabled()) {
            await this.host.showWarning(
                'Queue feature is disabled. Enable it in settings: workspaceShortcuts.queue.enabled'
            );
            return;
        }

        const displayName = skillName ? `Skill: ${skillName}` : path.basename(promptFilePath, '.prompt.md');
        const workingDirectory = this.resolveWorkPlanWorkingDirectory(planFilePath);

        const result = queueService.queueTask({
            type: 'follow-prompt',
            payload: {
                promptFilePath,
                planFilePath,
                skillName,
                additionalContext: options.additionalContext,
                workingDirectory,
                model: options.model
            },
            priority: 'normal',
            displayName: `${displayName} → ${path.basename(planFilePath)}`,
            config: {
                model: options.model,
                timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS
            }
        });

        await this.host.showInfo(
            `Queued background execution (#${result.position}): ${displayName} → ${path.basename(planFilePath)}`
        );
    }

    private getLastFollowPromptSelection(): { mode: 'interactive' | 'background'; model: string } | undefined {
        const stored = this.host.getState<{ mode: 'interactive' | 'background' | 'queued'; model: string } | undefined>(
            'followPrompt.lastSelection',
            undefined
        );
        if (!stored) return undefined;
        return {
            mode: stored.mode === 'queued' ? 'background' : stored.mode,
            model: stored.model
        };
    }

    private saveLastFollowPromptSelection(mode: 'interactive' | 'background', model: string): void {
        this.host.setState('followPrompt.lastSelection', { mode, model });
    }

    /**
     * @deprecated Use showFollowPromptDialog and executeFollowPrompt instead.
     */
    private async handleExecuteWorkPlanLegacy(
        planFilePath: string,
        promptFilePath: string
    ): Promise<void> {
        await this.trackPromptUsage(promptFilePath);

        const additionalMessage = await this.host.showInputBox({
            prompt: 'Additional context or instructions (optional)',
            placeHolder: 'e.g., "Focus on error handling" or "Use TypeScript strict mode"',
            ignoreFocusOut: true
        });

        if (additionalMessage === undefined) {
            return;
        }

        const sessionManager = getInteractiveSessionManager();

        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (additionalMessage && additionalMessage.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
        }

        const tool = this.host.getConfig<'copilot' | 'claude'>('workspaceShortcuts.workPlan', 'defaultTool', 'copilot');
        const workingDirectory = this.resolveWorkPlanWorkingDirectory(planFilePath);

        const sessionId = await sessionManager.startSession({
            workingDirectory,
            tool,
            initialPrompt: fullPrompt
        });

        if (sessionId) {
            await this.host.showInfo(
                `Interactive session started: ${path.basename(promptFilePath)} → ${path.basename(planFilePath)}`
            );
        } else {
            this.host.showError(
                'Failed to start interactive session. Please check that the AI CLI tool is installed.'
            );
        }
    }

    private resolveWorkPlanWorkingDirectory(planFilePath: string): string {
        const configPath = this.host.getConfig<string>('workspaceShortcuts.workPlan', 'workingDirectory', '{workspaceFolder}');

        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return path.dirname(planFilePath);
        }

        const resolved = configPath.replace('{workspaceFolder}', workspaceRoot);

        if (resolved.endsWith('/src') && !fs.existsSync(resolved)) {
            return workspaceRoot;
        }

        return resolved;
    }
}

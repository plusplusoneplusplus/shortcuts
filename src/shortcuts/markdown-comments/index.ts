/**
 * Markdown Comments feature module
 * Exports all components for the markdown comments functionality
 */

export {
    buildClarificationPrompt,
    escapeShellArg,
    parseCopilotOutput,
    validateAndTruncatePrompt
} from './ai-clarification-handler';
export * from './comment-anchor';
export { MarkdownCommentsCommands } from './comments-commands';
export { CommentsManagerBase, Disposable, FileWatcher, FileWatcherFactory, TypedEventEmitter } from './comments-manager-base';
export { CommentsManager } from './comments-manager';
export { CommentFileItem, CommentItem, MarkdownCommentsTreeDataProvider } from './comments-tree-provider';
export { EditorHost, MessageContext, DispatchResult } from './editor-host';
export { EditorMessageRouter, WebviewMessage, AskAIContext } from './editor-message-router';
export * from './file-path-utils';
export * from './markdown-parser';
export { PromptGenerator } from './prompt-generator';
export { ReviewEditorViewProvider } from './review-editor-view-provider';
export * from './types';
export { VscodeEditorHost } from './vscode-editor-host';
export * from './webview-utils';

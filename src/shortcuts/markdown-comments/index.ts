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
export { CommentsManager } from './comments-manager';
export { CommentFileItem, CommentItem, MarkdownCommentsTreeDataProvider } from './comments-tree-provider';
export * from './markdown-parser';
export { PromptGenerator } from './prompt-generator';
export { ReviewEditorViewProvider } from './review-editor-view-provider';
export * from './types';
export * from './webview-utils';

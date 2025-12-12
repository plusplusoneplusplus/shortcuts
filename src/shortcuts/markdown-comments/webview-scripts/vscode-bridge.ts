/**
 * VS Code webview bridge
 * 
 * Handles communication between the webview and the VS Code extension.
 */

import { state } from './state';
import { ExtensionMessage, WebviewMessage } from './types';

/**
 * Send a message to the extension
 */
export function postMessage(message: WebviewMessage): void {
    state.vscode.postMessage(message);
}

/**
 * Notify the extension that the webview is ready
 */
export function notifyReady(): void {
    postMessage({ type: 'ready' });
}

/**
 * Request the extension to resolve all comments
 */
export function requestResolveAll(): void {
    postMessage({ type: 'resolveAll' });
}

/**
 * Request the extension to copy the AI prompt
 */
export function requestCopyPrompt(format: string = 'markdown'): void {
    postMessage({ type: 'copyPrompt', promptOptions: { format } });
}

/**
 * Add a new comment
 */
export function addComment(comment: string): void {
    const selection = state.pendingSelection;
    if (!selection) return;
    
    const message: WebviewMessage = {
        type: 'addComment',
        selection: {
            startLine: selection.startLine,
            startColumn: selection.startColumn,
            endLine: selection.endLine,
            endColumn: selection.endColumn,
            selectedText: selection.selectedText
        },
        comment
    };
    
    if (selection.mermaidContext) {
        message.mermaidContext = selection.mermaidContext;
    }
    
    postMessage(message);
}

/**
 * Edit an existing comment
 */
export function editComment(commentId: string, comment: string): void {
    postMessage({ type: 'editComment', commentId, comment });
}

/**
 * Resolve a comment
 */
export function resolveComment(commentId: string): void {
    postMessage({ type: 'resolveComment', commentId });
}

/**
 * Reopen a resolved comment
 */
export function reopenComment(commentId: string): void {
    postMessage({ type: 'reopenComment', commentId });
}

/**
 * Delete a comment
 */
export function deleteCommentMessage(commentId: string): void {
    postMessage({ type: 'deleteComment', commentId });
}

/**
 * Update the document content
 */
export function updateContent(content: string): void {
    postMessage({ type: 'updateContent', content });
}

/**
 * Request image path resolution
 */
export function resolveImagePath(path: string, imgId: string): void {
    postMessage({ type: 'resolveImagePath', path, imgId });
}

/**
 * Message handler type
 */
export type MessageHandler = (message: ExtensionMessage) => void;

/**
 * Setup message listener from extension
 */
export function setupMessageListener(handler: MessageHandler): void {
    window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
        handler(event.data);
    });
}


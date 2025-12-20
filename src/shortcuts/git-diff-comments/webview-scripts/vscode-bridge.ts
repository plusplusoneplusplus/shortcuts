/**
 * VSCode API bridge for webview communication
 */

import { DiffSelection, VSCodeAPI, WebviewMessage } from './types';

/**
 * VSCode API instance
 */
let vscode: VSCodeAPI | null = null;

/**
 * Initialize the VSCode API
 */
export function initVSCodeAPI(): VSCodeAPI {
    if (!vscode) {
        vscode = window.acquireVsCodeApi();
    }
    return vscode;
}

/**
 * Get the VSCode API instance
 */
export function getVSCodeAPI(): VSCodeAPI | null {
    return vscode;
}

/**
 * Send a message to the extension
 */
export function postMessage(message: WebviewMessage): void {
    if (vscode) {
        vscode.postMessage(message);
    }
}

/**
 * Notify extension that webview is ready
 */
export function sendReady(): void {
    postMessage({ type: 'ready' });
}

/**
 * Request current state from extension
 */
export function requestState(): void {
    postMessage({ type: 'requestState' });
}

/**
 * Send add comment request
 */
export function sendAddComment(
    selection: DiffSelection,
    selectedText: string,
    comment: string
): void {
    postMessage({
        type: 'addComment',
        selection,
        selectedText,
        comment
    });
}

/**
 * Send edit comment request
 */
export function sendEditComment(commentId: string, comment: string): void {
    postMessage({
        type: 'editComment',
        commentId,
        comment
    });
}

/**
 * Send delete comment request
 */
export function sendDeleteComment(commentId: string): void {
    postMessage({
        type: 'deleteComment',
        commentId
    });
}

/**
 * Send resolve comment request
 */
export function sendResolveComment(commentId: string): void {
    postMessage({
        type: 'resolveComment',
        commentId
    });
}

/**
 * Send reopen comment request
 */
export function sendReopenComment(commentId: string): void {
    postMessage({
        type: 'reopenComment',
        commentId
    });
}


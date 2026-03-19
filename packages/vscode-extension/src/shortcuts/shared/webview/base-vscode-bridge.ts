/**
 * Base VSCode Webview Bridge
 * 
 * Provides common functionality for VSCode webview communication.
 * Both markdown-comments and git-diff-comments webviews use this base.
 */

/**
 * Base VSCode API interface
 */
export interface BaseVSCodeAPI {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

/**
 * Base message type interface
 * Uses a generic to allow specific message types without index signatures
 */
export interface BaseWebviewMessage {
    type: string;
}

/**
 * Base extension message interface
 */
export interface BaseExtensionMessage {
    type: string;
}

/**
 * Generic message handler type
 */
export type BaseMessageHandler<T extends { type: string }> = (message: T) => void;

/**
 * Post a message to the VSCode extension
 * Uses a generic to accept any message type with a 'type' property
 */
export function postMessageToExtension<T extends { type: string }>(
    vscode: BaseVSCodeAPI | null,
    message: T
): void {
    if (vscode) {
        vscode.postMessage(message);
    }
}

/**
 * Setup a message listener from the extension
 */
export function setupBaseMessageListener<T extends { type: string }>(
    handler: BaseMessageHandler<T>
): void {
    window.addEventListener('message', (event: MessageEvent<T>) => {
        handler(event.data);
    });
}

/**
 * Common message types for comment-related operations
 */
export const CommonMessageTypes = {
    READY: 'ready',
    ADD_COMMENT: 'addComment',
    EDIT_COMMENT: 'editComment',
    DELETE_COMMENT: 'deleteComment',
    RESOLVE_COMMENT: 'resolveComment',
    REOPEN_COMMENT: 'reopenComment',
    OPEN_FILE: 'openFile',
    UPDATE: 'update',
    SCROLL_TO_COMMENT: 'scrollToComment'
} as const;


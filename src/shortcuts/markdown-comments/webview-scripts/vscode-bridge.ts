/**
 * VS Code webview bridge
 * 
 * Handles communication between the webview and the VS Code extension.
 * Uses shared utilities from the base-vscode-bridge module.
 */

import {
    BaseMessageHandler,
    CommonMessageTypes,
    postMessageToExtension,
    setupBaseMessageListener
} from '../../shared/webview/base-vscode-bridge';
import { state } from './state';
import { ExtensionMessage, WebviewMessage } from './types';

/**
 * Send a message to the extension
 */
export function postMessage(message: WebviewMessage): void {
    postMessageToExtension(state.vscode, message);
}

/**
 * Notify the extension that the webview is ready
 */
export function notifyReady(): void {
    postMessage({ type: CommonMessageTypes.READY });
}

/**
 * Request the extension to resolve all comments
 */
export function requestResolveAll(): void {
    postMessage({ type: 'resolveAll' });
}

/**
 * Request the extension to delete all comments
 */
export function requestDeleteAll(): void {
    postMessage({ type: 'deleteAll' });
}

/**
 * Request the extension to copy the AI prompt
 */
export function requestCopyPrompt(format: string = 'markdown'): void {
    postMessage({ type: 'copyPrompt', promptOptions: { format } });
}

/**
 * Request the extension to send the AI prompt to chat
 * @param format - The format of the prompt ('markdown' or 'json')
 * @param newConversation - If true, starts a new chat conversation; if false, uses existing chat
 */
export function requestSendToChat(format: string = 'markdown', newConversation: boolean = true): void {
    postMessage({ type: 'sendToChat', promptOptions: { format, newConversation } });
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
 * Request to open a file in VS Code
 */
export function openFile(path: string): void {
    postMessage({ type: 'openFile', path });
}

/**
 * Request AI clarification for selected text
 */
export function requestAskAI(context: {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    /** Command ID from the AI command registry */
    instructionType: string;
    customInstruction?: string;
}): void {
    postMessage({ type: 'askAI', context });
}

/**
 * Message handler type
 * Re-exported from shared module for backward compatibility
 */
export type MessageHandler = BaseMessageHandler<ExtensionMessage>;

/**
 * Setup message listener from extension
 */
export function setupMessageListener(handler: MessageHandler): void {
    setupBaseMessageListener<ExtensionMessage>(handler);
}


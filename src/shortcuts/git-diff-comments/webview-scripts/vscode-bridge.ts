/**
 * VSCode API bridge for webview communication
 * 
 * Uses shared utilities from the base-vscode-bridge module.
 */

import {
    BaseVSCodeAPI,
    CommonMessageTypes,
    postMessageToExtension
} from '../../shared/webview/base-vscode-bridge';
import { DiffSelection, VSCodeAPI, WebviewMessage } from './types';

/**
 * VSCode API instance
 */
let vscode: VSCodeAPI | null = null;

/**
 * Initialize the VSCode API and save state for restoration
 */
export function initVSCodeAPI(): VSCodeAPI {
    if (!vscode) {
        vscode = window.acquireVsCodeApi();
        // Save initial data for webview state restoration after VSCode restart
        if (window.initialData) {
            vscode.setState(window.initialData);
        }
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
    postMessageToExtension(vscode as BaseVSCodeAPI | null, message);
}

/**
 * Notify extension that webview is ready
 */
export function sendReady(): void {
    postMessage({ type: CommonMessageTypes.READY });
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

/**
 * Send open file request
 */
export function sendOpenFile(filePath: string): void {
    postMessage({
        type: 'openFile',
        fileToOpen: filePath
    });
}

/**
 * Send copy path request
 */
export function sendCopyPath(filePath: string): void {
    postMessage({
        type: 'copyPath',
        pathToCopy: filePath
    });
}

/**
 * AI instruction type for Ask AI feature
 */
export type DiffAIInstructionType = 'clarify' | 'go-deeper' | 'custom';

/**
 * Context for Ask AI request
 */
export interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    side: 'old' | 'new' | 'both';
    surroundingLines: string;
    instructionType: DiffAIInstructionType;
    customInstruction?: string;
}

/**
 * Send Ask AI request
 */
export function sendAskAI(context: AskAIContext): void {
    postMessage({
        type: 'askAI',
        context
    });
}

/**
 * Send save content request (for editable diff view)
 */
export function sendSaveContent(newContent: string): void {
    postMessage({
        type: 'saveContent',
        newContent
    });
}


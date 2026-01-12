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
import { ViewMode } from './state';

/**
 * VSCode API instance
 */
let vscode: VSCodeAPI | null = null;

/**
 * Persisted webview state interface
 */
export interface PersistedWebviewState {
    /** The view mode preference (split or inline) */
    viewMode?: ViewMode;
    /** Original initial data for restoration */
    initialData?: any;
}

/**
 * Initialize the VSCode API and save state for restoration
 */
export function initVSCodeAPI(): VSCodeAPI {
    if (!vscode) {
        vscode = window.acquireVsCodeApi();
        // Preserve existing state (like viewMode) while updating initialData
        const existingState = vscode.getState() as PersistedWebviewState | null;
        const newState: PersistedWebviewState = {
            ...existingState,
            initialData: window.initialData
        };
        vscode.setState(newState);
    }
    return vscode;
}

/**
 * Get the persisted view mode preference
 * @returns The persisted view mode, or undefined if not set
 */
export function getPersistedViewMode(): ViewMode | undefined {
    if (!vscode) {
        return undefined;
    }
    const state = vscode.getState() as PersistedWebviewState | null;
    return state?.viewMode;
}

/**
 * Save the view mode preference to persistent state
 * @param viewMode The view mode to persist
 */
export function saveViewMode(viewMode: ViewMode): void {
    if (!vscode) {
        return;
    }
    const existingState = vscode.getState() as PersistedWebviewState | null;
    const newState: PersistedWebviewState = {
        ...existingState,
        viewMode
    };
    vscode.setState(newState);
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
 * AI instruction type for Ask AI feature.
 * This is now a string to support dynamic command IDs from the registry.
 */
export type DiffAIInstructionType = string;

/**
 * Context for Ask AI request
 */
export interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    side: 'old' | 'new' | 'both';
    surroundingLines: string;
    /** Command ID from the AI command registry */
    instructionType: DiffAIInstructionType;
    /** Custom instruction text (only used when command has isCustomInput=true) */
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

/**
 * Send content modified state (for dirty indicator in tab)
 */
export function sendContentModified(isDirty: boolean): void {
    postMessage({
        type: 'contentModified',
        isDirty
    });
}

/**
 * Send pin tab request to convert preview tab to a regular pinned tab.
 * This is called when user double-clicks on the webview content or performs
 * an action that should "keep" the tab open.
 */
export function sendPinTab(): void {
    postMessage({
        type: 'pinTab'
    });
}


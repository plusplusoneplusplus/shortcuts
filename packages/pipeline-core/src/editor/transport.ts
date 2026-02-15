/**
 * Transport abstraction for the Markdown Review Editor.
 *
 * Abstracts the bidirectional message channel between the UI (webview)
 * and the backend (VS Code extension host or standalone HTTP server).
 */

import type { Disposable } from '../utils/process-monitor';
import type { BackendToWebviewMessage, WebviewToBackendMessage } from './messages';

/** Callback for receiving messages */
export type MessageListener<T> = (message: T) => void;

/** Abstracts the bidirectional message channel between UI and backend */
export interface EditorTransport {
    /** Send a message from backend to the UI */
    postMessage(message: BackendToWebviewMessage): void;

    /** Register a handler for messages coming from the UI */
    onMessage(listener: MessageListener<WebviewToBackendMessage>): Disposable;

    /** Whether the transport is currently connected */
    readonly isConnected: boolean;

    /** Fires when connection state changes */
    onDidChangeConnection?(listener: (connected: boolean) => void): Disposable;
}

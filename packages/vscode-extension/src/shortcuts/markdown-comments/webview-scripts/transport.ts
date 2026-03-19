/**
 * Abstract transport layer for webview↔host communication.
 *
 * VscodeTransport wraps acquireVsCodeApi(); HttpTransport (commit 008) uses fetch+WebSocket.
 */

import { ExtensionMessage, VsCodeApi, WebviewMessage } from './types';

/**
 * Abstract transport for webview↔host communication.
 */
export interface EditorTransport {
    /** Send a message from the webview to the host (extension or server) */
    postMessage(message: WebviewMessage): void;
    /** Register a handler for messages from the host */
    onMessage(handler: (message: ExtensionMessage) => void): void;
}

/**
 * VS Code transport implementation using acquireVsCodeApi().
 */
export class VscodeTransport implements EditorTransport {
    constructor(private readonly vscode: VsCodeApi) {}

    postMessage(message: WebviewMessage): void {
        this.vscode.postMessage(message);
    }

    onMessage(handler: (message: ExtensionMessage) => void): void {
        window.addEventListener('message', (event: MessageEvent) => {
            handler(event.data);
        });
    }
}

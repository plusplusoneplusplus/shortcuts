/**
 * HTTP Transport for the Review Editor SPA
 *
 * Concrete `EditorTransport` implementation for browser environments.
 * Routes outgoing commands through REST fetch() calls to the server API,
 * and receives server-push events over a WebSocket connection.
 *
 * Browser-only — no Node.js or VS Code dependencies.
 */

import type {
    EditorTransport,
    MessageListener,
    BackendToWebviewMessage,
    WebviewToBackendMessage,
} from '@plusplusoneplusplus/pipeline-core';
import type { Disposable } from '@plusplusoneplusplus/pipeline-core/dist/utils/process-monitor';
import {
    onReviewMessage,
    connectReviewWebSocket,
    disconnectReviewWebSocket,
} from './review-websocket';

/**
 * EditorTransport implementation backed by REST API + WebSocket.
 *
 * - `postMessage()` is not used (server → UI flow happens via WebSocket)
 * - `onMessage()` registers handlers that receive WebSocket events
 * - `send()` routes WebviewToBackendMessage to REST endpoints
 */
export class HttpTransport implements EditorTransport {
    private messageHandlers: Array<MessageListener<WebviewToBackendMessage>> = [];
    private backendHandlers: Array<MessageListener<BackendToWebviewMessage>> = [];
    private unsubscribeWs: (() => void) | null = null;
    private _isConnected = false;
    private connectionListeners: Array<(connected: boolean) => void> = [];

    constructor(
        private readonly filePath: string,
        private readonly apiBase: string = '/api',
    ) {}

    // --- EditorTransport interface ---

    get isConnected(): boolean {
        return this._isConnected;
    }

    postMessage(message: BackendToWebviewMessage): void {
        for (const h of this.backendHandlers) h(message);
    }

    onMessage(listener: MessageListener<WebviewToBackendMessage>): Disposable {
        this.messageHandlers.push(listener);
        return {
            dispose: () => {
                const idx = this.messageHandlers.indexOf(listener);
                if (idx >= 0) this.messageHandlers.splice(idx, 1);
            },
        };
    }

    onDidChangeConnection(listener: (connected: boolean) => void): Disposable {
        this.connectionListeners.push(listener);
        return {
            dispose: () => {
                const idx = this.connectionListeners.indexOf(listener);
                if (idx >= 0) this.connectionListeners.splice(idx, 1);
            },
        };
    }

    // --- Backend → Webview message handler registration ---

    /**
     * Register a handler for BackendToWebviewMessage events
     * (dispatched from WebSocket events and REST responses).
     */
    onBackendMessage(listener: MessageListener<BackendToWebviewMessage>): Disposable {
        this.backendHandlers.push(listener);
        return {
            dispose: () => {
                const idx = this.backendHandlers.indexOf(listener);
                if (idx >= 0) this.backendHandlers.splice(idx, 1);
            },
        };
    }

    // --- send() routes WebviewToBackendMessage to REST ---

    async send(message: WebviewToBackendMessage): Promise<void> {
        const encodedPath = encodeURIComponent(this.filePath);
        switch (message.type) {
            case 'addComment':
                await this.post(`/review/files/${encodedPath}/comments`, {
                    selection: message.selection,
                    selectedText: message.selection?.selectedText,
                    comment: message.comment,
                    mermaidContext: message.mermaidContext,
                });
                break;
            case 'editComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    comment: message.comment,
                });
                break;
            case 'deleteComment':
                await this.del(`/review/files/${encodedPath}/comments/${message.commentId}`);
                break;
            case 'resolveComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    status: 'resolved',
                });
                break;
            case 'reopenComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    status: 'open',
                });
                break;
            case 'resolveAll':
                await this.post(`/review/files/${encodedPath}/comments/resolve-all`, {});
                break;
            case 'deleteAll':
                await this.del(`/review/files/${encodedPath}/comments`);
                break;
            case 'ready':
                await this.refetchState();
                break;
            case 'resolveImagePath':
                this.dispatchBackend({
                    type: 'imageResolved',
                    imgId: message.imgId,
                    uri: `${this.apiBase}/review/images/${encodeURIComponent(message.path)}`,
                });
                break;
            default:
                // AI-related and other messages — no-op in browser for now
                break;
        }
    }

    // --- Connection lifecycle ---

    connect(): void {
        this.unsubscribeWs = onReviewMessage((msg) => {
            switch (msg.type) {
                case 'comment-added':
                case 'comment-updated':
                case 'comment-deleted':
                case 'comment-resolved':
                case 'comments-cleared':
                case 'document-updated':
                    // Re-fetch full state on any change event
                    this.refetchState();
                    break;
                case 'welcome':
                    this.setConnected(true);
                    break;
            }
        });
        connectReviewWebSocket(this.filePath);
    }

    disconnect(): void {
        if (this.unsubscribeWs) { this.unsubscribeWs(); this.unsubscribeWs = null; }
        disconnectReviewWebSocket();
        this.setConnected(false);
        this.messageHandlers = [];
        this.backendHandlers = [];
    }

    // --- Private helpers ---

    private setConnected(connected: boolean): void {
        if (this._isConnected !== connected) {
            this._isConnected = connected;
            for (const l of this.connectionListeners) l(connected);
        }
    }

    private dispatchBackend(msg: BackendToWebviewMessage): void {
        for (const h of this.backendHandlers) h(msg);
    }

    private async refetchState(): Promise<void> {
        try {
            const data = await this.get(`/review/files/${encodeURIComponent(this.filePath)}`);
            this.dispatchBackend({
                type: 'update',
                content: data.content,
                comments: data.comments,
                filePath: this.filePath,
            });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[HttpTransport] Failed to refetch state:', err);
        }
    }

    private async get(urlPath: string): Promise<any> {
        const res = await fetch(`${this.apiBase}${urlPath}`);
        if (!res.ok) throw new Error(`GET ${urlPath} failed: ${res.status}`);
        return res.json();
    }

    private async post(urlPath: string, body: any): Promise<any> {
        const res = await fetch(`${this.apiBase}${urlPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`POST ${urlPath} failed: ${res.status}`);
        return res.json();
    }

    private async patch(urlPath: string, body: any): Promise<any> {
        const res = await fetch(`${this.apiBase}${urlPath}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH ${urlPath} failed: ${res.status}`);
        return res.json();
    }

    private async del(urlPath: string): Promise<any> {
        const res = await fetch(`${this.apiBase}${urlPath}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`DELETE ${urlPath} failed: ${res.status}`);
        // 204 No Content has no body
        if (res.status === 204) return {};
        return res.json();
    }
}

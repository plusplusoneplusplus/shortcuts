/**
 * Review Editor WebSocket Client
 *
 * Client-side WebSocket module for the review editor SPA.
 * Connects to the server WebSocket, subscribes to a specific file path,
 * and dispatches incoming messages to registered handlers.
 *
 * Follows the pattern of the existing process dashboard websocket.ts:
 * - Exponential backoff reconnect
 * - Ping/pong keepalive
 * - Handler registration/unregistration
 *
 * Browser-only — no Node.js or VS Code dependencies.
 */

/** Server message types relevant to the review editor. */
export type ReviewServerMessage =
    | { type: 'comment-added'; filePath: string; comment: any }
    | { type: 'comment-updated'; filePath: string; comment: any }
    | { type: 'comment-deleted'; filePath: string; commentId: string }
    | { type: 'comment-resolved'; filePath: string; commentId: string }
    | { type: 'comments-cleared'; filePath: string; count: number }
    | { type: 'document-updated'; filePath: string; content: string; comments: any[] }
    | { type: 'welcome'; clientId: string; timestamp: number }
    | { type: 'pong' };

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let currentFilePath: string | null = null;

type ReviewWsHandler = (msg: ReviewServerMessage) => void;
const handlers: ReviewWsHandler[] = [];

/**
 * Register a handler for incoming review WebSocket messages.
 * Returns an unsubscribe function.
 */
export function onReviewMessage(handler: ReviewWsHandler): () => void {
    handlers.push(handler);
    return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
    };
}

/**
 * Connect to the WebSocket server and subscribe to a specific file.
 * Reconnects with exponential backoff on disconnection.
 */
export function connectReviewWebSocket(filePath: string): void {
    currentFilePath = filePath;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + '/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        reconnectDelay = 1000;
        // Subscribe to the specific file
        ws!.send(JSON.stringify({ type: 'subscribe-file', filePath }));
        // Start keepalive pings
        pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30_000);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data) as ReviewServerMessage;
            for (const h of handlers) h(msg);
        } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
            if (currentFilePath) {
                connectReviewWebSocket(currentFilePath);
            }
        }, reconnectDelay);
    };

    ws.onerror = () => {};
}

/**
 * Disconnect the review WebSocket and stop reconnecting.
 */
export function disconnectReviewWebSocket(): void {
    currentFilePath = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (ws) { ws.close(); ws = null; }
}

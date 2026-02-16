/**
 * WebSocket Server
 *
 * Uses the `ws` library in noServer mode, attached to an existing HTTP server.
 * Used for live-reload notifications when --watch is enabled.
 *
 * Messages (Server → Client):
 *   { type: "reload", components: string[] }
 *   { type: "rebuilding", components: string[] }
 *   { type: "error", message: string }
 *
 * Messages (Client → Server):
 *   { type: "ping" }
 */

import * as http from 'http';
import * as WS from 'ws';

// ============================================================================
// Types
// ============================================================================

export interface WSClient {
    send: (data: string) => void;
    close: () => void;
}

export interface WSMessage {
    type: string;
    components?: string[];
    message?: string;
}

export type WSMessageHandler = (client: WSClient, message: WSMessage) => void;

// ============================================================================
// WebSocketServer
// ============================================================================

/**
 * Minimal WebSocket server that attaches to an existing HTTP server.
 */
export class WebSocketServer {
    private wss: WS.WebSocketServer;
    private clients: Set<WSClient> = new Set();
    private messageHandler?: WSMessageHandler;

    constructor() {
        this.wss = new WS.WebSocketServer({ noServer: true });
    }

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Attach the WebSocket server to an HTTP server.
     * Handles upgrade requests to /ws.
     */
    attach(server: http.Server): void {
        server.on('upgrade', (req, socket, head) => {
            if (req.url !== '/ws') {
                socket.destroy();
                return;
            }

            this.wss.handleUpgrade(req, socket, head, (wsSocket) => {
                const client: WSClient = {
                    send: (data: string) => {
                        if (wsSocket.readyState === WS.WebSocket.OPEN) {
                            wsSocket.send(data);
                        }
                    },
                    close: () => {
                        wsSocket.close();
                        this.clients.delete(client);
                    },
                };

                this.clients.add(client);

                wsSocket.on('message', (raw) => {
                    try {
                        const parsed = JSON.parse(raw.toString());
                        if (this.messageHandler) {
                            this.messageHandler(client, parsed);
                        }
                    } catch {
                        // Ignore parse errors
                    }
                });

                wsSocket.on('close', () => {
                    this.clients.delete(client);
                });
            });
        });
    }

    /**
     * Register a handler for incoming messages.
     */
    onMessage(handler: WSMessageHandler): void {
        this.messageHandler = handler;
    }

    /**
     * Broadcast a message to all connected clients.
     */
    broadcast(message: WSMessage): void {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            client.send(data);
        }
    }

    /**
     * Close all connections.
     */
    closeAll(): void {
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
    }
}

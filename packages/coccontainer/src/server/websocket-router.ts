/**
 * WebSocket upgrade router.
 *
 * Owns one reusable `noServer` WebSocketServer per registered path so upgrade
 * events don't allocate a fresh server instance each time, and exposes explicit
 * cleanup on shutdown. Unmatched upgrade paths destroy the socket.
 */

import type * as http from 'http';
import type { Duplex } from 'stream';
import { URL } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';

export type WsConnectionHandler = (ws: WebSocket) => void;

export class ContainerWebSocketRouter {
    private readonly servers = new Map<string, WebSocketServer>();
    private readonly handlers = new Map<string, WsConnectionHandler>();

    /** Register a connection handler for an upgrade path (e.g. `/ws`). */
    register(pathname: string, onConnection: WsConnectionHandler): this {
        this.servers.set(pathname, new WebSocketServer({ noServer: true }));
        this.handlers.set(pathname, onConnection);
        return this;
    }

    /** Route a single HTTP upgrade to the matching handler, or destroy the socket. */
    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const wss = this.servers.get(url.pathname);
        const onConnection = this.handlers.get(url.pathname);
        if (wss && onConnection) {
            wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
            return;
        }
        socket.destroy();
    }

    /** Attach this router to an HTTP server's `upgrade` event. */
    attach(server: http.Server): void {
        server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    }

    /** Close all owned WebSocket servers (and their live connections). */
    close(): void {
        for (const wss of this.servers.values()) {
            wss.close();
        }
        this.servers.clear();
        this.handlers.clear();
    }
}

/**
 * Terminal WebSocket Server
 *
 * Dedicated WebSocket server for terminal I/O over `/ws/terminal`.
 * Each connection is scoped to a workspace; clients create, interact with,
 * and close PTY sessions via typed JSON messages.
 *
 * Separated from ProcessWebSocketServer because the terminal uses a
 * per-session bidirectional byte-stream model, whereas the process WS
 * uses a broadcast-oriented subscribe → receive pattern.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { getServerLogger } from '../logging/server-logger';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { TerminalSessionManager, toSessionInfo } from './terminal-session-manager';
import type { TerminalSessionManagerOptions } from './terminal-session-manager';
import type { TerminalClientMessage, TerminalServerMessage } from './types';

// ============================================================================
// Constants
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

interface TerminalWSClient {
    socket: WebSocket;
    id: string;
    workspaceId: string;
    workspaceRootPath: string;
    sessions: Set<string>;
}

// ============================================================================
// TerminalWebSocketServer
// ============================================================================

export class TerminalWebSocketServer {
    private wss: WebSocketServer;
    private clients = new Map<string, TerminalWSClient>();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private readonly sessionManager: TerminalSessionManager;
    private readonly store: ProcessStore;

    constructor(
        store: ProcessStore,
        sessionManagerOptions?: Omit<TerminalSessionManagerOptions, 'onData' | 'onExit'>,
    ) {
        this.wss = new WebSocketServer({ noServer: true });
        this.store = store;
        this.sessionManager = new TerminalSessionManager({
            ...sessionManagerOptions,
            onData: (sessionId, data) => this.onPtyData(sessionId, data),
            onExit: (sessionId, exitCode, signal) => this.onPtyExit(sessionId, exitCode, signal),
        });
    }

    /** Expose session manager for external access (e.g. REST API, tests). */
    getSessionManager(): TerminalSessionManager {
        return this.sessionManager;
    }

    get clientCount(): number {
        return this.clients.size;
    }

    // ========================================================================
    // Upgrade & Close
    // ========================================================================

    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.onConnection(ws, req);
        });
    }

    closeAll(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        for (const [, client] of this.clients) {
            try { client.socket.close(1001, 'Server shutting down'); } catch { /* ignore */ }
        }
        this.clients.clear();
        this.sessionManager.destroyAll();
        try { this.wss.close(); } catch { /* ignore */ }
    }

    // ========================================================================
    // Connection Handler
    // ========================================================================

    private async onConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        const clientId = crypto.randomUUID();
        (ws as any).isAlive = true;

        // Parse workspaceId from query params
        let workspaceId: string;
        try {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            workspaceId = url.searchParams.get('workspaceId') || '';
        } catch {
            workspaceId = '';
        }

        if (!workspaceId) {
            this.sendMessage(ws, { type: 'terminal-error', sessionId: null, message: 'Missing workspaceId parameter' });
            ws.close(4001, 'Missing workspaceId');
            return;
        }

        // Validate workspace exists and get rootPath
        let workspace: WorkspaceInfo | undefined;
        try {
            const workspaces = await this.store.getWorkspaces();
            workspace = workspaces.find((w) => w.id === workspaceId);
            if (!workspace) {
                if (ws.readyState !== WebSocket.OPEN) return;
                this.sendMessage(ws, { type: 'terminal-error', sessionId: null, message: 'Unknown workspace' });
                ws.close(4001, 'Unknown workspace');
                return;
            }
        } catch {
            if (ws.readyState !== WebSocket.OPEN) return;
            this.sendMessage(ws, { type: 'terminal-error', sessionId: null, message: 'Failed to validate workspace' });
            ws.close(4002, 'Failed to validate workspace');
            return;
        }

        // Guard: WS may have closed during async validation
        if (ws.readyState !== WebSocket.OPEN) return;

        const client: TerminalWSClient = {
            socket: ws,
            id: clientId,
            workspaceId,
            workspaceRootPath: workspace.rootPath,
            sessions: new Set(),
        };
        this.clients.set(clientId, client);

        getServerLogger().info({ clientId, workspaceId }, 'Terminal WebSocket connected');

        ws.on('pong', () => { (ws as any).isAlive = true; });

        ws.on('message', (raw: Buffer | string) => {
            const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
            let msg: TerminalClientMessage;
            try { msg = JSON.parse(text); } catch { return; }
            this.handleClientMessage(client, msg);
        });

        ws.on('close', () => {
            this.cleanupClient(client);
        });

        ws.on('error', (err) => {
            getServerLogger().warn({ clientId: client.id, err }, 'Terminal WebSocket error');
            this.cleanupClient(client);
        });

        // Start heartbeat on first connection
        if (!this.heartbeatTimer) {
            this.startHeartbeat();
        }
    }

    // ========================================================================
    // Client Message Handling
    // ========================================================================

    private handleClientMessage(client: TerminalWSClient, msg: TerminalClientMessage): void {
        switch (msg.type) {
            case 'terminal-create': {
                try {
                    const session = this.sessionManager.createSession(
                        client.workspaceId,
                        client.workspaceRootPath,
                        msg.cols ?? 80,
                        msg.rows ?? 24,
                    );
                    client.sessions.add(session.id);
                    this.sendMessage(client.socket, {
                        type: 'terminal-created',
                        session: toSessionInfo(session),
                    });
                } catch (err) {
                    this.sendMessage(client.socket, {
                        type: 'terminal-error',
                        sessionId: null,
                        message: err instanceof Error ? err.message : 'Failed to create terminal session',
                    });
                }
                break;
            }
            case 'terminal-input': {
                try {
                    this.sessionManager.writeToSession(msg.sessionId, msg.data);
                } catch {
                    // Session may have already been destroyed
                }
                break;
            }
            case 'terminal-resize': {
                try {
                    this.sessionManager.resizeSession(msg.sessionId, msg.cols, msg.rows);
                } catch {
                    // Session may have already been destroyed
                }
                break;
            }
            case 'terminal-close': {
                this.sessionManager.destroySession(msg.sessionId);
                client.sessions.delete(msg.sessionId);
                break;
            }
            case 'terminal-pin': {
                const pinned = this.sessionManager.pinSession(msg.sessionId);
                if (pinned) {
                    this.sendMessage(client.socket, {
                        type: 'terminal-pin-changed',
                        sessionId: msg.sessionId,
                        pinned: true,
                    });
                } else {
                    this.sendMessage(client.socket, {
                        type: 'terminal-error',
                        sessionId: msg.sessionId,
                        message: 'Terminal session not found',
                    });
                }
                break;
            }
            case 'terminal-unpin': {
                const unpinned = this.sessionManager.unpinSession(msg.sessionId);
                if (unpinned) {
                    this.sendMessage(client.socket, {
                        type: 'terminal-pin-changed',
                        sessionId: msg.sessionId,
                        pinned: false,
                    });
                } else {
                    this.sendMessage(client.socket, {
                        type: 'terminal-error',
                        sessionId: msg.sessionId,
                        message: 'Terminal session not found',
                    });
                }
                break;
            }
        }
    }

    // ========================================================================
    // PTY Event Handlers
    // ========================================================================

    private onPtyData(sessionId: string, data: string): void {
        const client = this.findClientBySession(sessionId);
        if (client && client.socket.readyState === WebSocket.OPEN) {
            this.sendMessage(client.socket, {
                type: 'terminal-output',
                sessionId,
                data,
            });
        }
    }

    private onPtyExit(sessionId: string, exitCode: number, signal?: number): void {
        const client = this.findClientBySession(sessionId);
        if (client) {
            client.sessions.delete(sessionId);
            if (client.socket.readyState === WebSocket.OPEN) {
                this.sendMessage(client.socket, {
                    type: 'terminal-exit',
                    sessionId,
                    exitCode,
                    signal,
                });
            }
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private findClientBySession(sessionId: string): TerminalWSClient | undefined {
        for (const [, client] of this.clients) {
            if (client.sessions.has(sessionId)) {
                return client;
            }
        }
        return undefined;
    }

    private cleanupClient(client: TerminalWSClient): void {
        for (const sessionId of client.sessions) {
            this.sessionManager.destroySession(sessionId);
        }
        this.clients.delete(client.id);
    }

    private sendMessage(ws: WebSocket, msg: TerminalServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            let prunedCount = 0;
            for (const [, client] of this.clients) {
                const ws = client.socket;
                if (!(ws as any).isAlive) {
                    this.cleanupClient(client);
                    try { ws.terminate(); } catch { /* ignore */ }
                    prunedCount++;
                    continue;
                }
                (ws as any).isAlive = false;
                ws.ping();
            }
            if (prunedCount > 0) {
                getServerLogger().debug({ prunedCount }, 'Terminal heartbeat pruned dead connections');
            }
        }, HEARTBEAT_INTERVAL_MS);

        if (this.heartbeatTimer.unref) {
            this.heartbeatTimer.unref();
        }
    }
}

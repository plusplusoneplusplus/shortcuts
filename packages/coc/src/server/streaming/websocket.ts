/**
 * WebSocket Server for Process Events
 *
 * Uses the `ws` library for WebSocket protocol handling (RFC 6455).
 *
 * Features:
 * - Welcome message on connect
 * - Heartbeat using ws-level ping/pong with dead-connection pruning
 * - Workspace-scoped subscription filtering
 * - Process event broadcasting
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { AIProcess, MarkdownComment } from '@plusplusoneplusplus/forge';
import { getServerLogger } from '../logging/server-logger';

// ============================================================================
// Types
// ============================================================================

export interface WSClient {
    socket: WebSocket;
    id: string;
    send: (data: string) => void;
    close: () => void;
    workspaceId?: string;
    subscribedWikiIds?: Set<string>;
    subscribedFiles?: Set<string>;
    lastSeen: number;
}

/** Lightweight comment projection for WebSocket messages. */
export interface MarkdownCommentSummary {
    id: string;
    filePath: string;
    selection: MarkdownComment['selection'];
    selectedText: string;
    comment: string;
    status: string;
    type?: string;
    author?: string;
    tags?: string[];
    createdAt: string;
    updatedAt: string;
}

/** Lightweight process summary for WebSocket messages. */
export interface ProcessSummary {
    id: string;
    promptPreview: string;
    status: string;
    type?: string;
    startTime: string;
    endTime?: string;
    error?: string;
    workspaceId?: string;
    workspaceName?: string;
    workingDirectory?: string;
    title?: string;
    customTitle?: string;
    lastMessagePreview?: string;
    lastEventAt?: string;
    /**
     * Number of unanswered interactive ask-user questions awaiting the user. Omitted
     * (or 0) when the process is not waiting for input. List/sidebar views use this
     * to surface an "awaiting input" indicator on running tasks.
     */
    pendingAskUserCount?: number;
}

/** Lightweight queue task summary for WebSocket messages. */
export interface QueueTaskSummary {
    id: string;
    type: string;
    priority: string;
    status: string;
    displayName?: string;
    createdAt: number;
    startedAt?: number;
}

/** Queue state snapshot sent via WebSocket. */
export interface QueueSnapshot {
    repoId?: string;
    queued: QueueTaskSummary[];
    running: QueueTaskSummary[];
    stats: {
        queued: number;
        running: number;
        total: number;
        isPaused: boolean;
        isDraining: boolean;
    };
}

/** Server → Client message types */
export type ServerMessage =
    | { type: 'welcome'; clientId: string; timestamp: number }
    | { type: 'pong' }
    | { type: 'process-added'; process: ProcessSummary }
    | { type: 'process-updated'; process: ProcessSummary }
    | { type: 'process-removed'; processId: string }
    | { type: 'processes-cleared'; count: number }
    | { type: 'queue-updated'; queue: QueueSnapshot }
    | { type: 'drain-start'; queued: number; running: number }
    | { type: 'drain-progress'; queued: number; running: number }
    | { type: 'drain-complete'; outcome: 'completed'; queued: number; running: number }
    | { type: 'drain-timeout'; queued: number; running: number; timeoutMs?: number }
    | { type: 'tasks-changed'; workspaceId: string; timestamp: number }
    | { type: 'workflows-changed'; workspaceId: string; timestamp: number }
    | { type: 'templates-changed'; workspaceId: string; timestamp: number }
    | { type: 'notes-changed'; workspaceId: string; changedPaths: string[]; timestamp: number }
    | { type: 'wiki-reload'; wikiId: string; components: string[] }
    | { type: 'wiki-rebuilding'; wikiId: string; components: string[] }
    | { type: 'wiki-error'; wikiId: string; message: string }
    | { type: 'comment-added'; filePath: string; comment: MarkdownCommentSummary }
    | { type: 'comment-updated'; filePath: string; comment: MarkdownCommentSummary }
    | { type: 'comment-deleted'; filePath: string; commentId: string }
    | { type: 'comment-resolved'; filePath: string; commentId: string }
    | { type: 'comments-cleared'; filePath: string; count: number }
    | { type: 'document-updated'; filePath: string; content: string; comments: MarkdownCommentSummary[] }
    | { type: 'data-wiped'; timestamp: number }
    | { type: 'data-imported'; timestamp: number; mode: 'replace' | 'merge' }
    | { type: 'schedule-added'; repoId: string; scheduleId: string; schedule?: unknown }
    | { type: 'schedule-updated'; repoId: string; scheduleId: string; schedule?: unknown }
    | { type: 'schedule-removed'; repoId: string; scheduleId: string }
    | { type: 'schedule-triggered'; repoId: string; scheduleId: string; schedule?: unknown; run?: unknown }
    | { type: 'schedule-run-complete'; repoId: string; scheduleId: string; schedule?: unknown; run?: unknown }
    | { type: 'git-changed'; workspaceId: string; trigger: string; timestamp: number }
    | { type: 'diff-comment-updated'; workspaceId: string; action: 'added' | 'updated' | 'deleted'; storageKey: string; comment?: any; commentId?: string }
    | { type: 'canvas-updated'; workspaceId: string; canvasId: string; processId?: string; title?: string; revision: number; editor: 'ai' | 'user'; timestamp: number }
    | { type: 'work-item-added'; workspaceId: string; item: any }
    | { type: 'work-item-updated'; workspaceId: string; item: any }
    | { type: 'work-item-removed'; workspaceId: string; itemId: string }
    | { type: 'work-item-pr-created'; workspaceId: string; workItemId: string; prUrl: string; prNumber: number; iteration: number }
    | { type: 'turn-deleted'; processId: string; turnIndex: number; deletedAt: string | null }
    | { type: 'turn-pinned'; processId: string; turnIndex: number; pinnedAt: string | null }
    | { type: 'turn-archived'; processId: string; turnIndex: number; archived: boolean }
    | { type: 'ralph-session-complete'; workspaceId: string; sessionId?: string; processId: string; totalIterations: number; reason: 'signal' | 'cap' | string }
    | { type: 'loop-created' | 'loop-updated' | 'loop-paused' | 'loop-resumed' | 'loop-cancelled' | 'loop-expired' | 'loop-tick'; loopId: string; processId: string; status: string; workspaceId?: string; timestamp: number };

/** Client → Server message types */
export type ClientMessage =
    | { type: 'ping' }
    | { type: 'subscribe'; workspaceId: string }
    | { type: 'subscribe-wiki'; wikiId: string }
    | { type: 'subscribe-file'; filePath: string }
    | { type: 'unsubscribe-file'; filePath: string };

// ============================================================================
// ProcessWebSocketServer
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Minimal WebSocket server that attaches to an existing HTTP server
 * and broadcasts process lifecycle events to connected clients.
 */
export class ProcessWebSocketServer {
    private clients: Set<WSClient> = new Set();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private wss: WebSocketServer;
    private gitChangedListeners: Array<(workspaceId: string) => void> = [];
    private broadcastListeners: Array<(data: string) => void> = [];

    constructor() {
        this.wss = new WebSocketServer({ noServer: true });
    }

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Attach the WebSocket server to an HTTP server.
     * Backward-compat shim — registers its own upgrade listener and
     * connection handler.  Production code should prefer calling
     * `attachConnectionHandler()` + `attachWebSocketUpgradeHandler()`.
     */
    attach(server: http.Server): void {
        attachWebSocketUpgradeHandler(server, this);
        this.attachConnectionHandler();
    }

    /**
     * Handle a WebSocket upgrade for this server.
     * Called by the upgrade dispatch function.
     */
    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.wss.emit('connection', ws, req);
        });
    }

    /**
     * Register the `connection` handler on the internal WebSocketServer
     * and start the heartbeat timer.  Does not touch the HTTP server.
     */
    attachConnectionHandler(): void {
        this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
            const clientId = crypto.randomUUID();
            const remoteAddress = req.socket?.remoteAddress;
            (ws as any).isAlive = true;

            const client: WSClient = {
                socket: ws,
                id: clientId,
                lastSeen: Date.now(),
                send: (data: string) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                },
                close: () => {
                    try { ws.close(); } catch { /* ignore */ }
                    this.clients.delete(client);
                },
            };

            this.clients.add(client);
            getServerLogger().info({ clientId, remoteAddress }, 'WebSocket connected');

            // Send welcome message
            client.send(JSON.stringify({
                type: 'welcome',
                clientId,
                timestamp: Date.now(),
            }));

            ws.on('pong', () => { (ws as any).isAlive = true; });

            ws.on('message', (data: Buffer | string) => {
                try {
                    const text = typeof data === 'string' ? data : data.toString('utf-8');
                    const parsed = JSON.parse(text) as ClientMessage;
                    this.handleClientMessage(client, parsed);
                } catch {
                    getServerLogger().debug({ clientId }, 'WebSocket message parse error');
                }
            });

            ws.on('close', (code: number, reason: Buffer) => {
                this.clients.delete(client);
                getServerLogger().debug({ clientId, reason: reason.toString() }, 'WebSocket disconnected');
            });
            ws.on('error', (err: Error) => {
                this.clients.delete(client);
                getServerLogger().warn({ clientId, err }, 'WebSocket error');
            });
        });

        // Start heartbeat check
        this.startHeartbeat();
    }

    /**
     * Broadcast a process event to connected clients, applying workspace filtering.
     */
    broadcastProcessEvent(message: ServerMessage): void {
        const data = JSON.stringify(message);
        const eventWorkspaceId = this.getMessageWorkspaceId(message);

        for (const client of this.clients) {
            // If client has no subscription, it receives everything
            if (!client.workspaceId) {
                client.send(data);
                continue;
            }
            // If event has no workspace, send to all
            if (!eventWorkspaceId) {
                client.send(data);
                continue;
            }
            // Only send if workspace matches
            if (client.workspaceId === eventWorkspaceId) {
                client.send(data);
            }
        }
        // Notify external listeners (e.g. container-link forwarding)
        for (const listener of this.broadcastListeners) {
            try { listener(data); } catch { /* listener errors are non-fatal */ }
        }
    }

    /**
     * Register a listener that is called whenever a `git-changed` event is broadcast.
     * Used by the git-info cache to invalidate stale entries after git mutations.
     */
    onGitChanged(listener: (workspaceId: string) => void): void {
        this.gitChangedListeners.push(listener);
    }

    /**
     * Register a listener that receives the serialized JSON of every broadcast event.
     * Used by the container-link to forward events to a remote container.
     * Returns an unsubscribe function.
     */
    onBroadcast(listener: (data: string) => void): () => void {
        this.broadcastListeners.push(listener);
        return () => {
            const idx = this.broadcastListeners.indexOf(listener);
            if (idx >= 0) this.broadcastListeners.splice(idx, 1);
        };
    }

    /**
     * Broadcast a git-changed event to clients subscribed to the given workspace.
     */
    broadcastGitChanged(workspaceId: string, trigger: string): void {
        const message: ServerMessage = {
            type: 'git-changed',
            workspaceId,
            trigger,
            timestamp: Date.now(),
        };
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (!client.workspaceId || client.workspaceId === workspaceId) {
                client.send(data);
            }
        }
        for (const listener of this.gitChangedListeners) {
            try { listener(workspaceId); } catch { /* listener errors are non-fatal */ }
        }
        for (const listener of this.broadcastListeners) {
            try { listener(data); } catch { /* non-fatal */ }
        }
    }

    /**
     * Broadcast a wiki event to connected clients, applying wiki-scoped filtering.
     * Clients subscribed to specific wikiIds only receive matching events.
     * Clients with no wiki subscriptions receive all wiki events (backward compat).
     */
    broadcastWikiEvent(message: ServerMessage): void {
        const data = JSON.stringify(message);
        const wikiId = 'wikiId' in message ? (message as any).wikiId as string : undefined;

        for (const client of this.clients) {
            if (client.subscribedWikiIds && client.subscribedWikiIds.size > 0) {
                if (wikiId && client.subscribedWikiIds.has(wikiId)) {
                    client.send(data);
                }
                continue;
            }
            // Clients with no wiki subscription get all wiki events
            client.send(data);
        }
        for (const listener of this.broadcastListeners) {
            try { listener(data); } catch { /* non-fatal */ }
        }
    }

    /**
     * Broadcast a file-scoped event to connected clients.
     * Only sends to clients whose `subscribedFiles` includes the given path.
     * Clients with no file subscriptions do NOT receive file events.
     *
     * File paths are normalized via `decodeURIComponent` so that callers
     * may pass either encoded (`folder%2Ffile.md`) or decoded (`folder/file.md`)
     * forms and delivery still works correctly.
     */
    broadcastFileEvent(filePath: string, message: ServerMessage): void {
        const normalizedPath = decodeURIComponent(filePath);
        const data = JSON.stringify({ ...message, filePath: normalizedPath });
        for (const client of this.clients) {
            if (client.subscribedFiles && client.subscribedFiles.has(normalizedPath)) {
                client.send(data);
            }
        }
    }

    /**
     * Close all connections and clear the heartbeat interval.
     */
    closeAll(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
        try { this.wss.close(); } catch { /* ignore double-close */ }
    }

    // ========================================================================
    // Private
    // ========================================================================

    private handleClientMessage(client: WSClient, message: ClientMessage): void {
        client.lastSeen = Date.now();
        switch (message.type) {
            case 'ping':
                client.send(JSON.stringify({ type: 'pong' }));
                break;
            case 'subscribe':
                client.workspaceId = message.workspaceId;
                getServerLogger().debug({ clientId: client.id, channel: `workspace:${message.workspaceId}` }, 'WebSocket subscribed');
                break;
            case 'subscribe-wiki':
                if (!client.subscribedWikiIds) {
                    client.subscribedWikiIds = new Set();
                }
                client.subscribedWikiIds.add(message.wikiId);
                getServerLogger().debug({ clientId: client.id, channel: `wiki:${message.wikiId}` }, 'WebSocket subscribed');
                break;
            case 'subscribe-file': {
                if (!client.subscribedFiles) {
                    client.subscribedFiles = new Set();
                }
                const subPath = decodeURIComponent(message.filePath);
                client.subscribedFiles.add(subPath);
                getServerLogger().debug({ clientId: client.id, channel: `file:${subPath}` }, 'WebSocket subscribed');
                break;
            }
            case 'unsubscribe-file': {
                const unsubPath = decodeURIComponent(message.filePath);
                client.subscribedFiles?.delete(unsubPath);
                break;
            }
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            let prunedCount = 0;
            for (const client of this.clients) {
                const ws = client.socket;
                if (!(ws as any).isAlive) {
                    client.close();
                    ws.terminate();
                    prunedCount++;
                    continue;
                }
                (ws as any).isAlive = false;
                ws.ping();
            }
            if (prunedCount > 0) {
                getServerLogger().debug({ prunedCount }, 'Heartbeat pruned dead connections');
            }
        }, HEARTBEAT_INTERVAL_MS);

        // Don't prevent Node.js from exiting
        if (this.heartbeatTimer.unref) {
            this.heartbeatTimer.unref();
        }
    }

    private getMessageWorkspaceId(message: ServerMessage): string | undefined {
        // Wiki events use their own filtering path (broadcastWikiEvent), not workspace filtering
        if (message.type === 'wiki-reload' || message.type === 'wiki-rebuilding' || message.type === 'wiki-error') {
            return undefined;
        }
        if ('process' in message && message.process) {
            return message.process.workspaceId;
        }
        if (
            message.type === 'tasks-changed' ||
            message.type === 'workflows-changed' ||
            message.type === 'templates-changed' ||
            message.type === 'notes-changed' ||
            message.type === 'git-changed' ||
            message.type === 'diff-comment-updated' ||
            message.type === 'work-item-added' ||
            message.type === 'work-item-updated' ||
            message.type === 'work-item-removed'
        ) {
            return message.workspaceId;
        }
        return undefined;
    }
}

// ============================================================================
// Process Summary Helper
// ============================================================================

/**
 * Convert an AIProcess to a lightweight ProcessSummary for WebSocket messages.
 * Strips large fields (fullPrompt, result, structuredResult) to keep messages small.
 */
export function toProcessSummary(process: AIProcess): ProcessSummary {
    const askUserCount = Array.isArray(process.pendingAskUser) ? process.pendingAskUser.length : 0;
    return {
        id: process.id,
        promptPreview: process.promptPreview,
        status: process.status,
        type: process.type,
        startTime: process.startTime instanceof Date ? process.startTime.toISOString() : String(process.startTime),
        endTime: process.endTime instanceof Date ? process.endTime.toISOString() : (process.endTime ? String(process.endTime) : undefined),
        error: process.error,
        workspaceId: process.metadata?.workspaceId,
        workspaceName: process.metadata?.workspaceName,
        workingDirectory: process.workingDirectory,
        title: process.title,
        customTitle: process.customTitle,
        lastMessagePreview: process.lastMessagePreview,
        lastEventAt: process.lastEventAt instanceof Date ? process.lastEventAt.toISOString() : (process.lastEventAt ? String(process.lastEventAt) : undefined),
        pendingAskUserCount: askUserCount > 0 ? askUserCount : 0,
    };
}

/**
 * Convert a MarkdownComment to a lightweight MarkdownCommentSummary for WebSocket messages.
 */
export function toCommentSummary(comment: MarkdownComment): MarkdownCommentSummary {
    return {
        id: comment.id,
        filePath: comment.filePath,
        selection: comment.selection,
        selectedText: comment.selectedText,
        comment: comment.comment,
        status: comment.status,
        type: comment.type,
        author: comment.author,
        tags: comment.tags,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
    };
}

// ============================================================================
// Upgrade Dispatch
// ============================================================================

/**
 * Standalone upgrade dispatcher that routes incoming WebSocket upgrades
 * to the correct server based on the request URL pathname.
 *
 * - `/ws`          → processWs (ProcessWebSocketServer)
 * - `/ws/terminal` → terminalWs (TerminalWebSocketServer), if provided
 * - anything else  → socket.destroy()
 */
export function attachWebSocketUpgradeHandler(
    server: http.Server,
    processWs: ProcessWebSocketServer,
    terminalWs?: { handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void },
): void {
    server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        if (url.pathname === '/ws') {
            processWs.handleUpgrade(req, socket, head);
        } else if (url.pathname === '/ws/terminal' && terminalWs) {
            terminalWs.handleUpgrade(req, socket, head);
        } else {
            socket.destroy();
        }
    });
}

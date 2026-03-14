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
import { WebSocketServer, WebSocket } from 'ws';
import type { AIProcess, MarkdownComment } from '@plusplusoneplusplus/pipeline-core';
import { getServerLogger } from './server-logger';

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
    title?: string;
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

/** History task summary for WebSocket messages. */
export interface QueueHistoryTaskSummary {
    id: string;
    type: string;
    priority: string;
    status: string;
    displayName?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
}

/** Queue state snapshot sent via WebSocket. */
export interface QueueSnapshot {
    repoId?: string;
    queued: QueueTaskSummary[];
    running: QueueTaskSummary[];
    history?: QueueHistoryTaskSummary[];
    stats: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
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
    | { type: 'diff-comment-updated'; workspaceId: string; action: 'added' | 'updated' | 'deleted'; storageKey: string; comment?: any; commentId?: string };

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

    constructor() {
        this.wss = new WebSocketServer({ noServer: true });
    }

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Attach the WebSocket server to an HTTP server.
     * Handles upgrade requests to /ws.
     */
    attach(server: http.Server): void {
        server.on('upgrade', (req: http.IncomingMessage, socket, head: Buffer) => {
            if (req.url !== '/ws') {
                socket.destroy();
                return;
            }
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit('connection', ws, req);
            });
        });

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
    }

    /**
     * Broadcast a file-scoped event to connected clients.
     * Only sends to clients whose `subscribedFiles` includes the given path.
     * Clients with no file subscriptions do NOT receive file events.
     */
    broadcastFileEvent(filePath: string, message: ServerMessage): void {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.subscribedFiles && client.subscribedFiles.has(filePath)) {
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
            case 'subscribe-file':
                if (!client.subscribedFiles) {
                    client.subscribedFiles = new Set();
                }
                client.subscribedFiles.add(message.filePath);
                getServerLogger().debug({ clientId: client.id, channel: `file:${message.filePath}` }, 'WebSocket subscribed');
                break;
            case 'unsubscribe-file':
                client.subscribedFiles?.delete(message.filePath);
                break;
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
            return (message.process as ProcessSummary).workspaceId;
        }
        if (
            message.type === 'tasks-changed' ||
            message.type === 'workflows-changed' ||
            message.type === 'templates-changed' ||
            message.type === 'git-changed' ||
            message.type === 'diff-comment-updated'
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
    return {
        id: process.id,
        promptPreview: process.promptPreview,
        status: process.status,
        type: process.type,
        startTime: process.startTime instanceof Date ? process.startTime.toISOString() : String(process.startTime),
        endTime: process.endTime instanceof Date ? process.endTime.toISOString() : (process.endTime ? String(process.endTime) : undefined),
        error: process.error,
        workspaceId: process.metadata?.workspaceId,
        title: process.title,
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



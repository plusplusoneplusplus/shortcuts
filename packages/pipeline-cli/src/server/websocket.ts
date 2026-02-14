/**
 * WebSocket Server for Process Events
 *
 * Raw WebSocket implementation using Node.js http upgrade event.
 * No external dependencies — implements the WebSocket handshake
 * and frame protocol directly (RFC 6455).
 *
 * Follows the deep-wiki WebSocket pattern with extensions for:
 * - Welcome message on connect
 * - Heartbeat (ping/pong) with dead-connection pruning
 * - Workspace-scoped subscription filtering
 * - Process event broadcasting
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Socket } from 'net';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

export interface WSClient {
    socket: Socket;
    id: string;
    send: (data: string) => void;
    close: () => void;
    workspaceId?: string;
    lastSeen: number;
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
    queued: QueueTaskSummary[];
    running: QueueTaskSummary[];
    stats: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        total: number;
        isPaused: boolean;
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
    | { type: 'queue-updated'; queue: QueueSnapshot };

/** Client → Server message types */
export type ClientMessage =
    | { type: 'ping' }
    | { type: 'subscribe'; workspaceId: string };

// ============================================================================
// ProcessWebSocketServer
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * Minimal WebSocket server that attaches to an existing HTTP server
 * and broadcasts process lifecycle events to connected clients.
 */
export class ProcessWebSocketServer {
    private clients: Set<WSClient> = new Set();
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Attach the WebSocket server to an HTTP server.
     * Handles upgrade requests to /ws.
     */
    attach(server: http.Server): void {
        server.on('upgrade', (req: http.IncomingMessage, socket: Socket, _head: Buffer) => {
            if (req.url !== '/ws') {
                socket.destroy();
                return;
            }

            const key = req.headers['sec-websocket-key'];
            if (!key) {
                socket.destroy();
                return;
            }

            // Perform WebSocket handshake
            const acceptKey = crypto
                .createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11E65B')
                .digest('base64');

            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
                '\r\n',
            );

            const clientId = crypto.randomUUID();
            const client: WSClient = {
                socket,
                id: clientId,
                lastSeen: Date.now(),
                send: (data: string) => {
                    try {
                        sendFrame(socket, data);
                    } catch {
                        // Ignore send errors on closed sockets
                    }
                },
                close: () => {
                    try {
                        socket.end();
                    } catch {
                        // Ignore
                    }
                    this.clients.delete(client);
                },
            };

            this.clients.add(client);

            // Send welcome message
            client.send(JSON.stringify({
                type: 'welcome',
                clientId,
                timestamp: Date.now(),
            }));

            // Handle incoming messages
            socket.on('data', (buf: Buffer) => {
                try {
                    const message = decodeFrame(buf);
                    if (message !== null) {
                        const parsed = JSON.parse(message) as ClientMessage;
                        this.handleClientMessage(client, parsed);
                    }
                } catch {
                    // Ignore parse errors
                }
            });

            const removeClient = () => {
                this.clients.delete(client);
            };

            socket.on('close', removeClient);
            socket.on('end', removeClient);
            socket.on('error', removeClient);
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
    }

    // ========================================================================
    // Private
    // ========================================================================

    private handleClientMessage(client: WSClient, message: ClientMessage): void {
        switch (message.type) {
            case 'ping':
                client.lastSeen = Date.now();
                client.send(JSON.stringify({ type: 'pong' }));
                break;
            case 'subscribe':
                client.lastSeen = Date.now();
                client.workspaceId = message.workspaceId;
                break;
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            for (const client of this.clients) {
                if (now - client.lastSeen > HEARTBEAT_TIMEOUT_MS) {
                    client.close();
                }
            }
        }, HEARTBEAT_INTERVAL_MS);

        // Don't prevent Node.js from exiting
        if (this.heartbeatTimer.unref) {
            this.heartbeatTimer.unref();
        }
    }

    private getMessageWorkspaceId(message: ServerMessage): string | undefined {
        if ('process' in message && message.process) {
            return (message.process as ProcessSummary).workspaceId;
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
    };
}

// ============================================================================
// WebSocket Frame Encoding/Decoding (exported for testing)
// ============================================================================

/**
 * Send a text frame over the socket.
 */
export function sendFrame(socket: Socket, data: string): void {
    const payload = Buffer.from(data, 'utf-8');
    const length = payload.length;

    let header: Buffer;

    if (length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = length;
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(length, 6);
    }

    socket.write(Buffer.concat([header, payload]));
}

/**
 * Decode a WebSocket text frame.
 * Returns the decoded text or null if the frame is a close/binary/etc.
 */
export function decodeFrame(buf: Buffer): string | null {
    if (buf.length < 2) return null;

    const opcode = buf[0] & 0x0f;

    // Only handle text frames (opcode 1)
    if (opcode !== 1) return null;

    const masked = (buf[1] & 0x80) !== 0;
    let payloadLength = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
        if (buf.length < 4) return null;
        payloadLength = buf.readUInt16BE(2);
        offset = 4;
    } else if (payloadLength === 127) {
        if (buf.length < 10) return null;
        payloadLength = buf.readUInt32BE(6);
        offset = 10;
    }

    if (masked) {
        if (buf.length < offset + 4 + payloadLength) return null;
        const maskKey = buf.slice(offset, offset + 4);
        offset += 4;
        const payload = buf.slice(offset, offset + payloadLength);
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskKey[i % 4];
        }
        return payload.toString('utf-8');
    }

    if (buf.length < offset + payloadLength) return null;
    return buf.slice(offset, offset + payloadLength).toString('utf-8');
}

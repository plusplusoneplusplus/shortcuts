/**
 * WebSocket Server
 *
 * Raw WebSocket implementation using Node.js http upgrade event.
 * No external dependencies — implements the WebSocket handshake
 * and frame protocol directly (~80 lines).
 *
 * Used for live-reload notifications when --watch is enabled.
 *
 * Messages (Server → Client):
 *   { type: "reload", modules: string[] }
 *   { type: "rebuilding", modules: string[] }
 *   { type: "error", message: string }
 *
 * Messages (Client → Server):
 *   { type: "ping" }
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Socket } from 'net';

// ============================================================================
// Types
// ============================================================================

export interface WSClient {
    socket: Socket;
    send: (data: string) => void;
    close: () => void;
}

export interface WSMessage {
    type: string;
    modules?: string[];
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
    private clients: Set<WSClient> = new Set();
    private messageHandler?: WSMessageHandler;

    get clientCount(): number {
        return this.clients.size;
    }

    /**
     * Attach the WebSocket server to an HTTP server.
     * Handles upgrade requests to /ws.
     */
    attach(server: http.Server): void {
        server.on('upgrade', (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
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

            const client: WSClient = {
                socket,
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

            socket.on('data', (buf: Buffer) => {
                try {
                    const message = decodeFrame(buf);
                    if (message !== null && this.messageHandler) {
                        const parsed = JSON.parse(message);
                        this.messageHandler(client, parsed);
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

// ============================================================================
// WebSocket Frame Encoding/Decoding
// ============================================================================

/**
 * Send a text frame over the socket.
 */
function sendFrame(socket: Socket, data: string): void {
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
        // Write as two 32-bit values for compatibility
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(length, 6);
    }

    socket.write(Buffer.concat([header, payload]));
}

/**
 * Decode a WebSocket text frame.
 * Returns the decoded text or null if the frame is a close/binary/etc.
 */
function decodeFrame(buf: Buffer): string | null {
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
        // Read lower 32 bits only (enough for our messages)
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

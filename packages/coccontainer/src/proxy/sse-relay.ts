/**
 * SSE relay — connects to agent SSE streams and multiplexes to container clients.
 */

import { parseSseBuffer } from '@plusplusoneplusplus/forge/sse';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { EventEmitter } from 'events';

export interface SSEEvent {
    agentId: string;
    agentName: string;
    event?: string;
    data: string;
    id?: string;
}

/**
 * Manages SSE connections to multiple agents and emits unified events.
 */
export class SSERelay extends EventEmitter {
    private connections = new Map<string, http.IncomingMessage>();

    connect(agentId: string, agentName: string, agentAddress: string, path: string = '/api/events'): void {
        if (this.connections.has(agentId)) {
            this.disconnect(agentId);
        }

        let normalizedAddr = agentAddress;
        if (!/^(https?|wss?):\/\//i.test(normalizedAddr)) {
            normalizedAddr = `http://${normalizedAddr}`;
        }
        const url = new URL(path, normalizedAddr);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const req = transport.get(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                headers: { Accept: 'text/event-stream' },
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return;
                }

                this.connections.set(agentId, res);

                let buffer = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => {
                    const { frames, rest } = parseSseBuffer(buffer + chunk);
                    buffer = rest;

                    for (const frame of frames) {
                        const event: SSEEvent = { agentId, agentName, ...frame };
                        // Log relay dispatch with event type
                        try {
                            const parsed = JSON.parse(event.data);
                            const type = parsed.type || event.event || 'unknown';
                            const processId = parsed.process?.id || '';
                            const status = parsed.process?.status || '';
                            console.log(`[sse-relay] 📨 Received from ${agentName}: type=${type} process=${processId} status=${status} → dispatching to ${this.listenerCount('event')} subscriber(s)`);
                        } catch {
                            console.log(`[sse-relay] 📨 Received event from ${agentName} → dispatching to ${this.listenerCount('event')} subscriber(s)`);
                        }
                        this.emit('event', event);
                    }
                });

                res.on('end', () => {
                    this.connections.delete(agentId);
                    this.emit('disconnected', agentId);
                });
            }
        );

        req.on('error', () => {
            this.connections.delete(agentId);
            this.emit('connection-error', agentId);
        });
    }

    disconnect(agentId: string): void {
        const conn = this.connections.get(agentId);
        if (conn) {
            conn.destroy();
            this.connections.delete(agentId);
        }
    }

    disconnectAll(): void {
        for (const [id] of this.connections) {
            this.disconnect(id);
        }
    }
}

/**
 * SSE relay — connects to agent SSE streams and multiplexes to container clients.
 */

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

    /**
     * Start listening to an agent's SSE stream.
     */
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
                res.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const events = this.parseSSE(buffer, agentId, agentName);
                    // Keep remainder after last double newline
                    const lastIdx = buffer.lastIndexOf('\n\n');
                    buffer = lastIdx >= 0 ? buffer.slice(lastIdx + 2) : buffer;

                    for (const event of events) {
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

    /**
     * Disconnect from an agent's SSE stream.
     */
    disconnect(agentId: string): void {
        const conn = this.connections.get(agentId);
        if (conn) {
            conn.destroy();
            this.connections.delete(agentId);
        }
    }

    /**
     * Disconnect all agents.
     */
    disconnectAll(): void {
        for (const [id] of this.connections) {
            this.disconnect(id);
        }
    }

    private parseSSE(buffer: string, agentId: string, agentName: string): SSEEvent[] {
        const events: SSEEvent[] = [];
        const blocks = buffer.split('\n\n');
        // Last block may be incomplete, skip it
        for (let i = 0; i < blocks.length - 1; i++) {
            const block = blocks[i].trim();
            if (!block) continue;

            let event: string | undefined;
            let data = '';
            let id: string | undefined;

            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
                else if (line.startsWith('id:')) id = line.slice(3).trim();
            }

            if (data) {
                events.push({ agentId, agentName, event, data, id });
            }
        }
        return events;
    }
}

/**
 * WebSocket relay — maintains WS connections to agents, relays to container clients.
 */

import * as WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface WSRelayMessage {
    agentId: string;
    agentName: string;
    data: string;
}

/**
 * Manages WebSocket connections to multiple CoC agents.
 */
export class WebSocketRelay extends EventEmitter {
    private connections = new Map<string, WebSocket.WebSocket>();

    /**
     * Connect to an agent's WebSocket endpoint.
     */
    connect(agentId: string, agentName: string, agentAddress: string, wsPath: string = '/ws'): void {
        if (this.connections.has(agentId)) {
            this.disconnect(agentId);
        }

        const wsUrl = agentAddress.replace(/^http/, 'ws') + wsPath;
        const ws = new WebSocket.WebSocket(wsUrl);

        ws.on('open', () => {
            this.connections.set(agentId, ws);
            this.emit('connected', agentId);
        });

        ws.on('message', (data: WebSocket.RawData) => {
            const message: WSRelayMessage = {
                agentId,
                agentName,
                data: data.toString(),
            };
            this.emit('message', message);
        });

        ws.on('close', () => {
            this.connections.delete(agentId);
            this.emit('disconnected', agentId);
        });

        ws.on('error', () => {
            this.connections.delete(agentId);
            this.emit('error', agentId);
        });
    }

    /**
     * Send a message to a specific agent's WebSocket.
     */
    send(agentId: string, data: string): boolean {
        const ws = this.connections.get(agentId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            return true;
        }
        return false;
    }

    /**
     * Disconnect from an agent.
     */
    disconnect(agentId: string): void {
        const ws = this.connections.get(agentId);
        if (ws) {
            ws.close();
            this.connections.delete(agentId);
        }
    }

    /**
     * Disconnect all.
     */
    disconnectAll(): void {
        for (const [id] of this.connections) {
            this.disconnect(id);
        }
    }
}

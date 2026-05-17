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
    private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private agentMeta = new Map<string, { name: string; address: string; wsPath: string }>();

    /**
     * Connect to an agent's WebSocket endpoint.
     */
    connect(agentId: string, agentName: string, agentAddress: string, wsPath: string = '/ws'): void {
        if (this.connections.has(agentId)) {
            this.disconnect(agentId);
        }

        this.agentMeta.set(agentId, { name: agentName, address: agentAddress, wsPath });
        const wsUrl = agentAddress.replace(/^http/, 'ws') + wsPath;
        const ws = new WebSocket.WebSocket(wsUrl);

        ws.on('open', () => {
            this.connections.set(agentId, ws);
            console.log(`[ws-relay] Connected to agent ${agentName} (${agentId}) at ${wsUrl}`);
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
            console.log(`[ws-relay] Disconnected from agent ${agentName} (${agentId}), reconnecting in 5s`);
            this.emit('disconnected', agentId);
            this.scheduleReconnect(agentId);
        });

        ws.on('error', (err) => {
            this.connections.delete(agentId);
            console.error(`[ws-relay] Error for agent ${agentName} (${agentId}):`, err.message);
            this.scheduleReconnect(agentId);
        });
    }

    private scheduleReconnect(agentId: string): void {
        if (this.reconnectTimers.has(agentId)) return;
        const meta = this.agentMeta.get(agentId);
        if (!meta) return;
        this.reconnectTimers.set(agentId, setTimeout(() => {
            this.reconnectTimers.delete(agentId);
            if (!this.connections.has(agentId)) {
                console.log(`[ws-relay] Reconnecting to agent ${meta.name} (${agentId})`);
                this.connect(agentId, meta.name, meta.address, meta.wsPath);
            }
        }, 5000));
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
        const timer = this.reconnectTimers.get(agentId);
        if (timer) { clearTimeout(timer); this.reconnectTimers.delete(agentId); }
        this.agentMeta.delete(agentId);
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

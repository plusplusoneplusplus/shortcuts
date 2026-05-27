/**
 * Agent Connection Manager
 *
 * Manages outbound WebSocket connections to directly-addressed CoC agents
 * (non-call-home agents). Receives events from agents and publishes them
 * to the WSRelay event bus.
 *
 * Call-home agents are managed by InboundAgentManager, not this class.
 */

import * as WebSocket from 'ws';
import type { WebSocketRelay } from './ws-relay';

export class AgentConnectionManager {
    private connections = new Map<string, WebSocket.WebSocket>();
    private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private agentMeta = new Map<string, { name: string; address: string; wsPath: string }>();

    constructor(private readonly wsRelay: WebSocketRelay) {}

    /** Connect to an agent's WebSocket endpoint and relay events to WSRelay. */
    connect(agentId: string, agentName: string, agentAddress: string, wsPath: string = '/ws'): void {
        if (this.connections.has(agentId)) {
            this.disconnect(agentId);
        }

        this.agentMeta.set(agentId, { name: agentName, address: agentAddress, wsPath });
        let normalizedAddr = agentAddress;
        if (!/^(wss?|https?):\/\//i.test(normalizedAddr)) {
            normalizedAddr = `ws://${normalizedAddr}`;
        }
        const wsUrl = normalizedAddr.replace(/^http/i, 'ws') + wsPath;
        const ws = new WebSocket.WebSocket(wsUrl);

        ws.on('open', () => {
            this.connections.set(agentId, ws);
            console.log(`[agent-conn] Connected to agent ${agentName} (${agentId}) at ${wsUrl}`);
        });

        ws.on('message', (data: WebSocket.RawData) => {
            const message = { agentId, agentName, data: data.toString() };
            this.wsRelay.emit('message', message);
        });

        ws.on('close', () => {
            this.connections.delete(agentId);
            console.log(`[agent-conn] Disconnected from agent ${agentName} (${agentId}), reconnecting in 5s`);
            this.scheduleReconnect(agentId);
        });

        ws.on('error', (err) => {
            this.connections.delete(agentId);
            console.error(`[agent-conn] Error for agent ${agentName} (${agentId}):`, err.message);
            this.scheduleReconnect(agentId);
        });
    }

    /** Send a WS message to a specific agent. */
    send(agentId: string, data: string): boolean {
        const ws = this.connections.get(agentId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            return true;
        }
        return false;
    }

    /** Disconnect from an agent. */
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

    /** Disconnect all agents. */
    disconnectAll(): void {
        for (const [id] of this.connections) {
            this.disconnect(id);
        }
    }

    private scheduleReconnect(agentId: string): void {
        if (this.reconnectTimers.has(agentId)) return;
        const meta = this.agentMeta.get(agentId);
        if (!meta) return;
        this.reconnectTimers.set(agentId, setTimeout(() => {
            this.reconnectTimers.delete(agentId);
            if (!this.connections.has(agentId)) {
                console.log(`[agent-conn] Reconnecting to agent ${meta.name} (${agentId})`);
                this.connect(agentId, meta.name, meta.address, meta.wsPath);
            }
        }, 5000));
    }
}

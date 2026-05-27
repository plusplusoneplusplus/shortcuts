/**
 * WebSocket Relay — central bidirectional event bus.
 *
 * Outbound (agent → bridges):
 *   AgentManager emits events → WSRelay → subscribers (WebClientBridge, TeamsBridge)
 *
 * Inbound (bridges → agent):
 *   Bridges call wsRelay.sendToAgent() → AgentManager.proxyRequest()
 *
 * WSRelay does NOT manage any agent connections — that is AgentManager's job.
 */

import { EventEmitter } from 'events';
import type { AgentManager } from '../inbound/agent-manager';

export interface WSRelayMessage {
    agentId: string;
    agentName: string;
    data: string;
}

/**
 * Central bidirectional event bus for the container.
 */
export class WebSocketRelay extends EventEmitter {
    private _agentManager: AgentManager | null = null;

    /** Set the AgentManager reference (called once at startup). */
    setAgentManager(agentManager: AgentManager): void {
        this._agentManager = agentManager;
    }

    /**
     * Send an HTTP request to an agent via AgentManager.
     * This is the inbound path: bridge → WSRelay → AgentManager → Agent.
     */
    async proxyToAgent(
        agentId: string,
        method: string,
        path: string,
        headers?: Record<string, string>,
        body?: string,
    ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
        if (!this._agentManager) {
            throw new Error('AgentManager not set on WSRelay');
        }
        return this._agentManager.proxyRequest(agentId, method, path, headers ?? {}, body);
    }

    /**
     * Send a raw WS message to an outbound-connected agent via AgentManager.
     */
    sendToAgent(agentId: string, data: string): boolean {
        if (!this._agentManager) return false;
        return this._agentManager.sendOutbound(agentId, data);
    }
}

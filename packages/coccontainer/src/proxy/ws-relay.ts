/**
 * WebSocket Relay — pure event bus for agent events.
 *
 * Subscribers (WebClientBridge, TeamsBridge, etc.) listen for 'message' events.
 * Publishers (InboundAgentManager, AgentConnectionManager) emit events into the bus.
 *
 * WSRelay does NOT manage any agent connections — that is the responsibility of
 * InboundAgentManager (call-home) and AgentConnectionManager (outbound).
 */

import { EventEmitter } from 'events';

export interface WSRelayMessage {
    agentId: string;
    agentName: string;
    data: string;
}

/**
 * Pure event bus for broadcasting agent events to all subscribers.
 */
export class WebSocketRelay extends EventEmitter {
}

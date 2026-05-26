/**
 * Inbound Agent Manager
 *
 * Manages WebSocket connections from agents that connect to the container
 * via the call-home pattern. Handles registration, heartbeats, event
 * forwarding, and request proxying.
 */

import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
    createMessage,
    parseMessage,
    type ChannelMessage,
    type RegisterPayload,
    type HeartbeatPayload,
    type EventPayload,
    type ResponsePayload,
    type RegisteredPayload,
    type RequestPayload,
    type SubscribeSSEPayload,
    type UnsubscribeSSEPayload,
    type SSEEventPayload,
} from './protocol';

export interface InboundAgent {
    /** Assigned agent ID. */
    id: string;
    /** Agent display name. */
    name: string;
    /** The WebSocket connection. */
    ws: WebSocket.WebSocket;
    /** Last heartbeat timestamp. */
    lastHeartbeat: number;
    /** Workspaces reported by the agent. */
    workspaces: Array<{ id: string; name: string; rootPath: string }>;
}

export interface PendingRequest {
    resolve: (response: ResponsePayload) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages inbound agent connections.
 * Emits:
 *  - 'agent-connected' (agent: InboundAgent)
 *  - 'agent-disconnected' (agentId: string, agentName: string)
 *  - 'agent-event' (agentId: string, agentName: string, data: string)
 *  - 'agent-sse-event' (agentId: string, subscriptionId: string, event: string|undefined, data: string, id: string|undefined)
 */
export class InboundAgentManager extends EventEmitter {
    private agents = new Map<string, InboundAgent>();
    private pendingRequests = new Map<string, PendingRequest>();
    private requestTimeoutMs: number;

    constructor(options?: { requestTimeoutMs?: number }) {
        super();
        this.requestTimeoutMs = options?.requestTimeoutMs ?? 30_000;
    }

    /**
     * Handle a new WebSocket connection from an agent.
     */
    handleConnection(ws: WebSocket.WebSocket): void {
        let agentId: string | null = null;

        ws.on('message', (raw: WebSocket.RawData) => {
            const msg = parseMessage(raw.toString());
            if (!msg) return;

            switch (msg.type) {
                case 'register': {
                    const payload = msg.payload as RegisterPayload;
                    agentId = this.registerAgent(ws, payload);
                    break;
                }
                case 'heartbeat': {
                    if (agentId) {
                        const agent = this.agents.get(agentId);
                        if (agent) {
                            agent.lastHeartbeat = (msg.payload as HeartbeatPayload).timestamp;
                        }
                    }
                    break;
                }
                case 'event': {
                    if (agentId) {
                        const agent = this.agents.get(agentId);
                        if (agent) {
                            const payload = msg.payload as EventPayload;
                            this.emit('agent-event', agentId, agent.name, payload.data);
                        }
                    }
                    break;
                }
                case 'response': {
                    const payload = msg.payload as ResponsePayload;
                    this.handleResponse(payload);
                    break;
                }
                case 'sse-event': {
                    if (agentId) {
                        const payload = msg.payload as SSEEventPayload;
                        this.emit('agent-sse-event', agentId, payload.subscriptionId, payload.event, payload.data, payload.id);
                    }
                    break;
                }
            }
        });

        ws.on('close', () => {
            if (agentId) {
                const agent = this.agents.get(agentId);
                const name = agent?.name ?? 'unknown';
                this.agents.delete(agentId);
                this.emit('agent-disconnected', agentId, name);
            }
        });

        ws.on('error', () => {
            // Error is followed by close; handled there
        });
    }

    /**
     * Get an inbound agent by ID.
     */
    getAgent(agentId: string): InboundAgent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Check if an agent is connected via inbound channel.
     */
    hasAgent(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    /**
     * List all connected inbound agents.
     */
    listAgents(): InboundAgent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Send a proxied HTTP request to an agent and wait for the response.
     */
    async proxyRequest(agentId: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<ResponsePayload> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not connected via inbound channel`);
        }

        const requestId = randomUUID();
        const payload: RequestPayload = { requestId, method, path, headers, body };
        const msg = createMessage('request', payload);

        return new Promise<ResponsePayload>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Request to agent ${agentId} timed out after ${this.requestTimeoutMs}ms`));
            }, this.requestTimeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });
            agent.ws.send(JSON.stringify(msg));
        });
    }

    /**
     * Subscribe to SSE events from an agent.
     */
    subscribeSSE(agentId: string, subscriptionId: string, path: string): boolean {
        const agent = this.agents.get(agentId);
        if (!agent) return false;

        const payload: SubscribeSSEPayload = { subscriptionId, path };
        const msg = createMessage('subscribe-sse', payload);
        agent.ws.send(JSON.stringify(msg));
        return true;
    }

    /**
     * Unsubscribe from SSE events.
     */
    unsubscribeSSE(agentId: string, subscriptionId: string): void {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        const payload: UnsubscribeSSEPayload = { subscriptionId };
        const msg = createMessage('unsubscribe-sse', payload);
        agent.ws.send(JSON.stringify(msg));
    }

    /**
     * Close all connections and clean up.
     */
    close(): void {
        for (const [, agent] of this.agents) {
            agent.ws.close();
        }
        this.agents.clear();
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Manager closed'));
        }
        this.pendingRequests.clear();
    }

    // ========================================================================
    // Private
    // ========================================================================

    private registerAgent(ws: WebSocket.WebSocket, payload: RegisterPayload): string {
        const agentId = payload.agentId ?? randomUUID();
        const existing = this.agents.get(agentId);
        const reconnected = !!existing;

        if (reconnected && existing!.ws !== ws) {
            // Different WebSocket — true reconnection; close old connection
            existing!.ws.removeAllListeners();
            existing!.ws.close();
        }

        const agent: InboundAgent = {
            id: agentId,
            name: payload.name,
            ws,
            lastHeartbeat: Date.now(),
            workspaces: payload.workspaces ?? existing?.workspaces ?? [],
        };

        this.agents.set(agentId, agent);

        // Send registration confirmation
        const confirmedPayload: RegisteredPayload = { agentId, reconnected };
        ws.send(JSON.stringify(createMessage('registered', confirmedPayload)));

        // Only emit agent-connected on first registration or true reconnection (different ws)
        if (!existing || existing.ws !== ws) {
            this.emit('agent-connected', agent);
        }
        return agentId;
    }

    private handleResponse(payload: ResponsePayload): void {
        const pending = this.pendingRequests.get(payload.requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(payload.requestId);
            pending.resolve(payload);
        }
    }
}

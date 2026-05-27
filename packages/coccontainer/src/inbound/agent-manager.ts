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

/** Cached metadata for agents that disconnected (preserved across reconnections). */
export interface DisconnectedAgent {
    id: string;
    name: string;
    workspaces: Array<{ id: string; name: string; rootPath: string }>;
    disconnectedAt: number;
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
export class AgentManager extends EventEmitter {
    private agents = new Map<string, InboundAgent>();
    private disconnectedAgents = new Map<string, DisconnectedAgent>();
    private pendingRequests = new Map<string, PendingRequest>();
    private requestTimeoutMs: number;
    private heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;
    private staleThresholdMs: number;

    constructor(options?: { requestTimeoutMs?: number; staleThresholdMs?: number }) {
        super();
        this.requestTimeoutMs = options?.requestTimeoutMs ?? 30_000;
        this.staleThresholdMs = options?.staleThresholdMs ?? 90_000; // 3 missed heartbeats
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
                            console.log(`[AgentManager] Received event from ${agent.name} (${agentId}): ${(payload.data ?? '').substring(0, 120)}`);
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
                // Preserve metadata for offline lookups
                if (agent) {
                    this.disconnectedAgents.set(agentId, {
                        id: agent.id,
                        name: agent.name,
                        workspaces: agent.workspaces,
                        disconnectedAt: Date.now(),
                    });
                }
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
     * Get cached metadata for a disconnected agent.
     */
    getDisconnectedAgent(agentId: string): DisconnectedAgent | undefined {
        return this.disconnectedAgents.get(agentId);
    }

    /**
     * Start periodic heartbeat staleness checks.
     * Terminates agents that haven't sent a heartbeat within staleThresholdMs.
     */
    startHeartbeatCheck(intervalMs: number = 30_000): void {
        this.stopHeartbeatCheck();
        this.heartbeatCheckTimer = setInterval(() => this.checkStaleAgents(), intervalMs);
    }

    /**
     * Stop periodic heartbeat staleness checks.
     */
    stopHeartbeatCheck(): void {
        if (this.heartbeatCheckTimer) {
            clearInterval(this.heartbeatCheckTimer);
            this.heartbeatCheckTimer = null;
        }
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

        process.stderr.write(`[agent-mgr] Sending request to agent "${agent.name}" (${agentId}): ${method} ${path}\n`);

        return new Promise<ResponsePayload>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                process.stderr.write(`[agent-mgr] Request TIMEOUT: ${method} ${path} (agent=${agentId})\n`);
                reject(new Error(`Request to agent ${agentId} timed out after ${this.requestTimeoutMs}ms`));
            }, this.requestTimeoutMs);

            this.pendingRequests.set(requestId, {
                resolve: (resp) => {
                    process.stderr.write(`[agent-mgr] Got response from agent "${agent.name}": ${method} ${path} → ${resp.status} (bodyLen=${resp.body?.length ?? 0})\n`);
                    resolve(resp);
                },
                reject,
                timer,
            });
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
        this.stopHeartbeatCheck();
        for (const [, agent] of this.agents) {
            agent.ws.close();
        }
        this.agents.clear();
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Manager closed'));
        }
        this.pendingRequests.clear();
        // Close outbound connections
        for (const [id] of this.outboundConnections) {
            this.disconnectOutbound(id);
        }
    }

    // ========================================================================
    // Outbound connections (container connects TO agent)
    // ========================================================================

    private outboundConnections = new Map<string, WebSocket.WebSocket>();
    private outboundReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private outboundMeta = new Map<string, { name: string; address: string; wsPath: string }>();

    /**
     * Connect outbound to an agent's WebSocket endpoint.
     * Events from the agent are emitted via 'agent-event' (same as call-home agents).
     */
    connectOutbound(agentId: string, agentName: string, agentAddress: string, wsPath: string = '/ws'): void {
        if (this.outboundConnections.has(agentId)) {
            this.disconnectOutbound(agentId);
        }

        this.outboundMeta.set(agentId, { name: agentName, address: agentAddress, wsPath });
        let normalizedAddr = agentAddress;
        if (!/^(wss?|https?):\/\//i.test(normalizedAddr)) {
            normalizedAddr = `ws://${normalizedAddr}`;
        }
        const wsUrl = normalizedAddr.replace(/^http/i, 'ws') + wsPath;
        const ws = new WebSocket.WebSocket(wsUrl);

        ws.on('open', () => {
            this.outboundConnections.set(agentId, ws);
            console.log(`[agent-mgr] Connected outbound to ${agentName} (${agentId}) at ${wsUrl}`);
        });

        ws.on('message', (data: WebSocket.RawData) => {
            this.emit('agent-event', agentId, agentName, data.toString());
        });

        ws.on('close', () => {
            this.outboundConnections.delete(agentId);
            console.log(`[agent-mgr] Outbound disconnected from ${agentName} (${agentId}), reconnecting in 5s`);
            this.scheduleOutboundReconnect(agentId);
        });

        ws.on('error', (err) => {
            this.outboundConnections.delete(agentId);
            console.error(`[agent-mgr] Outbound error for ${agentName} (${agentId}):`, err.message);
            this.scheduleOutboundReconnect(agentId);
        });
    }

    /** Send a raw WS message to an outbound-connected agent. */
    sendOutbound(agentId: string, data: string): boolean {
        const ws = this.outboundConnections.get(agentId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            return true;
        }
        return false;
    }

    /** Disconnect an outbound agent connection. */
    disconnectOutbound(agentId: string): void {
        const timer = this.outboundReconnectTimers.get(agentId);
        if (timer) { clearTimeout(timer); this.outboundReconnectTimers.delete(agentId); }
        this.outboundMeta.delete(agentId);
        const ws = this.outboundConnections.get(agentId);
        if (ws) {
            ws.close();
            this.outboundConnections.delete(agentId);
        }
    }

    /** Disconnect all outbound connections. */
    disconnectAllOutbound(): void {
        for (const [id] of this.outboundConnections) {
            this.disconnectOutbound(id);
        }
    }

    private scheduleOutboundReconnect(agentId: string): void {
        if (this.outboundReconnectTimers.has(agentId)) return;
        const meta = this.outboundMeta.get(agentId);
        if (!meta) return;
        this.outboundReconnectTimers.set(agentId, setTimeout(() => {
            this.outboundReconnectTimers.delete(agentId);
            if (!this.outboundConnections.has(agentId)) {
                console.log(`[agent-mgr] Reconnecting outbound to ${meta.name} (${agentId})`);
                this.connectOutbound(agentId, meta.name, meta.address, meta.wsPath);
            }
        }, 5000));
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
            workspaces: payload.workspaces ?? existing?.workspaces ?? this.disconnectedAgents.get(agentId)?.workspaces ?? [],
        };

        this.agents.set(agentId, agent);
        this.disconnectedAgents.delete(agentId);

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

    private checkStaleAgents(): void {
        const now = Date.now();
        for (const [agentId, agent] of this.agents) {
            if (now - agent.lastHeartbeat > this.staleThresholdMs) {
                console.log(`[agent-mgr] Agent "${agent.name}" (${agentId}) heartbeat stale (${Math.round((now - agent.lastHeartbeat) / 1000)}s) — terminating connection`);
                agent.ws.terminate();
                // The 'close' event handler will clean up and emit 'agent-disconnected'
            }
        }
    }
}

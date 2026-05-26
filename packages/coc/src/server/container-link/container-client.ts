/**
 * Container Link Client
 *
 * WebSocket client that connects outbound to a CoCContainer server.
 * Handles registration, heartbeats, event forwarding, and request proxying.
 */

import * as WebSocket from 'ws';
import * as http from 'http';
import * as os from 'os';
import { EventEmitter } from 'events';
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

export interface ContainerLinkOptions {
    /** Container WebSocket URL (e.g. ws://container.example.com:5000/ws/agent-link). */
    containerUrl: string;
    /** Display name for this agent. */
    agentName?: string;
    /** Persistent agent ID (used for reconnection matching). */
    agentId?: string;
    /** Heartbeat interval in ms (default: 30000). */
    heartbeatIntervalMs?: number;
    /** Reconnect base delay in ms (default: 2000). Exponential backoff applied. */
    reconnectBaseMs?: number;
    /** Max reconnect delay in ms (default: 60000). */
    reconnectMaxMs?: number;
    /** Local HTTP handler to invoke for proxied requests. */
    localRequestHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
    /** Local HTTP server instance (for proxied requests). */
    localServer?: http.Server;
    /** Local server port (for constructing internal requests). */
    localPort?: number;
    /** Callback to get current workspace list for registration. */
    getWorkspaces?: () => Promise<Array<{ id: string; name: string; rootPath: string }>>;
}

export type ContainerLinkStatus = 'disconnected' | 'connecting' | 'connected' | 'registered';

/**
 * Manages the outbound WebSocket connection to a container.
 */
export class ContainerLinkClient extends EventEmitter {
    private ws: WebSocket.WebSocket | null = null;
    private options: Required<Pick<ContainerLinkOptions, 'containerUrl' | 'heartbeatIntervalMs' | 'reconnectBaseMs' | 'reconnectMaxMs'>> & ContainerLinkOptions;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private _status: ContainerLinkStatus = 'disconnected';
    private _assignedAgentId: string | null = null;
    private stopped = false;

    constructor(options: ContainerLinkOptions) {
        super();
        this.options = {
            heartbeatIntervalMs: 30_000,
            reconnectBaseMs: 2_000,
            reconnectMaxMs: 60_000,
            ...options,
        };
    }

    get status(): ContainerLinkStatus {
        return this._status;
    }

    get assignedAgentId(): string | null {
        return this._assignedAgentId;
    }

    /**
     * Start connecting to the container.
     */
    start(): void {
        this.stopped = false;
        this.connect();
    }

    /**
     * Stop the connection and prevent reconnection.
     */
    stop(): void {
        this.stopped = true;
        this.cleanup();
        this.setStatus('disconnected');
    }

    /**
     * Forward a WebSocket broadcast event to the container.
     */
    forwardEvent(data: string): void {
        if (this._status !== 'registered') return;
        const payload: EventPayload = { data };
        this.send(createMessage('event', payload));
    }

    /**
     * Forward an SSE event to the container for a given subscription.
     */
    forwardSSEEvent(subscriptionId: string, event: string | undefined, data: string, id?: string): void {
        if (this._status !== 'registered') return;
        const payload: SSEEventPayload = { subscriptionId, event, data, id };
        this.send(createMessage('sse-event', payload));
    }

    // ========================================================================
    // Private
    // ========================================================================

    private connect(): void {
        if (this.stopped) return;
        this.setStatus('connecting');

        const wsUrl = this.buildWsUrl();
        const ws = new WebSocket.WebSocket(wsUrl);

        ws.on('open', () => {
            this.ws = ws;
            this.reconnectAttempts = 0;
            this.setStatus('connected');
            this.sendRegister();
            this.startHeartbeat();
        });

        ws.on('message', (raw: WebSocket.RawData) => {
            this.handleMessage(raw.toString());
        });

        ws.on('close', () => {
            this.cleanup();
            this.scheduleReconnect();
        });

        ws.on('error', () => {
            // Error is followed by close event; just ignore here
        });
    }

    private buildWsUrl(): string {
        let base = this.options.containerUrl.replace(/\/$/, '');
        // Auto-prepend ws:// if no protocol is specified
        if (!/^(wss?|https?):\/\//i.test(base)) {
            base = `ws://${base}`;
        }
        // If URL already includes path, use as-is; otherwise append default path
        if (base.includes('/ws/agent-link')) {
            return base;
        }
        const wsBase = base.replace(/^http/i, 'ws');
        return `${wsBase}/ws/agent-link`;
    }

    private sendRegister(): void {
        const payload: RegisterPayload = {
            name: this.options.agentName ?? os.hostname(),
            agentId: this.options.agentId,
        };
        // Send initial register without workspaces, then update with workspace list
        this.send(createMessage('register', payload));
        // Async: fetch workspaces and send updated register if available
        if (this.options.getWorkspaces) {
            this.options.getWorkspaces().then(workspaces => {
                if (workspaces.length > 0 && this._status === 'registered') {
                    const updatedPayload: RegisterPayload = { ...payload, workspaces };
                    this.send(createMessage('register', updatedPayload));
                }
            }).catch(() => { /* best-effort */ });
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this._status === 'registered' || this._status === 'connected') {
                const payload: HeartbeatPayload = { timestamp: Date.now() };
                this.send(createMessage('heartbeat', payload));
            }
        }, this.options.heartbeatIntervalMs);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private handleMessage(raw: string): void {
        const msg = parseMessage(raw);
        if (!msg) return;

        switch (msg.type) {
            case 'registered':
                this.handleRegistered(msg.payload as RegisteredPayload);
                break;
            case 'request':
                this.handleRequest(msg.payload as RequestPayload);
                break;
            case 'subscribe-sse':
                this.handleSubscribeSSE(msg.payload as SubscribeSSEPayload);
                break;
            case 'unsubscribe-sse':
                this.handleUnsubscribeSSE(msg.payload as UnsubscribeSSEPayload);
                break;
        }
    }

    private handleRegistered(payload: RegisteredPayload): void {
        this._assignedAgentId = payload.agentId;
        this.setStatus('registered');
        this.emit('registered', payload);
    }

    private handleRequest(payload: RequestPayload): void {
        // Proxy request to local HTTP server
        const port = this.options.localPort;
        if (!port) {
            this.sendResponse(payload.requestId, 503, {}, 'Agent not ready');
            return;
        }

        const reqOptions: http.RequestOptions = {
            hostname: '127.0.0.1',
            port,
            path: payload.path,
            method: payload.method,
            headers: {
                ...payload.headers,
                host: `127.0.0.1:${port}`,
            },
        };

        const proxyReq = http.request(reqOptions, (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk) => chunks.push(chunk));
            proxyRes.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(proxyRes.headers)) {
                    if (typeof value === 'string') {
                        headers[key] = value;
                    } else if (Array.isArray(value)) {
                        headers[key] = value.join(', ');
                    }
                }
                this.sendResponse(payload.requestId, proxyRes.statusCode ?? 500, headers, body);
            });
        });

        proxyReq.on('error', () => {
            this.sendResponse(payload.requestId, 502, {}, 'Proxy error');
        });

        if (payload.body) {
            proxyReq.write(payload.body);
        }
        proxyReq.end();
    }

    private sseSubscriptions = new Map<string, http.IncomingMessage>();

    private handleSubscribeSSE(payload: SubscribeSSEPayload): void {
        const port = this.options.localPort;
        if (!port) return;

        // Cancel existing subscription if any
        this.cancelSSESubscription(payload.subscriptionId);

        const req = http.get({
            hostname: '127.0.0.1',
            port,
            path: payload.path,
            headers: { Accept: 'text/event-stream' },
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return;
            }
            this.sseSubscriptions.set(payload.subscriptionId, res);

            let buffer = '';
            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';
                for (const part of parts) {
                    if (!part.trim()) continue;
                    const event = this.parseSSEBlock(part);
                    if (event) {
                        this.forwardSSEEvent(payload.subscriptionId, event.event, event.data, event.id);
                    }
                }
            });

            res.on('end', () => {
                this.sseSubscriptions.delete(payload.subscriptionId);
            });
        });

        req.on('error', () => {
            this.sseSubscriptions.delete(payload.subscriptionId);
        });
    }

    private handleUnsubscribeSSE(payload: UnsubscribeSSEPayload): void {
        this.cancelSSESubscription(payload.subscriptionId);
    }

    private cancelSSESubscription(id: string): void {
        const existing = this.sseSubscriptions.get(id);
        if (existing) {
            existing.destroy();
            this.sseSubscriptions.delete(id);
        }
    }

    private parseSSEBlock(block: string): { event?: string; data: string; id?: string } | null {
        let event: string | undefined;
        let id: string | undefined;
        const dataLines: string[] = [];

        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            } else if (line.startsWith('id:')) {
                id = line.slice(3).trim();
            }
        }

        if (dataLines.length === 0) return null;
        return { event, data: dataLines.join('\n'), id };
    }

    private sendResponse(requestId: string, status: number, headers: Record<string, string>, body: string): void {
        const payload: ResponsePayload = { requestId, status, headers, body };
        this.send(createMessage('response', payload));
    }

    private send(msg: ChannelMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped) return;
        this.setStatus('disconnected');
        const delay = Math.min(
            this.options.reconnectBaseMs * Math.pow(2, this.reconnectAttempts),
            this.options.reconnectMaxMs,
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    private cleanup(): void {
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Close all SSE subscriptions
        for (const [id, res] of this.sseSubscriptions) {
            res.destroy();
        }
        this.sseSubscriptions.clear();

        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
            this.ws = null;
        }
    }

    private setStatus(status: ContainerLinkStatus): void {
        if (this._status !== status) {
            this._status = status;
            this.emit('status', status);
        }
    }
}

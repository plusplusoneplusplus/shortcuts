/**
 * Agent ↔ Container Channel Protocol
 *
 * Defines the message types exchanged over the persistent WebSocket
 * connection between a CoC agent (outbound) and the container (inbound).
 *
 * This is a copy of the protocol in coccontainer/src/inbound/protocol.ts.
 * Kept in sync manually to avoid circular package dependencies.
 */

// ============================================================================
// Envelope
// ============================================================================

export interface ChannelMessage {
    /** Correlation ID for request/response matching. */
    id: string;
    /** Message type discriminator. */
    type: ChannelMessageType;
    /** Type-specific payload. */
    payload: unknown;
}

export type ChannelMessageType =
    // Agent → Container
    | 'register'
    | 'heartbeat'
    | 'event'
    | 'response'
    | 'sse-event'
    // Container → Agent
    | 'registered'
    | 'request'
    | 'subscribe-sse'
    | 'unsubscribe-sse';

// ============================================================================
// Agent → Container messages
// ============================================================================

/** Agent announces itself to the container. */
export interface RegisterPayload {
    /** Agent's display name. */
    name: string;
    /** Agent's unique ID (generated if not provided). */
    agentId?: string;
    /** CoC server version. */
    version?: string;
    /** Workspaces the agent manages. */
    workspaces?: Array<{
        id: string;
        name: string;
        rootPath: string;
    }>;
}

/** Keep-alive (agent → container). */
export interface HeartbeatPayload {
    /** Unix timestamp in ms. */
    timestamp: number;
}

/** WS broadcast event forwarded from agent to container. */
export interface EventPayload {
    /** The original WS broadcast JSON (process lifecycle events). */
    data: string;
}

/** Response to a proxied HTTP request. */
export interface ResponsePayload {
    /** Correlation ID matching the original request. */
    requestId: string;
    /** HTTP status code. */
    status: number;
    /** Response headers. */
    headers: Record<string, string>;
    /** Response body (string, usually JSON). */
    body: string;
}

/** SSE event forwarded from agent to container. */
export interface SSEEventPayload {
    /** Subscription ID (from subscribe-sse). */
    subscriptionId: string;
    /** SSE event name (if any). */
    event?: string;
    /** SSE data field. */
    data: string;
    /** SSE id field (if any). */
    id?: string;
}

// ============================================================================
// Container → Agent messages
// ============================================================================

/** Confirmation that registration succeeded. */
export interface RegisteredPayload {
    /** The agent ID assigned by the container. */
    agentId: string;
    /** Whether this is a new registration or reconnection. */
    reconnected: boolean;
}

/** Proxied HTTP request from browser → container → agent. */
export interface RequestPayload {
    /** Correlation ID (agent must include this in response). */
    requestId: string;
    /** HTTP method. */
    method: string;
    /** Request path (e.g. /api/workspaces/...). */
    path: string;
    /** Request headers. */
    headers: Record<string, string>;
    /** Request body (if any). */
    body?: string;
}

/** Ask agent to start streaming SSE for a process. */
export interface SubscribeSSEPayload {
    /** Unique subscription ID. */
    subscriptionId: string;
    /** SSE path on the agent (e.g. /api/workspaces/.../processes/.../events). */
    path: string;
}

/** Ask agent to stop streaming SSE. */
export interface UnsubscribeSSEPayload {
    /** Subscription ID to cancel. */
    subscriptionId: string;
}

// ============================================================================
// Helpers
// ============================================================================

export function createMessage(type: ChannelMessageType, payload: unknown, id?: string): ChannelMessage {
    return {
        id: id ?? generateId(),
        type,
        payload,
    };
}

export function parseMessage(raw: string): ChannelMessage | null {
    try {
        const msg = JSON.parse(raw);
        if (msg && typeof msg.type === 'string' && 'payload' in msg) {
            return msg as ChannelMessage;
        }
        return null;
    } catch {
        return null;
    }
}

let counter = 0;
function generateId(): string {
    return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

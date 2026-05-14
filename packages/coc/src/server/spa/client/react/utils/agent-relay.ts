/**
 * Agent Relay — browser-based RPC bridge for devtunnel agents.
 *
 * Opens a persistent small popup on the agent's domain that forwards
 * API requests and SSE streams via postMessage. This solves the auth
 * problem where the server-side proxy can't have devtunnel cookies.
 */

type PendingRequest = {
    resolve: (value: { status: number; data: unknown }) => void;
    reject: (error: Error) => void;
};

type SSEListener = {
    onEvent: (eventType: string, data: string) => void;
    onError: () => void;
    onOpen?: () => void;
};

interface AgentRelayState {
    popup: Window | null;
    ready: boolean;
    readyPromise: Promise<void> | null;
    readyResolve: (() => void) | null;
    pending: Map<string, PendingRequest>;
    sseListeners: Map<string, SSEListener>;
}

const relays = new Map<string, AgentRelayState>();

let messageListenerInstalled = false;

function ensureMessageListener(): void {
    if (messageListenerInstalled) return;
    messageListenerInstalled = true;

    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'relay-ready') {
            // Find which relay this popup belongs to
            for (const [, state] of relays) {
                if (state.popup && !state.ready) {
                    state.ready = true;
                    state.readyResolve?.();
                    break;
                }
            }
            return;
        }

        if (msg.type === 'relay-response') {
            for (const [, state] of relays) {
                const p = state.pending.get(msg.id);
                if (p) {
                    p.resolve({ status: msg.status, data: msg.data });
                    state.pending.delete(msg.id);
                    return;
                }
            }
            return;
        }

        if (msg.type === 'relay-error') {
            for (const [, state] of relays) {
                const p = state.pending.get(msg.id);
                if (p) {
                    p.reject(new Error(msg.error || 'Relay request failed'));
                    state.pending.delete(msg.id);
                    return;
                }
            }
            return;
        }

        if (msg.type === 'relay-sse-message') {
            for (const [, state] of relays) {
                const listener = state.sseListeners.get(msg.id);
                if (listener) {
                    listener.onEvent(msg.eventType || 'message', msg.data || '');
                    return;
                }
            }
            return;
        }

        if (msg.type === 'relay-sse-error') {
            for (const [, state] of relays) {
                const listener = state.sseListeners.get(msg.id);
                if (listener) {
                    listener.onError();
                    return;
                }
            }
            return;
        }

        if (msg.type === 'relay-sse-open-ack') {
            for (const [, state] of relays) {
                const listener = state.sseListeners.get(msg.id);
                if (listener?.onOpen) {
                    listener.onOpen();
                    return;
                }
            }
            return;
        }
    });
}

let nextId = 0;
function generateId(): string {
    return 'r' + (nextId++) + '-' + Date.now();
}

function getOrCreateRelay(agentAddr: string): AgentRelayState {
    let state = relays.get(agentAddr);
    if (state && state.popup && !state.popup.closed) {
        return state;
    }

    ensureMessageListener();

    let readyResolve: (() => void) | null = null;
    const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });

    state = {
        popup: null,
        ready: false,
        readyPromise,
        readyResolve,
        pending: new Map(),
        sseListeners: new Map(),
    };
    relays.set(agentAddr, state);

    const relayUrl = `${agentAddr}/api/fs/browse-helper?action=relay`;
    state.popup = window.open(relayUrl, 'coc-relay-' + agentAddr.replace(/[^a-z0-9]/gi, ''), 'width=200,height=100');

    if (!state.popup) {
        state.readyResolve = null;
        throw new Error('Popup blocked — please allow popups for this site');
    }

    // Timeout: if relay doesn't become ready in 30s, reject
    setTimeout(() => {
        if (!state!.ready) {
            state!.readyResolve = null;
            // Don't reject — the popup might be going through auth
        }
    }, 30_000);

    return state;
}

async function waitForReady(state: AgentRelayState): Promise<void> {
    if (state.ready) return;
    if (state.readyPromise) {
        await Promise.race([
            state.readyPromise,
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Relay connection timed out')), 60_000)),
        ]);
    }
}

/**
 * Make an API request through the relay popup.
 * Returns a fetch-Response-like object with status and parsed data.
 */
export async function relayFetch(
    agentAddr: string,
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; data: unknown }> {
    const state = getOrCreateRelay(agentAddr);
    await waitForReady(state);

    const id = generateId();
    return new Promise((resolve, reject) => {
        state.pending.set(id, { resolve, reject });

        state.popup!.postMessage({
            type: 'relay-request',
            id,
            method: init?.method || 'GET',
            path,
            headers: init?.headers,
            body: init?.body,
        }, '*');

        // Timeout per request
        setTimeout(() => {
            if (state.pending.has(id)) {
                state.pending.delete(id);
                reject(new Error('Relay request timed out'));
            }
        }, 120_000);
    });
}

/**
 * Open an SSE stream through the relay popup.
 * Returns an object with `close()` to stop the stream
 * and allows adding event listeners.
 */
export function relayEventSource(
    agentAddr: string,
    path: string,
): RelaySSE {
    const state = getOrCreateRelay(agentAddr);
    const id = generateId();
    const sse = new RelaySSE(state, id);

    // Wait for ready then open
    waitForReady(state).then(() => {
        state.sseListeners.set(id, {
            onEvent: (eventType, data) => sse._dispatch(eventType, data),
            onError: () => sse._dispatchError(),
            onOpen: () => sse._dispatchOpen(),
        });

        state.popup!.postMessage({
            type: 'relay-sse-open',
            id,
            path,
        }, '*');
    }).catch((err) => {
        console.error('Failed to open relay SSE:', err);
        sse._dispatchError();
    });

    return sse;
}

/**
 * EventSource-like object backed by the relay.
 * Supports addEventListener for named SSE events.
 */
export class RelaySSE {
    private listeners = new Map<string, Array<(event: { data: string }) => void>>();
    private closed = false;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;

    constructor(private state: AgentRelayState, private id: string) {}

    addEventListener(eventType: string, handler: (event: { data: string }) => void): void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, []);
        }
        this.listeners.get(eventType)!.push(handler);
    }

    removeEventListener(eventType: string, handler: (event: { data: string }) => void): void {
        const arr = this.listeners.get(eventType);
        if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.state.sseListeners.delete(this.id);
        try {
            this.state.popup?.postMessage({ type: 'relay-sse-close', id: this.id }, '*');
        } catch { /* popup may be closed */ }
    }

    /** @internal */
    _dispatch(eventType: string, data: string): void {
        if (this.closed) return;
        const handlers = this.listeners.get(eventType);
        if (handlers) {
            const event = { data };
            for (const h of handlers) {
                try { h(event); } catch (e) { console.error('SSE handler error:', e); }
            }
        }
    }

    /** @internal */
    _dispatchError(): void {
        if (this.closed) return;
        this.onerror?.();
    }

    /** @internal */
    _dispatchOpen(): void {
        if (this.closed) return;
        this.onopen?.();
    }
}

/**
 * Check if a relay is currently active and ready for an agent.
 */
export function hasActiveRelay(agentAddr: string): boolean {
    const state = relays.get(agentAddr);
    return !!state && !!state.popup && !state.popup.closed && state.ready;
}

/**
 * Open the relay popup proactively (e.g. after browse-helper auth succeeds).
 * This pre-opens the relay so subsequent API calls don't have a delay.
 */
export function openRelayIfNeeded(agentAddr: string): void {
    try {
        const state = getOrCreateRelay(agentAddr);
        // Just trigger creation, don't await
        void state.readyPromise;
    } catch {
        // Popup blocked — will try again on next request
    }
}

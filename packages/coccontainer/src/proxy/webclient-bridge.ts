/**
 * WebClient Bridge
 *
 * Manages browser WebSocket clients connected to the CoCContainer.
 * Symmetric to TeamsBridge — subscribes to WSRelay for agent events
 * and forwards them to connected browser clients.
 *
 * Inbound (browser → agent):
 *   Browser sends WS message { agentId, data } → forwarded via wsRelay.send()
 *
 * Outbound (agent → browser):
 *   WSRelay emits 'message' → broadcast to all connected browser WS clients
 */

import type { WebSocket as WsSocket } from 'ws';
import type { WebSocketRelay, WSRelayMessage } from '../proxy/ws-relay';

export interface WebClientBridgeOptions {
    wsRelay: WebSocketRelay;
}

export class WebClientBridge {
    private readonly wsRelay: WebSocketRelay;
    private readonly clients = new Set<WsSocket>();

    constructor(opts: WebClientBridgeOptions) {
        this.wsRelay = opts.wsRelay;
    }

    /**
     * Handle a new browser WebSocket connection.
     * Called from the HTTP server's 'upgrade' handler for /ws.
     */
    handleConnection(ws: WsSocket): void {
        this.clients.add(ws);
        console.log(`[webclient-bridge] 🌐 Browser client connected (total: ${this.clients.size})`);

        // Subscribe to agent events and forward to this browser client
        const onMessage = (msg: WSRelayMessage) => {
            if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
            // Parse the agent's JSON payload and inject agentId/agentName so the
            // browser's ProcessWebSocketConnection can pass isProcessEvent (which
            // requires a top-level `type` field). Sending the raw envelope
            // { agentId, agentName, data: "<json string>" } would fail that check
            // and silently drop every event in container mode.
            try {
                const parsed = JSON.parse(msg.data);
                ws.send(JSON.stringify({ ...parsed, agentId: msg.agentId, agentName: msg.agentName }));
            } catch {
                ws.send(JSON.stringify(msg));
            }
        };
        this.wsRelay.on('message', onMessage);

        // Handle inbound messages from browser → forward to target agent
        ws.on('message', (data: Buffer) => {
            try {
                const parsed = JSON.parse(data.toString());
                if (parsed.agentId && parsed.data) {
                    console.log(`[webclient-bridge] 📤 Browser → agent ${parsed.agentId}: forwarding WS message`);
                    this.wsRelay.send(parsed.agentId, typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data));
                }
            } catch {
                // ignore malformed
            }
        });

        ws.on('close', () => {
            this.clients.delete(ws);
            this.wsRelay.off('message', onMessage);
            console.log(`[webclient-bridge] 🌐 Browser client disconnected (total: ${this.clients.size})`);
        });
    }

    /** Number of connected browser clients. */
    get clientCount(): number {
        return this.clients.size;
    }

    /** Stop all connections and clean up. */
    stop(): void {
        for (const ws of this.clients) {
            ws.close();
        }
        this.clients.clear();
    }
}

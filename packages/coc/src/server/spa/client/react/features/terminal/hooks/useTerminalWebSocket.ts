/**
 * WebSocket hook for the dedicated /ws/terminal endpoint.
 * Unlike useWebSocket (general /ws), this targets the terminal-specific
 * endpoint with workspace/dimension query params and exposes explicit
 * connect/disconnect/sendInput/sendResize methods.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getWsPath } from '../../../utils/config';
import { cloneWsUrl } from '../../../api/wsUrl';

export type { WsStatus } from '../../../hooks/useWebSocket';
type WsStatus = 'connecting' | 'open' | 'closed';

// Client → Server (aligned with packages/coc/src/server/terminal/types.ts)
export type TerminalClientMessage =
    | { type: 'terminal-create'; workspaceId: string; cols?: number; rows?: number }
    | { type: 'terminal-attach'; sessionId: string }
    | { type: 'terminal-input'; sessionId: string; data: string }
    | { type: 'terminal-resize'; sessionId: string; cols: number; rows: number }
    | { type: 'terminal-close'; sessionId: string }
    | { type: 'terminal-pin'; sessionId: string }
    | { type: 'terminal-unpin'; sessionId: string }
    | { type: 'ping' };

// Server → Client (aligned with packages/coc/src/server/terminal/types.ts)
export interface TerminalSessionInfo {
    id: string;
    workspaceId: string;
    cols: number;
    rows: number;
    createdAt: number;
    lastActivity: number;
    pid: number;
    pinned: boolean;
}

export type TerminalServerMessage =
    | { type: 'terminal-created'; session: TerminalSessionInfo }
    | { type: 'terminal-output'; sessionId: string; data: string }
    | { type: 'terminal-exit'; sessionId: string; exitCode: number; signal?: number }
    | { type: 'terminal-error'; sessionId: string | null; message: string }
    | { type: 'terminal-pin-changed'; sessionId: string; pinned: boolean }
    | { type: 'pong' };

export interface UseTerminalWebSocketOptions {
    onMessage: (msg: TerminalServerMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
}

export interface UseTerminalWebSocketReturn {
    status: WsStatus;
    connect: (workspaceId: string, cols: number, rows: number, options?: TerminalConnectOptions) => void;
    disconnect: () => void;
    sendInput: (data: string) => void;
    sendResize: (cols: number, rows: number) => void;
}

export type TerminalConnectOptions =
    | { mode?: 'create' }
    | { mode: 'attach'; sessionId: string };

interface ConnectParams {
    workspaceId: string;
    cols: number;
    rows: number;
    mode: 'create' | 'attach';
    sessionId?: string;
}

export function useTerminalWebSocket({
    onMessage,
    onConnect,
    onDisconnect,
}: UseTerminalWebSocketOptions): UseTerminalWebSocketReturn {
    const [status, setStatus] = useState<WsStatus>('closed');
    const wsRef = useRef<WebSocket | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const reconnectDelayRef = useRef(1000);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const manualCloseRef = useRef(false);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);
    const onDisconnectRef = useRef(onDisconnect);

    // Store connect params for reconnect
    const connectParamsRef = useRef<ConnectParams | null>(null);

    useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
    useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);
    useEffect(() => { onDisconnectRef.current = onDisconnect; }, [onDisconnect]);

    const cleanup = useCallback(() => {
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
    }, []);

    const doConnect = useCallback(() => {
        const params = connectParamsRef.current;
        if (!params) return;

        cleanup();
        sessionIdRef.current = params.mode === 'attach' ? params.sessionId ?? null : null;
        if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
            wsRef.current.close();
        }

        const basePath = getWsPath();
        // baseUrl omitted → page-origin URL (local behavior unchanged). AC-07 wires
        // a remote clone's baseUrl in so its terminal targets that server.
        const wsUrl = cloneWsUrl(`${basePath}/terminal?workspaceId=${encodeURIComponent(params.workspaceId)}&cols=${params.cols}&rows=${params.rows}`);
        setStatus('connecting');

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectDelayRef.current = 1000;
            setStatus('open');
            if (params.mode === 'attach') {
                if (!params.sessionId) {
                    throw new Error('Cannot attach terminal WebSocket without a server session id');
                }
                ws.send(JSON.stringify({
                    type: 'terminal-attach',
                    sessionId: params.sessionId,
                }));
            } else {
                // Spawn a PTY session on the server
                ws.send(JSON.stringify({
                    type: 'terminal-create',
                    workspaceId: params.workspaceId,
                    cols: params.cols,
                    rows: params.rows,
                }));
            }
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
            onConnectRef.current?.();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'terminal-created' && msg.session?.id) {
                    sessionIdRef.current = msg.session.id;
                }
                onMessageRef.current(msg);
            } catch { /* ignore parse errors */ }
        };

        ws.onclose = () => {
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            setStatus('closed');
            onDisconnectRef.current?.();
            if (!manualCloseRef.current) {
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
                    doConnect();
                }, reconnectDelayRef.current);
            }
        };

        ws.onerror = () => { /* handled by onclose */ };
    }, [cleanup]);

    const connect = useCallback((workspaceId: string, cols: number, rows: number, options?: TerminalConnectOptions) => {
        manualCloseRef.current = false;
        const mode = options?.mode ?? 'create';
        if (mode === 'attach') {
            connectParamsRef.current = { workspaceId, cols, rows, mode, sessionId: options.sessionId };
        } else {
            connectParamsRef.current = { workspaceId, cols, rows, mode };
        }
        doConnect();
    }, [doConnect]);

    const disconnect = useCallback(() => {
        manualCloseRef.current = true;
        cleanup();
        if (wsRef.current) {
            if (wsRef.current.readyState === WebSocket.OPEN && sessionIdRef.current) {
                wsRef.current.send(JSON.stringify({ type: 'terminal-close', sessionId: sessionIdRef.current }));
            }
            wsRef.current.close();
            wsRef.current = null;
        }
        sessionIdRef.current = null;
        setStatus('closed');
    }, [cleanup]);

    const sendInput = useCallback((data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
            wsRef.current.send(JSON.stringify({ type: 'terminal-input', sessionId: sessionIdRef.current, data }));
        }
    }, []);

    const sendResize = useCallback((cols: number, rows: number) => {
        if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
            wsRef.current.send(JSON.stringify({ type: 'terminal-resize', sessionId: sessionIdRef.current, cols, rows }));
        }
    }, []);

    useEffect(() => {
        return () => {
            manualCloseRef.current = true;
            cleanup();
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [cleanup]);

    return { status, connect, disconnect, sendInput, sendResize };
}

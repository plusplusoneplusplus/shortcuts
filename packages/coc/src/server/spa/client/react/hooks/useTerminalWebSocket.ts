/**
 * WebSocket hook for the dedicated /ws/terminal endpoint.
 * Unlike useWebSocket (general /ws), this targets the terminal-specific
 * endpoint with workspace/dimension query params and exposes explicit
 * connect/disconnect/sendInput/sendResize methods.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getWsPath } from '../utils/config';

export type { WsStatus } from './useWebSocket';
type WsStatus = 'connecting' | 'open' | 'closed';

// Client → Server
export type TerminalClientMessage =
    | { type: 'terminal-input'; data: string }
    | { type: 'terminal-resize'; cols: number; rows: number }
    | { type: 'terminal-close' }
    | { type: 'ping' };

// Server → Client
export type TerminalServerMessage =
    | { type: 'terminal-created'; sessionId: string; cols: number; rows: number }
    | { type: 'terminal-output'; data: string }
    | { type: 'terminal-exit'; code: number }
    | { type: 'terminal-error'; message: string }
    | { type: 'pong' };

export interface UseTerminalWebSocketOptions {
    onMessage: (msg: TerminalServerMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
}

export interface UseTerminalWebSocketReturn {
    status: WsStatus;
    connect: (workspaceId: string, cols: number, rows: number) => void;
    disconnect: () => void;
    sendInput: (data: string) => void;
    sendResize: (cols: number, rows: number) => void;
}

export function useTerminalWebSocket({
    onMessage,
    onConnect,
    onDisconnect,
}: UseTerminalWebSocketOptions): UseTerminalWebSocketReturn {
    const [status, setStatus] = useState<WsStatus>('closed');
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectDelayRef = useRef(1000);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const manualCloseRef = useRef(false);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);
    const onDisconnectRef = useRef(onDisconnect);

    // Store connect params for reconnect
    const connectParamsRef = useRef<{ workspaceId: string; cols: number; rows: number } | null>(null);

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
        if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
            wsRef.current.close();
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const basePath = getWsPath();
        const wsUrl = `${protocol}//${location.host}${basePath}/terminal?workspaceId=${encodeURIComponent(params.workspaceId)}&cols=${params.cols}&rows=${params.rows}`;
        setStatus('connecting');

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectDelayRef.current = 1000;
            setStatus('open');
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

    const connect = useCallback((workspaceId: string, cols: number, rows: number) => {
        manualCloseRef.current = false;
        connectParamsRef.current = { workspaceId, cols, rows };
        doConnect();
    }, [doConnect]);

    const disconnect = useCallback(() => {
        manualCloseRef.current = true;
        cleanup();
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setStatus('closed');
    }, [cleanup]);

    const sendInput = useCallback((data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'terminal-input', data }));
        }
    }, []);

    const sendResize = useCallback((cols: number, rows: number) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'terminal-resize', cols, rows }));
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

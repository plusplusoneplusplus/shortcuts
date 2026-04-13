/**
 * WebSocket hook: connection with exponential backoff reconnect.
 * Mirrors websocket.ts logic but dispatches via callback instead of global state.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getWsPath } from '../utils/config';

export type WsStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketOptions {
    onMessage: (msg: any) => void;
    onConnect?: () => void;
}

export function useWebSocket({ onMessage, onConnect }: UseWebSocketOptions) {
    const [status, setStatus] = useState<WsStatus>('closed');
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectDelayRef = useRef(1000);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const manualCloseRef = useRef(false);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        onConnectRef.current = onConnect;
    }, [onConnect]);

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
        cleanup();
        if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
            wsRef.current.close();
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + location.host + getWsPath();
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
            if (!manualCloseRef.current) {
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
                    doConnect();
                }, reconnectDelayRef.current);
            }
        };

        ws.onerror = () => { /* handled by onclose */ };
    }, [cleanup]);

    const connect = useCallback(() => {
        manualCloseRef.current = false;
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

    return { status, connect, disconnect };
}

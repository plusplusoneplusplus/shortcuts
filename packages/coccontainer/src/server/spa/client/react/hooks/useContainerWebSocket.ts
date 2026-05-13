/**
 * WebSocket hook for the CoCContainer dashboard.
 * Connects to the container's WS endpoint and receives relayed agent messages.
 */

import { useRef, useEffect, useState, useCallback } from 'react';

export type WsStatus = 'connecting' | 'open' | 'closed';

interface UseContainerWebSocketOptions {
    onMessage: (msg: any) => void;
    onConnect?: () => void;
}

export function useContainerWebSocket({ onMessage, onConnect }: UseContainerWebSocketOptions) {
    const [status, setStatus] = useState<WsStatus>('closed');
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectDelayRef = useRef(1000);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const manualCloseRef = useRef(false);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);

    useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
    useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);

    const cleanup = useCallback(() => {
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
        const wsUrl = `${protocol}//${location.host}/ws`;
        setStatus('connecting');

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectDelayRef.current = 1000;
            setStatus('open');
            onConnectRef.current?.();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                onMessageRef.current(msg);
            } catch { /* ignore */ }
        };

        ws.onclose = () => {
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

    useEffect(() => {
        manualCloseRef.current = false;
        doConnect();
        return () => {
            manualCloseRef.current = true;
            cleanup();
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [doConnect, cleanup]);

    return { status };
}

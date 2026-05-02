/**
 * WebSocket hook: connection with exponential backoff reconnect.
 * React state wrapper around @plusplusoneplusplus/coc-client realtime primitives.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';

export type WsStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketOptions {
    onMessage: (msg: any) => void;
    onConnect?: () => void;
}

export function useWebSocket({ onMessage, onConnect }: UseWebSocketOptions) {
    const [status, setStatus] = useState<WsStatus>('closed');
    const connectionRef = useRef<ProcessWebSocketConnection | null>(null);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        onConnectRef.current = onConnect;
    }, [onConnect]);

    const doConnect = useCallback(() => {
        connectionRef.current?.close();
        connectionRef.current = getSpaCocClient().events.connect({
            onMessage: msg => onMessageRef.current(msg),
            onOpen: () => onConnectRef.current?.(),
            onStatusChange: setStatus,
        });
    }, []);

    const connect = useCallback(() => {
        doConnect();
    }, [doConnect]);

    const disconnect = useCallback(() => {
        connectionRef.current?.close();
        connectionRef.current = null;
        setStatus('closed');
    }, []);

    useEffect(() => {
        return () => {
            connectionRef.current?.close();
            connectionRef.current = null;
        };
    }, []);

    return { status, connect, disconnect };
}

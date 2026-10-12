/**
 * WebSocket hook: connection with exponential backoff reconnect.
 * React state wrapper around @plusplusoneplusplus/coc-client realtime primitives.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { ConnectionStatus, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';
import { createBrowserSocketRelay } from '../shared/file-path/browser-control-relay';

export type WsStatus = ConnectionStatus;

interface UseWebSocketOptions {
    onMessage: (msg: any) => void;
    onConnect?: () => void;
    broadcastProcessUpdates?: boolean;
    browserRoutingRef?: string | null;
}

export function useWebSocket({ onMessage, onConnect, broadcastProcessUpdates = false, browserRoutingRef }: UseWebSocketOptions) {
    const [status, setStatus] = useState<WsStatus>('closed');
    const connectionRef = useRef<ProcessWebSocketConnection | null>(null);
    const onMessageRef = useRef(onMessage);
    const onConnectRef = useRef(onConnect);
    const browserRelayRef = useRef<ReturnType<typeof createBrowserSocketRelay> | null>(null);
    const browserRoutingRefRef = useRef(browserRoutingRef);
    browserRoutingRefRef.current = browserRoutingRef;
    useEffect(() => { void browserRelayRef.current?.update(browserRoutingRef ?? null); }, [browserRoutingRef]);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        onConnectRef.current = onConnect;
    }, [onConnect]);

    const doConnect = useCallback(() => {
        browserRelayRef.current?.dispose();
        browserRelayRef.current = null;
        connectionRef.current?.close();
        connectionRef.current = getSpaCocClient().events.connect({
            onMessage: msg => {
                if (browserRelayRef.current?.onMessage(msg)) return;
                if (broadcastProcessUpdates && (msg.type === 'process-added' || msg.type === 'process-updated')) {
                    window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: msg }));
                }
                onMessageRef.current(msg);
            },
            onOpen: () => {
                browserRelayRef.current?.onOpen();
                window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} }));
                onConnectRef.current?.();
            },
            onStatusChange: status => {
                if (status === 'closed') browserRelayRef.current?.onClose();
                setStatus(status);
            },
        });
        if (browserRoutingRefRef.current !== undefined) {
            browserRelayRef.current = createBrowserSocketRelay(connectionRef.current);
            void browserRelayRef.current.update(browserRoutingRefRef.current ?? null);
        }
    }, [broadcastProcessUpdates]);

    const connect = useCallback(() => {
        doConnect();
    }, [doConnect]);

    const disconnect = useCallback(() => {
        browserRelayRef.current?.dispose();
        browserRelayRef.current = null;
        connectionRef.current?.close();
        connectionRef.current = null;
        setStatus('closed');
    }, []);

    useEffect(() => {
        return () => {
            browserRelayRef.current?.dispose();
            connectionRef.current?.close();
            connectionRef.current = null;
        };
    }, []);

    return { status, connect, disconnect };
}

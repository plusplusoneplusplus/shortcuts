/**
 * WebSocket hook: connection with exponential backoff reconnect.
 * React state wrapper around @plusplusoneplusplus/coc-client realtime primitives.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { ConnectionStatus, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';
import { createBrowserSocketRelay } from '../shared/file-path/browser-control-relay';
import { createDashboardDiscoverySocketRelay } from '../shared/dashboard-discovery/socket-relay';

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
    const discoveryRelayRef = useRef<ReturnType<typeof createDashboardDiscoverySocketRelay> | null>(null);
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
        discoveryRelayRef.current?.dispose();
        discoveryRelayRef.current = null;
        browserRelayRef.current?.dispose();
        browserRelayRef.current = null;
        connectionRef.current?.close();
        connectionRef.current = getSpaCocClient().events.connect({
            onMessage: msg => {
                if (discoveryRelayRef.current?.onMessage(msg)) return;
                if (browserRelayRef.current?.onMessage(msg)) return;
                if (broadcastProcessUpdates && (msg.type === 'process-added' || msg.type === 'process-updated'
                    || msg.type === 'tool-inventory-changed')) {
                    window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: msg }));
                }
                onMessageRef.current(msg);
            },
            onOpen: () => {
                discoveryRelayRef.current?.onOpen();
                browserRelayRef.current?.onOpen();
                window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} }));
                onConnectRef.current?.();
            },
            onStatusChange: status => {
                if (status === 'closed') {
                    discoveryRelayRef.current?.onClose();
                    browserRelayRef.current?.onClose();
                }
                setStatus(status);
            },
        });
        if (broadcastProcessUpdates) discoveryRelayRef.current = createDashboardDiscoverySocketRelay(connectionRef.current);
        if (browserRoutingRefRef.current !== undefined) {
            browserRelayRef.current = createBrowserSocketRelay(connectionRef.current);
            void browserRelayRef.current.update(browserRoutingRefRef.current ?? null);
        }
    }, [broadcastProcessUpdates]);

    const connect = useCallback(() => {
        doConnect();
    }, [doConnect]);

    const disconnect = useCallback(() => {
        discoveryRelayRef.current?.dispose();
        discoveryRelayRef.current = null;
        browserRelayRef.current?.dispose();
        browserRelayRef.current = null;
        connectionRef.current?.close();
        connectionRef.current = null;
        setStatus('closed');
    }, []);

    useEffect(() => {
        return () => {
            discoveryRelayRef.current?.dispose();
            discoveryRelayRef.current = null;
            browserRelayRef.current?.dispose();
            connectionRef.current?.close();
            connectionRef.current = null;
        };
    }, []);

    return { status, connect, disconnect };
}

/**
 * RemoteCloneEventBridge — extends the global `/ws` event subscription to every
 * ONLINE remote clone.
 *
 * The dashboard moves a task RUNNING → COMPLETED in the sidebar from the global
 * `/ws` `process-added`/`process-updated`/`process-removed` lifecycle events
 * (dispatched in App.onMessage). `useWebSocket` only connects that socket to the
 * LOCAL server, so a remote clone's task never receives its lifecycle events and
 * the row stays stuck "running" even though the conversation pane (fed by the
 * per-process SSE, which IS routed per-clone via useChatSSE) shows it completed.
 *
 * This opens one additional global socket per online remote clone (deduped by
 * `baseUrl`) and feeds every message into the SAME `onMessage` handler, so remote
 * tasks update in real time exactly like local ones. Server-side loopback WS CORS
 * (AC-02) already permits the cross-origin upgrade to `127.0.0.1:{port}`.
 */
import { useEffect, useRef } from 'react';
import type { ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../../api/cocClient';
import { useRepos } from '../../contexts/ReposContext';
import { isRemoteWorkspace } from '../../repos/remoteWorkspaceAggregation';
import type { RepoData } from '../../repos/repoGrouping';
import { useApp } from '../../contexts/AppContext';
import { createBrowserSocketRelay } from '../../shared/file-path/browser-control-relay';

/** Distinct baseUrls of currently-online remote clones (one socket per server). */
function onlineRemoteBaseUrls(repos: RepoData[]): string[] {
    const set = new Set<string>();
    for (const repo of repos) {
        const ws = repo.workspace;
        if (isRemoteWorkspace(ws) && ws.remote.connection === 'online' && ws.baseUrl) {
            set.add(ws.baseUrl);
        }
    }
    return Array.from(set).sort();
}

/**
 * Keep a live global event socket open to each online remote clone, routing every
 * message into the shared dashboard `onMessage` handler.
 */
export function useRemoteCloneEvents(onMessage: (msg: any) => void, browserRoutingRef: string | null = null): void {
    const { repos } = useRepos();
    const routingRef = useRef(browserRoutingRef);
    routingRef.current = browserRoutingRef;
    const relaysRef = useRef(new Map<string, ReturnType<typeof createBrowserSocketRelay>>());
    useEffect(() => { for (const relay of relaysRef.current.values()) void relay.update(browserRoutingRef); }, [browserRoutingRef]);

    // Ref the handler so a new onMessage identity doesn't churn the sockets.
    const onMessageRef = useRef(onMessage);
    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    // Stable key for the online-clone set — reconcile sockets only when it changes.
    const key = onlineRemoteBaseUrls(repos).join('|');
    const connectionsRef = useRef<Map<string, ProcessWebSocketConnection>>(new Map());

    useEffect(() => {
        const conns = connectionsRef.current;
        const desired = new Set(key ? key.split('|') : []);
        // Drop sockets for clones that went offline or disappeared.
        for (const [baseUrl, conn] of conns) {
            if (!desired.has(baseUrl)) {
                relaysRef.current.get(baseUrl)?.dispose();
                relaysRef.current.delete(baseUrl);
                conn.close();
                conns.delete(baseUrl);
            }
        }
        // Open a socket for each newly-online clone, feeding the shared handler.
        for (const baseUrl of desired) {
            if (!conns.has(baseUrl)) {
                const conn = getCocClientFor(baseUrl).events.connect({
                        onOpen: () => {
                            relaysRef.current.get(baseUrl)?.onOpen();
                            window.dispatchEvent(new CustomEvent('coc-remote-ws-connect', { detail: { baseUrl } }));
                        },
                        onStatusChange: status => { if (status === 'closed') relaysRef.current.get(baseUrl)?.onClose(); },
                        onMessage: (msg: any) => {
                            if (relaysRef.current.get(baseUrl)?.onMessage(msg)) return;
                            onMessageRef.current(msg);
                            window.dispatchEvent(new CustomEvent('coc-remote-ws-message', {
                                detail: { message: msg, baseUrl },
                            }));
                        },
                    });
                conns.set(baseUrl, conn);
                const relay = createBrowserSocketRelay(conn, baseUrl);
                relaysRef.current.set(baseUrl, relay);
                void relay.update(routingRef.current);
            }
        }
    }, [key]);

    // Close every remote socket on unmount.
    useEffect(() => {
        const conns = connectionsRef.current;
        return () => {
            for (const relay of relaysRef.current.values()) relay.dispose();
            relaysRef.current.clear();
            for (const conn of conns.values()) {
                conn.close();
            }
            conns.clear();
        };
    }, []);
}

/** Null-rendering bridge that wires remote-clone events into `onMessage`. */
export function RemoteCloneEventBridge({ onMessage }: { onMessage: (msg: any) => void }): null {
    const { state } = useApp();
    useRemoteCloneEvents(onMessage, state.selectedRepoId);
    return null;
}

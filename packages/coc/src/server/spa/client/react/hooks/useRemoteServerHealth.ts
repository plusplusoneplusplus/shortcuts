import { useState, useEffect, useRef, useCallback } from 'react';
import type { RemoteServer, RemoteServerHealth } from '../utils/serverRegistry';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';

const POLL_INTERVAL_MS = 30_000;

export interface ServerHealthState extends Omit<RemoteServerHealth, 'serverId' | 'kind'> {
    server: RemoteServer;
    kind: RemoteServer['kind'];
}

export interface UseRemoteServerHealthResult {
    /** Latest health snapshot, one entry per server. */
    healthStates: ServerHealthState[];
    /**
     * Re-poll every server immediately, without waiting for the next
     * {@link POLL_INTERVAL_MS} cycle. Used after a Restart so the offline→online
     * transition surfaces promptly instead of up to 30s later. Safe to call any
     * time; a no-op while there are no servers.
     */
    refetch: () => void;
}

async function checkServer(server: RemoteServer, owner: CocClient): Promise<ServerHealthState> {
    try {
        const body = await owner.servers.getHealth(server.id);
        return {
            server,
            kind: server.kind,
            status: body.status,
            effectiveUrl: body.effectiveUrl,
            version: body.version,
            commit: body.commit,
            serverName: body.serverName,
            uptime: body.uptime,
            processCount: body.processCount,
            tunnelId: body.tunnelId,
            localPort: body.localPort,
            publicUrl: body.publicUrl,
            lastChecked: body.lastChecked,
            error: body.error,
        };
    } catch (e) {
        return {
            server,
            kind: server.kind,
            status: 'offline',
            lastChecked: Date.now(),
            error: e instanceof Error ? e.message : 'Unknown error',
        };
    }
}

/** `owner` is the server whose registry lists `servers`; defaults to the page origin. */
export function useRemoteServerHealth(servers: RemoteServer[], owner?: CocClient): UseRemoteServerHealthResult {
    const [healthStates, setHealthStates] = useState<ServerHealthState[]>(
        () => servers.map(s => ({ server: s, kind: s.kind, status: 'checking' as const })),
    );
    const cancelledRef = useRef(false);
    // Holds the current effect's poll closure so refetch() can fire an extra poll
    // without re-running the effect (which would reset every row to "checking" and
    // restart the interval timer).
    const pollRef = useRef<(() => void) | undefined>(undefined);

    useEffect(() => {
        cancelledRef.current = false;
        setHealthStates(servers.map(s => ({ server: s, kind: s.kind, status: 'checking' as const })));

        if (servers.length === 0) {
            pollRef.current = undefined;
            return () => { cancelledRef.current = true; };
        }

        const poll = async () => {
            const client = owner ?? getSpaCocClient();
            const results = await Promise.all(servers.map(server => checkServer(server, client)));
            if (cancelledRef.current) { return; }
            setHealthStates(results);
        };
        pollRef.current = () => { void poll(); };

        void poll();
        const id = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        return () => {
            cancelledRef.current = true;
            clearInterval(id);
            pollRef.current = undefined;
        };
    }, [servers, owner]);

    const refetch = useCallback(() => { pollRef.current?.(); }, []);

    return { healthStates, refetch };
}

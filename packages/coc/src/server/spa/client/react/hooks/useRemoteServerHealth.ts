import { useState, useEffect, useRef } from 'react';
import type { RemoteServer, RemoteServerHealth } from '../utils/serverRegistry';
import { getSpaCocClient } from '../api/cocClient';

const POLL_INTERVAL_MS = 30_000;

export interface ServerHealthState extends Omit<RemoteServerHealth, 'serverId' | 'kind'> {
    server: RemoteServer;
    kind: RemoteServer['kind'];
}

async function checkServer(server: RemoteServer): Promise<ServerHealthState> {
    try {
        const body = await getSpaCocClient().servers.getHealth(server.id);
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

export function useRemoteServerHealth(servers: RemoteServer[]): ServerHealthState[] {
    const [healthStates, setHealthStates] = useState<ServerHealthState[]>(
        () => servers.map(s => ({ server: s, kind: s.kind, status: 'checking' as const })),
    );
    const cancelledRef = useRef(false);

    useEffect(() => {
        cancelledRef.current = false;
        setHealthStates(servers.map(s => ({ server: s, kind: s.kind, status: 'checking' as const })));

        if (servers.length === 0) {
            return () => { cancelledRef.current = true; };
        }

        const poll = async () => {
            const results = await Promise.all(servers.map(checkServer));
            if (cancelledRef.current) { return; }
            setHealthStates(results);
        };

        void poll();
        const id = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        return () => {
            cancelledRef.current = true;
            clearInterval(id);
        };
    }, [servers]);

    return healthStates;
}

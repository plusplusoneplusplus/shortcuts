/**
 * useRemoteServerHealth — polls each remote CoC server for `/api/health` and
 * `/api/admin/version` every 30 seconds and returns typed `ServerHealthState[]`.
 *
 * All requests are cross-origin `fetch()` calls (no `cocClient` helper) because
 * each remote runs at a different origin (e.g. devtunnel URLs).
 *
 * Note on `servers` identity: this hook re-runs the polling effect when the
 * `servers` reference changes. Callers should stabilize the array (with
 * `useMemo` or a module-level constant) to avoid restarting the timer on every
 * render.
 */

import { useState, useEffect, useRef } from 'react';
import type { RemoteServer } from '../utils/serverRegistry';

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface ServerHealthState {
    server: RemoteServer;
    status: 'checking' | 'online' | 'offline';
    /** From `/api/admin/version` response. */
    version?: string;
    /** From `/api/admin/version` response. */
    commit?: string;
    /** Best-effort hostname from `/api/admin/config`. */
    serverName?: string;
    /** From `/api/health` response (process uptime in seconds). */
    uptime?: number;
    /** From `/api/health` response. */
    processCount?: number;
    /** Date.now() after the most recent poll attempt. */
    lastChecked?: number;
    /** Last fetch error message when offline. */
    error?: string;
}

async function fetchServerName(serverUrl: string): Promise<string | undefined> {
    try {
        const res = await fetch(`${serverUrl}/api/admin/config`);
        if (!res.ok) { return undefined; }
        const body = await res.json();
        const hostname = body?.hostname ?? body?.resolved?.hostname;
        return typeof hostname === 'string' ? hostname : undefined;
    } catch {
        return undefined;
    }
}

async function checkServer(server: RemoteServer): Promise<ServerHealthState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const [healthRes, versionRes] = await Promise.all([
            fetch(`${server.url}/api/health`, { signal: controller.signal }),
            fetch(`${server.url}/api/admin/version`, { signal: controller.signal }),
        ]);
        clearTimeout(timer);
        if (!healthRes.ok || !versionRes.ok) {
            const status = !healthRes.ok ? healthRes.status : versionRes.status;
            return {
                server,
                status: 'offline',
                lastChecked: Date.now(),
                error: `HTTP ${status}`,
            };
        }
        const health = await healthRes.json();
        const ver = await versionRes.json();
        const serverName = await fetchServerName(server.url);
        return {
            server,
            status: 'online',
            uptime: typeof health?.uptime === 'number' ? health.uptime : undefined,
            processCount: typeof health?.processCount === 'number' ? health.processCount : undefined,
            version: typeof ver?.version === 'string' ? ver.version : undefined,
            commit: typeof ver?.commit === 'string' ? ver.commit : undefined,
            serverName,
            lastChecked: Date.now(),
        };
    } catch (e) {
        clearTimeout(timer);
        return {
            server,
            status: 'offline',
            lastChecked: Date.now(),
            error: e instanceof Error ? e.message : 'Unknown error',
        };
    }
}

export function useRemoteServerHealth(servers: RemoteServer[]): ServerHealthState[] {
    const [healthStates, setHealthStates] = useState<ServerHealthState[]>(
        () => servers.map(s => ({ server: s, status: 'checking' as const })),
    );
    const cancelledRef = useRef(false);

    useEffect(() => {
        cancelledRef.current = false;
        setHealthStates(servers.map(s => ({ server: s, status: 'checking' as const })));

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

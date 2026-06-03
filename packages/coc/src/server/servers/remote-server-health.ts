import type { RemoteServerHealth, RemoteServerKind } from './remote-server-types';

const FETCH_TIMEOUT_MS = 5_000;

interface HealthTarget {
    serverId: string;
    kind: RemoteServerKind;
    baseUrl?: string;
    tunnelId?: string;
    localPort?: number;
    publicUrl?: string;
    lastError?: string;
}

async function fetchOptionalServerName(baseUrl: string): Promise<string | undefined> {
    try {
        const res = await fetch(`${baseUrl}/api/admin/config`);
        if (!res.ok) {
            return undefined;
        }
        const body = await res.json() as { hostname?: unknown; resolved?: { hostname?: unknown } };
        const hostname = body.hostname ?? body.resolved?.hostname;
        return typeof hostname === 'string' ? hostname : undefined;
    } catch {
        return undefined;
    }
}

export async function checkRemoteServerHealth(target: HealthTarget): Promise<RemoteServerHealth> {
    const lastChecked = Date.now();
    if (!target.baseUrl) {
        return {
            serverId: target.serverId,
            kind: target.kind,
            status: 'offline',
            tunnelId: target.tunnelId,
            localPort: target.localPort,
            publicUrl: target.publicUrl,
            lastChecked,
            error: target.lastError ?? 'No effective endpoint is available',
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const [healthRes, versionRes] = await Promise.all([
            fetch(`${target.baseUrl}/api/health`, { signal: controller.signal }),
            fetch(`${target.baseUrl}/api/admin/version`, { signal: controller.signal }),
        ]);
        clearTimeout(timer);
        if (!healthRes.ok || !versionRes.ok) {
            const status = !healthRes.ok ? healthRes.status : versionRes.status;
            return {
                serverId: target.serverId,
                kind: target.kind,
                status: 'offline',
                effectiveUrl: target.baseUrl,
                tunnelId: target.tunnelId,
                localPort: target.localPort,
                publicUrl: target.publicUrl,
                lastChecked: Date.now(),
                error: `HTTP ${status}`,
            };
        }

        const health = await healthRes.json() as { uptime?: unknown; processCount?: unknown };
        const version = await versionRes.json() as { version?: unknown; commit?: unknown };
        const serverName = await fetchOptionalServerName(target.baseUrl);
        return {
            serverId: target.serverId,
            kind: target.kind,
            status: 'online',
            effectiveUrl: target.baseUrl,
            version: typeof version.version === 'string' ? version.version : undefined,
            commit: typeof version.commit === 'string' ? version.commit : undefined,
            serverName,
            uptime: typeof health.uptime === 'number' ? health.uptime : undefined,
            processCount: typeof health.processCount === 'number' ? health.processCount : undefined,
            tunnelId: target.tunnelId,
            localPort: target.localPort,
            publicUrl: target.publicUrl,
            lastChecked: Date.now(),
        };
    } catch (error) {
        clearTimeout(timer);
        return {
            serverId: target.serverId,
            kind: target.kind,
            status: 'offline',
            effectiveUrl: target.baseUrl,
            tunnelId: target.tunnelId,
            localPort: target.localPort,
            publicUrl: target.publicUrl,
            lastChecked: Date.now(),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

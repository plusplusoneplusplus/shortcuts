import { getApiBase } from './config';

const LEGACY_REGISTRY_KEY = 'coc-remote-servers';
const MIGRATION_DONE_KEY = 'coc-remote-servers-api-migrated';

export type RemoteServerKind = 'url' | 'devtunnel';
export type RemoteServerRuntimeStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'failed';

export interface BaseRemoteServer {
    id: string;
    label: string;
    kind: RemoteServerKind;
    addedAt: number;
    updatedAt: number;
    effectiveUrl?: string;
    status?: RemoteServerRuntimeStatus;
    localPort?: number;
    publicUrl?: string;
    lastChecked?: number;
    lastError?: string;
}

export interface UrlRemoteServer extends BaseRemoteServer {
    kind: 'url';
    url: string;
}

export interface DevTunnelRemoteServer extends BaseRemoteServer {
    kind: 'devtunnel';
    tunnelId: string;
}

export type RemoteServer = UrlRemoteServer | DevTunnelRemoteServer;

export type RemoteServerInput =
    | { kind: 'url'; label: string; url: string }
    | { kind: 'devtunnel'; label: string; tunnelId: string };

export type RemoteServerPatch =
    | { label?: string; kind?: 'url'; url?: string }
    | { label?: string; kind?: 'devtunnel'; tunnelId?: string };

export interface RemoteServerHealth {
    serverId: string;
    status: 'checking' | 'online' | 'offline';
    kind: RemoteServerKind;
    effectiveUrl?: string;
    version?: string;
    commit?: string;
    serverName?: string;
    uptime?: number;
    processCount?: number;
    tunnelId?: string;
    localPort?: number;
    publicUrl?: string;
    lastChecked: number;
    error?: string;
}

interface LegacyRemoteServer {
    id?: string;
    label?: string;
    url?: string;
    addedAt?: number;
}

let migrationPromise: Promise<void> | undefined;

function apiUrl(path: string): string {
    return `${getApiBase()}${path}`;
}

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

async function readJson<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${res.status}`;
        throw new Error(message);
    }
    return body as T;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(apiUrl(path), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
    return readJson<T>(res);
}

async function fetchRemoteServersWithoutMigration(): Promise<RemoteServer[]> {
    return requestJson<RemoteServer[]>('/servers');
}

function loadLegacyServers(): LegacyRemoteServer[] {
    try {
        const raw = localStorage.getItem(LEGACY_REGISTRY_KEY);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is LegacyRemoteServer => {
            return typeof item === 'object'
                && item !== null
                && typeof (item as LegacyRemoteServer).url === 'string'
                && typeof (item as LegacyRemoteServer).label === 'string';
        }) : [];
    } catch {
        return [];
    }
}

async function migrateLegacyRemoteServers(): Promise<void> {
    try {
        if (localStorage.getItem(MIGRATION_DONE_KEY) === 'true') {
            return;
        }
    } catch {
        return;
    }

    const legacy = loadLegacyServers();
    if (legacy.length === 0) {
        try {
            localStorage.setItem(MIGRATION_DONE_KEY, 'true');
        } catch {
            // If localStorage is unavailable, retrying the no-op migration on next load is safe.
        }
        return;
    }

    const existing = await fetchRemoteServersWithoutMigration();
    const existingUrls = new Set(existing.filter((s): s is UrlRemoteServer => s.kind === 'url').map(s => stripTrailingSlash(s.url)));
    for (const server of legacy) {
        const url = stripTrailingSlash(server.url!.trim());
        if (!url || existingUrls.has(url)) {
            continue;
        }
        await addRemoteServerWithoutMigration({
            kind: 'url',
            label: server.label!.trim() || url,
            url,
        });
        existingUrls.add(url);
    }

    try {
        localStorage.setItem(MIGRATION_DONE_KEY, 'true');
    } catch {
        // A failed marker write means the migration may retry next load.
    }
}

async function ensureMigrated(): Promise<void> {
    if (!migrationPromise) {
        migrationPromise = migrateLegacyRemoteServers().finally(() => {
            migrationPromise = undefined;
        });
    }
    await migrationPromise;
}

async function addRemoteServerWithoutMigration(input: RemoteServerInput): Promise<RemoteServer> {
    return requestJson<RemoteServer>('/servers', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function listRemoteServers(): Promise<RemoteServer[]> {
    await ensureMigrated();
    return fetchRemoteServersWithoutMigration();
}

export async function getRemoteServers(): Promise<RemoteServer[]> {
    return listRemoteServers();
}

export async function addRemoteServer(input: RemoteServerInput): Promise<RemoteServer> {
    await ensureMigrated();
    return addRemoteServerWithoutMigration(input);
}

export async function updateRemoteServer(id: string, patch: RemoteServerPatch): Promise<RemoteServer> {
    await ensureMigrated();
    return requestJson<RemoteServer>(`/servers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
}

export async function removeRemoteServer(id: string): Promise<void> {
    await ensureMigrated();
    await requestJson<{ ok: true }>(`/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testRemoteServer(input: RemoteServerInput): Promise<RemoteServerHealth> {
    return requestJson<RemoteServerHealth>('/servers/test', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function getServerEndpoint(server: RemoteServer): string | undefined {
    return server.kind === 'url' ? server.url : server.effectiveUrl;
}

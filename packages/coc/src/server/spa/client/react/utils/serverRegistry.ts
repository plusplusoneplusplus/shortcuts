import { getSpaCocClient } from '../api/cocClient';

export type {
    RemoteServerKind,
    RemoteServerRuntimeStatus,
    BaseRemoteServer,
    UrlRemoteServer,
    DevTunnelRemoteServer,
    RemoteServer,
    RemoteServerInput,
    RemoteServerPatch,
    RemoteServerHealth,
    RemoteServerRuntime,
    RemoteServerRestartResponse,
} from '@plusplusoneplusplus/coc-client';

import type { RemoteServer, RemoteServerHealth, RemoteServerInput, RemoteServerPatch, RemoteServerRestartResponse, RemoteServerRuntime, UrlRemoteServer } from '@plusplusoneplusplus/coc-client';

const LEGACY_REGISTRY_KEY = 'coc-remote-servers';
const MIGRATION_DONE_KEY = 'coc-remote-servers-api-migrated';

interface LegacyRemoteServer {
    id?: string;
    label?: string;
    url?: string;
    addedAt?: number;
}

let migrationPromise: Promise<void> | undefined;

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

async function fetchRemoteServersWithoutMigration(): Promise<RemoteServer[]> {
    return getSpaCocClient().servers.list();
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
    return getSpaCocClient().servers.add(input);
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
    return getSpaCocClient().servers.update(id, patch);
}

export async function removeRemoteServer(id: string): Promise<void> {
    await ensureMigrated();
    await getSpaCocClient().servers.remove(id);
}

export async function testRemoteServer(input: RemoteServerInput): Promise<RemoteServerHealth> {
    return getSpaCocClient().servers.test(input);
}

export async function reconnectServer(id: string): Promise<RemoteServerRuntime> {
    return getSpaCocClient().servers.reconnect(id);
}

export async function restartServer(id: string): Promise<RemoteServerRestartResponse> {
    return getSpaCocClient().servers.restart(id);
}

export function getServerEndpoint(server: RemoteServer): string | undefined {
    return server.kind === 'url' ? server.url : server.effectiveUrl;
}

/**
 * Remote workspace aggregation (AC-01).
 *
 * Folds workspaces from SSH/devtunnel-connected remote CoC servers into the
 * local repo data flow. For each ONLINE remote server we fetch its
 * `/api/workspaces` + git-info batch DIRECTLY at the server's `effectiveUrl`
 * (the already-forwarded `http://127.0.0.1:{localPort}`), tag every workspace
 * with `{ baseUrl, serverId, serverLabel }` plus a remote marker, and merge the
 * result with the local list. Offline / unreachable servers contribute their
 * LAST-KNOWN list from a persisted cache, each entry flagged `offline`.
 *
 * Routing seam (IMMUTABLE): a remote workspace carries `baseUrl` (= the server's
 * effectiveUrl); local workspaces have none. There are NO composite workspace
 * IDs and NO new serverId namespace — `baseUrl` is the routing key, `serverId`
 * is referenced for persistence/caching only.
 *
 * The remote fetch here is intentionally self-contained (a small CocClient bound
 * to `effectiveUrl`); it does NOT re-plumb the shared SPA client (AC-03 owns
 * per-clone request routing).
 */

import {
    CocClient,
    type GitInfoResponse,
    type RemoteServer,
    type WorkspaceInfo,
    type WorkspacesResponse,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';
import { isRemoteShellEnabled } from '../utils/config';
import {
    loadRemoteWorkspaceCache,
    saveRemoteWorkspaceCacheEntry,
} from './remoteWorkspaceCache';

/** Per-remote routing + provenance attached to every aggregated remote workspace. */
export interface RemoteWorkspaceMarker {
    /** Routing key: the remote server's effectiveUrl (e.g. http://127.0.0.1:4000). */
    baseUrl: string;
    /** Stable registry id of the contributing server (persistence/caching only). */
    serverId: string;
    /** Human-readable server label for badges/grouping. */
    serverLabel: string;
    /** True when this entry came from cache because the server is offline/unreachable. */
    offline: boolean;
}

/**
 * A workspace tagged as remote. The marker lives under the `remote` key so
 * downstream code (AC-03/04/05) can reliably tell remote from local: local
 * workspaces never carry `remote` / `baseUrl`.
 */
export type RemoteWorkspaceInfo = WorkspaceInfo & {
    /** Present on remote workspaces only; absent on local ones. */
    remote: RemoteWorkspaceMarker;
    /** Convenience mirror of `remote.baseUrl` (the routing key). */
    baseUrl: string;
};

/** Per-server git-info results keyed by remote workspace id. */
export type RemoteGitInfoMap = Record<string, GitInfoResponse | null>;

export interface RemoteWorkspaceSource {
    serverId: string;
    serverLabel: string;
    baseUrl: string;
    /** Whether the contributed workspaces are live (online) or cached (offline). */
    online: boolean;
    workspaces: RemoteWorkspaceInfo[];
    /** git-info keyed by remote workspace id; empty for offline (cached) sources. */
    gitInfo: RemoteGitInfoMap;
}

export interface AggregatedRemoteWorkspaces {
    sources: RemoteWorkspaceSource[];
    /** Flat list of all tagged remote workspaces across every source. */
    workspaces: RemoteWorkspaceInfo[];
    /** Merged git-info across all online sources, keyed by remote workspace id. */
    gitInfo: RemoteGitInfoMap;
    /** Non-fatal per-server problems (e.g. fetch failures) for surfacing/logging. */
    warnings: string[];
}

const EMPTY_AGGREGATE: AggregatedRemoteWorkspaces = {
    sources: [],
    workspaces: [],
    gitInfo: {},
    warnings: [],
};

/** True when a remote workspace (carries a `remote` marker / `baseUrl`). */
export function isRemoteWorkspace(workspace: unknown): workspace is RemoteWorkspaceInfo {
    return (
        typeof workspace === 'object' &&
        workspace !== null &&
        typeof (workspace as { baseUrl?: unknown }).baseUrl === 'string' &&
        typeof (workspace as { remote?: unknown }).remote === 'object' &&
        (workspace as { remote?: unknown }).remote !== null
    );
}

/**
 * Tag a server's raw workspace list with its remote marker. Pure: no I/O.
 * `offline` flags entries served from cache for an unreachable server.
 */
export function tagRemoteWorkspaces(
    server: Pick<RemoteServer, 'id' | 'label'>,
    baseUrl: string,
    workspaces: WorkspaceInfo[],
    offline: boolean,
): RemoteWorkspaceInfo[] {
    const serverLabel = server.label || server.id;
    return workspaces.map(workspace => ({
        ...workspace,
        baseUrl,
        remote: {
            baseUrl,
            serverId: server.id,
            serverLabel,
            offline,
        },
    }));
}

/** Whether a server is currently connected (online) with a reachable base URL. */
function isServerOnline(server: RemoteServer): server is RemoteServer & { effectiveUrl: string } {
    return server.status === 'online' && typeof server.effectiveUrl === 'string' && server.effectiveUrl.length > 0;
}

function normalizeWorkspacesResponse(response: WorkspacesResponse | WorkspaceInfo[]): WorkspaceInfo[] {
    if (Array.isArray(response)) {
        return response;
    }
    return Array.isArray(response?.workspaces) ? response.workspaces : [];
}

/** Build an offline source from the last-known cache for a server, or null when nothing is cached. */
function offlineSourceFromCache(
    server: RemoteServer,
    cache: ReturnType<typeof loadRemoteWorkspaceCache>,
): RemoteWorkspaceSource | null {
    const cached = cache[server.id];
    if (!cached || cached.workspaces.length === 0) {
        return null;
    }
    // Prefer the server's current effectiveUrl, else the cached one used last time.
    const baseUrl = server.effectiveUrl || cached.baseUrl;
    return {
        serverId: server.id,
        serverLabel: server.label || server.id,
        baseUrl,
        online: false,
        workspaces: tagRemoteWorkspaces(server, baseUrl, cached.workspaces, true),
        gitInfo: {},
    };
}

/**
 * Fetch + tag one online server's workspaces (and git-info batch) directly at
 * its effectiveUrl, and refresh its cache entry. On failure, fall back to the
 * cached (offline-flagged) list so a transient error never drops the server.
 */
async function loadOnlineSource(
    server: RemoteServer & { effectiveUrl: string },
    cache: ReturnType<typeof loadRemoteWorkspaceCache>,
): Promise<{ source?: RemoteWorkspaceSource; warning?: string }> {
    const serverLabel = server.label || server.id;
    const baseUrl = server.effectiveUrl;
    try {
        const remoteClient = new CocClient({ baseUrl, fetch, timeoutMs: 15_000 });
        const rawWorkspaces = normalizeWorkspacesResponse(await remoteClient.workspaces.list());
        const visible = rawWorkspaces.filter(ws => !ws.virtual);
        const gitInfo: RemoteGitInfoMap = visible.length > 0
            ? (await remoteClient.workspaces.gitInfoBatch(visible.map(ws => ws.id))).results ?? {}
            : {};

        // Persist the raw (untagged) list so a later offline load can re-tag it.
        saveRemoteWorkspaceCacheEntry(server.id, { baseUrl, workspaces: visible });

        return {
            source: {
                serverId: server.id,
                serverLabel,
                baseUrl,
                online: true,
                workspaces: tagRemoteWorkspaces(server, baseUrl, visible, false),
                gitInfo,
            },
        };
    } catch (error) {
        const offline = offlineSourceFromCache(server, cache);
        const reason = error instanceof Error ? error.message : 'failed to load remote workspaces';
        if (offline) {
            return { source: offline, warning: `${serverLabel}: ${reason} (showing cached)` };
        }
        return { warning: `${serverLabel}: ${reason}` };
    }
}

/**
 * Aggregate remote workspaces across all configured servers.
 *
 * Online servers are fetched live (and cached); offline/unreachable servers
 * yield their last-known cached entries flagged `offline`. Returns an empty
 * aggregate (no work, no warnings) when `features.remoteShell` is OFF, so the
 * classic flow is byte-for-byte unchanged.
 */
export async function aggregateRemoteWorkspaces(): Promise<AggregatedRemoteWorkspaces> {
    if (!isRemoteShellEnabled()) {
        return EMPTY_AGGREGATE;
    }

    let servers: RemoteServer[];
    try {
        servers = await getSpaCocClient().servers.list();
    } catch {
        // Registry unavailable: nothing to aggregate. Local flow is unaffected.
        return EMPTY_AGGREGATE;
    }

    const cache = loadRemoteWorkspaceCache();

    const results = await Promise.all(servers.map(async (server): Promise<{ source?: RemoteWorkspaceSource; warning?: string }> => {
        if (isServerOnline(server)) {
            return loadOnlineSource(server, cache);
        }
        const offline = offlineSourceFromCache(server, cache);
        return offline ? { source: offline } : {};
    }));

    const sources = results.flatMap(result => (result.source ? [result.source] : []));
    const warnings = results.flatMap(result => (result.warning ? [result.warning] : []));

    const workspaces: RemoteWorkspaceInfo[] = [];
    const gitInfo: RemoteGitInfoMap = {};
    for (const source of sources) {
        workspaces.push(...source.workspaces);
        Object.assign(gitInfo, source.gitInfo);
    }

    return { sources, workspaces, gitInfo, warnings };
}

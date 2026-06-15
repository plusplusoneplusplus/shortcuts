/**
 * Last-known remote workspace cache (AC-01).
 *
 * Persists the per-server workspace list so offline / unreachable servers can
 * still contribute their last-known clones (flagged offline) to the dashboard.
 *
 * Two-layer, matching the existing dashboard pattern (see serverRegistry.ts /
 * ReposGrid.tsx): an in-memory map (fast, survives within a session even when
 * localStorage is unavailable) backed by localStorage for cross-reload
 * persistence. Keyed by the stable registry `serverId` — robust to devtunnel
 * port reassignment, since the cached `baseUrl` is only a fallback.
 */

import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';

const CACHE_KEY = 'coc-remote-workspace-cache';

export interface RemoteWorkspaceCacheEntry {
    /** The effectiveUrl the workspaces were last fetched from. */
    baseUrl: string;
    /** Last-known raw (untagged) workspace list for the server. */
    workspaces: WorkspaceInfo[];
    /** Epoch ms of the last successful refresh. */
    updatedAt: number;
}

export type RemoteWorkspaceCache = Record<string, RemoteWorkspaceCacheEntry>;

/** Session-scoped mirror; the source of truth when localStorage is unavailable. */
let memoryCache: RemoteWorkspaceCache | null = null;

function isCacheEntry(value: unknown): value is RemoteWorkspaceCacheEntry {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as RemoteWorkspaceCacheEntry).baseUrl === 'string' &&
        Array.isArray((value as RemoteWorkspaceCacheEntry).workspaces)
    );
}

function readFromStorage(): RemoteWorkspaceCache {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== 'object' || parsed === null) return {};
        const out: RemoteWorkspaceCache = {};
        for (const [serverId, entry] of Object.entries(parsed as Record<string, unknown>)) {
            if (isCacheEntry(entry)) {
                out[serverId] = entry;
            }
        }
        return out;
    } catch {
        // SSR / test / quota — fall back to whatever is in memory.
        return {};
    }
}

function writeToStorage(cache: RemoteWorkspaceCache): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
        // SSR / test / quota — in-memory copy still serves this session.
    }
}

/** Load the full cache (in-memory mirror seeded from localStorage on first read). */
export function loadRemoteWorkspaceCache(): RemoteWorkspaceCache {
    if (!memoryCache) {
        memoryCache = readFromStorage();
    }
    return memoryCache;
}

/** Upsert one server's last-known list. Stamps `updatedAt` and persists. */
export function saveRemoteWorkspaceCacheEntry(
    serverId: string,
    entry: { baseUrl: string; workspaces: WorkspaceInfo[] },
): void {
    const cache = loadRemoteWorkspaceCache();
    cache[serverId] = {
        baseUrl: entry.baseUrl,
        workspaces: entry.workspaces,
        updatedAt: Date.now(),
    };
    writeToStorage(cache);
}

/** Reset both layers. Exposed for tests. @internal */
export function _resetRemoteWorkspaceCache(): void {
    memoryCache = null;
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch {
        // ignore
    }
}

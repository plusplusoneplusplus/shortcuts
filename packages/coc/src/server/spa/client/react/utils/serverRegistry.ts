/**
 * Remote server registry — localStorage-backed CRUD for `RemoteServer` entries
 * that the Servers page polls for health/version metadata.
 *
 * No React dependency: this module is plain TypeScript so it can be reused by
 * non-React callers and is trivially testable. All `localStorage` access is
 * wrapped in try/catch so private-mode browsers, quota-exceeded errors, and
 * stripped storage APIs degrade silently.
 */

const REGISTRY_KEY = 'coc-remote-servers';

export interface RemoteServer {
    /** Stable opaque identifier (crypto.randomUUID() when available). */
    id: string;
    /** User-provided friendly name shown in the UI. */
    label: string;
    /** Base URL of the remote CoC server (no trailing slash). */
    url: string;
    /** Date.now() at creation time. */
    addedAt: number;
}

function loadAll(): RemoteServer[] {
    try {
        const raw = localStorage.getItem(REGISTRY_KEY);
        return raw ? (JSON.parse(raw) as RemoteServer[]) : [];
    } catch {
        return [];
    }
}

function saveAll(servers: RemoteServer[]): void {
    try {
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(servers));
    } catch {
        // storage quota or private-mode — silently ignore
    }
}

function stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function generateId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // fall through to timestamp fallback
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getRemoteServers(): RemoteServer[] {
    return loadAll();
}

export function addRemoteServer(fields: Omit<RemoteServer, 'id' | 'addedAt'>): RemoteServer {
    const entry: RemoteServer = {
        id: generateId(),
        label: fields.label,
        url: stripTrailingSlash(fields.url),
        addedAt: Date.now(),
    };
    const next = [...loadAll(), entry];
    saveAll(next);
    return entry;
}

export function removeRemoteServer(id: string): void {
    const next = loadAll().filter(s => s.id !== id);
    saveAll(next);
}

export function updateRemoteServer(
    id: string,
    patch: Partial<Pick<RemoteServer, 'label' | 'url'>>,
): void {
    const next = loadAll().map(s => {
        if (s.id !== id) { return s; }
        const merged: RemoteServer = { ...s };
        if (patch.label !== undefined) { merged.label = patch.label; }
        if (patch.url !== undefined) { merged.url = stripTrailingSlash(patch.url); }
        return merged;
    });
    saveAll(next);
}

/**
 * Workspace directory — one listing of the repos and repo groups this server
 * can reach: its own registry plus every registered remote CoC server's.
 *
 * Remote repos are addressed by the dashboard's clone key
 * `remote:<serverId>:<workspaceId>` and fetched from each remote's own
 * `/api/workspaces` (and `/api/repo-groups/:id` for group members) at its
 * effective base URL — the same REST surface the SPA's remote workspace
 * aggregation reads. Each remote gets a short per-request timeout; an
 * unreachable server never fails the listing and reports its last-known repos
 * (cached in memory) flagged `online: false`.
 *
 * Starting a chat on a remote uses that remote's normal `POST /api/queue` (or
 * `POST /api/ralph-launch`) with no local fallback.
 *
 * Output is deliberately minimal: names, IDs, server display name/kind and
 * reachability. No paths, URLs, hosts, tunnel IDs or credentials.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createCache, type CacheHandle } from '../cache';
import { isRepoGroupWorkspaceId, readRepoGroup } from '../workspaces/repo-group-workspace';
import type { RemoteServerKind, RemoteServerWithRuntime } from './remote-server-types';

// ============================================================================
// Types
// ============================================================================

export type WorkspaceServerKind = 'local' | RemoteServerKind;

/** Display name used for this server in directory output and `name@server`. */
export const LOCAL_SERVER_NAME = 'local';

export interface WorkspaceDirectoryMember {
    id: string;
    name: string;
}

export interface WorkspaceDirectoryEntry {
    /** Local workspace ID, or `remote:<serverId>:<workspaceId>` for remote repos. */
    id: string;
    name: string;
    type: 'repo' | 'group';
    /** Server display name (`local` for this server). */
    server: string;
    serverKind: WorkspaceServerKind;
    online: boolean;
    /** Repo groups only. Member IDs use the same addressing as `id`. */
    members?: WorkspaceDirectoryMember[];
}

export interface WorkspaceDirectoryServer {
    server: string;
    serverKind: WorkspaceServerKind;
    online: boolean;
}

export interface WorkspaceDirectoryListing {
    entries: WorkspaceDirectoryEntry[];
    servers: WorkspaceDirectoryServer[];
}

export interface RemoteChatRequest {
    serverId: string;
    /** `queue` → `POST /api/queue`; `ralph` → `POST /api/ralph-launch`. */
    kind: 'queue' | 'ralph';
    body: Record<string, unknown>;
}

export interface RemoteChatResult {
    /** Remote process id (queue-prefixed for queue tasks). */
    processId: string;
    /** Ralph only. */
    sessionId?: string;
}

export interface WorkspaceDirectory {
    list(): Promise<WorkspaceDirectoryListing>;
    /** Start a chat on a remote server. Throws an Error with a model-facing message. */
    startRemoteChat(request: RemoteChatRequest): Promise<RemoteChatResult>;
}

/** The slice of `RemoteServerRuntimeService` the directory needs. */
export interface RemoteServerSource {
    list(): RemoteServerWithRuntime[];
}

export interface WorkspaceDirectoryOptions {
    store: ProcessStore;
    dataDir?: string;
    remoteServers?: RemoteServerSource;
    /** Per-request timeout for listing calls. Default 4s. */
    listTimeoutMs?: number;
    /** Per-request timeout for starting a remote chat. Default 15s. */
    startTimeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Override the shared last-known remote cache (tests). */
    lastKnownCache?: CacheHandle<WorkspaceDirectoryEntry[]>;
}

// ============================================================================
// Clone keys (server-side mirror of the SPA's repos/cloneIdentity.ts)
// ============================================================================

const REMOTE_CLONE_KEY_PREFIX = 'remote:';

export function buildRemoteCloneKey(serverId: string, workspaceId: string): string {
    return `${REMOTE_CLONE_KEY_PREFIX}${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
}

export function parseRemoteCloneKey(value: string | undefined): { serverId: string; workspaceId: string } | null {
    if (!value?.startsWith(REMOTE_CLONE_KEY_PREFIX)) return null;
    const encoded = value.slice(REMOTE_CLONE_KEY_PREFIX.length);
    const separator = encoded.indexOf(':');
    if (separator <= 0 || separator === encoded.length - 1) return null;
    try {
        const serverId = decodeURIComponent(encoded.slice(0, separator));
        const workspaceId = decodeURIComponent(encoded.slice(separator + 1));
        return serverId && workspaceId ? { serverId, workspaceId } : null;
    } catch {
        return null;
    }
}

/** Dashboard deep link to a chat; remote chats route through their clone key. */
export function buildChatOpenLink(workspaceSelectionId: string, processId: string): string {
    return `#repos/${encodeURIComponent(workspaceSelectionId)}/chats/${encodeURIComponent(processId)}`;
}

// ============================================================================
// Implementation
// ============================================================================

interface RawWorkspace {
    id: string;
    name?: string;
    virtual?: boolean;
}

const DEFAULT_LIST_TIMEOUT_MS = 4_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;

/** The remote answered with a non-2xx status. */
// Last-known remote entries per server id, served while a server is unreachable.
// Module-level so per-turn local-only directories never allocate a handle.
let sharedLastKnown: CacheHandle<WorkspaceDirectoryEntry[]> | undefined;
function getSharedLastKnownCache(): CacheHandle<WorkspaceDirectoryEntry[]> {
    sharedLastKnown ??= createCache({ namespace: 'workspace-directory-remote-last-known', immutable: true, maxSize: 200 });
    return sharedLastKnown;
}

class RemoteRejectedError extends Error {}

function serverName(server: RemoteServerWithRuntime): string {
    return server.label || server.id;
}

export function createWorkspaceDirectory(options: WorkspaceDirectoryOptions): WorkspaceDirectory {
    const fetchImpl = options.fetchImpl ?? fetch;
    const listTimeoutMs = options.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
    const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    const lastKnown = options.lastKnownCache ?? getSharedLastKnownCache();

    async function requestJson(
        url: string,
        timeoutMs: number,
        init?: { method: 'POST'; body: unknown },
    ): Promise<any> {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error(`timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            timer.unref?.();
        });
        try {
            const res = await Promise.race([
                fetchImpl(url, {
                    signal: controller.signal,
                    ...(init
                        ? { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
                        : {}),
                }),
                timeout,
            ]);
            const text = await Promise.race([res.text(), timeout]);
            let body: any;
            try {
                body = text ? JSON.parse(text) : undefined;
            } catch {
                body = undefined;
            }
            if (!res.ok) {
                const message = typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`;
                throw new RemoteRejectedError(message);
            }
            return body;
        } finally {
            clearTimeout(timer);
        }
    }

    function listLocal(workspaces: RawWorkspace[]): WorkspaceDirectoryEntry[] {
        const names = new Map(workspaces.map(ws => [ws.id, ws.name || ws.id]));
        const entries: WorkspaceDirectoryEntry[] = [];
        for (const ws of workspaces) {
            const base = { id: ws.id, name: ws.name || ws.id, server: LOCAL_SERVER_NAME, serverKind: 'local' as const, online: true };
            if (isRepoGroupWorkspaceId(ws.id)) {
                const file = options.dataDir ? readRepoGroup(options.dataDir, ws.id) : undefined;
                entries.push({
                    ...base,
                    type: 'group',
                    members: (file?.members ?? []).map(id => ({ id, name: names.get(id) ?? id })),
                });
            } else if (!ws.virtual) {
                entries.push({ ...base, type: 'repo' });
            }
        }
        return entries;
    }

    async function listRemote(server: RemoteServerWithRuntime): Promise<WorkspaceDirectoryEntry[]> {
        const baseUrl = server.effectiveUrl;
        if (!baseUrl) throw new Error('no reachable endpoint');
        const body = await requestJson(`${baseUrl}/api/workspaces`, listTimeoutMs);
        const workspaces: RawWorkspace[] = Array.isArray(body?.workspaces) ? body.workspaces : Array.isArray(body) ? body : [];
        const names = new Map(workspaces.map(ws => [ws.id, ws.name || ws.id]));
        const base = { server: serverName(server), serverKind: server.kind, online: true };
        return Promise.all(workspaces
            .filter(ws => typeof ws?.id === 'string' && (isRepoGroupWorkspaceId(ws.id) || !ws.virtual))
            .map(async (ws): Promise<WorkspaceDirectoryEntry> => {
                const entry = { ...base, id: buildRemoteCloneKey(server.id, ws.id), name: ws.name || ws.id };
                if (!isRepoGroupWorkspaceId(ws.id)) return { ...entry, type: 'repo' };
                let memberIds: string[] = [];
                try {
                    const group = await requestJson(`${baseUrl}/api/repo-groups/${encodeURIComponent(ws.id)}`, listTimeoutMs);
                    memberIds = Array.isArray(group?.members)
                        ? group.members.map((m: { workspaceId?: unknown }) => m?.workspaceId).filter((id: unknown): id is string => typeof id === 'string')
                        : [];
                } catch {
                    // Members are best-effort; the group itself stays listed.
                }
                return {
                    ...entry,
                    type: 'group',
                    members: memberIds.map(id => ({ id: buildRemoteCloneKey(server.id, id), name: names.get(id) ?? id })),
                };
            }));
    }

    return {
        async list() {
            const localWorkspaces = (await options.store.getWorkspaces()) as RawWorkspace[];
            const entries = listLocal(localWorkspaces);
            const servers: WorkspaceDirectoryServer[] = [{ server: LOCAL_SERVER_NAME, serverKind: 'local', online: true }];
            const remotes = options.remoteServers?.list() ?? [];
            const results = await Promise.all(remotes.map(async server => {
                try {
                    const remoteEntries = await listRemote(server);
                    lastKnown.set(server.id, remoteEntries);
                    return { server, online: true, entries: remoteEntries };
                } catch {
                    const cached = lastKnown.get(server.id) ?? [];
                    return {
                        server,
                        online: false,
                        entries: cached.map(entry => ({ ...entry, server: serverName(server), online: false })),
                    };
                }
            }));
            for (const result of results) {
                servers.push({ server: serverName(result.server), serverKind: result.server.kind, online: result.online });
                entries.push(...result.entries);
            }
            return { entries, servers };
        },

        async startRemoteChat(request) {
            const server = options.remoteServers?.list().find(s => s.id === request.serverId);
            if (!server) {
                throw new Error(`Remote server '${request.serverId}' is not registered. Call list_workspaces to see available repos.`);
            }
            const label = serverName(server);
            if (!server.effectiveUrl) {
                throw new Error(`Remote server "${label}" is offline (no reachable endpoint). The chat was not started.`);
            }
            const path = request.kind === 'ralph' ? '/api/ralph-launch' : '/api/queue';
            let body: any;
            try {
                body = await requestJson(`${server.effectiveUrl}${path}`, startTimeoutMs, { method: 'POST', body: request.body });
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                const prefix = err instanceof RemoteRejectedError ? `Remote server "${label}" rejected the request` : `Remote server "${label}" is unreachable`;
                throw new Error(`${prefix}: ${reason}. The chat was not started.`);
            }
            if (request.kind === 'ralph') {
                if (typeof body?.processId !== 'string') {
                    throw new Error(`Remote server "${label}" returned no processId for the Ralph launch.`);
                }
                return { processId: body.processId, ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}) };
            }
            const taskId = body?.task?.id;
            if (typeof taskId !== 'string' || !taskId) {
                throw new Error(`Remote server "${label}" returned no task id for the new chat.`);
            }
            return { processId: toQueueProcessId(taskId) };
        },
    };
}

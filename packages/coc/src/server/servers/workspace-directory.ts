import { stat } from 'node:fs/promises';
import { BranchService, resolvePathForHostFilesystem } from '@plusplusoneplusplus/forge';
import { remoteChatLaunchBody, remoteRalphLaunchBody } from '../delegation/remote-delegation-launch';

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

import type { ChatProvider } from '../tasks/task-types';
import type { ProcessIndexEntry, ProcessStore } from '@plusplusoneplusplus/forge';
import { resolveModelForProvider, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createCache, type CacheHandle } from '../cache';
import { isRepoGroupWorkspaceId, readRepoGroup } from '../workspaces/repo-group-workspace';
import type { RemoteServerKind, RemoteServerWithRuntime } from './remote-server-types';
import { resolveRecordedProvider } from '../processes/active-provider-session';

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
    /** Durable destination identity, separate from the connection alias. */
    serverIdentity?: string;
    /** Repo groups only. Member IDs use the same addressing as `id`. */
    members?: WorkspaceDirectoryMember[];
}

export interface WorkspaceDirectoryServer {
    /** Remote server id; absent for this server. */
    serverId?: string;
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
    resultOrigin?: import('../delegation/remote-delegation-return').RemoteResultOrigin;
}

export interface RemoteChatResult {
    serverIdentity: string;
    /** Remote process id (queue-prefixed for queue tasks). */
    processId: string;
    /** Ralph only. */
    sessionId?: string;
    resultDelivery?: import('../llm-tools/send-to-conversation-tool').TrackedResultDelivery | import('../delegation/remote-delegation-return').UnavailableRemoteResult;
}

export interface RemoteChatPostRequest {
    serverId: string;
    workspaceId: string;
    /** Exact process ID on the destination; never a connection-qualified ID. */
    processId: string;
    content: string;
    mode?: 'ask' | 'autopilot';
    model?: string;
    effortTier?: 'very-low' | 'low' | 'medium' | 'high';
    deliveryMode?: 'immediate' | 'enqueue' | 'steer';
    resultOrigin?: import('../delegation/remote-delegation-return').RemoteResultOrigin;
}

export interface RemoteChatPostResult {
    serverIdentity: string;
    processId: string;
    /** -1 means buffered; the destination appends the user turn when it drains. */
    turnIndex: number;
    resultDelivery?: import('../llm-tools/send-to-conversation-tool').TrackedResultDelivery | import('../delegation/remote-delegation-return').UnavailableRemoteResult;
}

export type RemoteChatDispatchState = 'not-started' | 'rejected' | 'uncertain';

/** Admission errors never imply that retrying execution is safe. */
export class RemoteChatAdmissionError extends Error {
    constructor(message: string, readonly dispatchState: RemoteChatDispatchState) {
        super(message);
        this.name = 'RemoteChatAdmissionError';
    }
}

/** One chat of a remote repo, as returned by the remote's `GET /api/processes`. */
export interface RemoteChatSummary {
    id: string;
    status?: string;
    title?: string;
    customTitle?: string;
    promptPreview?: string;
    /** ISO timestamps for the topic's relative age. */
    lastEventAt?: string;
    startTime?: string;
}

/** Internal read binding; never include endpoint details in tool output. */
export interface RemoteChatReadTarget {
    effectiveUrl: string;
    serverIdentity?: string;
}

export type WorkspaceGitSummary =
    | { state: 'clean' | 'dirty'; branch: string | null; detached?: true; ahead?: number; behind?: number }
    | { state: 'non-git' | 'unavailable' | 'unsupported' | 'offline' };

export interface WorkspaceGitTarget {
    id?: string;
    serverIdentity?: string;
    workspaceId?: string;
    online: boolean;
}

export interface WorkspaceDirectory {
    getGitSummary?(target: WorkspaceGitTarget, signal: AbortSignal): Promise<WorkspaceGitSummary>;
    list(): Promise<WorkspaceDirectoryListing>;
    isRemoteAutoProviderRoutingAvailable?(serverId: string): Promise<boolean>;
    validateRemoteProvider?(serverId: string, provider: ChatProvider): Promise<void>;
    /**
     * Most recent chats of one remote repo (remote store order). Throws
     * {@link RemoteServerOfflineError} when the server is unregistered or
     * unreachable, and a plain Error when it rejects the request.
     */
    listRemoteChats(serverId: string, workspaceId: string, limit: number): Promise<RemoteChatSummary[]>;
    /** Index-only metadata, bound to one endpoint/identity for the whole scan. */
    getRemoteChatSummaries?(serverId: string, workspaceId: string, filter: {
        limit: number; offset: number; since?: Date; until?: Date;
        serverIdentity?: string; target?: RemoteChatReadTarget;
    }): Promise<{ entries: ProcessIndexEntry[]; total: number; target: RemoteChatReadTarget }>;
    /** Start a chat on a remote server. Throws an Error with a model-facing message. */
    startRemoteChat(request: RemoteChatRequest): Promise<RemoteChatResult>;
    /** One follow-up through the destination's existing message-delivery API. */
    postRemoteChat?(request: RemoteChatPostRequest): Promise<RemoteChatPostResult>;
}

/** The slice of `RemoteServerRuntimeService` the directory needs. */
export interface RemoteServerSource {
    list(): RemoteServerWithRuntime[];
}

export interface WorkspaceDirectoryOptions {
    store: ProcessStore;
    serverIdentity?: string;
    dataDir?: string;
    remoteServers?: RemoteServerSource;
    /** Per-request timeout for listing calls. Default 4s. */
    listTimeoutMs?: number;
    /** Per-request timeout for starting a remote chat. Default 15s. */
    startTimeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Override the shared last-known remote cache (tests). */
    lastKnownCache?: CacheHandle<WorkspaceDirectoryEntry[]>;
    remoteResults?: Pick<import('../delegation/remote-delegation-return').RemoteDelegationReturn, 'dispatch'>;
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

/** The stable Ralph session view, valid across every iteration of the session. */
export function buildRalphSessionOpenLink(workspaceSelectionId: string, sessionId: string): string {
    return `#repos/${encodeURIComponent(workspaceSelectionId)}/chats/ralph/${encodeURIComponent(sessionId)}`;
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

// Last-known remote entries per server id, served while a server is unreachable.
// Module-level so per-turn local-only directories never allocate a handle.
let sharedLastKnown: CacheHandle<WorkspaceDirectoryEntry[]> | undefined;
function getSharedLastKnownCache(): CacheHandle<WorkspaceDirectoryEntry[]> {
    sharedLastKnown ??= createCache({ namespace: 'workspace-directory-remote-last-known', immutable: true, maxSize: 200 });
    return sharedLastKnown;
}

/** The remote answered with a non-2xx status; a server error can follow admission. */
class RemoteRejectedError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

/** The remote server has no reachable endpoint or did not answer in time. */
export class RemoteServerOfflineError extends Error {
    /** `detail` is for server-side logs only. */
    constructor(readonly server: string, detail?: string) {
        super(`Remote server "${server}" is offline${detail ? ` (${detail})` : ''}`);
    }
}

function serverName(server: RemoteServerWithRuntime): string {
    return server.label || server.id;
}

function isRemoteId(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 512) return false;
    try {
        encodeURIComponent(value);
        return true;
    } catch {
        return false;
    }
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
        signal?: AbortSignal,
    ): Promise<any> {
        const controller = new AbortController();
        signal?.throwIfAborted();
        let rejectAbort: ((reason: unknown) => void) | undefined;
        const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
        const abort = () => { controller.abort(signal?.reason); rejectAbort?.(signal?.reason); };
        signal?.addEventListener('abort', abort, { once: true });
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
                aborted,
            ]);
            const text = await Promise.race([res.text(), timeout, aborted]);
            let body: any;
            try {
                body = text ? JSON.parse(text) : undefined;
            } catch {
                body = undefined;
            }
            if (!res.ok) {
                const message = typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`;
                throw new RemoteRejectedError(message, res.status);
            }
            return body;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
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

    function assertCurrentTarget(serverId: string, target: RemoteChatReadTarget): void {
        const current = options.remoteServers?.list().find(server => server.id === serverId);
        if (!current || current.effectiveUrl !== target.effectiveUrl || current.serverIdentity !== target.serverIdentity) {
            throw new Error('Remote destination changed during discovery');
        }
    }

    async function listRemote(server: RemoteServerWithRuntime): Promise<WorkspaceDirectoryEntry[]> {
        const baseUrl = server.effectiveUrl;
        if (!baseUrl) throw new Error('no reachable endpoint');
        const body = await requestJson(`${baseUrl}/api/workspaces`, listTimeoutMs);
        const workspaces: RawWorkspace[] = Array.isArray(body?.workspaces) ? body.workspaces : Array.isArray(body) ? body : [];
        const names = new Map(workspaces.map(ws => [ws.id, ws.name || ws.id]));
        const base = { server: serverName(server), serverKind: server.kind, online: true,
            ...(server.serverIdentity ? { serverIdentity: server.serverIdentity } : {}) };
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
        async getGitSummary(target, signal) {
            if (!target.online) return { state: 'offline' };
            signal.throwIfAborted();
            if (target.id === undefined && !target.serverIdentity) return { state: 'unsupported' };
            const clone = parseRemoteCloneKey(target.id);
            const server = clone
                ? options.remoteServers?.list().find(s => s.id === clone.serverId)
                : target.id === undefined && target.serverIdentity !== options.serverIdentity
                    ? options.remoteServers?.list().find(s => s.serverIdentity === target.serverIdentity && !!s.effectiveUrl)
                    : undefined;
            const workspaceId = clone?.workspaceId ?? target.workspaceId ?? target.id;
            if (!workspaceId || isRepoGroupWorkspaceId(workspaceId)) return { state: 'unsupported' };
            if (clone || server || target.id === undefined && (!target.serverIdentity || target.serverIdentity !== options.serverIdentity)) {
                if (!server) return { state: 'unsupported' };
                if (target.serverIdentity && server.serverIdentity !== target.serverIdentity) return { state: 'unavailable' };
                if (!server.effectiveUrl) return { state: 'offline' };
                const binding = { effectiveUrl: server.effectiveUrl, serverIdentity: server.serverIdentity };
                try {
                    // The owning server's registry distinguishes non-Git from status read failures,
                    // including older git-info endpoints that encode a failed read as isGitRepo:false.
                    const listed = await requestJson(`${binding.effectiveUrl}/api/workspaces`, listTimeoutMs, undefined, signal);
                    assertCurrentTarget(server.id, binding);
                    const rows = Array.isArray(listed) ? listed : listed?.workspaces;
                    const ws = Array.isArray(rows) ? rows.find((row: RawWorkspace) => row.id === workspaceId) : undefined;
                    if (!ws || ws.virtual) return { state: 'unavailable' };
                    if (ws.isGitRepo === false) return { state: 'non-git' };
                    const info = await requestJson(`${binding.effectiveUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/git-info`, listTimeoutMs, undefined, signal);
                    assertCurrentTarget(server.id, binding);
                    signal.throwIfAborted();
                    if (info?.isGitRepo !== true || typeof info.dirty !== 'boolean'
                        || !(typeof info.branch === 'string' || info.branch === null)) return { state: 'unavailable' };
                    return {
                        state: info.dirty ? 'dirty' : 'clean', branch: info.detached === true ? null : info.branch,
                        ...(info.detached === true ? { detached: true as const } : {}),
                        ...(info.detached !== true && typeof info.upstream === 'string' && info.upstream
                            && Number.isSafeInteger(info.ahead) && info.ahead >= 0
                            && Number.isSafeInteger(info.behind) && info.behind >= 0
                            ? { ahead: info.ahead, behind: info.behind } : {}),
                    };
                } catch (err) {
                    signal.throwIfAborted();
                    return { state: err instanceof RemoteRejectedError && err.status === 404 ? 'unsupported' : 'unavailable' };
                }
            }
            const ws = (await options.store.getWorkspaces()).find(w => w.id === workspaceId);
            if (!ws?.rootPath || ws.virtual) return { state: 'unavailable' };
            try {
                if (!(await stat(resolvePathForHostFilesystem(ws.rootPath))).isDirectory()) return { state: 'unavailable' };
            } catch {
                return { state: 'unavailable' };
            }
            try {
                await stat(resolvePathForHostFilesystem(ws.rootPath, '.git'));
            } catch (err) {
                return { state: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'non-git' : 'unavailable' };
            }
            signal.throwIfAborted();
            const status = await new BranchService().getRepositoryStatus(ws.rootPath);
            signal.throwIfAborted();
            if (!status) return { state: 'unavailable' };
            return {
                state: status.dirty ? 'dirty' : 'clean', branch: status.isDetached ? null : status.branch,
                ...(status.isDetached ? { detached: true as const } : {}),
                ...(!status.isDetached && status.trackingBranch ? { ahead: status.ahead, behind: status.behind } : {}),
            };
        },
        async list() {
            const localWorkspaces = (await options.store.getWorkspaces()) as RawWorkspace[];
            const entries = listLocal(localWorkspaces);
            const servers: WorkspaceDirectoryServer[] = [{ server: LOCAL_SERVER_NAME, serverKind: 'local', online: true }];
            // Snapshot mutable runtime records before any remote I/O.
            const remotes = (options.remoteServers?.list() ?? []).map(server => ({ ...server }));
            const results = await Promise.all(remotes.map(async server => {
                try {
                    const remoteEntries = await listRemote(server);
                    assertCurrentTarget(server.id, { effectiveUrl: server.effectiveUrl!, serverIdentity: server.serverIdentity });
                    lastKnown.set(server.id, remoteEntries);
                    return { server, online: true, entries: remoteEntries };
                } catch {
                    const current = options.remoteServers?.list().find(candidate => candidate.id === server.id);
                    const cached = (lastKnown.get(server.id) ?? []).filter(entry => current
                        && (!current.serverIdentity || !entry.serverIdentity || current.serverIdentity === entry.serverIdentity));
                    return {
                        server,
                        online: false,
                        entries: cached.map(entry => ({ ...entry, server: serverName(server), online: false })),
                    };
                }
            }));
            for (const result of results) {
                servers.push({ serverId: result.server.id, server: serverName(result.server), serverKind: result.server.kind, online: result.online });
                entries.push(...result.entries);
            }
            return { entries, servers };
        },

        async getRemoteChatSummaries(serverId, workspaceId, filter) {
            const server = options.remoteServers?.list().find(s => s.id === serverId);
            if (!server?.effectiveUrl) throw new RemoteServerOfflineError(server ? serverName(server) : serverId);
            const target = { effectiveUrl: server.effectiveUrl, serverIdentity: server.serverIdentity };
            if ((filter.serverIdentity && filter.serverIdentity !== target.serverIdentity)
                || (filter.target && (filter.target.effectiveUrl !== target.effectiveUrl
                    || filter.target.serverIdentity !== target.serverIdentity))) {
                throw new Error('Remote destination changed during discovery');
            }
            const query = new URLSearchParams({
                workspace: workspaceId, type: 'chat', limit: String(filter.limit), offset: String(filter.offset),
            });
            if (filter.since) query.set('since', filter.since.toISOString());
            if (filter.until) query.set('until', filter.until.toISOString());
            const body = await requestJson(`${target.effectiveUrl}/api/processes/summaries?${query}`, listTimeoutMs);
            assertCurrentTarget(serverId, target);
            if (!Array.isArray(body?.summaries) || !Number.isSafeInteger(body.total) || body.total < 0
                || body.summaries.length > filter.limit
                || body.summaries.some((entry: ProcessIndexEntry) => !entry
                    || ['id', 'workspaceId', 'type', 'status', 'startTime', 'promptPreview']
                        .some(key => typeof (entry as unknown as Record<string, unknown>)[key] !== 'string')
                    || (entry.title !== undefined && typeof entry.title !== 'string')
                    || (entry.customTitle !== undefined && typeof entry.customTitle !== 'string'))) {
                throw new Error('Invalid remote chat summaries response');
            }
            // Preserve the raw page length for pagination; the caller verifies ownership.
            return { entries: body.summaries, total: body.total, target };
        },

        async listRemoteChats(serverId, workspaceId, limit) {
            const server = options.remoteServers?.list().find(s => s.id === serverId);
            if (!server?.effectiveUrl) throw new RemoteServerOfflineError(server ? serverName(server) : serverId);
            const query = new URLSearchParams({ workspace: workspaceId, limit: String(limit), exclude: 'conversation,toolCalls' });
            let body: any;
            try {
                body = await requestJson(`${server.effectiveUrl}/api/processes?${query}`, listTimeoutMs);
            } catch (err) {
                if (err instanceof RemoteRejectedError) throw err;
                throw new RemoteServerOfflineError(serverName(server), err instanceof Error ? err.message : String(err));
            }
            const processes: any[] = Array.isArray(body?.processes) ? body.processes : [];
            return processes
                .filter(p => typeof p?.id === 'string' && p.metadata?.workspaceId === workspaceId)
                .slice(0, limit)
                .map(p => ({
                    id: p.id,
                    ...(typeof p.status === 'string' ? { status: p.status } : {}),
                    ...(typeof p.title === 'string' ? { title: p.title } : {}),
                    ...(typeof p.customTitle === 'string' ? { customTitle: p.customTitle } : {}),
                    ...(typeof p.promptPreview === 'string' ? { promptPreview: p.promptPreview } : {}),
                    ...(typeof p.lastEventAt === 'string' ? { lastEventAt: p.lastEventAt } : {}),
                    ...(typeof p.startTime === 'string' ? { startTime: p.startTime } : {}),
                }));
        },

        async isRemoteAutoProviderRoutingAvailable(serverId) {
            const server = options.remoteServers?.list().find(s => s.id === serverId);
            if (!server?.effectiveUrl) {
                throw new RemoteServerOfflineError(server ? serverName(server) : serverId);
            }
            try {
                const config = await requestJson(`${server.effectiveUrl}/api/config/runtime`, listTimeoutMs);
                return config?.features?.autoAgentProviderRoutingEnabled === true;
            } catch (err) {
                // Older servers may lack the capability endpoint. Other HTTP or
                // transport failures do not prove that Auto is disabled.
                if (err instanceof RemoteRejectedError && err.status === 404) {
                    return false;
                }
                throw err;
            }
        },

        async validateRemoteProvider(serverId, provider) {
            const server = options.remoteServers?.list().find(s => s.id === serverId);
            if (!server?.effectiveUrl) {
                throw new RemoteServerOfflineError(server ? serverName(server) : serverId);
            }
            const body = await requestJson(`${server.effectiveUrl}/api/agent-providers`, listTimeoutMs);
            const status = body?.providers?.find((p: { id: string }) => p.id === provider);
            if (status?.enabled !== true || status?.available !== true) {
                throw new Error(`Provider '${provider}' is not available on remote server "${serverName(server)}".`);
            }
        },

        async startRemoteChat(request) {
            const server = options.remoteServers?.list().find(s => s.id === request.serverId);
            if (!server) {
                throw new RemoteChatAdmissionError(`Remote server '${request.serverId}' is not registered. Call list_workspaces to see available repos.`, 'not-started');
            }
            const label = serverName(server);
            if (!server.effectiveUrl) {
                throw new RemoteChatAdmissionError(`Remote server "${label}" is offline (no reachable endpoint). The chat was not started.`, 'not-started');
            }
            const target = { effectiveUrl: server.effectiveUrl, serverIdentity: server.serverIdentity };
            let serverIdentity: string;
            try {
                const health = await requestJson(`${target.effectiveUrl}/api/health`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                if (!isRemoteId(health?.serverIdentity)
                    || (target.serverIdentity && health.serverIdentity !== target.serverIdentity)) {
                    throw new Error('Server identity unavailable or replaced');
                }
                serverIdentity = health.serverIdentity;
            } catch {
                throw new RemoteChatAdmissionError('Remote owning server identity unavailable or replaced. The chat was not started.', 'not-started');
            }
            const grilling = request.kind === 'ralph' && request.body.entryPoint === 'grill';
            if (grilling) {
                try {
                    const capabilities = await requestJson(`${target.effectiveUrl}/api/ralph-launch/capabilities`, listTimeoutMs);
                    if (capabilities?.version !== 1 || capabilities?.grilling !== true) {
                        throw new Error('Native Ralph grilling is unsupported or disabled');
                    }
                } catch {
                    throw new RemoteChatAdmissionError(`Remote server "${label}" cannot admit native Ralph grilling. No launch was attempted.`, 'not-started');
                }
            }
            try {
                assertCurrentTarget(server.id, target);
            } catch {
                throw new RemoteChatAdmissionError('Remote destination changed before admission. The chat was not started.', 'not-started');
            }
            const path = request.kind === 'ralph' ? '/api/ralph-launch' : '/api/queue';
            let resultDelivery: import('../delegation/remote-delegation-return').UnavailableRemoteResult | undefined;
            if (request.resultOrigin && options.remoteResults) {
                const launch = request.kind === 'ralph' ? remoteRalphLaunchBody.parse({
                    goalSpec: request.body.goalSpec, entryPoint: request.body.entryPoint, title: request.body.title,
                    provider: request.body.provider, autoProviderRouting: request.body.autoProviderRouting, config: request.body.config,
                }) : remoteChatLaunchBody.parse({
                    content: (request.body.payload as Record<string, unknown>)?.prompt,
                    mode: (request.body.payload as Record<string, unknown>)?.mode,
                    priority: request.body.priority, title: request.body.displayName,
                    provider: (request.body.payload as Record<string, unknown>)?.provider,
                    autoProviderRouting: !!((request.body.payload as Record<string, unknown>)?.context as { autoProviderRouting?: unknown })?.autoProviderRouting,
                    config: request.body.config,
                });
                const tracked = await options.remoteResults.dispatch(request.serverId, {
                    version: 1, kind: request.kind === 'ralph' ? 'ralph' : 'launch',
                    workspaceId: String(request.body.workspaceId ?? (request.body.payload as Record<string, unknown>)?.workspaceId),
                    body: JSON.parse(JSON.stringify(launch)),
                }, request.resultOrigin, serverIdentity);
                if (tracked && !('unavailable' in tracked)) return tracked;
                resultDelivery = tracked?.unavailable;
            }
            let body: any;
            try {
                body = await requestJson(`${target.effectiveUrl}${path}`, startTimeoutMs, { method: 'POST', body: request.body });
            } catch (err) {
                // A timeout, lost response or server-side error may follow durable
                // admission. Only a definitive client rejection proves non-admission.
                // Do not expose fetch errors (which may contain private endpoints).
                const rejected = err instanceof RemoteRejectedError && err.status >= 400 && err.status < 500 && err.status !== 408;
                throw new RemoteChatAdmissionError(rejected
                    ? `Remote server "${label}" rejected the request (HTTP ${err.status}). The chat was not started.`
                    : `Remote server "${label}" did not confirm admission. Admission is uncertain; inspect the remote chat list before retrying. Do not launch a duplicate job.`,
                rejected ? 'rejected' : 'uncertain');
            }
            // A transport change during admission must not publish a guessed owner.
            try {
                assertCurrentTarget(server.id, target);
                const after = await requestJson(`${target.effectiveUrl}/api/health`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                if (after?.serverIdentity !== serverIdentity) throw new Error('Server identity changed');
            } catch {
                throw new RemoteChatAdmissionError('Remote job admission is uncertain: owning server unavailable or replaced. Do not launch a duplicate job.', 'uncertain');
            }
            if (request.kind === 'ralph') {
                if (!isRemoteId(body?.processId) || (body.sessionId !== undefined && !isRemoteId(body.sessionId))) {
                    throw new RemoteChatAdmissionError(`Remote server "${label}" returned invalid Ralph admission identities. Admission is uncertain; inspect the remote chat list. Do not launch a duplicate job.`, 'uncertain');
                }
                if (grilling && (body.phase !== 'grilling' || typeof body.sessionId !== 'string')) {
                    throw new RemoteChatAdmissionError(`Remote server "${label}" did not confirm native grilling admission. Admission is uncertain; inspect the remote chat list. Do not launch a duplicate job.`, 'uncertain');
                }
                return { serverIdentity, processId: body.processId, ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
                    ...(resultDelivery ? { resultDelivery } : {}) };
            }
            const taskId = body?.task?.id;
            if (!isRemoteId(taskId) || !isRemoteId(toQueueProcessId(taskId))) {
                throw new RemoteChatAdmissionError(`Remote server "${label}" returned an invalid task identity. Admission is uncertain; inspect the remote chat list. Do not launch a duplicate job.`, 'uncertain');
            }
            return { serverIdentity, processId: toQueueProcessId(taskId), ...(resultDelivery ? { resultDelivery } : {}) };
        },

        async postRemoteChat(request) {
            const server = options.remoteServers?.list().find(s => s.id === request.serverId);
            if (!server?.effectiveUrl) {
                throw new RemoteChatAdmissionError('Remote server is unregistered or offline. No follow-up was sent.', 'not-started');
            }
            if (![request.workspaceId, request.processId].every(isRemoteId)) {
                throw new RemoteChatAdmissionError('An exact remote workspace and process identity are required. No follow-up was sent.', 'not-started');
            }
            const target = { effectiveUrl: server.effectiveUrl, serverIdentity: server.serverIdentity };
            const query = new URLSearchParams({ workspace: request.workspaceId });
            const processPath = `/api/processes/${encodeURIComponent(request.processId)}`;
            let serverIdentity: string;
            let model = request.model;
            let reasoningEffort: string | undefined;
            try {
                const health = await requestJson(`${target.effectiveUrl}/api/health`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                if (!isRemoteId(health?.serverIdentity)
                    || (target.serverIdentity && health.serverIdentity !== target.serverIdentity)) {
                    throw new Error('Remote owner unavailable or replaced');
                }
                serverIdentity = health.serverIdentity;
                const detailQuery = new URLSearchParams(query);
                detailQuery.set('exclude', 'conversation,toolCalls');
                const detail = await requestJson(`${target.effectiveUrl}${processPath}?${detailQuery}`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                const proc = detail?.process;
                if (!proc || proc.id !== request.processId || proc.metadata?.workspaceId !== request.workspaceId
                    || proc.type !== 'chat' || proc.archived) {
                    throw new Error('Exact remote chat owner unavailable');
                }
                const provider = resolveRecordedProvider(proc);
                if ((model || request.effortTier) && !provider) throw new Error('Remote provider unavailable');
                if (!model && request.effortTier) {
                    // Read the owning server's configured mapping, never origin defaults.
                    const tiers = await requestJson(`${target.effectiveUrl}/api/agent-providers/${provider}/effort-tiers`, listTimeoutMs);
                    assertCurrentTarget(server.id, target);
                    const tier = tiers?.effortTiers?.[request.effortTier];
                    if (tiers?.provider !== provider || !isRemoteId(tier?.model)
                        || (tier.reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(tier.reasoningEffort))) {
                        throw new Error('Remote effort tier unavailable');
                    }
                    model = tier.model;
                    reasoningEffort = tier.reasoningEffort;
                }
                if (model && resolveModelForProvider(provider!, model).coerced) throw new Error('Incompatible remote model');
                const before = await requestJson(`${target.effectiveUrl}/api/health`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                if (before?.serverIdentity !== serverIdentity) throw new Error('Remote owner changed');
            } catch {
                throw new RemoteChatAdmissionError('Remote chat ownership or follow-up settings could not be verified. No follow-up was sent.', 'not-started');
            }
            let body: any;
            let resultDelivery: import('../delegation/remote-delegation-return').UnavailableRemoteResult | undefined;
            if (request.resultOrigin && options.remoteResults) {
                const tracked = await options.remoteResults.dispatch(request.serverId, {
                    version: 1, kind: 'follow-up', workspaceId: request.workspaceId, targetProcessId: request.processId,
                    body: { content: request.content, ...(request.mode ? { mode: request.mode } : {}),
                        ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) },
                }, request.resultOrigin, serverIdentity);
                if (tracked && !('unavailable' in tracked)) return tracked;
                resultDelivery = tracked?.unavailable;
            }
            try {
                body = await requestJson(`${target.effectiveUrl}${processPath}/message?${query}`, startTimeoutMs, {
                    method: 'POST', body: {
                        content: request.content,
                        ...(request.mode ? { mode: request.mode } : {}),
                        ...(model ? { model } : {}),
                        ...(reasoningEffort ? { reasoningEffort } : {}),
                        deliveryMode: request.deliveryMode === 'steer' ? 'immediate' : request.deliveryMode ?? 'enqueue',
                    },
                });
            } catch (err) {
                const rejected = err instanceof RemoteRejectedError && err.status >= 400 && err.status < 500 && err.status !== 408;
                throw new RemoteChatAdmissionError(rejected
                    ? `Remote server rejected the follow-up (HTTP ${err.status}). No follow-up was admitted.`
                    : 'Remote follow-up admission is uncertain. Inspect the remote chat before retrying. Do not send a duplicate follow-up.',
                rejected ? 'rejected' : 'uncertain');
            }
            try {
                assertCurrentTarget(server.id, target);
                const after = await requestJson(`${target.effectiveUrl}/api/health`, listTimeoutMs);
                assertCurrentTarget(server.id, target);
                if (after?.serverIdentity !== serverIdentity || body?.processId !== request.processId
                    || !Number.isSafeInteger(body?.turnIndex) || body.turnIndex < -1) {
                    throw new Error('Invalid follow-up acknowledgment');
                }
            } catch {
                throw new RemoteChatAdmissionError('Remote follow-up admission is uncertain: owner or acknowledgment unavailable. Do not send a duplicate follow-up.', 'uncertain');
            }
            return { serverIdentity, processId: request.processId, turnIndex: body.turnIndex, ...(resultDelivery ? { resultDelivery } : {}) };
        },
    };
}

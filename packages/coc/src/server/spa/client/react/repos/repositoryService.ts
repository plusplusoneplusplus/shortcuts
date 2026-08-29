import {
    CocApiError,
    CocNetworkError,
    type BrowseWorkspaceFoldersResponse,
    type DiscoverWorkspacesResponse,
    type GitInfoBatchResponse,
    type GitInfoResponse,
    type GlobalPreferences,
    type MyLifeSummaryResponse,
    type MyLifeSyncRequest,
    type MyLifeSyncResponse,
    type MyWorkSummaryResponse,
    type MyWorkSyncRequest,
    type MyWorkSyncResponse,
    type ProcessSummariesResponse,
    type QueueReposResponse,
    type RegisterWorkspaceRequest,
    type RemoteServer,
    type WorkspaceInfo,
    type WorkspaceSummaryResponse,
    type WorkspacesResponse,
} from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from './cloneRegistry';
import { getCocClientFor, getSpaCocClient } from '../api/cocClient';
import { isContainerMode, getRawApiBase } from '../utils/config';
import { CocClient } from '@plusplusoneplusplus/coc-client';

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
    // In container mode, always fetch the aggregated workspace list from the
    // container-level endpoint (no agent prefix) regardless of which agent is active.
    if (isContainerMode()) {
        const rawBase = getRawApiBase();
        const client = new CocClient({
            baseUrl: '',
            apiBasePath: rawBase,
            wsPath: '/ws',
            fetch,
        });
        const response = await client.workspaces.list();
        return normalizeWorkspacesResponse(response);
    }
    const response = await getSpaCocClient().workspaces.list();
    return normalizeWorkspacesResponse(response);
}

/**
 * Register a workspace in a CoC server's registry.
 *
 * `baseUrl` omitted → the page-origin server, exactly as before. Pass an online
 * remote server's `effectiveUrl` to register on THAT box instead: the remote
 * resolves `rootPath` against its own filesystem and computes the workspace id
 * itself, so ids stay server-authoritative.
 */
export function registerWorkspace(request: RegisterWorkspaceRequest, baseUrl?: string): Promise<WorkspaceInfo> {
    return getCocClientFor(baseUrl).workspaces.register(request);
}

export function updateWorkspace(workspaceId: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<{ workspace: WorkspaceInfo }> {
    return getSpaCocClient().workspaces.update(workspaceId, updates);
}

/**
 * Unregister a workspace from the CoC server that owns it.
 *
 * A remote (agent-hosted) workspace lives on another CoC server, so the DELETE
 * has to go to that server's `<baseUrl>/api/workspaces/<id>` — the clone registry
 * resolves it. A local workspace is absent from the registry and falls through to
 * the default page-origin client, unchanged.
 */
export function removeWorkspace(workspaceId: string): Promise<void> {
    return getCocClientForWorkspace(workspaceId).workspaces.delete(workspaceId);
}

/**
 * Scan a directory's direct children for git repos. `path` and the results are
 * resolved on whichever server `baseUrl` points at (page origin when omitted).
 */
export function discoverWorkspaces(path: string, baseUrl?: string): Promise<DiscoverWorkspacesResponse> {
    return getCocClientFor(baseUrl).workspaces.discover(path);
}

/**
 * List a directory's subfolders. Like {@link discoverWorkspaces}, `path` is
 * interpreted by the target server, so `~` expands to the REMOTE box's home
 * when a remote `baseUrl` is given.
 */
export function browseWorkspaceFolders(path: string, baseUrl?: string): Promise<BrowseWorkspaceFoldersResponse> {
    return getCocClientFor(baseUrl).workspaces.browseFolders(path);
}

export interface CloneRepositoryRequest {
    url: string;
    parentDir: string;
    /** Override the target folder name. Defaults to the name git derives from the URL. */
    dirName?: string;
}

export interface CloneRepositoryResponse {
    clonedPath: string;
}

/**
 * Clone a repository. Like {@link browseWorkspaceFolders}, `parentDir` is
 * interpreted by the target server, so a remote `baseUrl` runs `git clone` on
 * the REMOTE box's filesystem with that box's git credentials.
 */
export async function cloneRepository(
    request: CloneRepositoryRequest,
    baseUrl?: string,
): Promise<CloneRepositoryResponse> {
    try {
        return await getCocClientFor(baseUrl).request<CloneRepositoryResponse>('/git/clone', {
            method: 'POST',
            body: request,
        });
    } catch (error) {
        if (error instanceof CocApiError) {
            const body = error.body;
            if (body && typeof body === 'object') {
                const message = (body as Record<string, unknown>).error;
                if (typeof message === 'string' && message.trim()) {
                    throw new Error(message);
                }
            }
        }
        throw error;
    }
}

export function getWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummaryResponse> {
    return getSpaCocClient().workspaces.summary(workspaceId);
}

export function getWorkspaceGitInfo(workspaceId: string): Promise<GitInfoResponse> {
    return getCocClientForWorkspace(workspaceId).workspaces.gitInfo(workspaceId);
}

export function getWorkspaceGitInfoBatch(workspaceIds: string[], signal?: AbortSignal, trigger = 'initial-topology-load'): Promise<GitInfoBatchResponse> {
    return getSpaCocClient().workspaces.gitInfoBatch(workspaceIds, { signal, trigger });
}

export interface RemoteWorkspaceTargetSource {
    server: RemoteServer;
    workspaces: WorkspaceInfo[];
    gitInfoResults: Record<string, GitInfoResponse | null>;
}

export interface RemoteWorkspaceTargetSourcesResult {
    sources: RemoteWorkspaceTargetSource[];
    warnings: string[];
}

export async function listRemoteWorkspaceTargetSources(): Promise<RemoteWorkspaceTargetSourcesResult> {
    const servers = await getSpaCocClient().servers.list();
    const results = await Promise.all(servers.map(loadRemoteWorkspaceTargetSource));
    return {
        sources: results.flatMap(result => result.source ? [result.source] : []),
        warnings: results.flatMap(result => result.warning ? [result.warning] : []),
    };
}

async function loadRemoteWorkspaceTargetSource(server: RemoteServer): Promise<{ source?: RemoteWorkspaceTargetSource; warning?: string }> {
    const serverLabel = server.label || server.id;
    try {
        const health = await getSpaCocClient().servers.getHealth(server.id);
        if (health.status !== 'online' || !health.effectiveUrl) {
            return { warning: `${serverLabel}: ${health.error || 'remote CoC is offline'}` };
        }

        const remoteClient = new CocClient({
            baseUrl: health.effectiveUrl,
            fetch,
            timeoutMs: 15_000,
        });
        const workspaces = normalizeWorkspacesResponse(await remoteClient.workspaces.list());
        const gitInfoResults = workspaces.length > 0
            ? (await remoteClient.workspaces.gitInfoBatch(workspaces.map(workspace => workspace.id))).results ?? {}
            : {};

        return {
            source: {
                server: {
                    ...server,
                    effectiveUrl: health.effectiveUrl,
                    status: 'online',
                },
                workspaces,
                gitInfoResults,
            },
        };
    } catch (error) {
        return { warning: `${serverLabel}: ${getRepositoryApiErrorMessage(error, 'failed to load remote workspaces')}` };
    }
}

export function listProcessSummaries(limit = 5000): Promise<ProcessSummariesResponse> {
    return getSpaCocClient().processes.summaries({ limit });
}

export function listQueueRepos(): Promise<QueueReposResponse> {
    return getSpaCocClient().queue.repos();
}

export function getGlobalPreferences(): Promise<GlobalPreferences> {
    return getSpaCocClient().preferences.getGlobal();
}

export function updateGlobalPreferences(preferences: GlobalPreferences): Promise<GlobalPreferences> {
    return getSpaCocClient().preferences.updateGlobal(preferences);
}

export function syncMyWork(request: MyWorkSyncRequest = {}): Promise<MyWorkSyncResponse> {
    return getSpaCocClient().repos.syncMyWork(request);
}

export function generateMyWorkSummary(): Promise<MyWorkSummaryResponse> {
    return getSpaCocClient().repos.generateMyWorkSummary();
}

export function syncMyLife(request: MyLifeSyncRequest = {}): Promise<MyLifeSyncResponse> {
    return getSpaCocClient().repos.syncMyLife(request);
}

export function generateMyLifeSummary(): Promise<MyLifeSummaryResponse> {
    return getSpaCocClient().repos.generateMyLifeSummary();
}

export function getRepositoryApiErrorMessage(error: unknown, fallback: string, networkFallback = fallback): string {
    if (error instanceof CocApiError) {
        return error.message && !error.message.startsWith('CoC API request failed')
            ? error.message
            : fallback;
    }
    if (error instanceof CocNetworkError) {
        return networkFallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    return fallback;
}

function normalizeWorkspacesResponse(response: WorkspacesResponse | WorkspaceInfo[]): WorkspaceInfo[] {
    if (Array.isArray(response)) {
        return response;
    }
    return Array.isArray(response?.workspaces) ? response.workspaces : [];
}

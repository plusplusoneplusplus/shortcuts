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
    type WorkspaceInfo,
    type WorkspaceSummaryResponse,
    type WorkspacesResponse,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';
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

export function registerWorkspace(request: RegisterWorkspaceRequest): Promise<WorkspaceInfo> {
    return getSpaCocClient().workspaces.register(request);
}

export function updateWorkspace(workspaceId: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<{ workspace: WorkspaceInfo }> {
    return getSpaCocClient().workspaces.update(workspaceId, updates);
}

export function discoverWorkspaces(path: string): Promise<DiscoverWorkspacesResponse> {
    return getSpaCocClient().workspaces.discover(path);
}

export function browseWorkspaceFolders(path: string): Promise<BrowseWorkspaceFoldersResponse> {
    return getSpaCocClient().workspaces.browseFolders(path);
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

export async function cloneRepository(request: CloneRepositoryRequest): Promise<CloneRepositoryResponse> {
    try {
        return await getSpaCocClient().request<CloneRepositoryResponse>('/git/clone', {
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
    return getSpaCocClient().workspaces.gitInfo(workspaceId);
}

export function getWorkspaceGitInfoBatch(workspaceIds: string[], signal?: AbortSignal): Promise<GitInfoBatchResponse> {
    return getSpaCocClient().workspaces.gitInfoBatch(workspaceIds, { signal });
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

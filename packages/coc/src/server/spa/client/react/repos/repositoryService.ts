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

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
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

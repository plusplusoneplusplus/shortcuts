import type {
  BrowseWorkspaceFoldersOptions,
  BrowseWorkspaceFoldersResponse,
  DeleteWorkspaceHistoryFilters,
  DeleteWorkspaceOptions,
  DiscoverWorkspacesResponse,
  GitInfoBatchResponse,
  GitInfoResponse,
  MyLifeSummaryResponse,
  MyLifeSyncRequest,
  MyLifeSyncResponse,
  MyWorkSummaryResponse,
  MyWorkSyncRequest,
  MyWorkSyncResponse,
  RegisterWorkspaceRequest,
  WorkspaceInfo,
  WorkspaceSummaryOptions,
  WorkspaceSummaryResponse,
  WorkspacesResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function serializeDeleteOptions(options?: DeleteWorkspaceOptions): CocRequestOptions['query'] {
  if (!options) return undefined;
  return { archive: options.archive };
}

function serializeHistoryFilters(filters?: DeleteWorkspaceHistoryFilters): CocRequestOptions['query'] {
  if (!filters) return undefined;
  return {
    since: filters.since,
    until: filters.until,
  };
}

function serializeBrowseOptions(path: string, options?: BrowseWorkspaceFoldersOptions): CocRequestOptions['query'] {
  return {
    path,
    showHidden: options?.showHidden,
  };
}

function serializeSummaryOptions(options?: WorkspaceSummaryOptions): CocRequestOptions['query'] {
  if (!options) return undefined;
  return {
    folder: options.folder,
    showArchived: options.showArchived,
  };
}

export class WorkspacesClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(): Promise<WorkspacesResponse> {
    return this.transport.request<WorkspacesResponse>('/workspaces');
  }

  register(request: RegisterWorkspaceRequest): Promise<WorkspaceInfo> {
    return this.transport.request<WorkspaceInfo>('/workspaces', { method: 'POST', body: { ...request } });
  }

  discover(path: string): Promise<DiscoverWorkspacesResponse> {
    return this.transport.request<DiscoverWorkspacesResponse>('/workspaces/discover', { query: { path } });
  }

  browseFolders(path: string, options?: BrowseWorkspaceFoldersOptions): Promise<BrowseWorkspaceFoldersResponse> {
    return this.transport.request<BrowseWorkspaceFoldersResponse>('/fs/browse', {
      query: serializeBrowseOptions(path, options),
    });
  }

  update(workspaceId: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<{ workspace: WorkspaceInfo }> {
    return this.transport.request<{ workspace: WorkspaceInfo }>(`/workspaces/${encodePathSegment(workspaceId)}`, {
      method: 'PATCH',
      body: { ...updates },
    });
  }

  delete(workspaceId: string, options?: DeleteWorkspaceOptions): Promise<void> {
    return this.transport.request<void>(`/workspaces/${encodePathSegment(workspaceId)}`, {
      method: 'DELETE',
      query: serializeDeleteOptions(options),
    });
  }

  gitInfo(workspaceId: string): Promise<GitInfoResponse> {
    return this.transport.request<GitInfoResponse>(`/workspaces/${encodePathSegment(workspaceId)}/git-info`);
  }

  gitInfoBatch(workspaceIds: string[], options?: Pick<CocRequestOptions, 'signal'>): Promise<GitInfoBatchResponse> {
    return this.transport.request<GitInfoBatchResponse>('/git-info/batch', {
      method: 'POST',
      body: { workspaceIds: [...workspaceIds] },
      signal: options?.signal,
    });
  }

  summary(workspaceId: string, options?: WorkspaceSummaryOptions): Promise<WorkspaceSummaryResponse> {
    return this.transport.request<WorkspaceSummaryResponse>(`/workspaces/${encodePathSegment(workspaceId)}/summary`, {
      query: serializeSummaryOptions(options),
    });
  }

  deleteHistory(workspaceId: string, processId: string): Promise<void>;
  deleteHistory(workspaceId: string, filters?: DeleteWorkspaceHistoryFilters): Promise<void>;
  deleteHistory(workspaceId: string, processIdOrFilters?: string | DeleteWorkspaceHistoryFilters): Promise<void> {
    if (typeof processIdOrFilters === 'string') {
      return this.transport.request<void>(`/workspaces/${encodePathSegment(workspaceId)}/history/${encodePathSegment(processIdOrFilters)}`, { method: 'DELETE' });
    }
    return this.transport.request<void>(`/workspaces/${encodePathSegment(workspaceId)}/history`, {
      method: 'DELETE',
      query: serializeHistoryFilters(processIdOrFilters),
    });
  }

  deleteHistoryBulk(workspaceId: string, processIds: string[]): Promise<{ results: Array<{ processId: string; status: string }> }> {
    return this.transport.request(`/workspaces/${encodePathSegment(workspaceId)}/history`, {
      method: 'DELETE',
      body: { processIds: [...processIds] },
    });
  }

  syncMyWork(request: MyWorkSyncRequest = {}): Promise<MyWorkSyncResponse> {
    return this.transport.request<MyWorkSyncResponse>('/my-work/sync', { method: 'POST', body: { ...request } });
  }

  generateMyWorkSummary(): Promise<MyWorkSummaryResponse> {
    return this.transport.request<MyWorkSummaryResponse>('/my-work/generate-summary', { method: 'POST' });
  }

  syncMyLife(request: MyLifeSyncRequest = {}): Promise<MyLifeSyncResponse> {
    return this.transport.request<MyLifeSyncResponse>('/my-life/sync', { method: 'POST', body: { ...request } });
  }

  generateMyLifeSummary(): Promise<MyLifeSummaryResponse> {
    return this.transport.request<MyLifeSummaryResponse>('/my-life/generate-summary', { method: 'POST' });
  }
}

import type {
  DeleteWorkspaceHistoryFilters,
  DeleteWorkspaceOptions,
  DiscoverWorkspacesResponse,
  GitInfoResponse,
  RegisterWorkspaceRequest,
  WorkspaceInfo,
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
}

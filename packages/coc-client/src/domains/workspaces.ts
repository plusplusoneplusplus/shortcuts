import type {
  DiscoverWorkspacesResponse,
  GitInfoResponse,
  RegisterWorkspaceRequest,
  WorkspaceInfo,
  WorkspacesResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

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

  delete(workspaceId: string): Promise<void> {
    return this.transport.request<void>(`/workspaces/${encodePathSegment(workspaceId)}`, { method: 'DELETE' });
  }

  gitInfo(workspaceId: string): Promise<GitInfoResponse> {
    return this.transport.request<GitInfoResponse>(`/workspaces/${encodePathSegment(workspaceId)}/git-info`);
  }

  deleteHistory(workspaceId: string, processId: string): Promise<void> {
    return this.transport.request<void>(`/workspaces/${encodePathSegment(workspaceId)}/history/${encodePathSegment(processId)}`, { method: 'DELETE' });
  }

  deleteHistoryBulk(workspaceId: string, processIds: string[]): Promise<{ results: Array<{ processId: string; status: string }> }> {
    return this.transport.request(`/workspaces/${encodePathSegment(workspaceId)}/history`, {
      method: 'DELETE',
      body: { processIds: [...processIds] },
    });
  }
}

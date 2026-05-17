import type {
  BrowseWorkspaceFoldersOptions,
  BrowseWorkspaceFoldersResponse,
  DeleteWorkspaceHistoryFilters,
  DeleteWorkspaceOptions,
  DiscoverWorkspacesResponse,
  EnDevXDpuActivationResponse,
  GitInfoBatchResponse,
  GitInfoResponse,
  MyLifeSummaryResponse,
  MyLifeSyncRequest,
  MyLifeSyncResponse,
  MyWorkSummaryResponse,
  MyWorkSyncRequest,
  MyWorkSyncResponse,
  RalphContinueResponse,
  RalphSessionResponse,
  RegisterWorkspaceRequest,
  TerminalPinResponse,
  TerminalSessionsResponse,
  UpdateWorkspaceInstructionRequest,
  UpdateWorkspaceMcpConfigRequest,
  ProcessHistoryResponse,
  WorkspaceHistoryQuery,
  WorkspaceInfo,
  WorkspaceInstructionMode,
  WorkspaceInstructionResponse,
  WorkspaceInstructionsResponse,
  WorkspaceMcpConfigResponse,
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

function serializeHistoryQuery(query?: WorkspaceHistoryQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    limit: query.limit,
    offset: query.offset,
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

  discoverEnDevXDpu(workspaceId: string): Promise<EnDevXDpuActivationResponse> {
    return this.transport.request<EnDevXDpuActivationResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/endev-xdpu/discover`,
      { method: 'POST' },
    );
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

  getMcpConfig(workspaceId: string, options?: { forceReload?: boolean }): Promise<WorkspaceMcpConfigResponse> {
    return this.transport.request<WorkspaceMcpConfigResponse>(`/workspaces/${encodePathSegment(workspaceId)}/mcp-config`, {
      query: options?.forceReload ? { forceReload: true } : undefined,
    });
  }

  updateMcpConfig(workspaceId: string, request: UpdateWorkspaceMcpConfigRequest): Promise<{ workspace: WorkspaceInfo }> {
    return this.transport.request<{ workspace: WorkspaceInfo }>(`/workspaces/${encodePathSegment(workspaceId)}/mcp-config`, {
      method: 'PUT',
      body: { enabledMcpServers: request.enabledMcpServers === null ? null : [...request.enabledMcpServers] },
    });
  }

  getInstructions(workspaceId: string): Promise<WorkspaceInstructionsResponse> {
    return this.transport.request<WorkspaceInstructionsResponse>(`/workspaces/${encodePathSegment(workspaceId)}/instructions`);
  }

  updateInstruction(workspaceId: string, mode: WorkspaceInstructionMode, request: UpdateWorkspaceInstructionRequest): Promise<WorkspaceInstructionResponse> {
    return this.transport.request<WorkspaceInstructionResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/instructions/${encodePathSegment(mode)}`,
      { method: 'PUT', body: { ...request } },
    );
  }

  deleteInstruction(workspaceId: string, mode: WorkspaceInstructionMode): Promise<{ success: boolean }> {
    return this.transport.request<{ success: boolean }>(
      `/workspaces/${encodePathSegment(workspaceId)}/instructions/${encodePathSegment(mode)}`,
      { method: 'DELETE' },
    );
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

  history(workspaceId: string, query?: WorkspaceHistoryQuery): Promise<ProcessHistoryResponse> {
    return this.transport.request<ProcessHistoryResponse>(`/workspaces/${encodePathSegment(workspaceId)}/history`, {
      query: serializeHistoryQuery(query),
    });
  }

  /** Read a Ralph session journal: `session.json` record + parsed `progress.md` sections. */
  ralphSession(
    workspaceId: string,
    sessionId: string,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<RalphSessionResponse> {
    return this.transport.request<RalphSessionResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/ralph-sessions/${encodePathSegment(sessionId)}`,
      { signal: options?.signal },
    );
  }

  /**
   * Continue a Ralph session that hit its iteration cap. Extends the session
   * by `additionalIterations` (or the per-repo default when omitted) and
   * enqueues the next iteration on the same `sessionId`.
   */
  continueRalphSession(
    workspaceId: string,
    sessionId: string,
    request: { additionalIterations?: number } = {},
  ): Promise<RalphContinueResponse> {
    const body: Record<string, unknown> = {};
    if (typeof request.additionalIterations === 'number') {
      body.additionalIterations = request.additionalIterations;
    }
    return this.transport.request<RalphContinueResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/ralph-sessions/${encodePathSegment(sessionId)}/continue`,
      { method: 'POST', body },
    );
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

  listTerminals(workspaceId: string): Promise<TerminalSessionsResponse> {
    return this.transport.request<TerminalSessionsResponse>(`/workspaces/${encodePathSegment(workspaceId)}/terminals`);
  }

  pinTerminal(workspaceId: string, sessionId: string, pinned: boolean): Promise<TerminalPinResponse> {
    return this.transport.request<TerminalPinResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/terminals/${encodePathSegment(sessionId)}/pin`,
      { method: 'PATCH', body: { pinned } },
    );
  }
}

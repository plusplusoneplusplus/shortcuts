import type {
  CreateWorkItemFromChatRequest,
  CreateWorkItemRequest,
  ConvertWorkItemTrackerResponse,
  ExecuteWorkItemRequest,
  ExecuteWorkItemResponse,
  ImportFromAzureBoardsRequest,
  ImportFromGitHubRequest,
  ImproveWorkItemAiDraftRequest,
  NewWorkItemAiDraftRequest,
  RequestWorkItemChangesRequest,
  RequestWorkItemChangesResponse,
  ResolveWorkItemCommentsRequest,
  WorkItemSyncProvider,
  WorkItemSyncStatusResponse,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemAiGenerationResponse,
  WorkItemFilter,
  WorkItemGroupedResponse,
  WorkItemListResponse,
  WorkItemPlanRefineRequest,
  WorkItemPlanRefineResponse,
  WorkItemPlanResponse,
  WorkItemPlanUpdateResponse,
  WorkItemPlanVersion,
  WorkItemTreeFilter,
  WorkItemTreeResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function path(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/work-items${suffix}`;
}

function serializeFilter(filter?: WorkItemFilter): Record<string, string | number | undefined> | undefined {
  if (!filter) return undefined;
  return {
    ...filter,
    status: Array.isArray(filter.status) ? filter.status.join(',') : filter.status,
    tags: filter.tags?.join(','),
  };
}

export class WorkItemsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(workspaceId: string, filter?: WorkItemFilter): Promise<WorkItemListResponse> {
    return this.transport.request<WorkItemListResponse>(path(workspaceId), { query: serializeFilter(filter) });
  }

  grouped(workspaceId: string, filter?: Omit<WorkItemFilter, 'status' | 'offset'>): Promise<WorkItemGroupedResponse> {
    return this.transport.request<WorkItemGroupedResponse>(path(workspaceId, '/grouped'), { query: serializeFilter(filter) });
  }

  create(workspaceId: string, request: CreateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId), { method: 'POST', body: { ...request } });
  }

  createFromChat(workspaceId: string, request: CreateWorkItemFromChatRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, '/from-chat'), { method: 'POST', body: { ...request } });
  }

  get(workspaceId: string, workItemId: string): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`));
  }

  update(workspaceId: string, workItemId: string, request: UpdateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  updateStatus(workspaceId: string, workItemId: string, status: string, options?: Pick<UpdateWorkItemRequest, 'completedAt'>): Promise<WorkItem> {
    return this.update(workspaceId, workItemId, { status, ...options });
  }

  delete(workspaceId: string, workItemId: string): Promise<void> {
    return this.transport.request<void>(path(workspaceId, `/${encodePathSegment(workItemId)}`), { method: 'DELETE' });
  }

  pin(workspaceId: string, workItemId: string, pinned: boolean): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}/pin`), {
      method: 'PATCH',
      body: { pinned },
    });
  }

  archive(workspaceId: string, workItemId: string, archived: boolean): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}/archive`), {
      method: 'PATCH',
      body: { archived },
    });
  }

  requestChanges(workspaceId: string, workItemId: string, request: RequestWorkItemChangesRequest): Promise<RequestWorkItemChangesResponse> {
    return this.transport.request<RequestWorkItemChangesResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/request-changes`), {
      method: 'POST',
      body: { ...request },
    });
  }

  getPlan(workspaceId: string, workItemId: string): Promise<WorkItemPlanResponse> {
    return this.transport.request<WorkItemPlanResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/plan`));
  }

  updatePlan(workspaceId: string, workItemId: string, content: string, options?: { resolvedBy?: string; summary?: string }): Promise<WorkItemPlanUpdateResponse> {
    return this.transport.request<WorkItemPlanUpdateResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/plan`), {
      method: 'PUT',
      body: { content, ...options },
    });
  }

  planVersions(workspaceId: string, workItemId: string): Promise<WorkItemPlanVersion[]> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/versions`));
  }

  getPlanVersion(workspaceId: string, workItemId: string, version: number): Promise<WorkItemPlanVersion> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/versions/${version}`));
  }

  refinePlan(workspaceId: string, workItemId: string, request: WorkItemPlanRefineRequest = {}): Promise<WorkItemPlanRefineResponse> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/refine`), {
      method: 'POST',
      body: { ...request },
    });
  }

  execute(workspaceId: string, workItemId: string, request: ExecuteWorkItemRequest = {}): Promise<ExecuteWorkItemResponse> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/execute`), {
      method: 'POST',
      body: { ...request },
    });
  }

  syncStatus(workspaceId: string, provider?: WorkItemSyncProvider): Promise<WorkItemSyncStatusResponse> {
    return this.transport.request<WorkItemSyncStatusResponse>(path(workspaceId, '/sync/status'), {
      query: provider ? { provider } : undefined,
    });
  }

  importFromGitHub(workspaceId: string, request: ImportFromGitHubRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, '/import-from-github'), {
      method: 'POST',
      body: { ...request },
    });
  }

  importFromAzureBoards(workspaceId: string, request: ImportFromAzureBoardsRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, '/import-from-azure-boards'), {
      method: 'POST',
      body: { ...request },
    });
  }

  convertLocalEpicToGitHub(workspaceId: string, workItemId: string): Promise<ConvertWorkItemTrackerResponse> {
    return this.transport.request<ConvertWorkItemTrackerResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/convert-to-github`), {
      method: 'POST',
    });
  }

  convertGitHubEpicToLocal(workspaceId: string, workItemId: string): Promise<ConvertWorkItemTrackerResponse> {
    return this.transport.request<ConvertWorkItemTrackerResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/convert-to-local`), {
      method: 'POST',
    });
  }

  resolveComments(workspaceId: string, workItemId: string, request: ResolveWorkItemCommentsRequest): Promise<ExecuteWorkItemResponse> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/resolve-comments`), {
      method: 'POST',
      body: { ...request },
    });
  }

  tree(workspaceId: string, filter?: WorkItemTreeFilter): Promise<WorkItemTreeResponse> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (filter?.q) query.q = filter.q;
    if (filter?.type) query.type = filter.type;
    if (filter?.status) query.status = filter.status;
    if (filter?.tracker) query.tracker = filter.tracker;
    if (filter?.includeArchived !== undefined) query.includeArchived = filter.includeArchived;
    if (filter?.includeDone !== undefined) query.includeDone = filter.includeDone;
    return this.transport.request<WorkItemTreeResponse>(path(workspaceId, '/tree'), { query });
  }

  aiDraft(workspaceId: string, request: NewWorkItemAiDraftRequest): Promise<WorkItemAiGenerationResponse> {
    return this.transport.request<WorkItemAiGenerationResponse>(path(workspaceId, '/ai-draft'), {
      method: 'POST',
      body: { ...request },
    });
  }

  aiImprove(workspaceId: string, workItemId: string, request: ImproveWorkItemAiDraftRequest): Promise<WorkItemAiGenerationResponse> {
    return this.transport.request<WorkItemAiGenerationResponse>(
      path(workspaceId, `/${encodePathSegment(workItemId)}/ai-draft`),
      { method: 'POST', body: { ...request } },
    );
  }
}

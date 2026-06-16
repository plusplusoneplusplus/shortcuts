import type {
  CreateWorkItemFromChatRequest,
  CreateWorkItemRequest,
  ConvertWorkItemTrackerResponse,
  ApplyWorkItemAiDraftRequest,
  ApplyWorkItemAiDraftResponse,
  ExecuteWorkItemRequest,
  ExecuteWorkItemResponse,
  ImportFromAzureBoardsRequest,
  ImportFromGitHubRequest,
  ImproveWorkItemAiDraftRequest,
  NewWorkItemAiDraftRequest,
  RequestWorkItemChangesRequest,
  RequestWorkItemChangesResponse,
  ResolveWorkItemCommentsRequest,
  SubmitWorkItemPullRequestRequest,
  SubmitWorkItemPullRequestResponse,
  StartWorkItemAiReviewRequest,
  StartWorkItemAiReviewResponse,
  WorkItemSyncProvider,
  WorkItemSyncStatusResponse,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemChatBinding,
  WorkItemChatBindingListResponse,
  WorkItemChatFreshResponse,
  WorkItemAiGenerationResponse,
  WorkItemFilter,
  WorkItemGroupedResponse,
  WorkItemListResponse,
  WorkItemPlanRefineRequest,
  WorkItemPlanRefineResponse,
  WorkItemPlanResponse,
  WorkItemPlanRestoreRequest,
  WorkItemPlanRestoreResponse,
  WorkItemPlanUpdateResponse,
  WorkItemPlanVersion,
  WorkItemPlanVersionComparison,
  WorkItemTreeFilter,
  WorkItemTreeResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function path(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/work-items${suffix}`;
}

function originPath(originId: string, suffix = ''): string {
  return `/origins/${encodePathSegment(originId)}/work-items${suffix}`;
}

export interface WorkItemOriginScopeOptions {
  /**
   * Concrete workspace root to use when an origin-scoped mutation needs
   * provider/filesystem semantics. Read-only calls can omit this.
   */
  workspaceId?: string;
}

function serializeFilter(filter?: WorkItemFilter): Record<string, string | number | undefined> | undefined {
  if (!filter) return undefined;
  return {
    ...filter,
    status: Array.isArray(filter.status) ? filter.status.join(',') : filter.status,
    tags: filter.tags?.join(','),
  };
}

function withWorkspaceQuery(
  query: Record<string, string | number | boolean | undefined> | undefined,
  options?: WorkItemOriginScopeOptions,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!options?.workspaceId) return query;
  return { ...query, workspaceId: options.workspaceId };
}

function withWorkspaceBody<T extends Record<string, unknown>>(
  body: T,
  options?: WorkItemOriginScopeOptions,
): T & { workspaceId?: string } {
  if (!options?.workspaceId) return body;
  return { ...body, workspaceId: options.workspaceId };
}

function serializeTreeFilter(filter?: WorkItemTreeFilter): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (filter?.q) query.q = filter.q;
  if (filter?.type) query.type = filter.type;
  if (filter?.status) query.status = filter.status;
  if (filter?.tracker) query.tracker = filter.tracker;
  if (filter?.includeArchived !== undefined) query.includeArchived = filter.includeArchived;
  if (filter?.includeDone !== undefined) query.includeDone = filter.includeDone;
  return query;
}

export class WorkItemsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(workspaceId: string, filter?: WorkItemFilter): Promise<WorkItemListResponse> {
    return this.transport.request<WorkItemListResponse>(path(workspaceId), { query: serializeFilter(filter) });
  }

  listForOrigin(originId: string, filter?: WorkItemFilter, options?: WorkItemOriginScopeOptions): Promise<WorkItemListResponse> {
    return this.transport.request<WorkItemListResponse>(originPath(originId), {
      query: withWorkspaceQuery(serializeFilter(filter), options),
    });
  }

  grouped(workspaceId: string, filter?: Omit<WorkItemFilter, 'status' | 'offset'>): Promise<WorkItemGroupedResponse> {
    return this.transport.request<WorkItemGroupedResponse>(path(workspaceId, '/grouped'), { query: serializeFilter(filter) });
  }

  groupedForOrigin(originId: string, filter?: Omit<WorkItemFilter, 'status' | 'offset'>, options?: WorkItemOriginScopeOptions): Promise<WorkItemGroupedResponse> {
    return this.transport.request<WorkItemGroupedResponse>(originPath(originId, '/grouped'), {
      query: withWorkspaceQuery(serializeFilter(filter), options),
    });
  }

  create(workspaceId: string, request: CreateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId), { method: 'POST', body: { ...request } });
  }

  createForOrigin(originId: string, request: CreateWorkItemRequest, options?: WorkItemOriginScopeOptions): Promise<WorkItem> {
    return this.transport.request<WorkItem>(originPath(originId), {
      method: 'POST',
      body: withWorkspaceBody({ ...request }, options),
    });
  }

  createFromChat(workspaceId: string, request: CreateWorkItemFromChatRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, '/from-chat'), { method: 'POST', body: { ...request } });
  }

  get(workspaceId: string, workItemId: string): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`));
  }

  getForOrigin(originId: string, workItemId: string, options?: WorkItemOriginScopeOptions): Promise<WorkItem> {
    return this.transport.request<WorkItem>(originPath(originId, `/${encodePathSegment(workItemId)}`), {
      query: withWorkspaceQuery(undefined, options),
    });
  }

  update(workspaceId: string, workItemId: string, request: UpdateWorkItemRequest): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}`), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  updateForOrigin(originId: string, workItemId: string, request: UpdateWorkItemRequest, options?: WorkItemOriginScopeOptions): Promise<WorkItem> {
    return this.transport.request<WorkItem>(originPath(originId, `/${encodePathSegment(workItemId)}`), {
      method: 'PATCH',
      body: withWorkspaceBody({ ...request }, options),
    });
  }

  updateStatus(workspaceId: string, workItemId: string, status: string, options?: Pick<UpdateWorkItemRequest, 'completedAt'>): Promise<WorkItem> {
    return this.update(workspaceId, workItemId, { status, ...options });
  }

  updateStatusForOrigin(
    originId: string,
    workItemId: string,
    status: string,
    request?: Pick<UpdateWorkItemRequest, 'completedAt'>,
    options?: WorkItemOriginScopeOptions,
  ): Promise<WorkItem> {
    return this.updateForOrigin(originId, workItemId, { status, ...request }, options);
  }

  delete(workspaceId: string, workItemId: string): Promise<void> {
    return this.transport.request<void>(path(workspaceId, `/${encodePathSegment(workItemId)}`), { method: 'DELETE' });
  }

  deleteForOrigin(originId: string, workItemId: string, options?: WorkItemOriginScopeOptions): Promise<void> {
    return this.transport.request<void>(originPath(originId, `/${encodePathSegment(workItemId)}`), {
      method: 'DELETE',
      query: withWorkspaceQuery(undefined, options),
    });
  }

  pin(workspaceId: string, workItemId: string, pinned: boolean): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}/pin`), {
      method: 'PATCH',
      body: { pinned },
    });
  }

  pinForOrigin(originId: string, workItemId: string, pinned: boolean, options?: WorkItemOriginScopeOptions): Promise<WorkItem> {
    return this.transport.request<WorkItem>(originPath(originId, `/${encodePathSegment(workItemId)}/pin`), {
      method: 'PATCH',
      body: withWorkspaceBody({ pinned }, options),
    });
  }

  archive(workspaceId: string, workItemId: string, archived: boolean): Promise<WorkItem> {
    return this.transport.request<WorkItem>(path(workspaceId, `/${encodePathSegment(workItemId)}/archive`), {
      method: 'PATCH',
      body: { archived },
    });
  }

  archiveForOrigin(originId: string, workItemId: string, archived: boolean, options?: WorkItemOriginScopeOptions): Promise<WorkItem> {
    return this.transport.request<WorkItem>(originPath(originId, `/${encodePathSegment(workItemId)}/archive`), {
      method: 'PATCH',
      body: withWorkspaceBody({ archived }, options),
    });
  }

  requestChanges(workspaceId: string, workItemId: string, request: RequestWorkItemChangesRequest): Promise<RequestWorkItemChangesResponse> {
    return this.transport.request<RequestWorkItemChangesResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/request-changes`), {
      method: 'POST',
      body: { ...request },
    });
  }

  requestChangesForOrigin(
    originId: string,
    workItemId: string,
    request: RequestWorkItemChangesRequest,
    options?: WorkItemOriginScopeOptions,
  ): Promise<RequestWorkItemChangesResponse> {
    return this.transport.request<RequestWorkItemChangesResponse>(originPath(originId, `/${encodePathSegment(workItemId)}/request-changes`), {
      method: 'POST',
      body: withWorkspaceBody({ ...request }, options),
    });
  }

  submitPullRequest(
    workspaceId: string,
    workItemId: string,
    request: SubmitWorkItemPullRequestRequest = {},
  ): Promise<SubmitWorkItemPullRequestResponse> {
    return this.transport.request<SubmitWorkItemPullRequestResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/submit-pr`), {
      method: 'POST',
      body: { ...request },
    });
  }

  startAiReview(
    workspaceId: string,
    workItemId: string,
    request: StartWorkItemAiReviewRequest = {},
  ): Promise<StartWorkItemAiReviewResponse> {
    return this.transport.request<StartWorkItemAiReviewResponse>(path(workspaceId, `/${encodePathSegment(workItemId)}/ai-review`), {
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

  comparePlanVersions(workspaceId: string, workItemId: string, baseVersion: number, targetVersion: number): Promise<WorkItemPlanVersionComparison> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/versions/compare`), {
      query: { base: baseVersion, target: targetVersion },
    });
  }

  restorePlanVersion(
    workspaceId: string,
    workItemId: string,
    version: number,
    request: WorkItemPlanRestoreRequest = {},
  ): Promise<WorkItemPlanRestoreResponse> {
    return this.transport.request(path(workspaceId, `/${encodePathSegment(workItemId)}/plan/versions/${version}/restore`), {
      method: 'POST',
      body: { ...request },
    });
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

  listChatBindings(workspaceId: string): Promise<WorkItemChatBindingListResponse> {
    return this.transport.request<WorkItemChatBindingListResponse>(`/workspaces/${encodePathSegment(workspaceId)}/work-item-chat-bindings`);
  }

  getChatBinding(workspaceId: string, workItemId: string): Promise<WorkItemChatBinding> {
    return this.transport.request<WorkItemChatBinding>(
      `/workspaces/${encodePathSegment(workspaceId)}/work-item-chat-bindings/${encodePathSegment(workItemId)}`,
    );
  }

  createChatBinding(workspaceId: string, workItemId: string, taskId: string): Promise<WorkItemChatBinding> {
    return this.transport.request<WorkItemChatBinding>(
      `/workspaces/${encodePathSegment(workspaceId)}/work-item-chat-bindings`,
      { method: 'POST', body: { workItemId, taskId } },
    );
  }

  deleteChatBinding(workspaceId: string, workItemId: string): Promise<void> {
    return this.transport.request<void>(
      `/workspaces/${encodePathSegment(workspaceId)}/work-item-chat-bindings/${encodePathSegment(workItemId)}`,
      { method: 'DELETE' },
    );
  }

  startFreshChat(workspaceId: string, workItemId: string): Promise<WorkItemChatFreshResponse> {
    return this.transport.request<WorkItemChatFreshResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/work-item-chat-bindings/${encodePathSegment(workItemId)}/fresh`,
      { method: 'POST', body: {} },
    );
  }

  tree(workspaceId: string, filter?: WorkItemTreeFilter): Promise<WorkItemTreeResponse> {
    return this.transport.request<WorkItemTreeResponse>(path(workspaceId, '/tree'), { query: serializeTreeFilter(filter) });
  }

  treeForOrigin(originId: string, filter?: WorkItemTreeFilter, options?: WorkItemOriginScopeOptions): Promise<WorkItemTreeResponse> {
    return this.transport.request<WorkItemTreeResponse>(originPath(originId, '/tree'), {
      query: withWorkspaceQuery(serializeTreeFilter(filter), options),
    });
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

  applyAiDraft(
    workspaceId: string,
    workItemId: string,
    request: ApplyWorkItemAiDraftRequest,
    options: Pick<CocRequestOptions, 'signal'> = {},
  ): Promise<ApplyWorkItemAiDraftResponse> {
    return this.transport.request<ApplyWorkItemAiDraftResponse>(
      path(workspaceId, `/${encodePathSegment(workItemId)}/ai-draft/apply`),
      { method: 'POST', body: { ...request }, ...options },
    );
  }
}

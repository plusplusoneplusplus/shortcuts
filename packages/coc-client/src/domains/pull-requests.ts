import type {
  ClassificationBatchStatusQuery,
  ClassificationBatchStatusResponse,
  ClassificationStatusResponse,
  AddPullRequestCoworkerRosterEntryRequest,
  ClassifyDiffRequest,
  ClassifyDiffResponse,
  ProviderConfigRequest,
  PullRequestCoworkerRosterResponse,
  PrReviewHistoryResponse,
  PrSuggestionsResponse,
  PullRequestChatBinding,
  PullRequestChatBindingListResponse,
  PullRequestChatFreshResponse,
  PullRequestChecksResponse,
  PullRequestCommitsResponse,
  PullRequestListQuery,
  PullRequestListResponse,
  PullRequestReviewProgressRecord,
  PullRequestReviewersResponse,
  PullRequestThreadsResponse,
  RecentOpenedPullRequestsResponse,
  RecordRecentOpenedPullRequestRequest,
  SavePullRequestReviewProgressRequest,
  SanitizedProviderConfigResponse,
  TeamPrAutoClassificationRequest,
  TeamPrAutoClassificationResponse,
} from '../contracts';
import type { CocRequestOptions, NormalizedCocClientOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function serializePrListQuery(query?: PullRequestListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    workspaceId: query.workspaceId,
    status: query.status,
    scope: query.scope,
    top: query.top,
    skip: query.skip,
    force: query.force === true ? 'true' : undefined,
    author: query.author,
    search: query.search,
  };
}

type OriginPrStateOptions = Pick<CocRequestOptions, 'signal'> & {
  workspaceId?: string;
  repoId?: string;
};

type OriginPrProviderOptions = Pick<CocRequestOptions, 'signal'> & {
  workspaceId: string;
  repoId?: string;
};

type OriginPrDetailOptions = OriginPrProviderOptions & {
  force?: boolean;
};

function serializeOriginPrStateQuery(options?: OriginPrStateOptions): CocRequestOptions['query'] {
  if (!options?.workspaceId && !options?.repoId) return undefined;
  return {
    workspaceId: options.workspaceId,
    repoId: options.repoId,
  };
}

function serializeOriginPrListQuery(query: PullRequestListQuery & { workspaceId: string; repoId?: string }): CocRequestOptions['query'] {
  return {
    ...serializePrListQuery(query),
    workspaceId: query.workspaceId,
    repoId: query.repoId,
  };
}

function serializeOriginPrDetailQuery(options: OriginPrDetailOptions): CocRequestOptions['query'] {
  return {
    workspaceId: options.workspaceId,
    repoId: options.repoId,
    force: options.force === true ? 'true' : undefined,
  };
}

function withOriginPrStateBody<T extends Record<string, unknown>>(body: T, options?: OriginPrStateOptions): T & { workspaceId?: string; repoId?: string } {
  return {
    ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {}),
    ...(options?.repoId ? { repoId: options.repoId } : {}),
    ...body,
  };
}

function serializeClassificationBatchStatusQuery(query: ClassificationBatchStatusQuery): CocRequestOptions['query'] {
  return {
    type: query.type,
    identifiers: query.identifiers.join(','),
    workspaceId: query.workspaceId,
    repoId: query.repoId,
  };
}

export class PullRequestsClient {
  constructor(
    private readonly transport: RequestAdapter,
    private readonly options?: NormalizedCocClientOptions,
  ) {}

  getProviderConfig(): Promise<SanitizedProviderConfigResponse> {
    return this.transport.request<SanitizedProviderConfigResponse>('/providers/config');
  }

  saveProviderConfig(config: ProviderConfigRequest): Promise<void> {
    return this.transport.request<void>('/providers/config', {
      method: 'PUT',
      body: { ...config },
    });
  }

  list(repoId: string, query?: PullRequestListQuery, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestListResponse> {
    return this.transport.request<PullRequestListResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests`, {
      query: serializePrListQuery(query),
      signal: options?.signal,
    });
  }

  listForOrigin(
    originId: string,
    query: PullRequestListQuery & { workspaceId: string; repoId?: string },
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<PullRequestListResponse> {
    return this.transport.request<PullRequestListResponse>(`/origins/${encodePathSegment(originId)}/pull-requests`, {
      query: serializeOriginPrListQuery(query),
      signal: options?.signal,
    });
  }

  get(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'> & { force?: boolean }): Promise<unknown> {
    return this.transport.request<unknown>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}`, {
      query: options?.force ? { force: 'true' } : undefined,
      signal: options?.signal,
    });
  }

  getForOrigin(originId: string, prId: string, options: OriginPrDetailOptions): Promise<unknown> {
    return this.transport.request<unknown>(`/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}`, {
      query: serializeOriginPrDetailQuery(options),
      signal: options.signal,
    });
  }

  listRecentOpened(repoId: string, workspaceId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/recent-opened`,
      {
        query: { workspaceId },
        signal: options?.signal,
      },
    );
  }

  recordRecentOpened(
    repoId: string,
    workspaceId: string,
    entry: RecordRecentOpenedPullRequestRequest,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/recent-opened`,
      {
        method: 'POST',
        body: { workspaceId, ...entry },
        signal: options?.signal,
      },
    );
  }

  removeRecentOpened(
    repoId: string,
    workspaceId: string,
    prNumber: number,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/recent-opened/${encodePathSegment(String(prNumber))}`,
      {
        method: 'DELETE',
        query: { workspaceId },
        signal: options?.signal,
      },
    );
  }

  listRecentOpenedForOrigin(originId: string, options?: OriginPrStateOptions): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/recent-opened`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  recordRecentOpenedForOrigin(
    originId: string,
    entry: RecordRecentOpenedPullRequestRequest,
    options?: OriginPrStateOptions,
  ): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/recent-opened`,
      {
        method: 'POST',
        body: withOriginPrStateBody({ ...entry }, options),
        signal: options?.signal,
      },
    );
  }

  removeRecentOpenedForOrigin(
    originId: string,
    prNumber: number,
    options?: OriginPrStateOptions,
  ): Promise<RecentOpenedPullRequestsResponse> {
    return this.transport.request<RecentOpenedPullRequestsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/recent-opened/${encodePathSegment(String(prNumber))}`,
      {
        method: 'DELETE',
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  listCoworkerRoster(repoId: string, workspaceId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/coworker-roster`,
      {
        query: { workspaceId },
        signal: options?.signal,
      },
    );
  }

  addCoworkerToRoster(
    repoId: string,
    workspaceId: string,
    entry: AddPullRequestCoworkerRosterEntryRequest,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/coworker-roster`,
      {
        method: 'POST',
        body: { workspaceId, ...entry },
        signal: options?.signal,
      },
    );
  }

  removeCoworkerFromRoster(
    repoId: string,
    workspaceId: string,
    coworkerKey: string,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/coworker-roster/${encodePathSegment(coworkerKey)}`,
      {
        method: 'DELETE',
        query: { workspaceId },
        signal: options?.signal,
      },
    );
  }

  listCoworkerRosterForOrigin(originId: string, options?: OriginPrStateOptions): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/coworker-roster`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  addCoworkerToRosterForOrigin(
    originId: string,
    entry: AddPullRequestCoworkerRosterEntryRequest,
    options?: OriginPrStateOptions,
  ): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/coworker-roster`,
      {
        method: 'POST',
        body: withOriginPrStateBody({ ...entry }, options),
        signal: options?.signal,
      },
    );
  }

  removeCoworkerFromRosterForOrigin(
    originId: string,
    coworkerKey: string,
    options?: OriginPrStateOptions,
  ): Promise<PullRequestCoworkerRosterResponse> {
    return this.transport.request<PullRequestCoworkerRosterResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/coworker-roster/${encodePathSegment(coworkerKey)}`,
      {
        method: 'DELETE',
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  getThreads(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestThreadsResponse> {
    return this.transport.request<PullRequestThreadsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/threads`, {
      signal: options?.signal,
    });
  }

  getThreadsForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestThreadsResponse> {
    return this.transport.request<PullRequestThreadsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/threads`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
  }

  getReviewers(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestReviewersResponse> {
    return this.transport.request<PullRequestReviewersResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/reviewers`, {
      signal: options?.signal,
    });
  }

  getReviewersForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestReviewersResponse> {
    return this.transport.request<PullRequestReviewersResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/reviewers`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
  }

  getCommits(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestCommitsResponse> {
    return this.transport.request<PullRequestCommitsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/commits`, {
      signal: options?.signal,
    });
  }

  getCommitsForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestCommitsResponse> {
    return this.transport.request<PullRequestCommitsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/commits`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
  }

  getDiff(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<string> {
    const reqOptions: CocRequestOptions = { signal: options?.signal };
    if (this.transport.requestText) {
      return this.transport.requestText(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`, reqOptions);
    }
    return this.transport.request<string>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`, reqOptions);
  }

  getDiffForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<string> {
    const reqOptions: CocRequestOptions = {
      query: serializeOriginPrStateQuery(options),
      signal: options.signal,
    };
    const path = `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/diff`;
    if (this.transport.requestText) {
      return this.transport.requestText(path, reqOptions);
    }
    return this.transport.request<string>(path, reqOptions);
  }

  prFileDiffPath(repoId: string, prId: string, filePath: string): string {
    return `/api/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff/files/${encodePathSegment(filePath)}`;
  }

  prDiffPathForOrigin(originId: string, prId: string, options: { workspaceId: string; repoId?: string }): string {
    const query = new URLSearchParams();
    query.set('workspaceId', options.workspaceId);
    if (options.repoId) query.set('repoId', options.repoId);
    return `/api/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/diff?${query.toString()}`;
  }

  prFileDiffPathForOrigin(
    originId: string,
    prId: string,
    filePath: string,
    options: { workspaceId: string; repoId?: string; fullContext?: boolean },
  ): string {
    const query = new URLSearchParams();
    query.set('workspaceId', options.workspaceId);
    if (options.repoId) query.set('repoId', options.repoId);
    if (options.fullContext === true) query.set('fullContext', 'true');
    return `/api/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/diff/files/${encodePathSegment(filePath)}?${query.toString()}`;
  }

  getChecks(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestChecksResponse> {
    return this.transport.request<PullRequestChecksResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/checks`, {
      signal: options?.signal,
    });
  }

  getChecksForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestChecksResponse> {
    return this.transport.request<PullRequestChecksResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/checks`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
  }

  // ── Pull-request chat bindings ──────────────────────────────────

  listChatBindings(workspaceId: string): Promise<PullRequestChatBindingListResponse> {
    return this.transport.request<PullRequestChatBindingListResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/pull-request-chat-bindings`,
    );
  }

  getChatBinding(workspaceId: string, prId: string): Promise<PullRequestChatBinding> {
    return this.transport.request<PullRequestChatBinding>(
      `/workspaces/${encodePathSegment(workspaceId)}/pull-request-chat-bindings/${encodePathSegment(prId)}`,
    );
  }

  createChatBinding(workspaceId: string, prId: string, taskId: string): Promise<PullRequestChatBinding> {
    return this.transport.request<PullRequestChatBinding>(
      `/workspaces/${encodePathSegment(workspaceId)}/pull-request-chat-bindings`,
      { method: 'POST', body: { prId, taskId } },
    );
  }

  deleteChatBinding(workspaceId: string, prId: string): Promise<void> {
    return this.transport.request<void>(
      `/workspaces/${encodePathSegment(workspaceId)}/pull-request-chat-bindings/${encodePathSegment(prId)}`,
      { method: 'DELETE' },
    );
  }

  startFreshChat(workspaceId: string, prId: string): Promise<PullRequestChatFreshResponse> {
    return this.transport.request<PullRequestChatFreshResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/pull-request-chat-bindings/${encodePathSegment(prId)}/fresh`,
      { method: 'POST', body: {} },
    );
  }

  listChatBindingsForOrigin(originId: string): Promise<PullRequestChatBindingListResponse> {
    return this.transport.request<PullRequestChatBindingListResponse>(
      `/origins/${encodePathSegment(originId)}/pull-request-chat-bindings`,
    );
  }

  getChatBindingForOrigin(originId: string, prId: string): Promise<PullRequestChatBinding> {
    return this.transport.request<PullRequestChatBinding>(
      `/origins/${encodePathSegment(originId)}/pull-request-chat-bindings/${encodePathSegment(prId)}`,
    );
  }

  createChatBindingForOrigin(originId: string, prId: string, taskId: string): Promise<PullRequestChatBinding> {
    return this.transport.request<PullRequestChatBinding>(
      `/origins/${encodePathSegment(originId)}/pull-request-chat-bindings`,
      { method: 'POST', body: { prId, taskId } },
    );
  }

  deleteChatBindingForOrigin(originId: string, prId: string): Promise<void> {
    return this.transport.request<void>(
      `/origins/${encodePathSegment(originId)}/pull-request-chat-bindings/${encodePathSegment(prId)}`,
      { method: 'DELETE' },
    );
  }

  startFreshChatForOrigin(originId: string, prId: string, workspaceId: string): Promise<PullRequestChatFreshResponse> {
    return this.transport.request<PullRequestChatFreshResponse>(
      `/origins/${encodePathSegment(originId)}/pull-request-chat-bindings/${encodePathSegment(prId)}/fresh`,
      { method: 'POST', body: {}, query: { workspaceId } },
    );
  }

  /** Trigger on-demand AI classification of a PR's diff hunks. */
  classify(repoId: string, prId: string, body: ClassifyDiffRequest, options?: Pick<CocRequestOptions, 'signal'>): Promise<ClassifyDiffResponse> {
    return this.transport.request<ClassifyDiffResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/classify`,
      {
        method: 'POST',
        body: { ...body },
        signal: options?.signal,
      },
    );
  }

  /** Get cached classification result for a PR. */
  getClassification(repoId: string, prId: string, headSha: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ClassificationStatusResponse> {
    return this.transport.request<ClassificationStatusResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/classification`,
      {
        query: { headSha },
        signal: options?.signal,
      },
    );
  }

  /** Get cached/running status for a batch of classification identifiers. */
  getClassificationBatchStatus(repoId: string, query: ClassificationBatchStatusQuery, options?: Pick<CocRequestOptions, 'signal'>): Promise<ClassificationBatchStatusResponse> {
    return this.transport.request<ClassificationBatchStatusResponse>(
      `/repos/${encodePathSegment(repoId)}/classify-diff/batch-status`,
      {
        query: serializeClassificationBatchStatusQuery(query),
        signal: options?.signal,
      },
    );
  }

  /** Get cached/running PR classification status for a batch of identifiers under a canonical origin. */
  getClassificationBatchStatusForOrigin(
    originId: string,
    query: ClassificationBatchStatusQuery,
    options?: Pick<CocRequestOptions, 'signal'>,
  ): Promise<ClassificationBatchStatusResponse> {
    return this.transport.request<ClassificationBatchStatusResponse>(
      `/origins/${encodePathSegment(originId)}/classify-diff/batch-status`,
      {
        query: serializeClassificationBatchStatusQuery(query),
        signal: options?.signal,
      },
    );
  }

  /** Trigger bounded Team PR auto-classification using the server cap/skip helper. */
  autoClassifyTeam(repoId: string, body: TeamPrAutoClassificationRequest, options?: Pick<CocRequestOptions, 'signal'>): Promise<TeamPrAutoClassificationResponse> {
    return this.transport.request<TeamPrAutoClassificationResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/team-auto-classification`,
      {
        method: 'POST',
        body: { ...body },
        signal: options?.signal,
      },
    );
  }

  /** Trigger bounded Team PR auto-classification under a canonical origin. */
  autoClassifyTeamForOrigin(
    originId: string,
    body: TeamPrAutoClassificationRequest,
    options?: OriginPrStateOptions,
  ): Promise<TeamPrAutoClassificationResponse> {
    return this.transport.request<TeamPrAutoClassificationResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/team-auto-classification`,
      {
        method: 'POST',
        body: withOriginPrStateBody({ ...body }, options),
        signal: options?.signal,
      },
    );
  }

  /** Get persisted PR pop-out reviewer progress for a canonical origin. */
  getReviewProgressForOrigin(
    originId: string,
    prId: string,
    headSha: string,
    options?: OriginPrStateOptions,
  ): Promise<PullRequestReviewProgressRecord> {
    return this.transport.request<PullRequestReviewProgressRecord>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/review-progress`,
      {
        query: {
          ...serializeOriginPrStateQuery(options),
          headSha,
        },
        signal: options?.signal,
      },
    );
  }

  /** Persist PR pop-out reviewer progress for a canonical origin. */
  saveReviewProgressForOrigin(
    originId: string,
    prId: string,
    body: SavePullRequestReviewProgressRequest,
    options?: OriginPrStateOptions,
  ): Promise<PullRequestReviewProgressRecord> {
    return this.transport.request<PullRequestReviewProgressRecord>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/review-progress`,
      {
        method: 'PUT',
        body: withOriginPrStateBody({ ...body }, options),
        signal: options?.signal,
      },
    );
  }

  // ── PR review suggestions ──────────────────────────────────────

  /** Get cached PR suggestions (top-5 LLM-ranked PRs for the user). */
  getSuggestions(repoId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/suggestions`,
      { signal: options?.signal },
    );
  }

  /** Get cached PR suggestions under a canonical origin. */
  getSuggestionsForOrigin(originId: string, options?: OriginPrStateOptions): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/suggestions`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  /** Refresh the cached review history used to seed PR suggestions. */
  refreshReviewHistory(repoId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PrReviewHistoryResponse> {
    return this.transport.request<PrReviewHistoryResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/review-history/refresh`,
      { method: 'POST', signal: options?.signal },
    );
  }

  /** Refresh the cached review history under a canonical origin using a selected workspace. */
  refreshReviewHistoryForOrigin(originId: string, options?: OriginPrStateOptions): Promise<PrReviewHistoryResponse> {
    return this.transport.request<PrReviewHistoryResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/review-history/refresh`,
      {
        method: 'POST',
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }

  /** Refresh PR suggestions by re-ranking cached review history via LLM. */
  refreshSuggestions(repoId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/suggestions/refresh`,
      { method: 'POST', signal: options?.signal },
    );
  }

  /** Refresh PR suggestions by re-ranking origin-scoped review history via LLM. */
  refreshSuggestionsForOrigin(originId: string, options?: OriginPrStateOptions): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/suggestions/refresh`,
      {
        method: 'POST',
        query: serializeOriginPrStateQuery(options),
        signal: options?.signal,
      },
    );
  }
}

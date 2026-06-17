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

  getForOrigin(originId: string, prId: string, options: OriginPrDetailOptions): Promise<unknown> {
    return this.transport.request<unknown>(`/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}`, {
      query: serializeOriginPrDetailQuery(options),
      signal: options.signal,
    });
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

  getThreadsForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestThreadsResponse> {
    return this.transport.request<PullRequestThreadsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/threads`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
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

  getCommitsForOrigin(originId: string, prId: string, options: OriginPrProviderOptions): Promise<PullRequestCommitsResponse> {
    return this.transport.request<PullRequestCommitsResponse>(
      `/origins/${encodePathSegment(originId)}/pull-requests/${encodePathSegment(prId)}/commits`,
      {
        query: serializeOriginPrStateQuery(options),
        signal: options.signal,
      },
    );
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

  /** Trigger on-demand AI classification of a PR's diff hunks under a canonical origin. */
  classifyForOrigin(
    originId: string,
    prId: string,
    body: ClassifyDiffRequest,
    options?: OriginPrProviderOptions,
  ): Promise<ClassifyDiffResponse> {
    return this.transport.request<ClassifyDiffResponse>(
      `/origins/${encodePathSegment(originId)}/classify-diff`,
      {
        method: 'POST',
        body: withOriginPrStateBody({
          type: 'pr',
          identifier: `${prId}:${body.headSha}`,
          ...(body.model ? { model: body.model } : {}),
        }, options),
        signal: options?.signal,
      },
    );
  }

  /** Get cached classification result for a PR under a canonical origin. */
  getClassificationForOrigin(
    originId: string,
    prId: string,
    headSha: string,
    options?: OriginPrStateOptions,
  ): Promise<ClassificationStatusResponse> {
    return this.transport.request<ClassificationStatusResponse>(
      `/origins/${encodePathSegment(originId)}/classify-diff`,
      {
        query: {
          type: 'pr',
          identifier: `${prId}:${headSha}`,
          ...serializeOriginPrStateQuery(options),
        },
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

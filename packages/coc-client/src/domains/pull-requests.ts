import type {
  ClassificationStatusResponse,
  ClassifyDiffRequest,
  ClassifyDiffResponse,
  ProviderConfigRequest,
  PrSuggestionsResponse,
  PullRequestChatBinding,
  PullRequestChatBindingListResponse,
  PullRequestChecksResponse,
  PullRequestCommitsResponse,
  PullRequestListQuery,
  PullRequestListResponse,
  PullRequestReviewersResponse,
  PullRequestThreadsResponse,
  SanitizedProviderConfigResponse,
} from '../contracts';
import type { CocRequestOptions, NormalizedCocClientOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function serializePrListQuery(query?: PullRequestListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    status: query.status,
    scope: query.scope,
    top: query.top,
    skip: query.skip,
    force: query.force === true ? 'true' : undefined,
    author: query.author,
    search: query.search,
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

  get(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'> & { force?: boolean }): Promise<unknown> {
    return this.transport.request<unknown>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}`, {
      query: options?.force ? { force: 'true' } : undefined,
      signal: options?.signal,
    });
  }

  getThreads(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestThreadsResponse> {
    return this.transport.request<PullRequestThreadsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/threads`, {
      signal: options?.signal,
    });
  }

  getReviewers(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestReviewersResponse> {
    return this.transport.request<PullRequestReviewersResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/reviewers`, {
      signal: options?.signal,
    });
  }

  getCommits(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestCommitsResponse> {
    return this.transport.request<PullRequestCommitsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/commits`, {
      signal: options?.signal,
    });
  }

  getDiff(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<string> {
    const reqOptions: CocRequestOptions = { signal: options?.signal };
    if (this.transport.requestText) {
      return this.transport.requestText(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`, reqOptions);
    }
    return this.transport.request<string>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`, reqOptions);
  }

  prFileDiffPath(repoId: string, prId: string, filePath: string): string {
    return `/api/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff/files/${encodePathSegment(filePath)}`;
  }

  getChecks(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestChecksResponse> {
    return this.transport.request<PullRequestChecksResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/checks`, {
      signal: options?.signal,
    });
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

  // ── PR review suggestions ──────────────────────────────────────

  /** Get cached PR suggestions (top-5 LLM-ranked PRs for the user). */
  getSuggestions(repoId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/suggestions`,
      { signal: options?.signal },
    );
  }

  /** Refresh PR suggestions: re-fetch review history and re-rank via LLM. */
  refreshSuggestions(repoId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PrSuggestionsResponse> {
    return this.transport.request<PrSuggestionsResponse>(
      `/repos/${encodePathSegment(repoId)}/pull-requests/suggestions/refresh`,
      { method: 'POST', signal: options?.signal },
    );
  }
}

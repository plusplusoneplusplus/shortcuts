import type {
  ProviderConfigRequest,
  PullRequestChecksResponse,
  PullRequestCommitsResponse,
  PullRequestListQuery,
  PullRequestListResponse,
  PullRequestCommitsResponse,
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

  get(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<unknown> {
    return this.transport.request<unknown>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}`, {
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

  getCommits(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestCommitsResponse> {
    return this.transport.request<PullRequestCommitsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/commits`, {
      signal: options?.signal,
    });
  }

  getChecks(repoId: string, prId: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<PullRequestChecksResponse> {
    return this.transport.request<PullRequestChecksResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/checks`, {
      signal: options?.signal,
    });
  }
}

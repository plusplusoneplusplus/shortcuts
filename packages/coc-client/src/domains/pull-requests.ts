import type {
  ProviderConfigRequest,
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

  list(repoId: string, query?: PullRequestListQuery): Promise<PullRequestListResponse> {
    return this.transport.request<PullRequestListResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests`, {
      query: serializePrListQuery(query),
    });
  }

  get(repoId: string, prId: string): Promise<unknown> {
    return this.transport.request<unknown>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}`);
  }

  getThreads(repoId: string, prId: string): Promise<PullRequestThreadsResponse> {
    return this.transport.request<PullRequestThreadsResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/threads`);
  }

  getReviewers(repoId: string, prId: string): Promise<PullRequestReviewersResponse> {
    return this.transport.request<PullRequestReviewersResponse>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/reviewers`);
  }

  getDiff(repoId: string, prId: string): Promise<string> {
    if (this.transport.requestText) {
      return this.transport.requestText(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`);
    }
    return this.transport.request<string>(`/repos/${encodePathSegment(repoId)}/pull-requests/${encodePathSegment(prId)}/diff`);
  }
}

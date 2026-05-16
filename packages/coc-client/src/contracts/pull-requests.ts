export interface GitHubProviderConfigRequest {
  token: string;
}

export interface AdoProviderConfigRequest {
  orgUrl: string;
  token?: string;
}

export interface TavilyProviderConfigRequest {
  apiKey: string;
}

export interface ProviderConfigRequest {
  github?: GitHubProviderConfigRequest;
  ado?: AdoProviderConfigRequest;
  tavily?: TavilyProviderConfigRequest;
}

export interface SanitizedProviderConfigResponse {
  providers: {
    github?: { hasToken: boolean };
    ado?: { orgUrl: string };
    tavily?: { hasApiKey: boolean };
  };
}

// ── PR data routes ──────────────────────────────────────────────────

export interface PullRequestListQuery {
  status?: string;
  scope?: 'mine' | 'all';
  top?: number;
  skip?: number;
  force?: boolean;
  author?: string;
  search?: string;
}

export interface PullRequestListResponse {
  pullRequests: unknown[];
  total: number;
  fetchedAt?: number;
}

export interface PullRequestThreadsResponse {
  threads: unknown[];
}

export interface PullRequestReviewersResponse {
  reviewers: unknown[];
}

export interface PullRequestCommitsResponse {
  commits: unknown[];
}

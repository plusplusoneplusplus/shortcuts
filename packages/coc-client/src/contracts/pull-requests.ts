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

// ── PR checks / CI status (provider-agnostic) ──────────────────────

/**
 * Status of a pull-request check. Mirrors the `CheckStatus` union from
 * `@plusplusoneplusplus/forge`'s provider abstraction.
 */
export type PullRequestCheckStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'warning'
  | 'unknown';

export type PullRequestCheckSource = 'check' | 'status';

/**
 * Generic, provider-agnostic check result. The server returns this shape
 * for both GitHub (check-runs + commit statuses) and ADO (PR statuses +
 * commit statuses) pull requests.
 */
export interface PullRequestCheck {
  id: string;
  name: string;
  group?: string;
  status: PullRequestCheckStatus;
  source: PullRequestCheckSource;
  description?: string;
  detailsUrl?: string;
  /** ISO 8601 string. */
  startedAt?: string;
  /** ISO 8601 string. */
  completedAt?: string;
  durationMs?: number;
}

export interface PullRequestChecksResponse {
  checks: PullRequestCheck[];
}

// ── PR chat bindings ───────────────────────────────────────────────

/** A single pull-request → chat task binding. */
export interface PullRequestChatBinding {
  prId: string;
  taskId: string;
}

/** Response shape for listing bindings; map keyed by prId. */
export interface PullRequestChatBindingListResponse {
  bindings: Record<string, { taskId: string; createdAt: string }>;
}

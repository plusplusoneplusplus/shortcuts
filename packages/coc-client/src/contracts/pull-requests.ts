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

export interface PullRequestDiffStats {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PullRequestListItem {
  [key: string]: unknown;
  diffStats?: PullRequestDiffStats;
}

export interface PullRequestListResponse {
  pullRequests: PullRequestListItem[];
  total: number;
  fetchedAt?: number;
}

// ── Recently opened PRs ─────────────────────────────────────────────

export interface RecentOpenedPullRequestEntry {
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  webUrl?: string;
  /** ISO 8601 string. */
  openedAt: string;
}

export interface RecentOpenedPullRequestsResponse {
  entries: RecentOpenedPullRequestEntry[];
}

export interface RecordRecentOpenedPullRequestRequest {
  number: number;
  title: string;
  webUrl?: string;
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

// ── Classification (focused-diff) ───────────────────────────────────

/** The four hunk categories recognised by the classifier. */
export type HunkCategory = 'logic' | 'mechanical' | 'test' | 'generated';

/** How important a hunk is within its category. */
export type HunkIntensity = 'high' | 'low';

/** Classification result for a single `@@` hunk. */
export interface HunkClassification {
  file: string;
  hunkIndex: number;
  category: HunkCategory;
  intensity: HunkIntensity;
  reason: string;
}

/** Full classification result for a PR diff. */
export interface DiffClassificationResult {
  classifications: HunkClassification[];
}

/** Body for POST /repos/:repoId/pull-requests/:prId/classify. */
export interface ClassifyDiffRequest {
  headSha: string;
  model?: string;
  workspaceId?: string;
}

/** Response from POST classify (trigger). */
export interface ClassifyDiffResponse {
  status: 'started' | 'ready' | 'running';
  taskId?: string;
  processId?: string;
  result?: DiffClassificationResult;
}

/** Response from GET classification (cached lookup). */
export interface ClassificationStatusResponse {
  status: 'none' | 'ready' | 'running';
  processId?: string;
  result?: DiffClassificationResult;
  createdAt?: string;
}

// ── PR review suggestions ──────────────────────────────────────────

/** A single suggested PR with relevance score. */
export interface PrSuggestion {
  prNumber: number;
  score: number;
}

/** A reviewed PR entry used to seed AI review suggestions. */
export interface ReviewedPullRequestSummary {
  number: number;
  title: string;
  author: { id: string; displayName: string; email?: string; avatarUrl?: string };
  filesChanged: string[];
  labels: string[];
  reviewedAt: string;
  targetBranch: string;
  url: string;
}

/** Response from review-history endpoints. */
export interface PrReviewHistoryResponse {
  reviews: ReviewedPullRequestSummary[];
  fetchedAt: string | null;
}

/** Response from GET/POST suggestions endpoints. */
export interface PrSuggestionsResponse {
  suggestions: PrSuggestion[];
  rankedAt: string | null;
}

/** Provider enum for selecting a backend implementation. */
export enum ProviderType {
    ADO = 'ado',
    GitHub = 'github',
}

// ── Shared entity types ──────────────────────────────────────

export interface Identity {
    id: string;
    displayName: string;
    /** Provider login/username (e.g. GitHub login). Distinct from displayName which may be a full name. */
    login?: string;
    email?: string;
    avatarUrl?: string;
}

export interface Comment {
    id: number | string;
    author: Identity;
    body: string;
    createdAt: Date;
    updatedAt?: Date;
    url?: string;
}

export interface CommentThread {
    id: number | string;
    comments: Comment[];
    status: 'active' | 'resolved' | 'closed' | 'unknown';
    createdAt: Date;
    threadContext?: {
        /** Repository-relative path for file-scoped review comments. */
        filePath?: string;
        /** 1-based line number on the side indicated by `side`. */
        line?: number;
        /** 1-based start line when the provider exposes a range. */
        startLine?: number;
        /** 1-based end line when the provider exposes a range. */
        endLine?: number;
        /** Diff side the line belongs to: right/new file or left/old file. */
        side?: 'right' | 'left' | 'unknown';
    };
}

export type PullRequestStatus = 'open' | 'closed' | 'merged' | 'draft';

export type ReviewVote =
    | 'approved'
    | 'approved-with-suggestions'
    | 'rejected'
    | 'no-vote'
    | 'waiting-for-author';

export interface Reviewer {
    identity: Identity;
    vote: ReviewVote;
    isRequired: boolean;
}

// ── Canonical auto-merge / auto-complete status ──────────────

/**
 * Unified lifecycle state for a pull request's auto-merge (GitHub) /
 * auto-complete (Azure DevOps) configuration.
 *
 * - `not-enabled` auto-merge / auto-complete is not set on the PR
 * - `armed`       enabled and waiting on requirements; will merge when ready
 * - `queued`      the merge is queued or in progress
 * - `blocked`     enabled but currently cannot complete (see `blockedReason`)
 */
export type AutoMergeState = 'not-enabled' | 'armed' | 'queued' | 'blocked';

/**
 * Why an armed auto-merge / auto-complete is currently blocked.
 *
 * - `failing-checks` one or more required/blocking checks are failing
 * - `pending-review` required reviews/approvals or branch policies not satisfied
 * - `conflicts`      the source branch conflicts with the target branch
 * - `blocked`        blocked for an unspecified / other reason
 */
export type AutoMergeBlockedReason =
    | 'failing-checks'
    | 'pending-review'
    | 'conflicts'
    | 'blocked';

/**
 * Provider-agnostic auto-merge / auto-complete status. GitHub adapters map it
 * from REST `pulls.get` (`auto_merge` / `mergeable` / `mergeable_state`); ADO
 * adapters map it from `autoCompleteSetBy` / `completionOptions` / `mergeStatus`.
 * The UI renders one indicator with a provider-aware label ("Auto-merge" for
 * GitHub, "Auto-complete" for Azure DevOps).
 */
export interface PullRequestAutoMerge {
    /** Whether auto-merge (GitHub) / auto-complete (ADO) is enabled. */
    enabled: boolean;
    /** Unified lifecycle state. */
    state: AutoMergeState;
    /** Identity that enabled auto-merge / auto-complete, when known. */
    enabledBy?: Identity;
    /**
     * Normalized merge method the provider will use when it completes:
     * 'merge' | 'squash' | 'rebase' | 'rebase-merge', when exposed.
     */
    mergeMethod?: string;
    /** Reason the merge is blocked — only set when `state` is 'blocked'. */
    blockedReason?: AutoMergeBlockedReason;
}

// ── Canonical pull-request check / status ────────────────────

/**
 * Generic, provider-agnostic status for a pull-request check or CI run.
 * Adapters map their native shapes (GitHub check-runs / commit statuses,
 * ADO pull-request statuses / commit statuses) into this fixed vocabulary.
 *
 * - `pending`   queued / not yet started
 * - `running`   in progress
 * - `success`   completed successfully (GitHub success/neutral, ADO succeeded)
 * - `failure`   completed with failure or error
 * - `cancelled` cancelled before completion
 * - `skipped`   skipped or not applicable (GitHub skipped, ADO notApplicable/partiallySucceeded treated as warning)
 * - `warning`   completed with non-blocking issues (GitHub action_required, ADO partiallySucceeded)
 * - `unknown`   unmapped state
 */
export type CheckStatus =
    | 'pending'
    | 'running'
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'skipped'
    | 'warning'
    | 'unknown';

/**
 * Source kind for a pull-request check. Used to distinguish modern check
 * runs from legacy commit statuses in the UI when desired.
 *
 * - `check`   GitHub check-run or ADO PR status (richer model)
 * - `status`  Legacy commit-status (per-context state on the head commit)
 */
export type CheckSource = 'check' | 'status';

/**
 * Canonical pull-request check / CI status. Adapters map native shapes
 * (GitHub check-runs, GitHub commit statuses, ADO pull-request statuses,
 * ADO commit statuses) into this shape.
 */
export interface PullRequestCheck {
    /** Stable, provider-scoped identifier (used for React keys). */
    id: string;
    /** Display name of the check (GitHub check-run name, ADO context name). */
    name: string;
    /** Optional group/category — GitHub app name, ADO status `genre`, etc. */
    group?: string;
    /** Generic status (see `CheckStatus`). */
    status: CheckStatus;
    /** Source kind — modern check vs. legacy commit-status. */
    source: CheckSource;
    /** Provider-specific description (e.g. summary line). */
    description?: string;
    /** Web URL with full check details, when exposed by the provider. */
    detailsUrl?: string;
    /** When the check started, if known. */
    startedAt?: Date;
    /** When the check completed, if known. */
    completedAt?: Date;
    /** Convenience: derived duration in milliseconds. */
    durationMs?: number;
    /** Provider-specific raw object, for fields not in the canonical shape. */
    raw?: unknown;
}

// ── Canonical commit on a pull request ───────────────────────

/**
 * Canonical commit shape exposed for a pull request. Provider-agnostic;
 * adapters map their native commit objects into this shape.
 */
export interface PullRequestCommit {
    /** Full commit SHA. */
    id: string;
    /** Short SHA (typically the first 7 chars). */
    shortId: string;
    /** Full commit message (subject + body if available). */
    message: string;
    /** First line of the commit message. */
    subject: string;
    /** Author identity. */
    author: Identity;
    /** Committer identity, if distinct from the author. */
    committer?: Identity;
    /** Author timestamp. */
    authoredAt: Date;
    /** Commit timestamp (commit creation). May equal `authoredAt`. */
    committedAt?: Date;
    /** Web URL for the commit, if exposed by the provider. */
    url?: string;
    /** Provider-specific raw object, for fields not in the canonical shape. */
    raw?: unknown;
}

// ── Reviewed pull-request summary (for review-history fetch) ─

/**
 * Lightweight summary of a pull request the user has previously reviewed.
 * Used by the PR-suggestion feature to learn the user's review patterns.
 */
export interface ReviewedPullRequest {
    /** PR number. */
    number: number;
    /** PR title at time of review. */
    title: string;
    /** PR author identity. */
    author: Identity;
    /** Repository-relative file paths changed in the PR. */
    filesChanged: string[];
    /** Labels on the PR at time of review. */
    labels: string[];
    /** When the user submitted their review. */
    reviewedAt: Date;
    /** Target branch (e.g. 'main'). */
    targetBranch: string;
    /** Web URL for the PR. */
    url: string;
}

// ── Canonical pull-request entity ────────────────────────────

export interface PullRequest {
    id: number | string;
    number: number;
    title: string;
    description: string;
    author: Identity;
    sourceBranch: string;
    targetBranch: string;
    status: PullRequestStatus;
    isDraft: boolean;
    createdAt: Date;
    updatedAt: Date;
    mergedAt?: Date;
    closedAt?: Date;
    url: string;
    repositoryId: string;
    reviewers: Reviewer[];
    labels: string[];
    /** SHA of the PR head (source branch tip) commit. */
    headSha?: string;
    /** SHA of the PR base (target branch) commit. */
    baseSha?: string;
    /**
     * Unified auto-merge (GitHub) / auto-complete (ADO) status, when resolvable.
     * Populated from the provider's PR-detail fetch; list responses may omit the
     * underlying source fields, in which case this reports `not-enabled`.
     */
    autoMerge?: PullRequestAutoMerge;
    /** Provider-specific raw object, for fields not in the canonical shape. */
    raw?: unknown;
}

// ── Canonical work-item entity ───────────────────────────────

export interface WorkItem {
    id: number | string;
    title: string;
    /** e.g. 'Bug', 'Task', 'Issue', 'User Story' */
    type: string;
    /** Provider-specific state string: 'Open', 'In Progress', 'Closed', etc. */
    state: string;
    assignees: Identity[];
    author: Identity;
    description: string;
    priority?: number;
    labels: string[];
    createdAt: Date;
    updatedAt: Date;
    closedAt?: Date;
    url: string;
    repositoryId?: string;
    projectId?: string;
    /** Provider-specific raw object. */
    raw?: unknown;
}

// ── Search / mutation input types ────────────────────────────

export interface SearchCriteria {
    status?: string;
    /** Explicit author/creator ID for server-side filtering. */
    authorId?: string;
    assigneeId?: string;
    sourceBranch?: string;
    targetBranch?: string;
    top?: number;
    skip?: number;
    /** Controls whether the adapter scopes results to the current user ('mine') or fetches all ('all'). Defaults to 'mine'. */
    scope?: 'mine' | 'all';
}

export interface CreatePullRequestInput {
    title: string;
    description?: string;
    sourceBranch: string;
    targetBranch: string;
    isDraft?: boolean;
    reviewerIds?: string[];
    labels?: string[];
}

export interface UpdatePullRequestInput {
    title?: string;
    description?: string;
    status?: PullRequestStatus;
    isDraft?: boolean;
}

export interface CreateWorkItemInput {
    title: string;
    description?: string;
    assigneeIds?: string[];
    priority?: number;
    labels?: string[];
    [field: string]: unknown;
}

export interface UpdateWorkItemInput {
    title?: string;
    description?: string;
    state?: string;
    assigneeIds?: string[];
    priority?: number;
    labels?: string[];
    [field: string]: unknown;
}

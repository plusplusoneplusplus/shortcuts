/** Minimal GitHub REST API types used by the GitHub adapters. */

export interface GitHubUser {
    id: number;
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string;
    html_url?: string;
}

export interface GitHubLabel {
    id: number;
    name: string;
    color: string;
}

export interface GitHubPullRequest {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user: GitHubUser;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    state: 'open' | 'closed';
    draft: boolean;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    closed_at: string | null;
    html_url: string;
    labels: GitHubLabel[];
}

export interface GitHubReview {
    id: number;
    user: GitHubUser;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
    submitted_at: string | null;
    html_url: string;
}

export interface GitHubComment {
    id: number;
    user: GitHubUser;
    body: string;
    created_at: string;
    updated_at: string;
    html_url: string;
    path?: string | null;
    line?: number | null;
    original_line?: number | null;
    start_line?: number | null;
    original_start_line?: number | null;
    side?: 'RIGHT' | 'LEFT' | null;
}

/**
 * Minimal shape of a commit returned by `GET /repos/{owner}/{repo}/pulls/{pull_number}/commits`.
 * Only the fields the adapter actually consumes are listed here.
 */
export interface GitHubPullRequestCommit {
    sha: string;
    html_url?: string;
    commit: {
        message: string;
        author?: { name?: string | null; email?: string | null; date?: string | null } | null;
        committer?: { name?: string | null; email?: string | null; date?: string | null } | null;
    };
    /** Linked GitHub user for the author, when known. May be null for unmatched commits. */
    author?: GitHubUser | null;
    /** Linked GitHub user for the committer, when known. */
    committer?: GitHubUser | null;
}

/**
 * Minimal shape of a check-run returned by
 * `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`.
 */
export interface GitHubCheckRun {
    id: number;
    name: string;
    status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending';
    conclusion:
        | 'success'
        | 'failure'
        | 'neutral'
        | 'cancelled'
        | 'skipped'
        | 'timed_out'
        | 'action_required'
        | 'stale'
        | null;
    started_at?: string | null;
    completed_at?: string | null;
    html_url?: string | null;
    details_url?: string | null;
    output?: {
        title?: string | null;
        summary?: string | null;
    } | null;
    app?: {
        slug?: string | null;
        name?: string | null;
    } | null;
}

/**
 * Minimal shape of a combined commit status item returned by
 * `GET /repos/{owner}/{repo}/commits/{ref}/status`.
 */
export interface GitHubCombinedStatusItem {
    id: number;
    state: 'success' | 'failure' | 'pending' | 'error';
    context: string;
    description?: string | null;
    target_url?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface GitHubCombinedStatusResponse {
    state: 'success' | 'failure' | 'pending';
    statuses: GitHubCombinedStatusItem[];
    sha: string;
    total_count?: number;
}

export interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user: GitHubUser;
    assignees: GitHubUser[];
    state: 'open' | 'closed';
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    html_url: string;
    labels: GitHubLabel[];
}

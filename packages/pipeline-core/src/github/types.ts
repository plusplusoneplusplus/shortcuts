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

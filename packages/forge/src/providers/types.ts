/** Provider enum for selecting a backend implementation. */
export enum ProviderType {
    ADO = 'ado',
    GitHub = 'github',
}

// ── Shared entity types ──────────────────────────────────────

export interface Identity {
    id: string;
    displayName: string;
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

export interface PullRequestCommit {
    sha: string;
    shortSha: string;
    title: string;
    message: string;
    author: Identity;
    authoredAt?: Date;
    committedAt?: Date;
    url?: string;
    raw?: unknown;
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

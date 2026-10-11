export interface RepoGroupWriterConflict {
  workspaceId: string;
  writerWorkspaceId?: string;
  writerGroupId: string;
  writerGroupName: string;
  writerGroupLink: string;
  reason: 'writer-exists' | 'unresolved-membership';
}

export interface RepoGroupMemberAccess {
  workspaceId: string;
  /** Another saved membership shares this identity (conservative when unresolved). */
  shared: boolean;
  unresolved: boolean;
  /** All matching saved writers, including the group being edited. */
  writers: RepoGroupWriterConflict[];
}

export interface RepoGroupAccessResponse {
  enabled: boolean;
  members: RepoGroupMemberAccess[];
}

/** Status filter values accepted by the repo-group chat feed. */
export type RepoGroupChatStatus = 'running' | 'queued' | 'completed' | 'failed' | 'cancelled';

/** Archived filter: hide archived chats (default), show only them, or both. */
export type RepoGroupChatArchivedFilter = 'exclude' | 'only' | 'include';

/**
 * Query for `GET /api/repo-groups/:id/chats`. Filters apply identically to
 * every source; `cursor` is the opaque `nextCursor` of the previous page and
 * is rejected with 409 `STALE_CURSOR` when membership or filters changed.
 */
export interface RepoGroupChatFeedQuery {
  limit?: number;
  cursor?: string;
  /** Restrict to these owner workspace ids (the group id selects group-owned chats). */
  owners?: string[];
  statuses?: RepoGroupChatStatus[];
  archived?: RepoGroupChatArchivedFilter;
  type?: string;
}

/** One workspace whose chats feed the group list: the group itself or a member. */
export interface RepoGroupChatSource {
  workspaceId: string;
  role: 'group' | 'member';
  name?: string;
  stale?: boolean;
  staleReason?: 'workspace-removed' | 'path-missing';
  /** False when this source could not be read; its rows and counts are missing. */
  available: boolean;
  error?: string;
}

/** Exact counts over every matching unique chat, not only the loaded page. */
export interface RepoGroupChatCounts {
  total: number;
  running: number;
  queued: number;
  history: number;
  /** Unique unread chats across all available sources; absent when the store cannot count. */
  unread?: number;
  byOwner: Record<string, number>;
  /** True when at least one source was unavailable, so counts are lower bounds. */
  partial: boolean;
}

/**
 * One page of a repo group's aggregated chats. Every row carries
 * `ownerWorkspaceId`; rows keep their owner's native shape (queue task summary
 * or process history item). `running`/`queued` are returned in full on the
 * first page only.
 */
export interface RepoGroupChatFeedResponse<TTask = Record<string, unknown>, THistory = Record<string, unknown>> {
  groupId: string;
  /** Changes whenever the group's source set changes. */
  membershipKey: string;
  sources: RepoGroupChatSource[];
  running: Array<TTask & { ownerWorkspaceId: string }>;
  queued: Array<TTask & { ownerWorkspaceId: string }>;
  history: Array<THistory & { ownerWorkspaceId: string }>;
  hasMore: boolean;
  nextCursor?: string;
  counts: RepoGroupChatCounts;
}

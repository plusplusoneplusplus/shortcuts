import type {
  GitAmendResponse,
  GitAsyncJobResponse,
  GitBranchesResponse,
  GitBranchStatus,
  GitBranchRangeFilesResponse,
  GitBranchRangeResponse,
  GitCommit,
  GitCommitChatBinding,
  GitCommitChatBindingListResponse,
  GitCommitChatFreshResponse,
  GitCommitChatRebindResponse,
  GitCommitFilesResponse,
  GitCommitListResponse,
  GitDiffResponse,
  GitDiffCommentCountsResponse,
  GitDiffCommentReplyResponse,
  GitDiffCommentResolveResponse,
  GitDiffCommentResponse,
  GitDiffCommentsResponse,
  GitDiffCommentTotalsResponse,
  GitDiscardAllResponse,
  GitFileContentResponse,
  GitPatchApplyRequest,
  GitPatchApplyResponse,
  GitPatchExportResponse,
  GitOpJob,
  GitOperationResult,
  GitRepoState,
  GitWorkingTreeChangesResponse,
  ListWorktreesResponse,
  CleanupWorktreeResponse,
} from '../contracts';
import type { CocRequestOptions, QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export interface GitCommitListQuery {
  limit?: number;
  skip?: number;
  refresh?: boolean;
  search?: string;
}

export interface GitBranchRangeQuery {
  refresh?: boolean;
}

export interface GitFileDiffQuery {
  full?: boolean;
}

export interface GitBranchListQuery {
  type?: 'local' | 'remote' | 'all';
  limit?: number;
  offset?: number;
  search?: string;
}

export interface GitLatestOperationQuery {
  op?: string;
}

export interface GitCherryPickOptions {
  hashes?: string[];
  targetBranch?: string;
}

export interface GitWorkingTreeDiffQuery extends GitFileDiffQuery {
  stage?: 'staged' | 'unstaged' | 'untracked' | string;
}

export interface GitDiffCommentListQuery {
  oldRef?: string;
  newRef?: string;
}

export interface GitDiffCommentCountsQuery extends GitDiffCommentListQuery {
  status?: string | string[];
}

export interface GitDiffCommentTotalsQuery {
  commits: string[];
  status?: string | string[];
}

export interface GitCreateDiffCommentRequest {
  context: unknown;
  selection: unknown;
  selectedText: string;
  comment: string;
  status?: string;
  author?: string;
  tags?: string[];
  replies?: unknown[];
  aiResponse?: string;
  category?: string;
}

export interface GitUpdateDiffCommentRequest {
  comment?: string;
  status?: string;
  category?: string;
  selection?: unknown;
}

export interface GitResolveDiffCommentsRequest {
  oldRef: string;
  newRef: string;
  filePath?: string;
  commentId?: string;
  userContext?: string;
  skills?: string[];
}

function workspaceGitPath(workspaceId: string, suffix: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/git${suffix}`;
}

function workspacePath(workspaceId: string, suffix: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}${suffix}`;
}

function diffCommentsPath(workspaceId: string, suffix = ''): string {
  return `/diff-comments/${encodePathSegment(workspaceId)}${suffix}`;
}

function serializeCommitListQuery(query?: GitCommitListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    limit: query.limit,
    skip: query.skip,
    refresh: query.refresh,
    search: query.search,
  } satisfies Record<string, QueryPrimitive | undefined>;
}

function serializeBranchRangeQuery(query?: GitBranchRangeQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    refresh: query.refresh,
  };
}

function serializeFileDiffQuery(query?: GitFileDiffQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    full: query.full,
  };
}

function serializeBranchListQuery(query?: GitBranchListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    type: query.type,
    limit: query.limit,
    offset: query.offset,
    search: query.search,
  };
}

function serializeLatestOperationQuery(query?: GitLatestOperationQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    op: query.op,
  };
}

function serializeWorkingTreeDiffQuery(query?: GitWorkingTreeDiffQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    stage: query.stage,
    full: query.full,
  };
}

function serializeDiffCommentListQuery(query?: GitDiffCommentListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    oldRef: query.oldRef,
    newRef: query.newRef,
  };
}

function serializeStatus(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}

function serializeDiffCommentCountsQuery(query?: GitDiffCommentCountsQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    oldRef: query.oldRef,
    newRef: query.newRef,
    status: serializeStatus(query.status),
  };
}

function serializeDiffCommentTotalsQuery(query: GitDiffCommentTotalsQuery): CocRequestOptions['query'] {
  return {
    commits: query.commits.join(','),
    status: serializeStatus(query.status),
  };
}

function jsonRequest(method: string, body?: unknown): CocRequestOptions {
  return body === undefined ? { method } : { method, body };
}

export class GitClient {
  constructor(private readonly transport: RequestAdapter) {}

  listCommits(workspaceId: string, query?: GitCommitListQuery): Promise<GitCommitListResponse> {
    return this.transport.request<GitCommitListResponse>(workspaceGitPath(workspaceId, '/commits'), {
      query: serializeCommitListQuery(query),
    });
  }

  getCommit(workspaceId: string, hash: string): Promise<GitCommit> {
    return this.transport.request<GitCommit>(workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}`));
  }

  listCommitFiles(workspaceId: string, hash: string): Promise<GitCommitFilesResponse> {
    return this.transport.request<GitCommitFilesResponse>(workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}/files`));
  }

  getCommitDiff(workspaceId: string, hash: string): Promise<GitDiffResponse> {
    return this.transport.request<GitDiffResponse>(this.commitDiffPath(workspaceId, hash));
  }

  commitDiffPath(workspaceId: string, hash: string): string {
    return workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}/diff`);
  }

  getCommitFileDiff(workspaceId: string, hash: string, filePath: string, query?: GitFileDiffQuery): Promise<GitDiffResponse> {
    return this.transport.request<GitDiffResponse>(
      workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}/files/${encodePathSegment(filePath)}/diff`),
      { query: serializeFileDiffQuery(query) },
    );
  }

  commitFileDiffPath(workspaceId: string, hash: string, filePath: string): string {
    return workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}/files/${encodePathSegment(filePath)}/diff`);
  }

  getCommitFileContent(workspaceId: string, hash: string, filePath: string): Promise<GitFileContentResponse> {
    return this.transport.request<GitFileContentResponse>(
      workspaceGitPath(workspaceId, `/commits/${encodePathSegment(hash)}/files/${encodePathSegment(filePath)}/content`),
    );
  }

  getBranchRange(workspaceId: string, query?: GitBranchRangeQuery): Promise<GitBranchRangeResponse> {
    return this.transport.request<GitBranchRangeResponse>(workspaceGitPath(workspaceId, '/branch-range'), {
      query: serializeBranchRangeQuery(query),
    });
  }

  listBranchRangeFiles(workspaceId: string): Promise<GitBranchRangeFilesResponse> {
    return this.transport.request<GitBranchRangeFilesResponse>(workspaceGitPath(workspaceId, '/branch-range/files'));
  }

  getBranchRangeDiff(workspaceId: string): Promise<GitDiffResponse> {
    return this.transport.request<GitDiffResponse>(workspaceGitPath(workspaceId, '/branch-range/diff'));
  }

  getBranchRangeFileDiff(workspaceId: string, filePath: string, query?: GitFileDiffQuery): Promise<GitDiffResponse> {
    return this.transport.request<GitDiffResponse>(
      workspaceGitPath(workspaceId, `/branch-range/files/${encodePathSegment(filePath)}/diff`),
      { query: serializeFileDiffQuery(query) },
    );
  }

  branchRangeFileDiffPath(workspaceId: string, filePath: string): string {
    return workspaceGitPath(workspaceId, `/branch-range/files/${encodePathSegment(filePath)}/diff`);
  }

  listBranches(workspaceId: string, query?: GitBranchListQuery): Promise<GitBranchesResponse> {
    return this.transport.request<GitBranchesResponse>(workspaceGitPath(workspaceId, '/branches'), {
      query: serializeBranchListQuery(query),
    });
  }

  getBranchStatus(workspaceId: string): Promise<GitBranchStatus | null> {
    return this.transport.request<GitBranchStatus | null>(workspaceGitPath(workspaceId, '/branch-status'));
  }

  getRepoState(workspaceId: string): Promise<GitRepoState> {
    return this.transport.request<GitRepoState>(workspaceGitPath(workspaceId, '/repo-state'));
  }

  getLatestOperation(workspaceId: string, query?: GitLatestOperationQuery): Promise<GitOpJob | null> {
    return this.transport.request<GitOpJob | null>(workspaceGitPath(workspaceId, '/ops/latest'), {
      query: serializeLatestOperationQuery(query),
    });
  }

  getOperation(workspaceId: string, jobId: string): Promise<GitOpJob> {
    return this.transport.request<GitOpJob>(workspaceGitPath(workspaceId, `/ops/${encodePathSegment(jobId)}`));
  }

  createBranch(workspaceId: string, name: string, options?: { checkout?: boolean }): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/branches'), jsonRequest('POST', { name, checkout: options?.checkout }));
  }

  switchBranch(workspaceId: string, name: string, options?: { force?: boolean }): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/branches/switch'), jsonRequest('POST', { name, force: options?.force }));
  }

  renameBranch(workspaceId: string, oldName: string, newName: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/branches/rename'), jsonRequest('POST', { oldName, newName }));
  }

  deleteBranch(workspaceId: string, name: string, options?: { force?: boolean }): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(
      workspaceGitPath(workspaceId, `/branches/${encodePathSegment(name)}`),
      { method: 'DELETE', query: { force: options?.force } },
    );
  }

  fetch(workspaceId: string, options?: { remote?: string }): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/fetch'), jsonRequest('POST', options?.remote ? { remote: options.remote } : undefined));
  }

  pull(workspaceId: string, options?: { rebase?: boolean }): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/pull'), jsonRequest('POST', { rebase: options?.rebase }));
  }

  push(workspaceId: string, options?: { setUpstream?: boolean }): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/push'), jsonRequest('POST', { setUpstream: options?.setUpstream }));
  }

  pushTo(workspaceId: string, commitHash: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/push-to'), jsonRequest('POST', { commitHash }));
  }

  rebaseAutosquash(workspaceId: string): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/rebase-autosquash'), { method: 'POST' });
  }

  merge(workspaceId: string, branch: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/merge'), jsonRequest('POST', { branch }));
  }

  stash(workspaceId: string, message?: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/stash'), jsonRequest('POST', { message }));
  }

  popStash(workspaceId: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/stash/pop'), { method: 'POST' });
  }

  reset(workspaceId: string, hash: string, mode?: 'hard' | 'soft' | 'mixed'): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/reset'), jsonRequest('POST', { hash, mode }));
  }

  cherryPick(workspaceId: string, hash: string, options?: GitCherryPickOptions): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(
      workspaceGitPath(workspaceId, '/cherry-pick'),
      jsonRequest('POST', { hash, hashes: options?.hashes, targetBranch: options?.targetBranch }),
    );
  }

  exportCommitPatch(workspaceId: string, hash: string): Promise<GitPatchExportResponse> {
    return this.transport.request<GitPatchExportResponse>(workspaceGitPath(workspaceId, '/patch/export'), jsonRequest('POST', { hash }));
  }

  exportCommitPatches(workspaceId: string, hashes: string[]): Promise<GitPatchExportResponse> {
    return this.transport.request<GitPatchExportResponse>(workspaceGitPath(workspaceId, '/patch/export'), jsonRequest('POST', { hashes }));
  }

  applyCommitPatch(workspaceId: string, request: GitPatchApplyRequest): Promise<GitPatchApplyResponse> {
    return this.transport.request<GitPatchApplyResponse>(workspaceGitPath(workspaceId, '/patch/apply'), jsonRequest('POST', { ...request }));
  }

  amend(workspaceId: string, title: string, body?: string): Promise<GitAmendResponse> {
    return this.transport.request<GitAmendResponse>(workspaceGitPath(workspaceId, '/amend'), jsonRequest('POST', { title, body }));
  }

  reword(workspaceId: string, hash: string, title: string): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/reword'), jsonRequest('POST', { hash, title }));
  }

  dropCommit(workspaceId: string, hash: string): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/drop-commit'), jsonRequest('POST', { hash }));
  }

  rebaseContinue(workspaceId: string): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/rebase-continue'), { method: 'POST' });
  }

  rebaseAbort(workspaceId: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/rebase-abort'), { method: 'POST' });
  }

  mergeContinue(workspaceId: string): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/merge-continue'), { method: 'POST' });
  }

  mergeAbort(workspaceId: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/merge-abort'), { method: 'POST' });
  }

  rebaseReorder(workspaceId: string, commits: string[]): Promise<GitAsyncJobResponse> {
    return this.transport.request<GitAsyncJobResponse>(workspaceGitPath(workspaceId, '/rebase-reorder'), jsonRequest('POST', { commits }));
  }

  getWorkingTreeChanges(workspaceId: string): Promise<GitWorkingTreeChangesResponse> {
    return this.transport.request<GitWorkingTreeChangesResponse>(workspaceGitPath(workspaceId, '/changes'));
  }

  /**
   * List the CoC-created Git worktree records for a workspace, newest first.
   * Strictly workspace-scoped (never mixes records across workspaces/targets);
   * returns an empty list when the feature flag is off on the target server.
   * Routed under `/workspaces/:id/worktrees` (not `/git/`).
   */
  listWorktrees(workspaceId: string): Promise<ListWorktreesResponse> {
    return this.transport.request<ListWorktreesResponse>(workspacePath(workspaceId, '/worktrees'));
  }

  /**
   * Remove a CoC-created worktree checkout (`git worktree remove`, never
   * `--force`) and mark the record `cleaned`. The generated branch is
   * preserved. Rejects (409) while a linked task/session is still running or
   * when Git refuses removal (e.g. a dirty worktree) — the record stays intact.
   */
  cleanupWorktree(workspaceId: string, worktreeId: string): Promise<CleanupWorktreeResponse> {
    return this.transport.request<CleanupWorktreeResponse>(
      workspacePath(workspaceId, `/worktrees/${encodePathSegment(worktreeId)}/cleanup`),
      { method: 'POST' },
    );
  }

  stageFile(workspaceId: string, filePath: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/stage'), jsonRequest('POST', { filePath }));
  }

  unstageFile(workspaceId: string, filePath: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/unstage'), jsonRequest('POST', { filePath }));
  }

  discardFile(workspaceId: string, filePath: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/discard'), jsonRequest('POST', { filePath }));
  }

  deleteUntrackedFile(workspaceId: string, filePath: string): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/untracked'), jsonRequest('DELETE', { filePath }));
  }

  /** Discard every working-tree change (staged, unstaged, and untracked) in one call. */
  discardAllChanges(workspaceId: string): Promise<GitDiscardAllResponse> {
    return this.transport.request<GitDiscardAllResponse>(workspaceGitPath(workspaceId, '/changes/discard-all'), { method: 'POST' });
  }

  stageFiles(workspaceId: string, filePaths: string[]): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/stage-batch'), jsonRequest('POST', { filePaths }));
  }

  unstageFiles(workspaceId: string, filePaths: string[]): Promise<GitOperationResult> {
    return this.transport.request<GitOperationResult>(workspaceGitPath(workspaceId, '/changes/unstage-batch'), jsonRequest('POST', { filePaths }));
  }

  getWorkingTreeFileDiff(workspaceId: string, filePath: string, query?: GitWorkingTreeDiffQuery): Promise<GitDiffResponse> {
    return this.transport.request<GitDiffResponse>(
      workspaceGitPath(workspaceId, `/changes/files/${encodePathSegment(filePath)}/diff`),
      { query: serializeWorkingTreeDiffQuery(query) },
    );
  }

  listCommitChatBindings(workspaceId: string): Promise<GitCommitChatBindingListResponse> {
    return this.transport.request<GitCommitChatBindingListResponse>(workspacePath(workspaceId, '/commit-chat-bindings'));
  }

  getCommitChatBinding(workspaceId: string, commitHash: string): Promise<GitCommitChatBinding> {
    return this.transport.request<GitCommitChatBinding>(workspacePath(workspaceId, `/commit-chat-bindings/${encodePathSegment(commitHash)}`));
  }

  createCommitChatBinding(workspaceId: string, commitHash: string, taskId: string): Promise<GitCommitChatBinding> {
    return this.transport.request<GitCommitChatBinding>(workspacePath(workspaceId, '/commit-chat-bindings'), jsonRequest('POST', { commitHash, taskId }));
  }

  deleteCommitChatBinding(workspaceId: string, commitHash: string): Promise<void> {
    return this.transport.request<void>(workspacePath(workspaceId, `/commit-chat-bindings/${encodePathSegment(commitHash)}`), { method: 'DELETE' });
  }

  startFreshCommitChat(workspaceId: string, commitHash: string): Promise<GitCommitChatFreshResponse> {
    return this.transport.request<GitCommitChatFreshResponse>(
      workspacePath(workspaceId, `/commit-chat-bindings/${encodePathSegment(commitHash)}/fresh`),
      { method: 'POST', body: {} },
    );
  }

  rebindCommitChatBinding(workspaceId: string, oldHash: string, newHash: string): Promise<GitCommitChatRebindResponse> {
    return this.transport.request<GitCommitChatRebindResponse>(workspacePath(workspaceId, '/commit-chat-bindings/rebind'), jsonRequest('POST', { oldHash, newHash }));
  }

  getDiffCommentCounts(workspaceId: string, query?: GitDiffCommentCountsQuery): Promise<GitDiffCommentCountsResponse> {
    return this.transport.request<GitDiffCommentCountsResponse>(`/diff-comment-counts/${encodePathSegment(workspaceId)}`, {
      query: serializeDiffCommentCountsQuery(query),
    });
  }

  getDiffCommentTotals(workspaceId: string, query: GitDiffCommentTotalsQuery): Promise<GitDiffCommentTotalsResponse> {
    return this.transport.request<GitDiffCommentTotalsResponse>(`/diff-comment-totals/${encodePathSegment(workspaceId)}`, {
      query: serializeDiffCommentTotalsQuery(query),
    });
  }

  listDiffComments(workspaceId: string, query?: GitDiffCommentListQuery): Promise<GitDiffCommentsResponse> {
    return this.transport.request<GitDiffCommentsResponse>(diffCommentsPath(workspaceId), {
      query: serializeDiffCommentListQuery(query),
    });
  }

  createDiffComment(workspaceId: string, request: GitCreateDiffCommentRequest): Promise<GitDiffCommentResponse> {
    return this.transport.request<GitDiffCommentResponse>(diffCommentsPath(workspaceId), jsonRequest('POST', { ...request }));
  }

  listDiffCommentsForStorageKey(workspaceId: string, storageKey: string): Promise<GitDiffCommentsResponse> {
    return this.transport.request<GitDiffCommentsResponse>(diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}`));
  }

  getDiffComment(workspaceId: string, storageKey: string, commentId: string): Promise<GitDiffCommentResponse> {
    return this.transport.request<GitDiffCommentResponse>(diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}/${encodePathSegment(commentId)}`));
  }

  updateDiffComment(workspaceId: string, storageKey: string, commentId: string, request: GitUpdateDiffCommentRequest): Promise<GitDiffCommentResponse> {
    return this.transport.request<GitDiffCommentResponse>(
      diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}/${encodePathSegment(commentId)}`),
      jsonRequest('PATCH', { ...request }),
    );
  }

  deleteDiffComment(workspaceId: string, storageKey: string, commentId: string): Promise<void> {
    return this.transport.request<void>(
      diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}/${encodePathSegment(commentId)}`),
      { method: 'DELETE' },
    );
  }

  addDiffCommentReply(workspaceId: string, storageKey: string, commentId: string, text: string, options?: { author?: string; isAI?: boolean }): Promise<GitDiffCommentReplyResponse> {
    return this.transport.request<GitDiffCommentReplyResponse>(
      diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}/${encodePathSegment(commentId)}/replies`),
      jsonRequest('POST', { text, author: options?.author, isAI: options?.isAI }),
    );
  }

  askDiffCommentAI(workspaceId: string, storageKey: string, commentId: string, request?: { commandId?: string; customQuestion?: string }): Promise<GitDiffCommentResolveResponse> {
    return this.transport.request<GitDiffCommentResolveResponse>(
      diffCommentsPath(workspaceId, `/${encodePathSegment(storageKey)}/${encodePathSegment(commentId)}/ask-ai`),
      jsonRequest('POST', { commandId: request?.commandId, customQuestion: request?.customQuestion }),
    );
  }

  resolveDiffCommentsWithAI(workspaceId: string, request: GitResolveDiffCommentsRequest): Promise<GitDiffCommentResolveResponse> {
    return this.transport.request<GitDiffCommentResolveResponse>(diffCommentsPath(workspaceId, '/resolve-with-ai'), jsonRequest('POST', { ...request }));
  }
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authorEmail?: string;
  date: string;
  parentHashes: string[];
  body?: string;
}

export interface GitCommitListResponse {
  commits: GitCommit[];
  unpushedCount: number;
}

export interface GitFileChange {
  status: string;
  path: string;
  additions?: number;
  deletions?: number;
  oldPath?: string;
}

export interface GitCommitFilesResponse {
  files: GitFileChange[];
}

export interface GitDiffResponse {
  diff: string;
  truncated?: boolean;
  totalLines?: number;
  path?: string;
}

export interface GitBranchRangeInfo {
  baseRef: string;
  headRef: string;
  commitCount: number;
  additions: number;
  deletions: number;
  mergeBase: string;
  branchName?: string;
  fileCount: number;
  files?: GitFileChange[];
  commits?: GitCommit[];
}

export interface GitDefaultBranchResponse {
  onDefaultBranch: true;
  branchName?: string;
}

export type GitBranchRangeResponse = GitBranchRangeInfo | GitDefaultBranchResponse;

export interface GitBranchRangeFilesResponse {
  files: GitFileChange[];
}

export interface GitFileContentResponse {
  path: string;
  fileName: string;
  lines: string[];
  totalLines: number;
  truncated: boolean;
  language: string;
  resolvedRef: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remoteName?: string;
  lastCommitSubject?: string;
  lastCommitDate?: string;
}

export interface GitPaginatedBranchResult {
  branches: GitBranch[];
  totalCount: number;
  hasMore: boolean;
}

export interface GitBranchesResponse {
  local?: GitPaginatedBranchResult;
  remote?: GitPaginatedBranchResult;
}

export interface GitBranchStatus {
  name: string;
  isDetached: boolean;
  detachedHash?: string;
  ahead: number;
  behind: number;
  trackingBranch?: string;
  hasUncommittedChanges: boolean;
}

export type GitRepoOperationType = 'none' | 'merge' | 'rebase' | 'cherry-pick' | string;

export interface GitRepoState {
  operation: GitRepoOperationType;
  conflictFiles: string[];
}

export type GitOpType =
  | 'pull'
  | 'push'
  | 'fetch'
  | 'rebase-autosquash'
  | 'rebase-continue'
  | 'rebase-abort'
  | 'merge-continue'
  | 'merge-abort'
  | 'rebase-reorder'
  | 'reword'
  | 'cherry-pick-transfer'
  | string;

export type GitOpStatus = 'running' | 'success' | 'failed' | 'interrupted' | string;

export interface GitOpJob {
  id: string;
  workspaceId: string;
  op: GitOpType;
  status: GitOpStatus;
  startedAt: string;
  finishedAt?: string;
  output?: string;
  error?: string;
  pid?: number;
  metadata?: GitOpMetadata;
}

export interface GitOpWorkspaceMetadata {
  id: string;
  name?: string;
}

export interface GitOpServerMetadata {
  id: string;
  label?: string;
}

export interface GitOpCommitAuthorMetadata {
  name?: string;
  email?: string;
  date?: string;
}

export interface GitOpCommitMetadata {
  hash: string;
  subject?: string;
  author?: GitOpCommitAuthorMetadata;
}

export interface GitPatchTransferOperationMetadata {
  kind: 'patch-transfer';
  sourceServer?: GitOpServerMetadata;
  sourceWorkspace?: GitOpWorkspaceMetadata;
  sourceCommit?: GitOpCommitMetadata;
  normalizedSourceRemoteUrl?: string | null;
  targetWorkspace: GitOpWorkspaceMetadata;
  targetBranch?: string | null;
  targetHead?: string;
  newCommitHash?: string;
  stashed?: boolean;
}

export type GitOpMetadata = GitPatchTransferOperationMetadata;

export interface GitFormatPatchPayload {
  format: 'format-patch';
  body: string;
}

export interface GitPatchExportResponse {
  sourceWorkspace: GitOpWorkspaceMetadata;
  sourceCommit: GitOpCommitMetadata;
  normalizedSourceRemoteUrl: string | null;
  patch: GitFormatPatchPayload;
}

export interface GitPatchApplyRequest {
  patch: GitFormatPatchPayload;
  stashAndContinue?: boolean;
  sourceServer?: GitOpServerMetadata;
  sourceWorkspace?: GitOpWorkspaceMetadata;
  sourceCommit?: GitOpCommitMetadata;
  normalizedSourceRemoteUrl?: string | null;
}

export interface GitPatchApplyResponse {
  success: true;
  targetWorkspace: GitOpWorkspaceMetadata;
  targetBranch: string | null;
  targetHead?: string;
  newCommitHash?: string;
  stashed: boolean;
  operation: GitOpJob;
}

export interface GitOperationResult {
  success: boolean;
  error?: string;
  message?: string;
  conflicts?: boolean;
  [key: string]: unknown;
}

export interface GitAsyncJobResponse extends Partial<GitOperationResult> {
  jobId?: string;
  taskId?: string;
}

export interface GitAmendResponse {
  hash?: string;
  error?: string;
}

export interface GitWorkingTreeChange {
  filePath: string;
  originalPath?: string;
  oldPath?: string;
  status: string;
  stage: 'staged' | 'unstaged' | 'untracked' | string;
  repositoryRoot: string;
  repositoryName: string;
}

export interface GitWorkingTreeChangesResponse {
  changes: GitWorkingTreeChange[];
  repoState: GitRepoState;
}

export interface GitCommitChatBinding {
  commitHash: string;
  taskId: string;
}

export interface GitCommitChatBindingListResponse {
  bindings: GitCommitChatBinding[];
}

export interface GitCommitChatRebindResponse {
  oldHash: string;
  newHash: string;
  taskId: string;
}

export interface GitDiffCommentSelection {
  diffLineStart: number;
  diffLineEnd: number;
  side: 'added' | 'removed' | 'context' | string;
  oldLineStart?: number;
  oldLineEnd?: number;
  newLineStart?: number;
  newLineEnd?: number;
  startColumn: number;
  endColumn: number;
}

export interface GitDiffCommentContext {
  repositoryId: string;
  filePath: string;
  oldRef: string;
  newRef: string;
  commitHash?: string;
}

export interface GitDiffCommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  isAI?: boolean;
}

export interface GitDiffComment {
  id: string;
  context: GitDiffCommentContext;
  selection: GitDiffCommentSelection;
  selectedText: string;
  comment: string;
  status: 'open' | 'resolved' | 'orphaned' | string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
  replies?: GitDiffCommentReply[];
  aiResponse?: string;
  [key: string]: unknown;
}

export interface GitDiffCommentsResponse {
  comments: GitDiffComment[];
}

export interface GitDiffCommentResponse {
  comment: GitDiffComment;
}

export interface GitDiffCommentReplyResponse {
  reply: GitDiffCommentReply;
}

export interface GitDiffCommentCountsResponse {
  counts: Record<string, number>;
}

export interface GitDiffCommentTotalsResponse {
  totals: Record<string, number>;
}

export interface GitDiffCommentResolveResponse {
  taskId?: string;
  totalCount?: number;
  aiResponse?: string;
}

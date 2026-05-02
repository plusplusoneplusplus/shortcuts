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
}

export type GitBranchRangeResponse = GitBranchRangeInfo | GitDefaultBranchResponse;

export interface GitBranchRangeFilesResponse {
  files: GitFileChange[];
}

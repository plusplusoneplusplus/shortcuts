import type {
  GitBranchRangeFilesResponse,
  GitBranchRangeResponse,
  GitCommit,
  GitCommitFilesResponse,
  GitCommitListResponse,
  GitDiffResponse,
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

function workspaceGitPath(workspaceId: string, suffix: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/git${suffix}`;
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
}

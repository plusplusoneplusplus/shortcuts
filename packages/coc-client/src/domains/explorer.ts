import type {
  ExplorerBlobResponse,
  ExplorerFilesOptions,
  ExplorerFilesResponse,
  ExplorerSearchOptions,
  ExplorerSearchResponse,
  ExplorerTreeOptions,
  ExplorerTreeResponse,
  RepoInfo,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function repoPath(repoId: string, suffix = ''): string {
  return `/repos/${encodePathSegment(repoId)}${suffix}`;
}

function serializeTreeOptions(options?: ExplorerTreeOptions): CocRequestOptions['query'] {
  return {
    path: options?.path ?? '.',
    depth: options?.depth,
    showIgnored: options?.showIgnored,
  };
}

function serializeFilesOptions(options?: ExplorerFilesOptions): CocRequestOptions['query'] {
  return {
    path: options?.path ?? '.',
    showIgnored: options?.showIgnored,
  };
}

function serializeSearchOptions(query: string, options?: ExplorerSearchOptions): CocRequestOptions['query'] {
  return {
    q: query,
    limit: options?.limit,
    showIgnored: options?.showIgnored,
  };
}

export class ExplorerClient {
  constructor(private readonly transport: RequestAdapter) {}

  listRepos(): Promise<RepoInfo[]> {
    return this.transport.request<RepoInfo[]>('/repos');
  }

  tree(repoId: string, options?: ExplorerTreeOptions): Promise<ExplorerTreeResponse> {
    return this.transport.request<ExplorerTreeResponse>(repoPath(repoId, '/tree'), {
      query: serializeTreeOptions(options),
    });
  }

  listFiles(repoId: string, options?: ExplorerFilesOptions): Promise<ExplorerFilesResponse> {
    return this.transport.request<ExplorerFilesResponse>(repoPath(repoId, '/files'), {
      query: serializeFilesOptions(options),
    });
  }

  searchFiles(repoId: string, query: string, options?: ExplorerSearchOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerSearchResponse> {
    return this.transport.request<ExplorerSearchResponse>(repoPath(repoId, '/search'), {
      query: serializeSearchOptions(query, options),
      signal: options?.signal,
    });
  }

  readBlob(repoId: string, path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
    return this.transport.request<ExplorerBlobResponse>(repoPath(repoId, '/blob'), {
      query: { path },
      signal: options?.signal,
    });
  }

  writeBlob(repoId: string, path: string, content: string): Promise<{ success: boolean }> {
    return this.transport.request<{ success: boolean }>(repoPath(repoId, '/blob'), {
      method: 'PUT',
      query: { path },
      body: { content },
    });
  }

  reveal(repoId: string, path: string): Promise<void> {
    return this.transport.request<void>(repoPath(repoId, '/reveal'), {
      query: { path },
    });
  }

  readTrustedBlob(path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
    return this.transport.request<ExplorerBlobResponse>('/fs/blob', {
      query: { path },
      signal: options?.signal,
    });
  }
}

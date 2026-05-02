export interface RepoInfo {
  id: string;
  name: string;
  localPath: string;
  headSha: string;
  clonedAt: string;
  remoteUrl?: string;
}

export interface ExplorerTreeEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  path: string;
  children?: ExplorerTreeEntry[];
}

export interface ExplorerTreeResponse {
  entries: ExplorerTreeEntry[];
  truncated: boolean;
}

export interface ExplorerFilesResponse {
  files: string[];
  truncated: boolean;
}

export interface ExplorerSearchResult {
  path: string;
  score: number;
}

export interface ExplorerSearchResponse {
  results: ExplorerSearchResult[];
  truncated: boolean;
}

export interface ExplorerBlobResponse {
  content: string;
  encoding: 'utf-8' | 'base64';
  mimeType: string;
}

export interface ExplorerTreeOptions {
  path?: string;
  depth?: number;
  showIgnored?: boolean;
}

export interface ExplorerFilesOptions {
  path?: string;
  showIgnored?: boolean;
}

export interface ExplorerSearchOptions {
  limit?: number;
  showIgnored?: boolean;
}

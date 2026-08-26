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
  /**
   * Positions in `path` that matched the query, ascending, as JavaScript string
   * indices. Present so callers highlight the same characters the scorer used.
   */
  indices: number[];
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

/** One matching line from a repo content search. */
export interface ExplorerContentMatch {
  /** Repo-relative path with `/` separators on every platform. */
  path: string;
  /** One-based line number. */
  line: number;
  /** The matching line without its trailing newline, possibly truncated. */
  text: string;
  /**
   * UTF-16 offset of the match within `text` — a JavaScript string index, so a
   * client highlighting `text.slice(startColumn, endColumn)` highlights exactly
   * what matched.
   */
  startColumn: number;
  /** UTF-16 offset one past the end of the match within `text`. */
  endColumn: number;
  /** Lines preceding `line`, in file order. */
  before: string[];
  /** Lines following `line`, in file order. */
  after: string[];
}

export interface ExplorerContentSearchResponse {
  /** Matching lines, sorted by path then line. */
  matches: ExplorerContentMatch[];
  /**
   * True when any cap was hit — total matches, matches in one file, or a file
   * skipped for being too large. The list is partial either way.
   */
  truncated: boolean;
}

export interface ExplorerContentSearchOptions {
  /** Repo-relative subfolder to search. Omit or '.' for the whole repo. */
  path?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  showIgnored?: boolean;
  /** Whitelist globs. When non-empty, a file matching none of them is skipped. */
  include?: string[];
  /** Globs whose matches are skipped. */
  exclude?: string[];
  /** Cap on total matches. Clamped server-side to 1..500. */
  limit?: number;
}

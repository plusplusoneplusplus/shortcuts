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

export interface ExplorerRepoGroupSearchResult extends ExplorerSearchResult {
  /** Member workspace that owns the file. */
  workspaceId: string;
  /** Display name resolved by the group-owning server. */
  repoName: string;
}

export interface ExplorerRepoGroupSearchResponse {
  status: 'complete' | 'partial' | 'failed' | 'no-searchable-members';
  results: ExplorerRepoGroupSearchResult[];
  memberCount: number;
  searchableMemberCount: number;
  searchedMemberCount: number;
  unavailableMemberCount: number;
  failedMemberCount: number;
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
  /**
   * Present when this line is one piece of a match that crossed a line break —
   * a multi-line query. Every piece of that match carries the same id, and the
   * id is unique within a path, which is the only scope two pieces are ever
   * compared in. Absent for a single-line match.
   */
  group?: number;
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
  /** Restrict candidates to Git-tracked files. */
  fileScope?: 'tracked';
  /** Add non-ignored untracked files when `fileScope` is `tracked`. */
  includeUntracked?: boolean;
  /** Whitelist globs. When non-empty, a file matching none of them is skipped. */
  include?: string[];
  /** Globs whose matches are skipped. */
  exclude?: string[];
  /** Cap on total matches. Clamped server-side to 1..500. */
  limit?: number;
}

/** One matched span a replace should rewrite, as it looked when the search ran. */
export interface ExplorerContentReplaceTarget {
  /** One-based line number. */
  line: number;
  /** The line's full text at search time, without its terminator. */
  text: string;
  /** UTF-16 offset of the match within `text`. */
  startColumn: number;
  /** UTF-16 offset one past the end of the match within `text`. */
  endColumn: number;
}

/** Every span to rewrite in one file. */
export interface ExplorerContentReplaceFile {
  /** Repo-relative path with `/` separators. */
  path: string;
  /** The spans to rewrite; at least one. */
  targets: ExplorerContentReplaceTarget[];
}

/** Query modes for a replace — the same ones the search that produced it used. */
export interface ExplorerContentReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Carry the matched text's casing over to the replacement. Default false. */
  preserveCase?: boolean;
}

/** Why one file was left alone by a replace. */
export interface ExplorerContentReplaceSkip {
  path: string;
  /** `stale` — the file changed since the search; `missing`/`unreadable` — it cannot be written. */
  reason: 'stale' | 'missing' | 'unreadable';
  /** Human-readable detail, safe to show in the UI. */
  message: string;
}

export interface ExplorerContentReplaceResponse {
  /** How many matched spans were rewritten. */
  replacedMatches: number;
  /** How many files were written. */
  replacedFiles: number;
  /** Files that were not written, and why. */
  skipped: ExplorerContentReplaceSkip[];
}

// ---------------------------------------------------------------------------
// Repo-group content search
// ---------------------------------------------------------------------------

/** One member's slice of a repo-group content search. */
export interface ExplorerRepoGroupContentSearchMember {
  /**
   * Member workspace ID. This is result identity and the owner reference an
   * open uses — it must never select the transport, which belongs to the
   * group-owning server.
   */
  workspaceId: string;
  /** Display name resolved by the group-owning server. */
  repoName: string;
  /** Repo-relative matches, in the member's own search order. */
  matches: ExplorerContentMatch[];
  /** Matches this member found before the group-wide cap was applied. */
  totalMatches: number;
  /** True when this member's own caps hit, or the group cap dropped rows. */
  truncated: boolean;
}

/** A member that could not contribute to a repo-group content search. */
export interface ExplorerRepoGroupContentSearchFailure {
  workspaceId: string;
  /** Display name; absent when the workspace itself is gone. */
  repoName?: string;
  /**
   * `stale` — removed from the registry or its root vanished.
   * `unavailable` — present but not a usable Git repository.
   * `error` — the search itself failed.
   */
  reason: 'stale' | 'unavailable' | 'error';
  /** Human-readable detail, scrubbed of filesystem roots. */
  message: string;
}

export interface ExplorerRepoGroupContentSearchResponse {
  /**
   * `complete` — every member answered. `partial` — some did not.
   * `failed` — none of the live members answered.
   * `no-searchable-members` — the group has no live member to search.
   */
  status: 'complete' | 'partial' | 'failed' | 'no-searchable-members';
  /** Members with at least one returned match, in group-membership order. */
  members: ExplorerRepoGroupContentSearchMember[];
  /** Members that were not searched successfully, in membership order. */
  failures: ExplorerRepoGroupContentSearchFailure[];
  /** True when the group cap or any member's own cap dropped matches. */
  truncated: boolean;
  /** Matches actually returned across every member. */
  totalMatches: number;
  /** The cap this answer was apportioned against. */
  limit: number;
  memberCount: number;
  searchableMemberCount: number;
  searchedMemberCount: number;
  unavailableMemberCount: number;
  failedMemberCount: number;
}

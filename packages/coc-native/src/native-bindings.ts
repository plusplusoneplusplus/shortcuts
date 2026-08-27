/* eslint-disable */
/**
 * The addon's type surface, generated from the `#[napi]` items in
 * `rust/napi/src/` by `npm run build:native`. Do not edit.
 *
 * Committed on purpose: `npm run build` is plain `tsc`, so the TypeScript
 * build must not need a Rust toolchain. CI regenerates this and fails on a
 * diff, which is what keeps it honest.
 *
 * Declarations only — this emits no runtime code. Capability modules re-export
 * these under the package's own names; the real implementations come from the
 * binary the loader resolves.
 */

/**
 * Query modes, scoping and caps for one content search.
 *
 * Every field is optional; omitting all of them searches the whole repo for a
 * case-insensitive literal with the documented caps.
 */
export interface SearchContentOptions {
  /** Repo-relative subfolder to search. Omit for the whole repo. */
  path?: string
  /** Match case exactly. Defaults to false. */
  caseSensitive?: boolean
  /** Require word boundaries around the query. Defaults to false. */
  wholeWord?: boolean
  /** Treat the query as a regular expression rather than a literal. */
  regex?: boolean
  /** Search files `.gitignore` excludes — the explorer's `showIgnored` flag. */
  showIgnored?: boolean
  /** Whitelist globs. When non-empty, a file matching none of them is skipped. */
  include?: Array<string>
  /** Globs whose matches are skipped. */
  exclude?: Array<string>
  /** Cap on total matches. Defaults to 500. */
  maxResults?: number
  /** Cap on matches from any one file. Defaults to 20. */
  maxPerFile?: number
  /** Files larger than this are skipped. Defaults to 1 MiB. */
  maxFileSizeBytes?: number
  /** Lines of context on each side of a match. Defaults to 1. */
  contextLines?: number
}
/** One matching line, with its position inside the line and its neighbours. */
export interface ContentMatch {
  /** Repo-relative path with `/` separators on every platform. */
  path: string
  /** One-based line number. */
  line: number
  /** The matching line without its trailing newline, possibly truncated. */
  text: string
  /**
   * UTF-16 offset of the match within `text` — the same offset a JavaScript
   * string index would use, so highlight and match cannot disagree.
   */
  startColumn: number
  /** UTF-16 offset one past the end of the match within `text`. */
  endColumn: number
  /** Lines preceding `line`, in file order. */
  before: Array<string>
  /** Lines following `line`, in file order. */
  after: Array<string>
}
/** The bounded response from one content search. */
export interface ContentSearchResult {
  /** Matches sorted by path, then by line. */
  matches: Array<ContentMatch>
  /**
   * True when any cap bit: the total cap, a per-file cap, or a file skipped
   * for exceeding `maxFileSizeBytes`.
   */
  truncated: boolean
}
/**
 * Walk `root` in parallel and resolve with every line matching `query`.
 *
 * An empty query resolves with an empty result rather than every line.
 */
export declare function searchContent(root: string, query: string, options?: SearchContentOptions | undefined | null): Promise<ContentSearchResult>
/** How to build (and later refresh) an index. */
export interface BuildOptions {
  /** Include gitignored files — the `showIgnored` flag from the explorer. */
  includeIgnored?: boolean
  /** Safety cap on indexed paths. Omit for no cap. */
  maxEntries?: number
}
/** A scored path plus the positions the client highlights. */
export interface FileMatch {
  path: string
  score: number
  /**
   * Matched UTF-16 offsets within `path`, ascending — the same offsets a
   * JavaScript string index would use.
   */
  indices: Array<number>
}
/** Walk `root` in parallel and resolve with a ready-to-search index. */
export declare function buildFileIndex(root: string, options?: BuildOptions | undefined | null): Promise<FileIndex>
/**
 * Per-call overrides for one git invocation. Every field is optional;
 * omitting all of them uses a 30 s timeout and a 50 MiB output cap.
 */
export interface GitExecOptions {
  /**
   * Bytes of stdout (and of stderr) kept before the call fails.
   * Defaults to 50 MiB.
   */
  maxBuffer?: number
  /** Milliseconds before the child is killed. Defaults to 30 000. */
  timeout?: number
  /**
   * Working directory for the child. `-C` already points git at the repo, so
   * this is rarely needed.
   */
  cwd?: string
}
/**
 * Run `git -C <repoRoot> <args>` and resolve with its trimmed stdout.
 *
 * No shell is involved, so arguments containing spaces need no quoting. A
 * non-zero exit, a timeout, or output past the buffer cap all reject with
 * `git <args> failed: <stderr>`.
 */
export declare function execGit(args: Array<string>, repoRoot: string, options?: GitExecOptions | undefined | null): Promise<string>
/** Filesystem policy for one resolved Notes root. */
export interface NotesIndexBuildOptions {
  /**
   * Skip every symbolic-link entry. External and task-derived Notes roots
   * enable this to prevent reads outside the resolved root.
   */
  skipSymlinks?: boolean
}
/** One filename or content-line match. */
export interface NotesMatch {
  /** Zero for a filename match, otherwise the one-based content line. */
  line: number
  /** The original basename or line text, without lowercase normalization. */
  text: string
}
/** All matches for one root-relative Markdown path. */
export interface NotesSearchResult {
  /** Root-relative path with `/` separators on every platform. */
  path: string
  /** Filename match first, followed by content matches in line order. */
  matches: Array<NotesMatch>
}
/** The bounded response from one Notes index search. */
export interface NotesSearchResponse {
  results: Array<NotesSearchResult>
  truncated: boolean
}
/** Recursively build a complete immutable snapshot for one resolved Notes root. */
export declare function buildNotesIndex(root: string, options?: NotesIndexBuildOptions | undefined | null): Promise<NotesIndex>
/** An in-memory, gitignore-aware index of one repository's file paths. */
export declare class FileIndex {
  /** Number of indexed paths. */
  len(): number
  /** True when the walk hit the configured `maxEntries` cap. */
  truncated(): boolean
  /** A window of the raw path list, in index order. */
  files(offset: number, limit: number): Array<string>
  /** Score every indexed path and resolve with the best `limit` matches. */
  search(query: string, limit: number): Promise<FileMatch[]>
  /** Re-walk the root and atomically swap in the new path list. */
  refresh(): Promise<void>
}
/** An in-memory content index for one already-authorized Notes root. */
export declare class NotesIndex {
  /**
   * Search the current complete snapshot and return at most 50 matching
   * files and 100 total filename/content matches.
   */
  search(query: string): Promise<NotesSearchResponse>
  /**
   * Rebuild the complete root and atomically replace the searchable
   * snapshot. A failed rebuild retains the last complete snapshot.
   */
  refresh(): Promise<void>
  /**
   * Apply at most 1,024 normalized, root-relative changed file paths and
   * atomically replace the searchable snapshot. Missing files are removed;
   * existing lowercase-Markdown files are upserted from disk.
   */
  refreshChanged(changedPaths: Array<string>): Promise<void>
}

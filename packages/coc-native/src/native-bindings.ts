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
  /**
   * Environment overrides layered on top of the environment Node already
   * has. `GIT_TERMINAL_PROMPT`, `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` are
   * what callers set; `PATH`, `HOME` and `SSH_AUTH_SOCK` are inherited, so
   * `push` and `pull` still reach the user's credential helper and agent.
   */
  env?: Record<string, string>
}
/**
 * Run `git -C <repoRoot> <args>` and resolve with its trimmed stdout.
 *
 * No shell is involved, so arguments containing spaces need no quoting. A
 * non-zero exit, a timeout, or output past the buffer cap all reject with
 * `git <args> failed: <stderr>`.
 */
export declare function execGit(args: Array<string>, repoRoot: string, options?: GitExecOptions | undefined | null): Promise<string>
/**
 * One working-tree change, with the path spelled exactly as git printed it.
 *
 * `status` and `stage` are the `GitChangeStatus` and `GitChangeStage` string
 * unions verbatim, so the TypeScript side casts rather than translates. The
 * path stays repository-relative: `path.join` and `path.basename` decide what
 * the UI shows, and their separator handling belongs in Node.
 */
export interface GitStatusEntry {
  path: string
  /** Source path of a rename or copy; absent otherwise. */
  originalPath?: string
  status: string
  stage: string
}
/**
 * Read the full working-tree change list for a repository.
 *
 * Runs `git status --porcelain --untracked-files=all` and parses it, so the
 * output never crosses the boundary as text. Defaults to the 15 s timeout the
 * working-tree read path has always used, rather than the 30 s command default.
 */
export declare function gitStatusEntries(repoRoot: string, options?: GitExecOptions | undefined | null): Promise<GitStatusEntry[]>
/**
 * Parse porcelain text that was produced somewhere else.
 *
 * This exists for repositories inside a WSL distro: those run git through
 * `wsl.exe` in TypeScript and never reach {@link git_status_entries}, but the
 * parser must still be the single one in the codebase. The work stays on a
 * worker thread because a large repository's status output runs to megabytes.
 */
export declare function parseGitStatusPorcelain(output: string): Promise<GitStatusEntry[]>
/**
 * One commit, field-for-field the `GitCommit` the Git tab renders — minus
 * `repositoryRoot` and `repositoryName`, which the TypeScript caller fills in
 * because building paths is `path.join`'s job and stays in Node.
 */
export interface GitLogCommit {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  authorEmail: string
  /** ISO 8601 strict, in the author's own timezone offset (`%aI`). */
  date: string
  /** "3 days ago" (`%ar`). */
  relativeDate: string
  /** Space-separated parent hashes (`%P`); empty for a root commit. */
  parentHashes: string
  /** Decoration names (`%D`), already split and trimmed. */
  refs: Array<string>
  /**
   * Whether the commit is on `HEAD` but not on its upstream. Absent when
   * nobody asked — reading a single commit never computed it.
   */
  isAheadOfRemote?: boolean
}
/** One page of history, plus whether asking for the next one is worthwhile. */
export interface GitLogPage {
  commits: Array<GitLogCommit>
  hasMore: boolean
}
/** Which slice of history to read — the `CommitLoadOptions` the service takes. */
export interface GitLogOptions {
  /** Commits per page. */
  maxCount: number
  /** Commits to skip before the page starts. */
  skip: number
  /** Case-insensitive substring the commit message must contain. */
  search?: string
}
/**
 * Read a page of commit history, newest first.
 *
 * Backed by `gix`, so a page costs no child processes: the walk, the ref
 * decoration and the unpushed-commit set all come out of one open repository.
 * An unborn branch resolves to an empty page rather than rejecting, matching
 * what the Git tab showed for a repository with no commits.
 */
export declare function gitLogCommits(repoRoot: string, options: GitLogOptions): Promise<GitLogPage>
/**
 * Read one commit by any revision spec git would accept.
 *
 * Resolves with `null` for a spec that names nothing, because the caller has
 * always treated "no such commit" as an absent value rather than a failure.
 */
export declare function gitLogCommit(repoRoot: string, rev: string): Promise<GitLogCommit | null>
/**
 * The repository's default branch, and whether it came from a remote ref.
 *
 * `fromRemote` is what lets the caller keep memoising exactly the answers it
 * always memoised: the TypeScript cached `origin/main`, `origin/master` and
 * `origin/HEAD` for a minute and deliberately left the local `main`/`master`
 * fallbacks uncached.
 */
export interface GitRangeDefaultBranch {
  name: string
  fromRemote: boolean
}
/** Which ref a range is measured against, and whether that was the ref asked for. */
export interface GitRangeBaseRef {
  /** Absent when the repository has no default branch to fall back to. */
  baseRef?: string
  /** The `GitRangeBaseMode` actually used — not always the one requested. */
  baseMode: string
  /** True when `upstream` was asked for but the branch has no upstream. */
  baseModeFallback: boolean
}
/** One file in a commit range, minus the `repositoryRoot` the caller owns. */
export interface GitRangeFile {
  path: string
  /** A `GitChangeStatus` string union member. */
  status: string
  additions: number
  deletions: number
  /** Source path of a rename or copy; absent otherwise. */
  oldPath?: string
}
/** Added and removed line totals across a range. */
export interface GitRangeDiffStats {
  additions: number
  deletions: number
}
/**
 * Find the repository's default branch: `origin/main`, `origin/master`,
 * whatever `origin/HEAD` points at, then local `main` or `master`.
 *
 * Five ref lookups through `gix` where the TypeScript spawned up to five
 * `rev-parse --verify` children. Resolves with `null` when none of them exist.
 */
export declare function gitRangeDefaultBranch(repoRoot: string): Promise<GitRangeDefaultBranch | null>
/**
 * The current branch's upstream, e.g. `origin/my-feature`.
 *
 * Resolves with `null` for a branch with no upstream and for a detached HEAD,
 * both of which the caller already read as "no tracking branch".
 */
export declare function gitRangeUpstreamBranch(repoRoot: string): Promise<string | null>
/**
 * Resolve the ref a range should be measured against.
 *
 * `baseMode` is a `GitRangeBaseMode` member; anything else reads as
 * `default-branch`, matching what the route does with a misspelled `?base=`.
 * Asking for `upstream` on a branch with no upstream resolves to the default
 * branch with `baseModeFallback` set, rather than to nothing.
 */
export declare function gitRangeResolveBaseRef(repoRoot: string, baseMode: string): Promise<GitRangeBaseRef>
/**
 * The best merge base between two revisions.
 *
 * Resolves with `null` for unrelated histories and for a revision that names
 * nothing — both of which `git merge-base` reported by exiting non-zero, and
 * the caller turned into a null.
 */
export declare function gitRangeMergeBase(repoRoot: string, one: string, two: string): Promise<string | null>
/**
 * How many commits `headRef` has that `baseRef` does not.
 *
 * `git rev-list --count <base>..<head>` as a `gix` walk. A revision that names
 * nothing counts zero, which is what the TypeScript's `parseInt(...) || 0`
 * produced from the failed command.
 */
export declare function gitRangeCountAhead(repoRoot: string, baseRef: string, headRef: string): Promise<number>
/**
 * Read the files changed between two refs, in git's own order.
 *
 * Runs `diff --numstat` and `diff --name-status -M -C` over the three-dot
 * range and joins them, so neither output crosses the boundary as text. The
 * list is not sorted: the caller orders it with `localeCompare`, which is not
 * a byte comparison and is what the range view already shows.
 */
export declare function gitRangeChangedFiles(repoRoot: string, baseRef: string, headRef: string, options?: GitExecOptions | undefined | null): Promise<GitRangeFile[]>
/**
 * Join `--numstat` and `--name-status` text that was produced somewhere else.
 *
 * The WSL twin of {@link git_range_changed_files}, for the same reason
 * {@link parse_git_status_porcelain} exists: a repository inside a WSL distro
 * runs git through `wsl.exe` in TypeScript, and the parser must still be the
 * single one in the codebase.
 */
export declare function parseGitRangeChangedFiles(numstat: string, nameStatus: string): Promise<GitRangeFile[]>
/** Read the added and removed line totals between two refs. */
export declare function gitRangeDiffStats(repoRoot: string, baseRef: string, headRef: string, options?: GitExecOptions | undefined | null): Promise<GitRangeDiffStats>
/**
 * Parse `git diff --shortstat` text that was produced somewhere else.
 *
 * The WSL twin of {@link git_range_diff_stats}.
 */
export declare function parseGitDiffShortstat(text: string): Promise<GitRangeDiffStats>
/** Repository metadata from one `git status --porcelain=v2 --branch` call. */
export interface GitRepositoryStatus {
  /** Current branch name, or `HEAD` when detached. */
  branch: string
  isDetached: boolean
  /** Whether the index or working tree holds any change at all. */
  dirty: boolean
  ahead: number
  behind: number
  /** Configured upstream branch; absent when there is none. */
  trackingBranch?: string
  /** Whether the repository has no commits yet. */
  unborn: boolean
}
/**
 * The checked-out branch and its drift from upstream.
 *
 * `hasUncommittedChanges` is missing on purpose: the caller already has that
 * answer and merges it in, rather than paying for a second status read here.
 */
export interface GitBranchStatus {
  /** Empty when HEAD is detached. */
  name: string
  isDetached: boolean
  /** The commit HEAD points at; only present when detached. */
  detachedHash?: string
  ahead: number
  behind: number
  /** Remote tracking branch, e.g. `origin/main`; absent when unconfigured. */
  trackingBranch?: string
}
/** One branch as the branch list renders it. */
export interface GitBranchEntry {
  /** Short name — `main` locally, `origin/main` for a remote branch. */
  name: string
  isCurrent: boolean
  isRemote: boolean
  /** The part before the first `/` of a remote branch's name. */
  remoteName?: string
  lastCommitSubject: string
  /** `%(committerdate:relative)`, e.g. `3 days ago`. */
  lastCommitDate: string
}
/** One page of the branch list. */
export interface GitBranchPage {
  branches: Array<GitBranchEntry>
  /** Matching branches in the whole repository, not just on this page. */
  totalCount: number
  hasMore: boolean
}
/** Which slice of the branch list to read. */
export interface GitBranchListOptions {
  /** Remote branches instead of local ones. */
  remote: boolean
  /**
   * Branches to return. Zero returns the total with no rows, which is how
   * the count-only callers ask their question.
   */
  limit: number
  offset: number
  /** Case-insensitive substring the branch *name* must contain. */
  search?: string
}
/**
 * Read branch, tracking and working-tree metadata with one git command.
 *
 * Still the CLI rather than `gix`: the answer includes whether the tree is
 * dirty, and deciding that means the index refresh and `.gitignore` walk git
 * already does.
 */
export declare function gitRepositoryStatus(repoRoot: string): Promise<GitRepositoryStatus>
/**
 * Parse `--porcelain=v2 --branch` text produced somewhere else.
 *
 * The WSL twin of {@link git_repository_status}: those repositories run git
 * through `wsl.exe` in TypeScript, and this keeps the parser a single
 * implementation rather than two that drift.
 */
export declare function parseGitBranchStatus(output: string): Promise<GitRepositoryStatus>
/**
 * Read the checked-out branch, its upstream, and the drift between them.
 *
 * One opened repository in place of the four `rev-parse` / `symbolic-ref` /
 * `rev-list` children the Git tab used to spawn for this. Resolves with `null`
 * when HEAD names nothing — an unborn branch — which the caller has always
 * treated as an absent status rather than a failure.
 */
export declare function gitBranchStatus(repoRoot: string): Promise<GitBranchStatus | null>
/**
 * Read a page of the branch list, in git's own `refname` order.
 *
 * Backed by `gix`, so a page costs no child processes — and no shell either:
 * the TypeScript built a `git branch | grep | tail | head` pipeline whose
 * Windows half had to be spelled with `findstr` instead.
 */
export declare function gitListBranches(repoRoot: string, options: GitBranchListOptions): Promise<GitBranchPage>
/**
 * Read `git remote get-url <remote>` from configuration, with no child
 * process at all.
 *
 * Resolves with `null` when the remote is not configured or carries no URL —
 * the two cases `get-url` reported as one non-zero exit, and the caller as one
 * absent value. Only a path that is not a repository rejects.
 *
 * The bytes come back as configured: `gix` lowercases a host when it renders a
 * parsed URL, and this string is what the sidebar's grouping key is built
 * from, so the raw value wins wherever it and the resolved URL agree.
 */
export declare function gitRemoteUrl(repoRoot: string, remote: string): Promise<string | null>
/**
 * The repository's primary remote URL: `origin`, or the first remote by name
 * when `origin` is not configured.
 *
 * One call over one opened repository, where the TypeScript spawned between
 * one and three children to ask the same question. Resolves with `null` for a
 * repository with no remotes; rejects only when the path is not a repository,
 * which the caller reads as `undefined` too.
 */
export declare function gitDetectRemoteUrl(repoRoot: string): Promise<string | null>
/**
 * Every value `git config --global --get-all <key>` prints, one per element.
 *
 * No repository is involved, so there is no `repoRoot` parameter: this reads
 * the user's own config file, which is exactly what the `safe.directory` check
 * needs — a repository-local entry is not what Git for Windows consults before
 * agreeing to open a repo on the WSL share.
 *
 * Rejects with `git config --global --get-all <key> failed:` when the key is
 * unset or the global config file does not exist; the caller reads both as
 * "not configured".
 */
export declare function gitGlobalConfigGetAll(key: string, options?: GitExecOptions | undefined | null): Promise<string[]>
/**
 * Append a value to a multi-valued key in the global config file.
 *
 * `--add`, not a set: `safe.directory` is a list of every repository the user
 * has approved, and replacing it would revoke the rest.
 */
export declare function gitGlobalConfigAdd(key: string, value: string, options?: GitExecOptions | undefined | null): Promise<void>
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

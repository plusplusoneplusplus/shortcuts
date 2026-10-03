import type {
    NativeContentMatch,
    NativeContentSearchResult,
    NativeFileMatch,
    NativeRepoTreeEntry,
    NativeRepoTreeListing,
} from '@plusplusoneplusplus/coc-native';

/** Metadata about a registered workspace/repo, derived from WorkspaceInfo in @plusplusoneplusplus/forge. */
export interface RepoInfo {
    /** Stable ID — the WorkspaceInfo.id (hash of rootPath). */
    id: string;
    /** Human-readable name (folder basename). */
    name: string;
    /** Absolute path to the repo root on disk. */
    localPath: string;
    /** Current HEAD commit SHA (short, 7 chars). Empty string if not a git repo. */
    headSha: string;
    /** ISO timestamp of when the workspace was registered. */
    clonedAt: string;
    /** Git remote URL (origin), if available. */
    remoteUrl?: string;
}

/** Directory and search results use the Rust-generated wire shapes. */
export type TreeEntry = NativeRepoTreeEntry;
export type TreeListResult = NativeRepoTreeListing;
export type FileSearchResult = NativeFileMatch;
export type ContentMatch = NativeContentMatch;
export type ContentSearchResult = NativeContentSearchResult;

/** Result of a fuzzy file search across a repo. */
export interface SearchFilesResult {
    /** Matched file paths, sorted by score descending. */
    results: FileSearchResult[];
    /** True if the underlying file list was truncated at the cap. */
    truncated: boolean;
}

/**
 * The hard cap on matches one content search may return.
 *
 * The engine has no cancellation, so the caps are the only bound on what a
 * single query costs. A client asking for more is clamped to this, never
 * honoured.
 */
export const CONTENT_SEARCH_MAX_RESULTS = 500;

/** Query modes, scoping and caps for one content search. */
export interface ContentSearchOptions {
    /** Repo-relative subfolder to search. Omit for the whole repo. */
    path?: string;
    /** Match case exactly. Default false. */
    caseSensitive?: boolean;
    /** Require word boundaries around the query. Default false. */
    wholeWord?: boolean;
    /** Treat the query as a regular expression rather than a literal. Default false. */
    regex?: boolean;
    /** Search files `.gitignore` excludes — the explorer's `showIgnored` flag. */
    showIgnored?: boolean;
    /** Search only Git-tracked files, optionally adding non-ignored untracked files. */
    fileScope?: 'tracked';
    /** Add ordinary untracked files when `fileScope` is `tracked`. */
    includeUntracked?: boolean;
    /** Whitelist globs. When non-empty, a file matching none of them is skipped. */
    include?: string[];
    /** Globs whose matches are skipped. */
    exclude?: string[];
    /** Cap on total matches, clamped to 1..{@link CONTENT_SEARCH_MAX_RESULTS}. */
    limit?: number;
}

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

/** A single entry in a directory listing. */
export interface TreeEntry {
    /** File or directory name (basename only, no path separators). */
    name: string;
    /** Entry type. */
    type: 'file' | 'dir';
    /** Size in bytes (files only; undefined for directories). */
    size?: number;
    /** Path relative to the repo root, e.g. "src/index.ts". */
    path: string;
    /** Nested children, populated only for directory entries when depth > 1. */
    children?: TreeEntry[];
}

/** Result of listing a single directory inside a repo. */
export interface TreeListResult {
    /** Directory entries, dirs-first then alphabetical. */
    entries: TreeEntry[];
    /** True when the directory has more entries than the size guard allows. */
    truncated: boolean;
}

/** A single scored match from a fuzzy file-path search. */
export interface FileSearchResult {
    /** Repo-relative file path. */
    path: string;
    /** Higher = better match. */
    score: number;
    /**
     * Positions in `path` that matched the query, ascending, as JavaScript
     * string indices. Clients highlight exactly these characters instead of
     * re-deriving the match, so highlight and score cannot disagree.
     */
    indices: number[];
}

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

/** One matching line from a content search. */
export interface ContentMatch {
    /** Repo-relative path with `/` separators on every platform. */
    path: string;
    /** One-based line number. */
    line: number;
    /** The matching line without its trailing newline, possibly truncated. */
    text: string;
    /**
     * UTF-16 offset of the match within `text` — a JavaScript string index, so
     * a client highlighting `text.slice(startColumn, endColumn)` highlights
     * exactly what matched.
     */
    startColumn: number;
    /** UTF-16 offset one past the end of the match within `text`. */
    endColumn: number;
    /**
     * Present when this line is one piece of a match that crossed a line break
     * — a multi-line query. Every piece of that match carries the same id, and
     * the id is unique within a path. Absent for a single-line match.
     */
    group?: number;
    /** Lines preceding `line`, in file order. */
    before: string[];
    /** Lines following `line`, in file order. */
    after: string[];
}

/** Result of a content search across a repo. */
export interface ContentSearchResult {
    /** Matching lines, sorted by path then line. */
    matches: ContentMatch[];
    /**
     * True when any cap was hit — the total cap, the per-file cap, or a file
     * skipped for being too large. One flag for all three, because a caller
     * can do nothing different about any of them beyond saying so.
     */
    truncated: boolean;
}

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
    /** Whitelist globs. When non-empty, a file matching none of them is skipped. */
    include?: string[];
    /** Globs whose matches are skipped. */
    exclude?: string[];
    /** Cap on total matches, clamped to 1..{@link CONTENT_SEARCH_MAX_RESULTS}. */
    limit?: number;
}

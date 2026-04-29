/**
 * Notes Git — shared type definitions.
 *
 * Pure types, no runtime dependencies. Safe to import from server and client code.
 */

// ── Per-repo preference config ──────────────────────────────────────

/** Auto-commit scheduling settings within NotesGitConfig. */
export interface NotesGitAutoCommitConfig {
    /** Whether periodic auto-commit is enabled. */
    enabled: boolean;
    /** Interval between auto-commits in milliseconds (default: 1 800 000 = 30 min). */
    intervalMs?: number;
}

/** Per-repo preference block for notes git tracking. */
export interface NotesGitConfig {
    /** Whether the notes directory has been git-initialized. */
    enabled: boolean;
    /** Auto-commit scheduling settings. */
    autoCommit?: NotesGitAutoCommitConfig;
}

// ── API response types ──────────────────────────────────────────────

/** GET /api/repos/:repoId/notes-git/status response. */
export interface NotesGitStatus {
    /** Whether the notes directory is a git repository. */
    initialized: boolean;
    /** Current branch name (empty string when not initialized). */
    branch: string;
    /** True when working tree has no changes. */
    clean: boolean;
    /** Paths staged for commit. */
    staged: string[];
    /** Paths with unstaged modifications. */
    unstaged: string[];
    /** Paths not tracked by git. */
    untracked: string[];
    /** Total count: staged + unstaged + untracked. */
    totalChanges: number;
}

/** Single entry in the notes git log. */
export interface NotesGitLogEntry {
    /** Full commit hash. */
    hash: string;
    /** Abbreviated commit hash. */
    shortHash: string;
    /** Commit message (first line). */
    message: string;
    /** ISO 8601 commit date. */
    date: string;
    /** Number of files changed in this commit. */
    filesChanged: number;
}

/** A single file's diff information. */
export interface NotesGitDiffFile {
    /** Relative file path within the notes directory. */
    path: string;
    /** Git status letter: 'A' (added), 'M' (modified), 'D' (deleted), etc. */
    status: string;
    /** Unified diff content for this file. */
    diff: string;
}

/** GET /api/repos/:repoId/notes-git/diff response. */
export interface NotesGitDiff {
    /** Per-file diff details. */
    files: NotesGitDiffFile[];
}

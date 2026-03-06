/** Metadata about a registered workspace/repo, derived from WorkspaceInfo in pipeline-core. */
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
}

/** Result of listing a single directory inside a repo. */
export interface TreeListResult {
    /** Directory entries, dirs-first then alphabetical. */
    entries: TreeEntry[];
    /** True when the directory has more entries than the size guard allows. */
    truncated: boolean;
}

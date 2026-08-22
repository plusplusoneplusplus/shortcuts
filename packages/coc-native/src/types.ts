/** Options for building or refreshing a native file index. */
export interface NativeBuildOptions {
    /** Include gitignored files — the explorer's `showIgnored` flag. */
    includeIgnored?: boolean;
    /** Safety cap on indexed paths. Omit for no cap. */
    maxEntries?: number;
}

/** A scored path returned by {@link NativeFileIndex.search}. */
export interface NativeFileMatch {
    path: string;
    score: number;
    /**
     * Matched positions within `path`, ascending, as JavaScript string indices.
     * The client highlights exactly these characters, so highlight and score
     * can never disagree.
     */
    indices: number[];
}

/** An in-memory, gitignore-aware index of one repository's file paths. */
export interface NativeFileIndex {
    /** Number of indexed paths. */
    len(): number;
    /** True when the walk hit the configured `maxEntries` cap. */
    truncated(): boolean;
    /** A window of the raw path list, in index order. */
    files(offset: number, limit: number): string[];
    /** Best `limit` matches for `query`, best first. */
    search(query: string, limit: number): Promise<NativeFileMatch[]>;
    /** Re-walk the root and atomically swap in the new path list. */
    refresh(): Promise<void>;
}

/** The addon's module surface. */
export interface NativeFileIndexAddon {
    buildFileIndex(root: string, options?: NativeBuildOptions): Promise<NativeFileIndex>;
}

/** Why the addon is or is not available, for logs and `/health`. */
export interface NativeFileIndexStatus {
    loaded: boolean;
    /** Absolute path of the binary that loaded, when one did. */
    binaryPath?: string;
    /** Why loading was skipped or failed, when it was. */
    reason?: string;
}

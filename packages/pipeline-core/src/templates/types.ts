/** Base template — `kind` is a discriminated union tag for future extensibility. */
export interface Template {
    name: string;
    kind: 'commit';
    description?: string;
    hints?: string[];
}

/** Commit-flavoured template — references an existing commit by hash. */
export interface CommitTemplate extends Template {
    kind: 'commit';
    commitHash: string;
}

/** Input for `replicateCommit()`. */
export interface ReplicateOptions {
    template: CommitTemplate;
    repoRoot: string;
    instruction: string;
}

/** A single file change produced by the AI. */
export interface FileChange {
    path: string;
    content: string;
    status: 'new' | 'modified' | 'deleted';
    explanation?: string;
}

/** Return value of `replicateCommit()`. */
export interface ReplicateResult {
    files: FileChange[];
    summary: string;
}

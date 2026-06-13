/**
 * Native GitHub Copilot CLI session types.
 *
 * These records are read from the current user's native Copilot CLI session
 * store (`~/.copilot/session-store.db`). The store is external data owned by
 * the Copilot CLI — CoC reads it strictly read-only and never imports these
 * sessions into CoC process history.
 */

/** Reason a native-session response carries no data. */
export type NativeCopilotSessionsUnavailableReason = 'feature-disabled' | 'db-missing' | 'db-invalid';

/** One row in the native session list. */
export interface NativeCopilotSessionListItem {
    id: string;
    repository: string | null;
    cwd: string | null;
    hostType: string | null;
    branch: string | null;
    /** First line of the stored summary, truncated for list display. */
    summaryPreview: string;
    createdAt: string | null;
    updatedAt: string | null;
    turnCount: number;
    /** Snippets from indexed content matched by a text query (empty without a text hit). */
    matchSnippets: string[];
}

/** One ordered turn of a native session. */
export interface NativeCopilotSessionTurn {
    id: number;
    turnIndex: number;
    timestamp: string | null;
    userMessage: string;
    assistantResponse: string;
    userChars: number;
    assistantChars: number;
    /** search_index source id for this turn when an index row exists. */
    searchIndexSourceId: string | null;
    /** Indexed content length for this turn when an index row exists. */
    searchIndexChars: number | null;
}

/** Full native session detail. */
export interface NativeCopilotSessionDetail {
    id: string;
    repository: string | null;
    cwd: string | null;
    hostType: string | null;
    branch: string | null;
    summary: string;
    createdAt: string | null;
    updatedAt: string | null;
    turns: NativeCopilotSessionTurn[];
}

/** Filters accepted by the native session list query. */
export interface NativeCopilotSessionListOptions {
    /** Free-text query against natively indexed content (search_index FTS). */
    q?: string;
    /** Exact or partial session ID match. */
    sessionId?: string;
    /** Exact branch filter. */
    branch?: string;
    /** ISO timestamp lower bound on updated_at (inclusive). */
    from?: string;
    /** ISO timestamp upper bound on updated_at (inclusive). */
    to?: string;
    limit?: number;
    offset?: number;
    /**
     * Native `sessions.id` values to exclude from results. Used to deduplicate
     * against native sessions already tracked as CoC processes (the Copilot
     * SDK/CLI session id equals the native store id). Server-internal — not a
     * client-supplied query parameter.
     */
    excludeSessionIds?: ReadonlySet<string>;
    /**
     * When true, include background-job sessions (e.g. conversation-title
     * summarization) that are otherwise hidden. Defaults to false (hide them).
     */
    includeBackgroundJobs?: boolean;
}

/** Workspace identity used to scope native sessions to the active CoC workspace. */
export interface NativeSessionWorkspaceScope {
    /** Registered workspace root path; matches native `sessions.cwd` (equal or descendant). */
    rootPath?: string;
    /** Workspace `owner/repo` identity; matches native `sessions.repository` case-insensitively. */
    repository?: string;
}

export type NativeCopilotSessionListResult =
    | {
        available: true;
        items: NativeCopilotSessionListItem[];
        total: number;
        /** False when metadata tables exist but the native search_index is absent. */
        searchIndexAvailable: boolean;
        /** Count of workspace-scoped native sessions hidden because they are already tracked as CoC processes. */
        deduplicatedCount: number;
        /** Count of workspace-scoped native sessions hidden because they are background jobs (e.g. title summarization). */
        backgroundJobCount: number;
    }
    | {
        available: false;
        reason: Exclude<NativeCopilotSessionsUnavailableReason, 'feature-disabled'>;
    };

export type NativeCopilotSessionDetailResult =
    | { available: true; session: NativeCopilotSessionDetail | null }
    | { available: false; reason: Exclude<NativeCopilotSessionsUnavailableReason, 'feature-disabled'> };

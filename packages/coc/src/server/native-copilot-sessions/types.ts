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
    /**
     * Reconstructed chat transcript for rich dashboard rendering. Built from the
     * rich `session-state/<id>/events.jsonl` log when it is available and
     * parseable; otherwise mapped from the flat {@link NativeCopilotSessionTurn}s
     * above as text-only user/assistant turns. Always present (possibly empty).
     */
    conversation: ReconstructedConversationTurn[];
}

/**
 * One reconstructed tool call inside a {@link ReconstructedConversationTurn}.
 *
 * Mirrors the SPA-side `ClientToolCall` so the dashboard chat components
 * (`ConversationArea` / `ConversationTurnBubble`) can render it without a fork.
 */
export interface ReconstructedToolCall {
    id: string;
    toolName: string;
    /** Raw tool arguments object as recorded by the native CLI. */
    args: unknown;
    /** Tool result text (full `detailedContent`, else short `content`) when it succeeded. */
    result?: string;
    /** Error message when the tool call failed. */
    error?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
}

/**
 * One timeline event inside a {@link ReconstructedConversationTurn}, mirroring
 * the SPA-side `ClientTimelineItem` so the chat bubble can interleave assistant
 * text and tool cards in chronological order.
 */
export interface ReconstructedTimelineItem {
    type: 'content' | 'tool-start' | 'tool-complete' | 'tool-failed';
    timestamp: string;
    content?: string;
    toolCall?: ReconstructedToolCall;
}

/**
 * A single reconstructed conversation turn, mirroring the subset of the
 * SPA-side `ClientConversationTurn` that the read-only native-session detail
 * view populates. Built either from the rich `session-state/<id>/events.jsonl`
 * log or, as a fallback, from the flat `session-store.db` turns.
 */
export interface ReconstructedConversationTurn {
    role: 'user' | 'assistant';
    /** Primary markdown content of the turn. */
    content: string;
    timestamp?: string;
    turnIndex?: number;
    toolCalls?: ReconstructedToolCall[];
    timeline: ReconstructedTimelineItem[];
    /** Base64 data-URL strings for images attached to or produced in this turn. */
    images?: string[];
    /** Readable model reasoning/thinking for an assistant turn (events.jsonl `reasoningText`). */
    thinking?: string;
    /** Skills invoked during this turn. */
    skillNames?: string[];
    /** Model that produced an assistant turn (e.g. `gpt-5.5`, `claude-opus-4.8`). */
    model?: string;
    /** True when an assistant turn ended in an error. */
    isError?: boolean;
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

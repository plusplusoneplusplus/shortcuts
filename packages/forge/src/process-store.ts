/**
 * Process Store Interface
 *
 * Abstract storage interface for AI processes with workspace-scoped querying.
 * Enables multi-workspace process tracking for the standalone AI execution server.
 *
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

import { AIProcess, AIProcessStatus, AIProcessType, ProcessEvent, ConversationTurn, TimelineItem } from './ai/process-types';
import type { PipelinePhaseEvent, PipelineProgressEvent, ItemProcessEventData } from './pipeline-types';
import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ConversationCostEstimate } from './ai/conversation-cost-estimate';

/**
 * A single FTS5 search hit within a conversation turn,
 * enriched with process-level metadata for display.
 */
export interface ConversationSearchResult {
    processId: string;
    turnIndex: number;
    role: string;
    /** FTS5 snippet() output with match highlights */
    snippet: string;
    /** BM25 relevance score (lower is more relevant) */
    rank: number;
    processTitle?: string;
    promptPreview: string;
    processStatus: string;
    processType: string;
    workspaceId: string;
    startTime: string;
}

/**
 * Filter criteria for FTS5 conversation search.
 */
export interface SearchFilter {
    workspaceId?: string;
    status?: AIProcessStatus | AIProcessStatus[];
    type?: AIProcessType;
    /** Inclusive lower bound on conversation activity time: COALESCE(lastEventAt, startTime). */
    since?: Date;
    /** Exclusive upper bound on conversation activity time: COALESCE(lastEventAt, startTime). */
    until?: Date;
    limit?: number;
    offset?: number;
}

export interface PromptAutocompleteHistoryItem {
    text: string;
    source: 'initial' | 'follow-up';
    workspaceId?: string;
    processId?: string;
    timestamp: string;
    prefixMatch: boolean;
}

export interface PromptAutocompleteContext {
    exactPrefixMatches: PromptAutocompleteHistoryItem[];
    recentWorkspacePrompts: PromptAutocompleteHistoryItem[];
    recentProcessTurns: PromptAutocompleteHistoryItem[];
    historyFingerprint: string;
}

/**
 * Output event emitted during process execution.
 * Used by SSE streaming to push real-time output to clients.
 */
export interface HookStepEvent {
    step: string;
    status: 'running' | 'done' | 'failed';
    script: string;
    output?: string;
    durationMs?: number;
    /** Index within the postActions array (for post-action steps). */
    index?: number;
    /** Whether this is a 'script' or 'skill' action (for post-action steps). */
    actionType?: 'script' | 'skill';
    /** Skill name (for skill post-actions). */
    skillName?: string;
}

export interface ProcessOutputEvent {
    type: 'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed' | 'permission-request' | 'pipeline-phase' | 'pipeline-progress' | 'item-process' | 'suggestions' | 'token-usage' | 'message-queued' | 'message-steering' | 'hook-step' | 'background-tasks' | 'pending-message-added' | 'note-file-edit' | 'ask-user' | 'mcp-oauth-required' | 'mcp-oauth-completed';
    /** Partial output text (for 'chunk' events). */
    content?: string;
    /** Final process status (for 'complete' events). */
    status?: AIProcessStatus;
    /** Human-readable duration string (for 'complete' events). */
    duration?: string;
    /** Zero-based conversation turn index (for tool events, message-queued, message-steering). */
    turnIndex?: number;
    /** Unique tool call identifier (for tool events). */
    toolCallId?: string;
    /** Parent tool call ID for nested/subagent tool events. */
    parentToolCallId?: string;
    /** Tool name (for 'tool-start' events). */
    toolName?: string;
    /** Tool input parameters (for 'tool-start' events). */
    parameters?: Record<string, unknown>;
    /** Tool output result (for 'tool-complete' events). */
    result?: string;
    /** Error message (for 'tool-failed' events). */
    error?: string;
    /** Permission request ID (for 'permission-request' events). */
    permissionId?: string;
    /** Permission kind: 'read' | 'write' | 'shell' | 'url' | 'mcp' (for 'permission-request'). */
    kind?: string;
    /** Human-readable permission description (for 'permission-request' events). */
    description?: string;
    /** Pipeline phase event data (for 'pipeline-phase' events). */
    pipelinePhase?: PipelinePhaseEvent;
    /** Pipeline progress event data (for 'pipeline-progress' events). */
    pipelineProgress?: PipelineProgressEvent;
    /** Item-level process event data (for 'item-process' events). */
    itemProcess?: ItemProcessEventData;
    /** Follow-up message suggestions (for 'suggestions' events). */
    suggestions?: string[];
    /** Per-turn token usage data (for 'token-usage' events). */
    tokenUsage?: TokenUsage;
    /** Running total of token usage after this turn (for 'token-usage' events). */
    cumulativeTokenUsage?: TokenUsage;
    /** Server-derived estimated conversation cost after this turn (for 'token-usage' events). */
    conversationCostEstimate?: ConversationCostEstimate;
    /** Session-level token limit (for 'token-usage' events). */
    sessionTokenLimit?: number;
    /** Session-level current tokens (for 'token-usage' events). */
    sessionCurrentTokens?: number;
    /** Session-level system-prompt tokens from breakdown (for 'token-usage' events). */
    sessionSystemTokens?: number;
    /** Session-level tool-definition tokens from breakdown (for 'token-usage' events). */
    sessionToolTokens?: number;
    /** Session-level conversation tokens from breakdown (for 'token-usage' events). */
    sessionConversationTokens?: number;
    /** Resolved delivery mode (for 'message-queued' events). */
    deliveryMode?: 'immediate' | 'enqueue';
    /** 1-based queue position; 0 for immediate mode (for 'message-queued' events). */
    queuePosition?: number;
    /** Client-provided optimistic ID echoed back for reconciliation (for 'message-queued' / 'message-steering' events). */
    optimisticId?: string;
    /** Hook step event data (for 'hook-step' events). */
    hookStep?: HookStepEvent;
    /** Active background agents (for 'background-tasks' events). */
    backgroundAgents?: Array<{ id: string; type?: string; description?: string }>;
    /** Active background shells (for 'background-tasks' events). */
    backgroundShells?: Array<{ id: string; type?: string; description?: string }>;
    /** Total number of active background tasks (for 'background-tasks' events). */
    backgroundTotalActive?: number;
    /** Whether the session is waiting for background tasks to drain (for 'background-tasks' events). */
    backgroundWaitingForDrain?: boolean;
    /** The pending message that was added (for 'pending-message-added' events). */
    pendingMessage?: { id: string; content: string; mode?: string; createdAt: string };
    /** Note file edit event data (for 'note-file-edit' events). */
    noteFileEdit?: {
        toolCallId: string;
        /** Path as reported by the AI tool (absolute or relative). */
        filePath: string;
        oldStr: string;
        newStr: string;
    };
    /** MCP OAuth data (for 'mcp-oauth-required' / 'mcp-oauth-completed' events). */
    mcpOAuth?: {
        requestId: string;
        serverName: string;
        serverUrl: string;
        authorizationUrl?: string;
    };
    /** Ask-user question data (for 'ask-user' events). */
    askUser?: {
        questionId: string;
        question: string;
        type: 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text';
        options?: Array<{ value: string; label: string; description?: string }>;
        defaultValue?: string | string[];
        turnIndex: number;
    };
}

/**
 * Workspace identity for multi-workspace process tracking.
 * Physical workspace `id` values are machine-scoped; virtual/system workspace
 * IDs are fixed.
 */
export interface WorkspaceInfo {
    /** Stable unique identifier — hash of rootPath */
    id: string;
    /** Human-readable name (e.g. workspace folder name) */
    name: string;
    /** Absolute path to workspace root */
    rootPath: string;
    /** Optional UI color for dashboard differentiation */
    color?: string;
    /** Git remote URL (typically origin) — used to group clones of the same repo */
    remoteUrl?: string;
    /** Optional user-supplied description for this workspace. */
    description?: string;
    /**
     * Per-workspace MCP server filter.
     * - `undefined` — use the default MCP configuration (no override).
     * - `null` — all MCP servers are disabled for this workspace.
     * - `string[]` — only the named servers are active; others are suppressed.
     */
    enabledMcpServers?: string[] | null;
    /**
     * Per-workspace skill deny-list.
     * - `undefined` — all installed skills are enabled (default).
     * - `string[]` — skills whose name matches an entry are disabled.
     */
    disabledSkills?: string[];
    /**
     * Extra skill directories searched after `.github/skills/` and `~/.coc/skills/`, in order.
     * Paths may be absolute or relative to the workspace `rootPath`.
     */
    extraSkillFolders?: string[];
    /** True for the global workspace (not a real git repo). Virtual workspaces are hidden from the repos grid. */
    virtual?: boolean;
}

/**
 * Wiki identity for multi-wiki support in the CoC server.
 * `id` is a stable hash of the wikiDir path.
 */
export interface WikiInfo {
    /** Stable unique identifier — typically a hash of wikiDir */
    id: string;
    /** Human-readable name (e.g. "My Project Wiki") */
    name: string;
    /** Absolute path to the generated wiki directory */
    wikiDir: string;
    /** Absolute path to the source repository (optional — wiki may be standalone) */
    repoPath?: string;
    /** Optional UI color for dashboard differentiation */
    color?: string;
    /** Whether AI Q&A is enabled for this wiki */
    aiEnabled: boolean;
    /** ISO 8601 timestamp of when the wiki was registered */
    registeredAt: string;
}

/**
 * Aggregate storage statistics for admin/diagnostics.
 */
export interface StorageStats {
    totalProcesses: number;
    totalWorkspaces: number;
    totalWikis: number;
    /** Approximate total size of persisted data files in bytes. */
    storageSize: number;
}

/**
 * Filter criteria for querying processes.
 * All fields are optional; omitted fields impose no constraint.
 */
export interface ProcessFilter {
    workspaceId?: string;
    parentProcessId?: string;
    status?: AIProcessStatus | AIProcessStatus[];
    type?: AIProcessType;
    /**
     * Inclusive lower time bound. Lightweight metadata/history queries interpret this
     * as conversation activity time: COALESCE(lastEventAt, startTime), so follow-ups
     * on older conversations are included. Legacy full-process queries preserve their
     * existing startTime-based behavior where possible.
     */
    since?: Date;
    /** Exclusive upper time bound, using the same time-field semantics as `since`. */
    until?: Date;
    limit?: number;
    offset?: number;
    /**
     * Fields to exclude from the response.
     * Currently supported:
     *   - 'conversation' — strips conversationTurns, fullPrompt, and result
     *   - 'toolCalls' — strips toolCalls arrays from conversation turns (keeps turns intact)
     * Combining both reduces payload size for history/list views.
     */
    exclude?: string[];
}

/**
 * Lightweight index entry for process summaries.
 * Contains only the fields needed for list/sidebar views — no conversation data.
 */
export interface ProcessIndexEntry {
    id: string;
    workspaceId: string;
    status: string;
    type: string;
    startTime: string;
    endTime?: string;
    promptPreview: string;
    error?: string;
    parentProcessId?: string;
    title?: string;
    /** User-set custom title (set via rename UI). Orthogonal to AI-generated `title`. */
    customTitle?: string;
    /** Denormalized cleaned snapshot of the latest conversation turn (~120 chars). */
    lastMessagePreview?: string;
    /** Duration in milliseconds (computed from startTime/endTime). */
    duration?: number;
    /** Timestamp of the last conversation event (ISO string). */
    lastEventAt?: string;
    /** Activity timestamp used for metadata history ordering/filtering. */
    activityAt?: string;
    /** ISO timestamp when the process was pinned (null = not pinned). */
    pinnedAt?: string;
    /** Whether the process is archived. */
    archived?: boolean;
    /**
     * Number of unanswered interactive ask-user questions currently awaiting the user.
     * Omitted (or 0) when the process is not waiting for input. Used by list/sidebar
     * views to surface an "awaiting input" indicator without loading the full process.
     */
    pendingAskUserCount?: number;
}

/**
 * Callback type for process change notifications.
 */
export type ProcessChangeCallback = (event: ProcessEvent) => void;

/**
 * Abstract storage interface for AI processes.
 *
 * Implementations may be backed by VS Code Memento (extension),
 * in-memory Map (tests / server), or SQLite (persistent server).
 */
export interface ProcessStore {
    addProcess(process: AIProcess): Promise<void>;
    updateProcess(id: string, updates: Partial<AIProcess>): Promise<void>;
    getProcess(id: string, workspaceId?: string): Promise<AIProcess | undefined>;
    getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]>;
    removeProcess(id: string): Promise<void>;
    /** Remove processes matching filter. Returns count of removed items. */
    clearProcesses(filter?: ProcessFilter): Promise<number>;

    /**
     * Return lightweight index entries without loading full process files.
     * Optional — only file-backed stores support this.
     */
    getProcessSummaries?(filter?: ProcessFilter): Promise<{ entries: ProcessIndexEntry[]; total: number }>;

    /**
     * Return all process IDs matching the given filter.
     * Lightest possible query — only reads the id column.
     */
    getProcessIds(filter?: ProcessFilter): Promise<string[]>;

    /**
     * Optional: return the distinct set of native SDK session IDs recorded for a
     * workspace's processes. The Copilot SDK/CLI shares one session id per
     * conversation, so these ids match native `sessions.id` rows and are used to
     * deduplicate the read-only native Copilot CLI session view against sessions
     * already tracked as CoC processes. Only the SQLite store implements this.
     */
    getSdkSessionIds?(workspaceId: string): Set<string>;

    /** Return all known workspaces. */
    getWorkspaces(): Promise<WorkspaceInfo[]>;
    /** Register (or update) a workspace identity. */
    registerWorkspace(workspace: WorkspaceInfo): Promise<void>;
    /** Remove a workspace by ID. Returns true if found and removed. */
    removeWorkspace(id: string): Promise<boolean>;
    /** Partial-update a workspace. Returns updated workspace or undefined if not found. */
    updateWorkspace(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined>;

    /**
     * Optional store-level re-key for physical workspace IDs. Implementations
     * that persist workspace-scoped state should rewrite every reference to
     * `oldId` so it points at `newId`: the workspace record itself, process
     * history (including seen/unseen state), workspace-scoped bindings,
     * task-group/queue/schedule rows, and any on-disk process files.
     *
     * Returns `true` when the rename was applied. Returns `false` — leaving the
     * store unchanged — when `oldId` has no workspace record or a workspace
     * `newId` already exists, so the caller can treat a `false` result as a
     * conflict and fall back safely (never merging two workspaces).
     *
     * The repo-scoped data directory (`<dataDir>/repos/<id>/`) is moved by the
     * migration orchestrator BEFORE this is called, so file-backed stores find
     * their process files already under the new id.
     */
    renameWorkspaceId?(oldId: string, newId: string): Promise<boolean>;

    /** Return all known wikis. */
    getWikis(): Promise<WikiInfo[]>;
    /** Register (or update) a wiki identity. */
    registerWiki(wiki: WikiInfo): Promise<void>;
    /** Remove a wiki by ID. Returns true if found and removed. */
    removeWiki(id: string): Promise<boolean>;
    /** Partial-update a wiki. Returns updated wiki or undefined if not found. */
    updateWiki(id: string, updates: Partial<Omit<WikiInfo, 'id'>>): Promise<WikiInfo | undefined>;

    /** Optional callback invoked on every process mutation. */
    onProcessChange?: ProcessChangeCallback;

    /** Remove all workspaces. Returns count of removed items. */
    clearAllWorkspaces(): Promise<number>;
    /** Remove all wikis. Returns count of removed items. */
    clearAllWikis(): Promise<number>;
    /**
     * Return the count of processes matching the given filter without loading data.
     * Much cheaper than getAllProcesses().length for endpoints that only need a count.
     */
    getProcessCount(filter?: ProcessFilter): Promise<number>;

    /** Optional fast deterministic prompt autocomplete suffix lookup. */
    getBestPromptCompletion?(
        prefix: string,
        opts?: { minPrefixLen?: number },
    ): { completion: string; source: 'initial' | 'follow-up' } | null;

    /** Optional bounded user-history retrieval for AI-generated prompt autocomplete. */
    getPromptAutocompleteContext?(
        prefix: string,
        opts?: {
            workspaceId?: string;
            processId?: string;
            limit?: number;
            includeGlobalHistory?: boolean;
        },
    ): PromptAutocompleteContext;

    /**
     * Optional retrieval of the user's recent unique prompts in a workspace,
     * ordered most-recent first. Includes both initial task prompts and
     * follow-up user turns within tasks. Powers the up/down arrow history
     * navigation in chat inputs. Excludes archived processes/turns and
     * empty content; deduplicated by exact text (case-sensitive).
     */
    getRecentUserPrompts?(
        workspaceId: string,
        opts?: { limit?: number },
    ): string[];

    /** Return aggregate storage statistics. */
    getStorageStats(): Promise<StorageStats>;

    /** Subscribe to output events for a running process. Returns unsubscribe function. */
    onProcessOutput(id: string, callback: (event: ProcessOutputEvent) => void): () => void;

    /** Emit an output chunk for a running process (called by execution engine). */
    emitProcessOutput(id: string, content: string): void;

    /** Emit process completion (called by execution engine). */
    emitProcessComplete(id: string, status: AIProcessStatus, duration: string): void;

    /** Emit an arbitrary process output event (tool events, etc.). */
    emitProcessEvent(id: string, event: ProcessOutputEvent): void;

    /**
     * Request that any buffered output for the given process be flushed to disk.
     * Used by SSE handler to ensure snapshots include the latest content.
     * Optional — implementations that don't buffer may leave this undefined.
     */
    requestFlush?(id: string): Promise<void>;

    /**
     * Register a flush handler for a process. Called by the execution engine
     * when streaming starts so that external code (SSE handler) can trigger
     * an immediate flush of buffered content.
     */
    registerFlushHandler?(id: string, handler: () => Promise<void>): void;

    /** Unregister a previously registered flush handler. */
    unregisterFlushHandler?(id: string): void;


    /**
     * Atomically append a conversation turn inside the write queue, preventing race conditions
     * when multiple writers (user-turn from api-handler, assistant-turn from executor) update
     * conversationTurns concurrently.
     *
     * @param processId - Target process ID.
     * @param makeTurn - Factory called with the computed turn index (after optional streaming filter).
     * @param options.filterStreaming - If true, removes assistant streaming turns before appending.
     * @param options.additionalUpdates - Extra field updates applied atomically with the turn append.
     *   May be a plain object or a function receiving the current process for dynamic computation.
     * @returns The new turn and the full updated turns array, or undefined if process not found.
     */
    appendConversationTurn(
        processId: string,
        makeTurn: (turnIndex: number) => ConversationTurn,
        options?: {
            filterStreaming?: boolean;
            additionalUpdates?:
                | Partial<Omit<AIProcess, 'conversationTurns'>>
                | ((current: AIProcess) => Partial<Omit<AIProcess, 'conversationTurns'>>);
        }
    ): Promise<{ turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined>;

    /**
     * Atomically upsert a streaming assistant turn inside the write queue.
     * If a streaming assistant turn already exists, updates it in-place.
     * Otherwise, appends a new assistant turn. Prevents read-outside-lock races
     * that caused lost user turns in the old flushConversationTurn pattern.
     *
     * @param processId - Target process ID.
     * @param content - Current streamed content.
     * @param streaming - Whether the turn is still streaming.
     * @param timeline - Current timeline snapshot.
     */
    upsertStreamingTurn(
        processId: string,
        content: string,
        streaming: boolean,
        timeline?: TimelineItem[],
    ): Promise<void>;

    /**
     * Atomically update the content of a conversation turn at a specific index.
     * Used for prompt backfill (e.g., enriching the initial user turn content
     * after task generation resolves the full prompt).
     *
     * @param processId - Target process ID.
     * @param turnIndex - Array index of the turn to update.
     * @param content - New content for the turn.
     */
    updateTurnContent(
        processId: string,
        turnIndex: number,
        content: string,
    ): Promise<void>;

    /**
     * Atomically persist the copilot-sdk `user.message` event id on a user turn.
     * The id is captured during streaming and threaded back here after the SDK
     * call resolves; it is the durable anchor used later to rewind/truncate the
     * conversation at exactly this turn. Only updates `role: 'user'` turns — a
     * mismatched index or non-user turn is a safe no-op.
     *
     * @param processId - Target process ID.
     * @param turnIndex - Array index of the user turn to update.
     * @param sdkEventId - copilot-sdk `user.message` event id for this turn.
     */
    updateTurnSdkEventId(
        processId: string,
        turnIndex: number,
        sdkEventId: string,
    ): Promise<void>;

    /**
     * Full-text search across conversation turns using FTS5 MATCH with BM25 ranking.
     * Optional — only SQLite-backed stores support this.
     */
    searchConversations?(
        query: string,
        filter?: SearchFilter
    ): Promise<{ results: ConversationSearchResult[]; total: number }>;

    /**
     * Retrieve conversation turns for a process without loading the full AIProcess.
     * Optional — only SQLite-backed stores support this.
     */
    getConversationTurns?(processId: string): Promise<ConversationTurn[]>;

    /**
     * List recent processes ordered by start time (descending).
     * Returns lightweight summaries suitable for "recent sessions" browsing.
     * Optional — only SQLite-backed stores support this.
     */
    listRecentProcesses?(options: {
        workspaceId?: string;
        since?: Date;
        until?: Date;
        limit?: number;
        offset?: number;
        excludeProcessId?: string;
    }): Promise<ProcessIndexEntry[]>;

    /**
     * Fork a process by creating a new process with copied conversation turns.
     * The new process is independent (no cascade-delete relationship with source).
     * Source linkage is stored in `metadata.forkSourceId`.
     *
     * @param sourceId - ID of the process to fork from.
     * @param newId - ID for the new forked process.
     * @param newSdkSessionId - SDK session ID for the forked session.
     * @param upToTurnIndex - If provided, only copy turns up to (and including) this index.
     * @returns The newly created process with its conversation turns.
     */
    forkProcess?(
        sourceId: string,
        newId: string,
        newSdkSessionId: string,
        upToTurnIndex?: number,
    ): Promise<AIProcess>;
}

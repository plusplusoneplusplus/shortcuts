/**
 * Process Store Interface
 *
 * Abstract storage interface for AI processes with workspace-scoped querying.
 * Enables multi-workspace process tracking for the standalone AI execution server.
 *
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

import { AIProcess, AIProcessStatus, AIProcessType, ProcessEvent } from './ai/process-types';

/**
 * Output event emitted during process execution.
 * Used by SSE streaming to push real-time output to clients.
 */
export interface ProcessOutputEvent {
    type: 'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed' | 'permission-request';
    /** Partial output text (for 'chunk' events). */
    content?: string;
    /** Final process status (for 'complete' events). */
    status?: AIProcessStatus;
    /** Human-readable duration string (for 'complete' events). */
    duration?: string;
    /** Zero-based conversation turn index (for tool events). */
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
}

/**
 * Workspace identity for multi-workspace process tracking.
 * `id` is a stable hash of the workspace root path.
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
    status?: AIProcessStatus | AIProcessStatus[];
    type?: AIProcessType;
    since?: Date;
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
    getProcess(id: string): Promise<AIProcess | undefined>;
    getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]>;
    removeProcess(id: string): Promise<void>;
    /** Remove processes matching filter. Returns count of removed items. */
    clearProcesses(filter?: ProcessFilter): Promise<number>;

    /** Return all known workspaces. */
    getWorkspaces(): Promise<WorkspaceInfo[]>;
    /** Register (or update) a workspace identity. */
    registerWorkspace(workspace: WorkspaceInfo): Promise<void>;
    /** Remove a workspace by ID. Returns true if found and removed. */
    removeWorkspace(id: string): Promise<boolean>;
    /** Partial-update a workspace. Returns updated workspace or undefined if not found. */
    updateWorkspace(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined>;

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
}

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
    type: 'chunk' | 'complete';
    /** Partial output text (for 'chunk' events). */
    content?: string;
    /** Final process status (for 'complete' events). */
    status?: AIProcessStatus;
    /** Human-readable duration string (for 'complete' events). */
    duration?: string;
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

    /** Optional callback invoked on every process mutation. */
    onProcessChange?: ProcessChangeCallback;

    /** Subscribe to output events for a running process. Returns unsubscribe function. */
    onProcessOutput(id: string, callback: (event: ProcessOutputEvent) => void): () => void;

    /** Emit an output chunk for a running process (called by execution engine). */
    emitProcessOutput(id: string, content: string): void;

    /** Emit process completion (called by execution engine). */
    emitProcessComplete(id: string, status: AIProcessStatus, duration: string): void;
}

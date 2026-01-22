/**
 * Generic AI Service Types
 * 
 * Types and interfaces for the AI service module.
 * These are generic types used across different AI tool integrations.
 * 
 * IMPORTANT: This module should remain domain-agnostic. Feature-specific
 * metadata types (like code review) should be defined in their own modules
 * and use the generic metadata extensibility system here.
 */

/**
 * Result of checking if a process is running
 */
export interface ProcessCheckResult {
    /** Whether the process is currently running */
    isRunning: boolean;
    /** Error message if the check failed */
    error?: string;
}

/**
 * Supported AI tools for invocation
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Valid AI model options for Copilot CLI
 */
export const VALID_MODELS = [
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-4.5',
    'gpt-5.1-codex-max',
    'gemini-3-pro-preview'
] as const;

export type AIModel = typeof VALID_MODELS[number];

/**
 * Status of an AI process
 */
export type AIProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Result of an AI invocation
 */
export interface AIInvocationResult {
    /** Whether the invocation was successful */
    success: boolean;
    /** The response text from the AI (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
}

/**
 * Type of AI process - extensible via string union
 * Core types: 'clarification' | 'discovery'
 * Feature modules can register additional types via the generic metadata system
 */
export type AIProcessType = 'clarification' | 'code-review' | 'discovery' | 'code-review-group' | 'pipeline-execution' | 'pipeline-item' | string;

/**
 * Generic metadata interface that feature modules can extend.
 * This allows ai-service to remain decoupled from specific feature implementations.
 */
export interface GenericProcessMetadata {
    /** Type identifier for the metadata (matches AIProcessType) */
    type: string;
    /** Feature-specific data stored as key-value pairs */
    [key: string]: unknown;
}

/**
 * Generic group metadata interface for grouped processes.
 * Feature modules can extend this for specific group tracking needs.
 */
export interface GenericGroupMetadata extends GenericProcessMetadata {
    /** Child process IDs in this group */
    childProcessIds: string[];
}

/**
 * Options for registering a generic typed process
 */
export interface TypedProcessOptions {
    /** The process type identifier */
    type: AIProcessType;
    /** ID prefix for generated process IDs (e.g., 'review' -> 'review-1-timestamp') */
    idPrefix?: string;
    /** Feature-specific metadata */
    metadata?: GenericProcessMetadata;
    /** Parent process ID for grouped processes */
    parentProcessId?: string;
}

/**
 * Options for registering a generic process group
 */
export interface ProcessGroupOptions {
    /** The group type identifier */
    type: AIProcessType;
    /** ID prefix for generated group IDs */
    idPrefix?: string;
    /** Feature-specific metadata (will have childProcessIds added) */
    metadata?: Omit<GenericGroupMetadata, 'childProcessIds'>;
}

/**
 * Options for completing a process group
 */
export interface CompleteGroupOptions {
    /** Summary result text */
    result: string;
    /** Structured result as JSON string */
    structuredResult: string;
    /** Feature-specific execution statistics */
    executionStats?: Record<string, unknown>;
}

// ============================================================================
// LEGACY TYPES - Kept for backward compatibility
// These types are deprecated and will be removed in a future version.
// Feature modules should define their own metadata types.
// ============================================================================

/**
 * @deprecated Use GenericProcessMetadata with type='code-review' instead.
 * This type is kept for backward compatibility with existing code.
 * Code review specific metadata - defined here temporarily for compatibility.
 */
export interface CodeReviewProcessMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** Rules used for the review */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: {
        files: number;
        additions: number;
        deletions: number;
    };
}

/**
 * Discovery process specific metadata
 */
export interface DiscoveryProcessMetadata {
    /** Feature description being searched */
    featureDescription: string;
    /** Keywords used in the search */
    keywords?: string[];
    /** Target group path (if scoped to a group) */
    targetGroupPath?: string;
    /** Search scope settings */
    scope?: {
        includeSourceFiles: boolean;
        includeDocs: boolean;
        includeConfigFiles: boolean;
        includeGitHistory: boolean;
    };
    /** Number of results found */
    resultCount?: number;
}

/**
 * @deprecated Use GenericGroupMetadata with type='code-review-group' instead.
 * This type is kept for backward compatibility with existing code.
 * Metadata for grouped code review processes (master process)
 */
export interface CodeReviewGroupMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged' | 'range';
    /** Commit SHA (for commit reviews) */
    commitSha?: string;
    /** Commit message */
    commitMessage?: string;
    /** All rules being reviewed */
    rulesUsed: string[];
    /** Diff statistics */
    diffStats?: {
        files: number;
        additions: number;
        deletions: number;
    };
    /** Child process IDs (individual rule reviews) */
    childProcessIds: string[];
    /** Execution statistics */
    executionStats?: {
        totalRules: number;
        successfulRules: number;
        failedRules: number;
        totalTimeMs: number;
    };
}

/**
 * A tracked AI process
 */
export interface AIProcess {
    /** Unique identifier */
    id: string;
    /** Type of process */
    type: AIProcessType;
    /** Preview of the prompt (first ~50 chars) */
    promptPreview: string;
    /** Full prompt text */
    fullPrompt: string;
    /** Current status */
    status: AIProcessStatus;
    /** When the process started */
    startTime: Date;
    /** When the process ended (if finished) */
    endTime?: Date;
    /** Error message if failed */
    error?: string;
    /** The AI response if completed */
    result?: string;
    /** Path to the file containing the full result */
    resultFilePath?: string;
    /** Path to the file containing raw stdout from the AI tool */
    rawStdoutFilePath?: string;
    
    // ========================================================================
    // Generic metadata (preferred for new features)
    // ========================================================================
    
    /** Generic feature-specific metadata. Feature modules should use this. */
    metadata?: GenericProcessMetadata;
    
    /** Generic group metadata for grouped processes */
    groupMetadata?: GenericGroupMetadata;
    
    // ========================================================================
    // Legacy metadata fields (kept for backward compatibility)
    // New features should use `metadata` and `groupMetadata` instead.
    // ========================================================================
    
    /** @deprecated Use metadata with type='code-review' instead */
    codeReviewMetadata?: CodeReviewProcessMetadata;
    /** Discovery specific metadata (if type is 'discovery') */
    discoveryMetadata?: DiscoveryProcessMetadata;
    /** @deprecated Use groupMetadata with type='code-review-group' instead */
    codeReviewGroupMetadata?: CodeReviewGroupMetadata;
    /** Parsed structured result (for code reviews) */
    structuredResult?: string; // JSON string of CodeReviewResult
    /** Parent process ID (for child processes in a group) */
    parentProcessId?: string;
}

/**
 * Serialized format of AIProcess for persistence (Date -> ISO string)
 */
export interface SerializedAIProcess {
    id: string;
    type?: AIProcessType;
    promptPreview: string;
    fullPrompt: string;
    status: AIProcessStatus;
    startTime: string;  // ISO string
    endTime?: string;   // ISO string
    error?: string;
    result?: string;
    resultFilePath?: string;
    rawStdoutFilePath?: string;
    /** Generic feature-specific metadata */
    metadata?: GenericProcessMetadata;
    /** Generic group metadata for grouped processes */
    groupMetadata?: GenericGroupMetadata;
    /** @deprecated Use metadata instead */
    codeReviewMetadata?: CodeReviewProcessMetadata;
    discoveryMetadata?: DiscoveryProcessMetadata;
    /** @deprecated Use groupMetadata instead */
    codeReviewGroupMetadata?: CodeReviewGroupMetadata;
    structuredResult?: string;
    parentProcessId?: string;
}

/**
 * Convert AIProcess to serialized format for storage
 */
export function serializeProcess(process: AIProcess): SerializedAIProcess {
    return {
        id: process.id,
        type: process.type,
        promptPreview: process.promptPreview,
        fullPrompt: process.fullPrompt,
        status: process.status,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        error: process.error,
        result: process.result,
        resultFilePath: process.resultFilePath,
        rawStdoutFilePath: process.rawStdoutFilePath,
        metadata: process.metadata,
        groupMetadata: process.groupMetadata,
        codeReviewMetadata: process.codeReviewMetadata,
        discoveryMetadata: process.discoveryMetadata,
        codeReviewGroupMetadata: process.codeReviewGroupMetadata,
        structuredResult: process.structuredResult,
        parentProcessId: process.parentProcessId
    };
}

/**
 * Convert serialized format back to AIProcess
 */
export function deserializeProcess(serialized: SerializedAIProcess): AIProcess {
    return {
        id: serialized.id,
        type: serialized.type || 'clarification',
        promptPreview: serialized.promptPreview,
        fullPrompt: serialized.fullPrompt,
        status: serialized.status,
        startTime: new Date(serialized.startTime),
        endTime: serialized.endTime ? new Date(serialized.endTime) : undefined,
        error: serialized.error,
        result: serialized.result,
        resultFilePath: serialized.resultFilePath,
        rawStdoutFilePath: serialized.rawStdoutFilePath,
        metadata: serialized.metadata,
        groupMetadata: serialized.groupMetadata,
        codeReviewMetadata: serialized.codeReviewMetadata,
        discoveryMetadata: serialized.discoveryMetadata,
        codeReviewGroupMetadata: serialized.codeReviewGroupMetadata,
        structuredResult: serialized.structuredResult,
        parentProcessId: serialized.parentProcessId
    };
}

/**
 * Default prompt templates for different instruction types
 */
export const DEFAULT_PROMPTS = {
    clarify: `Please clarify the following snippet with more depth.

- Explain what it does in plain language.
- Walk through the key steps, including control flow and data flow.
- State any assumptions you are making from limited context.
- Call out ambiguities and ask up to 3 targeted questions.
- Suggest 2 to 3 concrete next checks, such as what to inspect or test next.

Snippet`,
    goDeeper: `Please provide an in-depth explanation and analysis of the following snippet.

Go beyond a summary and explore the surrounding implications.

- Intent and responsibilities in the broader system.
- Step-by-step control flow and data flow.
- Edge cases and failure modes, including correctness, security, and performance.
- Likely dependencies and impacts, and what else to inspect.
- Concrete improvements or refactors with tradeoffs.
- How to validate, including focused tests, repro steps, or logs.

Snippet`,
    customDefault: 'Please explain the following snippet'
} as const;

/**
 * Event types for process changes
 */
export type ProcessEventType = 'process-added' | 'process-updated' | 'process-removed' | 'processes-cleared';

/**
 * Process change event
 */
export interface ProcessEvent {
    type: ProcessEventType;
    process?: AIProcess;
}

// ============================================================================
// Interactive Session Types
// ============================================================================

/**
 * Supported CLI tools for interactive sessions
 */
export type InteractiveToolType = 'copilot' | 'claude';

/**
 * Status of an interactive session
 */
export type InteractiveSessionStatus = 'starting' | 'active' | 'ended' | 'error';

/**
 * Supported terminal types across platforms
 */
export type TerminalType =
    // macOS
    | 'terminal.app'
    | 'iterm'
    // Windows
    | 'windows-terminal'
    | 'cmd'
    | 'powershell'
    // Linux
    | 'gnome-terminal'
    | 'konsole'
    | 'xfce4-terminal'
    | 'xterm'
    // Generic
    | 'unknown';

/**
 * An interactive CLI session running in an external terminal
 */
export interface InteractiveSession {
    /** Unique session identifier */
    id: string;
    /** When the session was started */
    startTime: Date;
    /** When the session ended (if ended) */
    endTime?: Date;
    /** Current session status */
    status: InteractiveSessionStatus;
    /** Working directory for the session */
    workingDirectory: string;
    /** CLI tool being used */
    tool: InteractiveToolType;
    /** Initial prompt sent to the CLI (if any) */
    initialPrompt?: string;
    /** Type of terminal used */
    terminalType: TerminalType;
    /** Process ID of the terminal (if available) */
    pid?: number;
    /** Error message if status is 'error' */
    error?: string;
    /** Custom name for the session (user-defined) */
    customName?: string;
}

/**
 * Options for launching an external terminal
 */
export interface ExternalTerminalLaunchOptions {
    /** Working directory for the terminal */
    workingDirectory: string;
    /** CLI tool to launch */
    tool: InteractiveToolType;
    /** Initial prompt to send (optional) */
    initialPrompt?: string;
    /** Preferred terminal type (optional, auto-detected if not specified) */
    preferredTerminal?: TerminalType;
    /** Model to use (optional, uses default if not specified) */
    model?: string;
}

/**
 * Result of launching an external terminal
 */
export interface ExternalTerminalLaunchResult {
    /** Whether the launch was successful */
    success: boolean;
    /** Type of terminal that was launched */
    terminalType: TerminalType;
    /** Process ID of the launched terminal (if available) */
    pid?: number;
    /** Error message if launch failed */
    error?: string;
}

/**
 * Event types for interactive session changes
 */
export type InteractiveSessionEventType = 'session-started' | 'session-updated' | 'session-ended' | 'session-error';

/**
 * Interactive session change event
 */
export interface InteractiveSessionEvent {
    type: InteractiveSessionEventType;
    session: InteractiveSession;
}

// ============================================================================
// AI Process Manager Interface
// ============================================================================

/**
 * Process count statistics
 */
export interface ProcessCounts {
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}

/**
 * Interface for AI Process Manager implementations.
 *
 * This interface defines the contract for managing AI processes, including
 * registration, lifecycle management, and retrieval. Both the real
 * AIProcessManager and MockAIProcessManager implement this interface.
 *
 * Usage:
 * - Use this interface for dependency injection in tests
 * - Prefer the generic API (registerTypedProcess, registerProcessGroup) for new features
 * - Legacy methods are kept for backward compatibility
 */
export interface IAIProcessManager {
    // ========================================================================
    // Events
    // ========================================================================

    /**
     * Event fired when processes change (added, updated, removed, cleared)
     */
    readonly onDidChangeProcesses: import('vscode').Event<ProcessEvent>;

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the process manager with extension context for persistence
     * @param context VSCode extension context for Memento storage
     */
    initialize(context: import('vscode').ExtensionContext): Promise<void>;

    /**
     * Check if the manager is initialized with persistence
     */
    isInitialized(): boolean;

    // ========================================================================
    // Generic API (Preferred for new features)
    // ========================================================================

    /**
     * Register a typed process with generic metadata
     * @param prompt The full prompt being sent
     * @param options Options including type, metadata, and parent process ID
     * @param childProcess Optional child process reference for cancellation
     * @returns The process ID
     */
    registerTypedProcess(
        prompt: string,
        options: TypedProcessOptions,
        childProcess?: import('child_process').ChildProcess
    ): string;

    /**
     * Register a process group with generic metadata
     * @param prompt Description or prompt for the group
     * @param options Options including type and metadata
     * @returns The group process ID
     */
    registerProcessGroup(
        prompt: string,
        options: ProcessGroupOptions
    ): string;

    /**
     * Complete a process group with results
     * @param id Group process ID
     * @param options Completion options including result and stats
     */
    completeProcessGroup(id: string, options: CompleteGroupOptions): void;

    // ========================================================================
    // Legacy API (Kept for backward compatibility)
    // ========================================================================

    /**
     * Register a new process
     * @param prompt The full prompt being sent
     * @param childProcess Optional child process reference for cancellation
     * @returns The process ID
     */
    registerProcess(prompt: string, childProcess?: import('child_process').ChildProcess): string;

    /**
     * @deprecated Use registerTypedProcess with type='code-review' instead
     */
    registerCodeReviewProcess(
        prompt: string,
        metadata: {
            reviewType: 'commit' | 'pending' | 'staged' | 'range';
            commitSha?: string;
            commitMessage?: string;
            rulesUsed: string[];
            diffStats?: { files: number; additions: number; deletions: number };
        },
        childProcess?: import('child_process').ChildProcess,
        parentProcessId?: string
    ): string;

    /**
     * @deprecated Use registerProcessGroup with type='code-review-group' instead
     */
    registerCodeReviewGroup(
        metadata: Omit<CodeReviewGroupMetadata, 'childProcessIds' | 'executionStats'>
    ): string;

    /**
     * @deprecated Use completeProcessGroup instead
     */
    completeCodeReviewGroup(
        id: string,
        result: string,
        structuredResult: string,
        executionStats: CodeReviewGroupMetadata['executionStats']
    ): void;

    /**
     * Register a new discovery process
     * @param metadata Discovery process metadata
     * @returns The process ID
     */
    registerDiscoveryProcess(metadata: DiscoveryProcessMetadata): string;

    /**
     * Complete a discovery process with results
     */
    completeDiscoveryProcess(
        id: string,
        resultCount: number,
        resultSummary?: string,
        serializedResults?: string
    ): void;

    /**
     * Complete a code review process with structured result
     */
    completeCodeReviewProcess(id: string, result: string, structuredResult: string): void;

    // ========================================================================
    // Process Attachment
    // ========================================================================

    /**
     * Attach a child process to an existing tracked process
     */
    attachChildProcess(id: string, childProcess: import('child_process').ChildProcess): void;

    /**
     * Save raw stdout to a temp file and attach it to the process
     * @returns The file path if saved successfully, undefined otherwise
     */
    attachRawStdout(id: string, stdout: string): string | undefined;

    // ========================================================================
    // Process Lifecycle
    // ========================================================================

    /**
     * Update process status
     */
    updateProcess(id: string, status: AIProcessStatus, result?: string, error?: string): void;

    /**
     * Mark a process as completed
     */
    completeProcess(id: string, result?: string): void;

    /**
     * Mark a process as failed
     */
    failProcess(id: string, error: string): void;

    /**
     * Cancel a running process
     * @returns True if cancelled, false if process not found or not running
     */
    cancelProcess(id: string): boolean;

    /**
     * Update the structured result for a process
     */
    updateProcessStructuredResult(id: string, structuredResult: string): void;

    // ========================================================================
    // Process Removal
    // ========================================================================

    /**
     * Remove a process from tracking
     */
    removeProcess(id: string): void;

    /**
     * Clear all completed, failed, and cancelled processes
     */
    clearCompletedProcesses(): void;

    /**
     * Clear all processes (including running ones)
     */
    clearAllProcesses(): void;

    // ========================================================================
    // Process Retrieval
    // ========================================================================

    /**
     * Get all processes
     */
    getProcesses(): AIProcess[];

    /**
     * Get running processes only
     */
    getRunningProcesses(): AIProcess[];

    /**
     * Get a specific process by ID
     */
    getProcess(id: string): AIProcess | undefined;

    /**
     * Get all top-level processes (processes without parents)
     */
    getTopLevelProcesses(): AIProcess[];

    /**
     * Get child processes for a group
     */
    getChildProcesses(groupId: string): AIProcess[];

    /**
     * Get child process IDs from a parent process
     */
    getChildProcessIds(parentId: string): string[];

    // ========================================================================
    // Status Checks
    // ========================================================================

    /**
     * Check if there are any running processes
     */
    hasRunningProcesses(): boolean;

    /**
     * Get count of processes by status
     */
    getProcessCounts(): ProcessCounts;

    /**
     * Check if a process is a child of a group
     */
    isChildProcess(processId: string): boolean;

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Dispose of resources
     */
    dispose(): void;
}

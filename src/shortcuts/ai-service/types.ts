/**
 * AI Service Types (VS Code-specific)
 * 
 * Types and interfaces for the AI service module.
 * 
 * Core types (AIBackendType, AIModel, AIProcess, etc.) are provided by
 * @plusplusoneplusplus/pipeline-core and re-exported here for convenience.
 * 
 * This file contains only VS Code-specific types that cannot be moved to
 * pipeline-core (primarily IAIProcessManager which uses vscode.Event).
 */

// ============================================================================
// Re-export core AI types from pipeline-core
// ============================================================================

export {
    // Core AI types
    AIBackendType,
    AIModel,
    VALID_MODELS,
    AIInvocationResult,
    DEFAULT_PROMPTS,
    InteractiveToolType,
    DEFAULT_MODEL_ID,
    // Model registry
    ModelDefinition,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    // Process types
    AIToolType,
    AIProcessStatus,
    AIProcessType,
    GenericProcessMetadata,
    GenericGroupMetadata,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
    AIProcess,
    SerializedAIProcess,
    TrackedProcessFields,
    serializeProcess,
    deserializeProcess,
    ProcessEventType,
    ProcessEvent,
    ProcessCounts,
    // Terminal types
    InteractiveSessionStatus,
    TerminalType,
    InteractiveSession,
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    // Process check result (from process monitor)
    ProcessCheckResult
} from '@plusplusoneplusplus/pipeline-core';

// Import types we need for local use
import type {
    AIBackendType,
    AIProcess,
    AIProcessStatus,
    ProcessEvent,
    ProcessCounts,
    TypedProcessOptions,
    ProcessGroupOptions,
    CompleteGroupOptions,
    CodeReviewGroupMetadata,
    DiscoveryProcessMetadata,
    InteractiveSession as PipelineInteractiveSession
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Interactive Session Event Types (VS Code-specific)
// ============================================================================

/**
 * Event types for interactive session changes
 */
export type InteractiveSessionEventType = 'session-started' | 'session-updated' | 'session-ended' | 'session-error';

/**
 * Interactive session change event
 */
export interface InteractiveSessionEvent {
    type: InteractiveSessionEventType;
    session: PipelineInteractiveSession;
}

// ============================================================================
// AI Process Manager Interface (VS Code-specific)
// ============================================================================

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
     * Attach an SDK session ID to an existing tracked process.
     * This allows the process to be cancelled via the SDK abort mechanism.
     * 
     * @param id Process ID
     * @param sessionId The SDK session ID to attach
     */
    attachSdkSessionId(id: string, sessionId: string): void;

    /**
     * Get the SDK session ID for a tracked process.
     * 
     * @param id Process ID
     * @returns The SDK session ID if attached, undefined otherwise
     */
    getSdkSessionId(id: string): string | undefined;

    /**
     * Attach session metadata to an existing tracked process.
     * This stores the backend type and working directory for session resume functionality.
     * 
     * @param id Process ID
     * @param backend The AI backend type used
     * @param workingDirectory The working directory used for the session
     */
    attachSessionMetadata(id: string, backend: AIBackendType, workingDirectory?: string): void;

    /**
     * Get session metadata for a tracked process (for session resume).
     * 
     * @param id Process ID
     * @returns Session metadata if available
     */
    getSessionMetadata(id: string): { sdkSessionId?: string; backend?: AIBackendType; workingDirectory?: string } | undefined;

    /**
     * Check if a process is resumable (has session ID, completed, SDK backend).
     * 
     * @param id Process ID
     * @returns True if the process can be resumed
     */
    isProcessResumable(id: string): boolean;

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

// ============================================================================
// Follow Prompt Types (VS Code-specific)
// ============================================================================

/**
 * Options for executing a Follow Prompt command
 */
export interface FollowPromptExecutionOptions {
    /** Execution mode */
    mode: 'interactive' | 'background';
    /** AI model to use */
    model: string;
    /** Additional context/instructions */
    additionalContext?: string;
    /** Timeout in ms (for background mode) */
    timeoutMs?: number;
}

/**
 * Metadata for follow-prompt process tracking
 */
export interface FollowPromptProcessMetadata {
    /** Path to the prompt file used */
    promptFile: string;
    /** Path to the plan file being processed */
    planFile: string;
    /** AI model used for execution */
    model: string;
    /** Additional context provided by user */
    additionalContext?: string;
    /** Whether this was a skill-based execution */
    skillName?: string;
}

/**
 * Configuration for available AI models with display labels
 */
export interface AIModelConfig {
    /** Model identifier (e.g., "claude-sonnet-4.5") */
    id: string;
    /** Display label for UI (e.g., "Claude Sonnet 4.5") */
    label: string;
    /** Optional description (e.g., "(Recommended for coding)") */
    description?: string;
    /** Whether this is the default/recommended model */
    isDefault?: boolean;
}

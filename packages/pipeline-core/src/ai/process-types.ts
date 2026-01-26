/**
 * AI Process Types (Pure Node.js)
 *
 * Pure types for AI process tracking and management.
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

import { AIBackendType } from './types';

/**
 * Supported AI tools for invocation
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Status of an AI process
 */
export type AIProcessStatus = 'running' | 'completed' | 'failed' | 'cancelled';

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

    // ========================================================================
    // Session Resume Fields (Added 2026-01)
    // ========================================================================

    /** SDK session ID for resuming sessions (only for copilot-sdk backend) */
    sdkSessionId?: string;
    /** Backend type used for this process */
    backend?: AIBackendType;
    /** Working directory used for the original session */
    workingDirectory?: string;
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

    // ========================================================================
    // Session Resume Fields (Added 2026-01)
    // ========================================================================

    /** SDK session ID for resuming sessions (only for copilot-sdk backend) */
    sdkSessionId?: string;
    /** Backend type used for this process */
    backend?: AIBackendType;
    /** Working directory used for the original session */
    workingDirectory?: string;
}

/**
 * Extended AIProcess with session resume fields (internal use)
 * These fields are tracked in-memory and persisted for session resume functionality.
 */
export interface TrackedProcessFields {
    /** SDK session ID for resuming sessions */
    sdkSessionId?: string;
    /** Backend type used for this process */
    backend?: AIBackendType;
    /** Working directory used for the original session */
    workingDirectory?: string;
}

/**
 * Convert AIProcess to serialized format for storage
 */
export function serializeProcess(process: AIProcess & Partial<TrackedProcessFields>): SerializedAIProcess {
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
        parentProcessId: process.parentProcessId,
        // Session resume fields
        sdkSessionId: process.sdkSessionId,
        backend: process.backend,
        workingDirectory: process.workingDirectory
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
        parentProcessId: serialized.parentProcessId,
        // Session resume fields
        sdkSessionId: serialized.sdkSessionId,
        backend: serialized.backend,
        workingDirectory: serialized.workingDirectory
    };
}

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

/**
 * Process count statistics
 */
export interface ProcessCounts {
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}

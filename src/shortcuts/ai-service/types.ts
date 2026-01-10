/**
 * Generic AI Service Types
 * 
 * Types and interfaces for the AI service module.
 * These are generic types used across different AI tool integrations.
 */

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
 * Type of AI process
 */
export type AIProcessType = 'clarification' | 'code-review' | 'discovery' | 'code-review-group';

/**
 * Code review specific metadata
 */
export interface CodeReviewProcessMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged';
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
 * Metadata for grouped code review processes (master process)
 */
export interface CodeReviewGroupMetadata {
    /** Type of review */
    reviewType: 'commit' | 'pending' | 'staged';
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
    /** Code review specific metadata (if type is 'code-review') */
    codeReviewMetadata?: CodeReviewProcessMetadata;
    /** Discovery specific metadata (if type is 'discovery') */
    discoveryMetadata?: DiscoveryProcessMetadata;
    /** Code review group metadata (if type is 'code-review-group') */
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
    codeReviewMetadata?: CodeReviewProcessMetadata;
    discoveryMetadata?: DiscoveryProcessMetadata;
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
    clarify: 'Please clarify',
    goDeeper: 'Please provide an in-depth explanation and analysis of',
    customDefault: 'Please explain'
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

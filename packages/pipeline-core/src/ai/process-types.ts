/**
 * AI Process Types (Pure Node.js)
 *
 * Pure types for AI process tracking and management.
 * No VS Code dependencies - can be used in CLI tools and other environments.
 */

import { AIBackendType } from './types';
import type { TokenUsage } from '../copilot-sdk-wrapper/types';

/**
 * Supported AI tools for invocation
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Status of an AI process
 */
export type AIProcessStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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
    /** Workspace ID this process belongs to (hash of workspace root path) */
    workspaceId?: string;
    /** Human-readable workspace name */
    workspaceName?: string;
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
    /** Initial status for the process (default: 'running'). Use 'queued' for queue systems. */
    initialStatus?: 'queued' | 'running';
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

/**
 * A chronological event within a conversation turn (content chunk or tool lifecycle)
 */
export interface TimelineItem {
    /** Event type */
    type: 'content' | 'tool-start' | 'tool-complete' | 'tool-failed';
    /** When the event occurred */
    timestamp: Date;
    /** Text content (for 'content' events) */
    content?: string;
    /** Associated tool call (for tool events) */
    toolCall?: ToolCall;
}

/**
 * Serialized format of TimelineItem for persistence (Date → ISO string)
 */
export interface SerializedTimelineItem {
    type: 'content' | 'tool-start' | 'tool-complete' | 'tool-failed';
    timestamp: string;  // ISO string
    content?: string;
    toolCall?: SerializedToolCall;
}

/**
 * A single turn in a multi-turn conversation
 */
export interface ConversationTurn {
    /** Role of the speaker */
    role: 'user' | 'assistant';
    /** Message content */
    content: string;
    /** When this turn was created */
    timestamp: Date;
    /** Zero-based index of this turn in the conversation */
    turnIndex: number;
    /** True while the assistant response is still being streamed (ephemeral UI hint) */
    streaming?: boolean;
    /** Tool calls executed during this turn (typically assistant turns only) */
    toolCalls?: ToolCall[];
    /** Chronological execution events (content chunks + tool lifecycle) */
    timeline: TimelineItem[];
    /** Base64 data-URL strings for user-attached images */
    images?: string[];
    /** True for turns prepended from a prior session during cold resume */
    historical?: boolean;
    /** Suggested follow-up messages the user can send (assistant turns only). */
    suggestions?: string[];
    /** Token usage for this turn (assistant turns only, undefined for non-streaming or legacy). */
    tokenUsage?: TokenUsage;
}

/**
 * Serialized format of ConversationTurn for persistence (Date -> ISO string)
 */
export interface SerializedConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;  // ISO string
    turnIndex: number;
    streaming?: boolean;
    toolCalls?: SerializedToolCall[];
    /** Chronological execution events (timestamps as ISO strings) */
    timeline: SerializedTimelineItem[];
    /** Base64 data-URL strings for user-attached images */
    images?: string[];
    /** True for turns prepended from a prior session during cold resume */
    historical?: boolean;
    /** Suggested follow-up messages the user can send (assistant turns only). */
    suggestions?: string[];
    /** Token usage for this turn (assistant turns only). */
    tokenUsage?: TokenUsage;
}

/**
 * Status of a single tool call execution
 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Permission request details for a tool call (if the tool required user approval)
 */
export interface ToolCallPermissionRequest {
    /** Permission type: 'file', 'shell', 'url', 'read', 'write', 'mcp' */
    kind: string;
    /** When permission was requested */
    timestamp: Date;
    /** Optional: specific resource being accessed (e.g., file path) */
    resource?: string;
    /** Optional: operation description */
    operation?: string;
}

/**
 * Permission approval/denial result for a tool call
 */
export interface ToolCallPermissionResult {
    /** Whether permission was granted */
    approved: boolean;
    /** When permission was decided */
    timestamp: Date;
    /** Optional: denial reason */
    reason?: string;
}

/**
 * A single tool call executed during a conversation turn
 */
export interface ToolCall {
    /** Unique ID for this tool call */
    id: string;
    /** Tool name (e.g., 'bash', 'view', 'edit', 'grep') */
    name: string;
    /** Current execution status */
    status: ToolCallStatus;
    /** When the tool call started */
    startTime: Date;
    /** When the tool call finished (if completed/failed) */
    endTime?: Date;
    /** Tool arguments (as JSON object) */
    args: Record<string, unknown>;
    /** Tool execution result (if completed) */
    result?: string;
    /** Error message (if failed) */
    error?: string;
    /**
     * Parent tool call ID when this tool was triggered inside another tool
     * (for example: subagent tools under a `task` tool call).
     */
    parentToolCallId?: string;
    /** Permission request details (if applicable) */
    permissionRequest?: ToolCallPermissionRequest;
    /** Permission decision (if applicable) */
    permissionResult?: ToolCallPermissionResult;
}

/**
 * Serialized format of ToolCall for persistence (Date → ISO string)
 */
export interface SerializedToolCall {
    id: string;
    name: string;
    status: ToolCallStatus;
    startTime: string;  // ISO string
    endTime?: string;   // ISO string
    args: Record<string, unknown>;
    result?: string;
    error?: string;
    parentToolCallId?: string;
    permissionRequest?: {
        kind: string;
        timestamp: string;  // ISO string
        resource?: string;
        operation?: string;
    };
    permissionResult?: {
        approved: boolean;
        timestamp: string;  // ISO string
        reason?: string;
    };
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

    /** Human-readable title generated by AI after the first exchange */
    title?: string;

    // ========================================================================
    // Conversation Fields (Added 2026-02)
    // ========================================================================

    /** Ordered list of conversation turns for multi-turn chat */
    conversationTurns?: ConversationTurn[];

    // ========================================================================
    // Context Window Tracking Fields (Added 2026-03)
    // ========================================================================

    /** Session-level context window size (from session.usage_info) */
    tokenLimit?: number;
    /** Tokens currently occupying the session context (from session.usage_info) */
    currentTokens?: number;
    /** Running total of token usage across all turns in this session */
    cumulativeTokenUsage?: TokenUsage;
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

    /** Human-readable title generated by AI after the first exchange */
    title?: string;

    // ========================================================================
    // Conversation Fields (Added 2026-02)
    // ========================================================================

    /** Ordered list of conversation turns (timestamps as ISO strings) */
    conversationTurns?: SerializedConversationTurn[];

    // ========================================================================
    // Context Window Tracking Fields (Added 2026-03)
    // ========================================================================

    /** Session-level context window size */
    tokenLimit?: number;
    /** Tokens currently occupying the session context */
    currentTokens?: number;
    /** Running total of token usage across all turns */
    cumulativeTokenUsage?: TokenUsage;
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
        workingDirectory: process.workingDirectory,
        // Title
        title: process.title,
        // Conversation turns (Date → ISO string)
        conversationTurns: process.conversationTurns?.map(turn => ({
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp.toISOString(),
            turnIndex: turn.turnIndex,
            streaming: turn.streaming,
            toolCalls: turn.toolCalls?.map(tc => ({
                id: tc.id,
                name: tc.name,
                status: tc.status,
                startTime: tc.startTime.toISOString(),
                endTime: tc.endTime?.toISOString(),
                args: tc.args,
                result: tc.result,
                error: tc.error,
                ...(tc.parentToolCallId ? { parentToolCallId: tc.parentToolCallId } : {}),
                permissionRequest: tc.permissionRequest ? {
                    kind: tc.permissionRequest.kind,
                    timestamp: tc.permissionRequest.timestamp.toISOString(),
                    resource: tc.permissionRequest.resource,
                    operation: tc.permissionRequest.operation
                } : undefined,
                permissionResult: tc.permissionResult ? {
                    approved: tc.permissionResult.approved,
                    timestamp: tc.permissionResult.timestamp.toISOString(),
                    reason: tc.permissionResult.reason
                } : undefined
            })),
            timeline: (turn.timeline ?? []).map(item => ({
                type: item.type,
                timestamp: item.timestamp.toISOString(),
                content: item.content,
                toolCall: item.toolCall ? {
                    id: item.toolCall.id,
                    name: item.toolCall.name,
                    status: item.toolCall.status,
                    startTime: item.toolCall.startTime.toISOString(),
                    endTime: item.toolCall.endTime?.toISOString(),
                    args: item.toolCall.args,
                    result: item.toolCall.result,
                    error: item.toolCall.error,
                    ...(item.toolCall.parentToolCallId ? { parentToolCallId: item.toolCall.parentToolCallId } : {}),
                    permissionRequest: item.toolCall.permissionRequest ? {
                        kind: item.toolCall.permissionRequest.kind,
                        timestamp: item.toolCall.permissionRequest.timestamp.toISOString(),
                        resource: item.toolCall.permissionRequest.resource,
                        operation: item.toolCall.permissionRequest.operation
                    } : undefined,
                    permissionResult: item.toolCall.permissionResult ? {
                        approved: item.toolCall.permissionResult.approved,
                        timestamp: item.toolCall.permissionResult.timestamp.toISOString(),
                        reason: item.toolCall.permissionResult.reason
                    } : undefined
                } : undefined
            })),
            images: turn.images,
            suggestions: turn.suggestions,
            tokenUsage: turn.tokenUsage,
        })),
        // Context window tracking fields
        tokenLimit: process.tokenLimit,
        currentTokens: process.currentTokens,
        cumulativeTokenUsage: process.cumulativeTokenUsage,
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
        workingDirectory: serialized.workingDirectory,
        // Title
        title: serialized.title,
        // Conversation turns (ISO string → Date)
        conversationTurns: serialized.conversationTurns?.map(turn => ({
            role: turn.role,
            content: turn.content,
            timestamp: new Date(turn.timestamp),
            turnIndex: turn.turnIndex,
            streaming: turn.streaming,
            toolCalls: turn.toolCalls?.map(tc => ({
                id: tc.id,
                name: tc.name,
                status: tc.status,
                startTime: new Date(tc.startTime),
                endTime: tc.endTime ? new Date(tc.endTime) : undefined,
                args: tc.args,
                result: tc.result,
                error: tc.error,
                parentToolCallId: tc.parentToolCallId,
                permissionRequest: tc.permissionRequest ? {
                    kind: tc.permissionRequest.kind,
                    timestamp: new Date(tc.permissionRequest.timestamp),
                    resource: tc.permissionRequest.resource,
                    operation: tc.permissionRequest.operation
                } : undefined,
                permissionResult: tc.permissionResult ? {
                    approved: tc.permissionResult.approved,
                    timestamp: new Date(tc.permissionResult.timestamp),
                    reason: tc.permissionResult.reason
                } : undefined
            })),
            timeline: (turn.timeline ?? []).map(item => ({
                type: item.type,
                timestamp: new Date(item.timestamp),
                content: item.content,
                toolCall: item.toolCall ? {
                    id: item.toolCall.id,
                    name: item.toolCall.name,
                    status: item.toolCall.status,
                    startTime: new Date(item.toolCall.startTime),
                    endTime: item.toolCall.endTime ? new Date(item.toolCall.endTime) : undefined,
                    args: item.toolCall.args,
                    result: item.toolCall.result,
                    error: item.toolCall.error,
                    parentToolCallId: item.toolCall.parentToolCallId,
                    permissionRequest: item.toolCall.permissionRequest ? {
                        kind: item.toolCall.permissionRequest.kind,
                        timestamp: new Date(item.toolCall.permissionRequest.timestamp),
                        resource: item.toolCall.permissionRequest.resource,
                        operation: item.toolCall.permissionRequest.operation
                    } : undefined,
                    permissionResult: item.toolCall.permissionResult ? {
                        approved: item.toolCall.permissionResult.approved,
                        timestamp: new Date(item.toolCall.permissionResult.timestamp),
                        reason: item.toolCall.permissionResult.reason
                    } : undefined
                } : undefined
            })),
            images: turn.images,
            suggestions: turn.suggestions,
            tokenUsage: turn.tokenUsage,
        })),
        // Context window tracking fields
        tokenLimit: serialized.tokenLimit,
        currentTokens: serialized.currentTokens,
        cumulativeTokenUsage: serialized.cumulativeTokenUsage,
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
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}

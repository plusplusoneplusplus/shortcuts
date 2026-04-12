/**
 * Core AI process interface definitions.
 *
 * Defines the domain objects used to track AI processes, conversation turns,
 * tool calls, and related state — with no serialization logic. Serialization
 * helpers live in `process-serialization.ts`.
 */

import { AIBackendType } from './types';
import type { TokenUsage } from '../copilot-sdk-wrapper/types';
import type {
    CodeReviewProcessMetadata,
    DiscoveryProcessMetadata,
    CodeReviewGroupMetadata,
} from './process-legacy-types';

// Re-export legacy types so consumers of process-interfaces.ts get them too.
export type { CodeReviewProcessMetadata, DiscoveryProcessMetadata, CodeReviewGroupMetadata };

/**
 * Supported AI tools for invocation
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Status of an AI process
 */
export type AIProcessStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

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
    /** True when the user's large pasted content was externalized to a temp file reference */
    pasteExternalized?: boolean;
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
    /** True when the user's large pasted content was externalized to a temp file reference */
    pasteExternalized?: boolean;
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

/**
 * A message queued on the server while an AI response is in progress.
 * Persisted on the AIProcess so it survives chat switches and page refreshes.
 */
export interface PendingMessage {
    /** Unique identifier (crypto.randomUUID) */
    id: string;
    /** Message content */
    content: string;
    /** Interaction mode when the message was queued */
    mode?: string;
    /** ISO 8601 timestamp of when the message was queued */
    createdAt: string;
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
    // Legacy metadata fields (kept for backward-compatible deserialization)
    // New features should use `metadata` and `groupMetadata` instead.
    // See process-legacy-types.ts for why these cannot be removed yet.
    // ========================================================================

    /** Legacy: use metadata with type='code-review' for new processes */
    codeReviewMetadata?: CodeReviewProcessMetadata;
    /** Discovery specific metadata (if type is 'discovery') */
    discoveryMetadata?: DiscoveryProcessMetadata;
    /** Legacy: use groupMetadata with type='code-review-group' for new processes */
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

    // ========================================================================
    // Pending Messages (Added 2026-04)
    // ========================================================================

    /** Messages queued on the server while an AI response is in progress */
    pendingMessages?: PendingMessage[];

    /** True when the stale task detector has flagged this process as stale (running past timeout) */
    stale?: boolean;

    /** Absolute path to the JSON file backing this process in the store. */
    dataFilePath?: string;

    /** Timestamp of the last conversation event (turn completion). Set server-side only. */
    lastEventAt?: Date;

    // ========================================================================
    // Pin & Archive State (Added 2026-04)
    // ========================================================================

    /** ISO timestamp when the process was pinned (undefined = not pinned). */
    pinnedAt?: string;

    /** Whether the process is archived. */
    archived?: boolean;
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
    /** Legacy: use metadata instead for new processes */
    codeReviewMetadata?: CodeReviewProcessMetadata;
    discoveryMetadata?: DiscoveryProcessMetadata;
    /** Legacy: use groupMetadata instead for new processes */
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

    /** Messages queued on the server while an AI response is in progress */
    pendingMessages?: PendingMessage[];

    /** Timestamp of the last conversation event (turn completion). ISO string. */
    lastEventAt?: string;
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
    cancelling: number;
    completed: number;
    failed: number;
    cancelled: number;
}

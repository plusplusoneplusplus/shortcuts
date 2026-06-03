import type {
    BackgroundTasksInfo,
    SystemMessageConfig,
    TokenUsage,
    Tool,
    ToolEvent,
} from '@plusplusoneplusplus/coc-agent-sdk';

/**
 * A generic item with string key-value pairs for template substitution.
 * Used across pipeline and workflow execution engines.
 */
export interface PromptItem {
    [key: string]: string;
}

/**
 * AI invocation function type. Workflow execution receives this from callers
 * so the pure engine does not own SDK process/session lifecycle.
 */
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;

/**
 * Options for AI invocation.
 */
export interface AIInvokerOptions {
    /** Model to use (optional, uses caller default if not specified) */
    model?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Timeout in ms */
    timeoutMs?: number;
    /** Abort signal for cooperative cancellation. */
    signal?: AbortSignal;
    /** Custom tools to register on the AI session (SDK-native tools, not MCP). */
    tools?: Tool<any>[];
    /** Callback invoked for each tool event during the AI session. */
    onToolEvent?: (event: ToolEvent) => void;
    /** Callback invoked whenever background task state changes. */
    onBackgroundTasksChanged?: (tasks: BackgroundTasksInfo) => void;
    /** System message configuration for the SDK session. */
    systemMessage?: SystemMessageConfig;
}

/**
 * Result from AI invocation.
 */
export interface AIInvokerResult {
    /** Whether the invocation succeeded */
    success: boolean;
    /** The AI response (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
    /** SDK session ID if the request was made via SDK (for session resume) */
    sessionId?: string;
    /** Token usage data from the SDK (if available) */
    tokenUsage?: TokenUsage;
}

/**
 * Session metadata for session resume functionality.
 */
export interface SessionMetadata {
    /** SDK session ID for resuming sessions */
    sessionId?: string;
    /** Backend type used for this process */
    backend?: 'copilot-sdk' | 'copilot-cli' | 'clipboard';
    /** Working directory used for the session */
    workingDirectory?: string;
}

/**
 * Process tracking hooks for integration with AI process manager.
 */
export interface ProcessTracker {
    registerProcess(description: string, parentGroupId?: string): string;
    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string,
        structuredResult?: string
    ): void;
    attachSessionMetadata?(processId: string, metadata: SessionMetadata): void;
    registerGroup(description: string): string;
    completeGroup(
        groupId: string,
        summary: string,
        stats: {
            totalItems: number;
            successfulMaps: number;
            failedMaps: number;
            mapPhaseTimeMs: number;
            reducePhaseTimeMs: number;
            maxConcurrency: number;
        }
    ): void;
}

/**
 * Copilot SDK Wrapper Types
 *
 * SDK-specific types extracted from copilot-sdk-service.ts.
 * These types define the interface for interacting with the Copilot SDK,
 * including MCP server configuration, permission handling, and session management.
 */

import { AIInvocationResult } from '../ai/types';
import type { ToolCall } from '../ai/process-types';

// ============================================================================
// SDK Tool Types (re-exported from @github/copilot-sdk)
// ============================================================================

/**
 * Result type for a tool invocation.
 * Indicates whether the tool call succeeded, failed, was rejected, or denied.
 */
export type ToolResultType = 'success' | 'failure' | 'rejected' | 'denied';

/**
 * Structured tool result object with metadata.
 */
export interface ToolResultObject {
    textResultForLlm: string;
    binaryResultsForLlm?: Array<{ mimeType: string; base64Data: string }>;
    resultType: ToolResultType;
    error?: string;
}

/**
 * Tool result — either a plain string or a structured result object.
 */
export type ToolResult = string | ToolResultObject;

/**
 * Context passed to a tool handler when invoked by the SDK.
 */
export interface ToolInvocation {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    arguments: unknown;
}

/**
 * Handler function for a custom tool.
 */
export type ToolHandler<TArgs = unknown> = (
    args: TArgs,
    invocation: ToolInvocation,
) => Promise<unknown> | unknown;

/**
 * Zod-compatible schema interface for tool parameter validation.
 */
export interface ZodSchema<T = unknown> {
    _output: T;
    toJSONSchema(): Record<string, unknown>;
}

/**
 * Definition of a custom tool that can be registered on an AI session.
 *
 * Consumers can construct `Tool` objects directly or use the SDK's `defineTool`
 * helper (import `defineTool` from `@github/copilot-sdk`).
 */
export interface Tool<TArgs = unknown> {
    name: string;
    description?: string;
    parameters?: ZodSchema<TArgs> | Record<string, unknown>;
    handler: ToolHandler<TArgs>;
}

/**
 * Helper to define a tool with proper type inference for the handler.
 * Mirrors the SDK's `defineTool` helper from `@github/copilot-sdk`.
 */
export function defineTool<T = unknown>(name: string, config: {
    description?: string;
    parameters?: ZodSchema<T> | Record<string, unknown>;
    handler: ToolHandler<T>;
}): Tool<T> {
    return { name, ...config };
}

// Re-export model types for convenience
export { AIModel, VALID_MODELS, DEFAULT_MODEL_ID, ModelDefinition, MODEL_REGISTRY,
    getModelLabel, getModelDescription, getModelDefinition, getAllModels,
    getActiveModels, isValidModelId, getModelCount, getModelsByTier
} from './model-registry';

// ============================================================================
// MCP Server Configuration Types
// ============================================================================

/**
 * Base configuration for MCP (Model Context Protocol) servers.
 * Contains common fields shared by all server types.
 */
export interface MCPServerConfigBase {
    /** List of tools to enable from this server. Use ["*"] for all tools. */
    tools?: string[];
    /** Server type: "local" | "stdio" | "http" | "sse" */
    type?: 'local' | 'stdio' | 'http' | 'sse';
    /** Optional timeout in milliseconds */
    timeout?: number;
    /** Whether the server is enabled */
    enabled?: boolean;
}

/**
 * Configuration for local/stdio MCP servers.
 * These servers are spawned as child processes.
 */
export interface MCPLocalServerConfig extends MCPServerConfigBase {
    /** Server type: "local" or "stdio" (default if not specified) */
    type?: 'local' | 'stdio';
    /** Server command or executable path */
    command: string;
    /** Arguments to pass to the server */
    args?: string[];
    /** Environment variables for the server */
    env?: Record<string, string>;
    /** Working directory for the server process */
    cwd?: string;
}

/**
 * Configuration for remote MCP servers (HTTP or SSE).
 * These servers are accessed over the network.
 */
export interface MCPRemoteServerConfig extends MCPServerConfigBase {
    /** Server type: "http" or "sse" */
    type: 'http' | 'sse';
    /** URL of the remote server */
    url: string;
    /** Optional HTTP headers for authentication or other purposes */
    headers?: Record<string, string>;
}

/**
 * MCP (Model Context Protocol) server configuration.
 * Supports both local (command-based) and remote (HTTP/SSE) servers.
 */
export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

// ============================================================================
// MCP Control Options
// ============================================================================

/**
 * Options for controlling MCP tools at the session level.
 * These options map directly to the SDK's SessionConfig parameters.
 * 
 * Tool filtering behavior:
 * - If `availableTools` is specified, only those tools are available (whitelist mode)
 * - If `excludedTools` is specified, those tools are disabled (blacklist mode)
 * - `availableTools` takes precedence over `excludedTools` if both are specified
 * - If neither is specified, all tools are available (default SDK behavior)
 */
export interface MCPControlOptions {
    /** Whitelist of tool names to make available. Takes precedence over `excludedTools`. */
    availableTools?: string[];
    /** Blacklist of tool names to exclude. Ignored if `availableTools` is also specified. */
    excludedTools?: string[];
    /** Custom MCP server configurations. Pass an empty object `{}` to disable all MCP servers. */
    mcpServers?: Record<string, MCPServerConfig>;
}

// ============================================================================
// Permission Handling
// ============================================================================

/**
 * Permission request from the Copilot CLI.
 * Maps to SDK's PermissionRequest interface.
 */
export interface PermissionRequest {
    /** Type of permission being requested */
    kind: 'shell' | 'write' | 'mcp' | 'read' | 'url';
    /** Associated tool call ID (if applicable) */
    toolCallId?: string;
    /** Additional request-specific data */
    [key: string]: unknown;
}

/**
 * Result of a permission request.
 * Maps to SDK's PermissionRequestResult interface.
 */
export interface PermissionRequestResult {
    /** The decision kind */
    kind: 'approved' | 'denied-by-rules' | 'denied-no-approval-rule-and-could-not-request-from-user' | 'denied-interactively-by-user';
    /** Optional rules that led to this decision */
    rules?: unknown[];
}

/**
 * Handler function for permission requests.
 */
export type PermissionHandler = (
    request: PermissionRequest,
    invocation: { sessionId: string }
) => Promise<PermissionRequestResult> | PermissionRequestResult;

// ============================================================================
// Token Usage
// ============================================================================

/**
 * Aggregated token usage data from SDK events.
 *
 * Accumulated from `assistant.usage` events (per-turn) and
 * `session.usage_info` events (session-level quota info).
 */
export interface TokenUsage {
    /** Total input tokens consumed across all turns */
    inputTokens: number;
    /** Total output tokens generated across all turns */
    outputTokens: number;
    /** Total cache-read tokens across all turns */
    cacheReadTokens: number;
    /** Total cache-write tokens across all turns */
    cacheWriteTokens: number;
    /** Sum of inputTokens + outputTokens */
    totalTokens: number;
    /** Cumulative cost across all turns (if reported by the SDK) */
    cost?: number;
    /** Cumulative duration in ms across all turns (if reported by the SDK) */
    duration?: number;
    /** Number of assistant.usage events received (one per turn) */
    turnCount: number;
    /** Session-level token limit (last seen from session.usage_info) */
    tokenLimit?: number;
    /** Session-level current token count (last seen from session.usage_info) */
    currentTokens?: number;
}

// ============================================================================
// Attachment Types
// ============================================================================

/**
 * File or directory attachment for SDK messages.
 * Mirrors the SDK's `MessageOptions.attachments` element type.
 */
export interface Attachment {
    /** Attachment type: file or directory */
    type: 'file' | 'directory';
    /** Absolute path to the file or directory */
    path: string;
    /** Optional display name shown to the AI */
    displayName?: string;
}

// ============================================================================
// Send Message Options
// ============================================================================

/**
 * Options for sending a message via the SDK
 */
export interface SendMessageOptions {
    /** The prompt to send */
    prompt: string;
    /** Optional model override (e.g., 'gpt-5', 'claude-sonnet-4.6') */
    model?: string;
    /** Optional working directory for context (set at client level) */
    workingDirectory?: string;
    /** Optional timeout in milliseconds (default: DEFAULT_AI_TIMEOUT_MS = 4 hours) */
    timeoutMs?: number;
    /**
     * Idle timeout in milliseconds. Resets every time a streaming chunk or
     * message event is received. If no activity arrives within this window,
     * the session is force-destroyed. Independent of `timeoutMs` — whichever
     * fires first kills the session. Only applies to the streaming path.
     * @default DEFAULT_AI_IDLE_TIMEOUT_MS (1 hour)
     */
    idleTimeoutMs?: number;
    /**
     * File or directory attachments to include with the message.
     * Maps to the SDK's MessageOptions.attachments.
     */
    attachments?: Attachment[];
    /** Enable streaming for real-time response chunks (default: false) */
    streaming?: boolean;

    // MCP Control Options (Session-level tool filtering)

    /** Whitelist of tool names to make available. */
    availableTools?: string[];
    /** Blacklist of tool names to exclude. */
    excludedTools?: string[];
    /** Custom MCP server configurations. */
    mcpServers?: Record<string, MCPServerConfig>;
    /**
     * Whether to automatically load MCP server configuration from ~/.copilot/mcp-config.json.
     * @default true
     */
    loadDefaultMcpConfig?: boolean;

    /**
     * Handler for permission requests from the Copilot CLI.
     * Without a handler, all permission requests are denied by default.
     */
    onPermissionRequest?: PermissionHandler;

    /**
     * Callback invoked for each streaming chunk as it arrives from the SDK.
     * When provided, streaming mode is automatically enabled.
     */
    onStreamingChunk?: (chunk: string) => void;

    /**
     * Callback invoked for tool execution lifecycle events during streaming.
     * Receives events when tools start, complete, or fail.
     */
    onToolEvent?: (event: ToolEvent) => void;

    /**
     * Custom tools to register on the AI session.
     * These are SDK-native tools (not MCP) — each tool has a name, optional
     * description/parameters, and a handler function invoked by the AI.
     */
    tools?: Tool<any>[];

    /**
     * When true, the session is NOT destroyed after the first message completes.
     * The returned `sessionId` can be passed to `sendFollowUp()` for multi-turn conversation.
     * @default false
     */
    keepAlive?: boolean;
}

/**
 * Tool execution lifecycle event emitted during streaming.
 */
export interface ToolEvent {
    type: 'tool-start' | 'tool-complete' | 'tool-failed';
    toolCallId: string;
    toolName?: string;
    /**
     * Parent tool call ID when this tool is executed by a subagent
     * (typically nested under a `task` tool call).
     */
    parentToolCallId?: string;
    /** Tool input parameters (for 'tool-start' events). */
    parameters?: Record<string, unknown>;
    /** Tool output result (for 'tool-complete' events). */
    result?: string;
    /** Error message (for 'tool-failed' events). */
    error?: string;
}

// ============================================================================
// SDK Result Types
// ============================================================================

/**
 * Result from SDK invocation, extends AIInvocationResult with SDK-specific fields
 */
export interface SDKInvocationResult extends AIInvocationResult {
    /** Session ID used for this request (if session was created) */
    sessionId?: string;
    /** Raw SDK response data */
    rawResponse?: unknown;
    /** Aggregated token usage data (undefined when no usage events were received) */
    tokenUsage?: TokenUsage;
    /** Tool calls captured during this request (if any). Only populated for streaming sessions. */
    toolCalls?: ToolCall[];
}

/**
 * SDK availability check result
 */
export interface SDKAvailabilityResult {
    /** Whether the SDK is available and can be used */
    available: boolean;
    /** Path to the SDK if found */
    sdkPath?: string;
    /** Error message if not available */
    error?: string;
}

// ============================================================================
// Permission Handler Helpers
// ============================================================================

/**
 * Permission handler that approves all permission requests.
 * 
 * **WARNING**: This allows the AI to perform any operation without restrictions.
 * Only use this in trusted environments or for testing purposes.
 */
export const approveAllPermissions: PermissionHandler = () => {
    return { kind: 'approved' };
};

/**
 * Permission handler that denies all permission requests.
 * This is the default behavior when no handler is provided.
 */
export const denyAllPermissions: PermissionHandler = () => {
    return { kind: 'denied-by-rules' };
};

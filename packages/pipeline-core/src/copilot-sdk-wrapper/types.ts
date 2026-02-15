/**
 * Copilot SDK Wrapper Types
 *
 * SDK-specific types extracted from copilot-sdk-service.ts.
 * These types define the interface for interacting with the Copilot SDK,
 * including MCP server configuration, permission handling, and session management.
 */

import { AIInvocationResult } from '../ai/types';

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
// Send Message Options
// ============================================================================

/**
 * Options for sending a message via the SDK
 */
export interface SendMessageOptions {
    /** The prompt to send */
    prompt: string;
    /** Optional model override (e.g., 'gpt-5', 'claude-sonnet-4.5') */
    model?: string;
    /** Optional working directory for context (set at client level) */
    workingDirectory?: string;
    /** Optional timeout in milliseconds (default: 1800000 = 30 minutes) */
    timeoutMs?: number;
    /** Use session pool for efficient parallel requests (default: false) */
    usePool?: boolean;
    /** Enable streaming for real-time response chunks (default: false) */
    streaming?: boolean;

    // MCP Control Options (Session-level tool filtering)

    /** Whitelist of tool names to make available. Only applies to direct sessions (usePool: false). */
    availableTools?: string[];
    /** Blacklist of tool names to exclude. Only applies to direct sessions (usePool: false). */
    excludedTools?: string[];
    /** Custom MCP server configurations. Only applies to direct sessions (usePool: false). */
    mcpServers?: Record<string, MCPServerConfig>;
    /**
     * Whether to automatically load MCP server configuration from ~/.copilot/mcp-config.json.
     * Only applies to direct sessions (usePool: false).
     * @default true
     */
    loadDefaultMcpConfig?: boolean;

    /**
     * Handler for permission requests from the Copilot CLI.
     * Without a handler, all permission requests are denied by default.
     * Only applies to direct sessions (usePool: false).
     */
    onPermissionRequest?: PermissionHandler;

    /**
     * Callback invoked for each streaming chunk as it arrives from the SDK.
     * When provided, streaming mode is automatically enabled.
     * Only works with direct sessions (usePool: false).
     */
    onStreamingChunk?: (chunk: string) => void;
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
// Session Pool Configuration
// ============================================================================

/**
 * Configuration options for the session pool.
 * These are passed to the service to avoid VS Code dependencies.
 */
export interface SessionPoolConfig {
    /** Maximum number of concurrent sessions in the pool (default: 5) */
    maxSessions?: number;
    /** Idle timeout in milliseconds before sessions are destroyed (default: 300000 = 5 minutes) */
    idleTimeoutMs?: number;
}

/**
 * Default session pool configuration values.
 * These match the VS Code setting defaults.
 */
export const DEFAULT_SESSION_POOL_CONFIG: Required<SessionPoolConfig> = {
    maxSessions: 5,
    idleTimeoutMs: 300000
};

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

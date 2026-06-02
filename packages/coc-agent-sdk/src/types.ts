/**
 * Copilot SDK Wrapper Types
 *
 * Re-exports SDK types where possible, defines forge-specific types
 * for features that extend or wrap the SDK's surface.
 */

import type { ToolCall } from './tool-call';
export interface AIInvocationResult { success: boolean; response?: string; error?: string; }

// ============================================================================
// Tool contract — native, provider-neutral types
// ============================================================================
//
// The CoC tool contract is owned here rather than aliased from a specific
// provider's SDK. This keeps the provider-neutral tool runtime + MCP bridge
// (see ./llm-tools) free of any compile-time dependency on @github/copilot-sdk
// and insulates every CoC tool from churn in that pre-1.0 package. The Copilot
// provider path still hands the same `Tool[]` bundle straight to the SDK, so a
// compile-time drift guard (below) asserts these stay structurally
// interchangeable with the Copilot SDK's contract.

// Permission types remain provider-owned — they are not part of the tool
// contract and are only consumed on the Copilot path.
import type {
    PermissionHandler as _PermissionHandler,
} from '@github/copilot-sdk';

export type {
    PermissionHandler, PermissionRequest, PermissionRequestResult,
} from '@github/copilot-sdk';

/**
 * Result classification for a structured tool invocation.
 * Matches the Copilot SDK's `ToolResultType` union.
 */
export type ToolResultType = 'success' | 'failure' | 'rejected' | 'denied' | 'timeout';

/** Binary payload attached to a structured tool result. */
export interface ToolBinaryResult {
    data: string;
    mimeType: string;
    type: string;
    description?: string;
}

/**
 * Structured tool-handler result. Structurally identical to the Copilot SDK's
 * `ToolResultObject`.
 */
export interface ToolResultObject {
    textResultForLlm: string;
    binaryResultsForLlm?: ToolBinaryResult[];
    resultType: ToolResultType;
    error?: string;
    sessionLog?: string;
    toolTelemetry?: Record<string, unknown>;
}

/**
 * Per-invocation envelope passed to a tool handler. Structurally identical to
 * the Copilot SDK's `ToolInvocation`.
 */
export interface ToolInvocation {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    arguments: unknown;
    /** W3C Trace Context traceparent from the CLI's execute_tool span. */
    traceparent?: string;
    /** W3C Trace Context tracestate from the CLI's execute_tool span. */
    tracestate?: string;
}

/** Tool handler signature: receives parsed args plus the invocation envelope. */
export type ToolHandler<TArgs = unknown> = (args: TArgs, invocation: ToolInvocation) => Promise<unknown> | unknown;

/**
 * Zod-like schema interface for type inference. Any object exposing a
 * `toJSONSchema()` method is treated as a schema.
 */
export interface ZodSchema<T = unknown> {
    _output: T;
    toJSONSchema(): Record<string, unknown>;
}

/**
 * Tool definition. `parameters` may be a Zod-like schema (enabling handler-arg
 * inference), a raw JSON Schema object, or omitted.
 */
export interface Tool<TArgs = unknown> {
    name: string;
    description?: string;
    parameters?: ZodSchema<TArgs> | Record<string, unknown>;
    handler: ToolHandler<TArgs>;
    /**
     * When true, explicitly indicates this tool is intended to override a
     * built-in tool of the same name. If unset and the name clashes with a
     * built-in tool, the runtime returns an error.
     */
    overridesBuiltInTool?: boolean;
    /** When true, the tool can execute without a permission prompt. */
    skipPermission?: boolean;
}

// ----------------------------------------------------------------------------
// Compile-time drift guard
// ----------------------------------------------------------------------------
// Asserts the native tool contract above stays structurally interchangeable
// with the Copilot SDK's, in both directions. The Copilot provider path assigns
// the same `Tool[]` bundle straight to the SDK's `SessionConfig.tools` (see
// request-runner.ts), so if the SDK's shape drifts — a field type changes or a
// required field is added — one of these assertions fails its constraint and
// the build breaks here, pointing at the exact contract to reconcile.
// Type-only; emits no runtime code.
type _Extends<A, B> = [A] extends [B] ? true : false;
type _Assert<_T extends true> = never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ToolContractGuard = [
    _Assert<_Extends<Tool<unknown>, import('@github/copilot-sdk').Tool<unknown>>>,
    _Assert<_Extends<import('@github/copilot-sdk').Tool<unknown>, Tool<unknown>>>,
    _Assert<_Extends<ToolInvocation, import('@github/copilot-sdk').ToolInvocation>>,
    _Assert<_Extends<import('@github/copilot-sdk').ToolInvocation, ToolInvocation>>,
    _Assert<_Extends<ToolResultObject, import('@github/copilot-sdk').ToolResultObject>>,
    _Assert<_Extends<import('@github/copilot-sdk').ToolResultObject, ToolResultObject>>,
];

/**
 * Local implementation of the SDK's `defineTool` helper.
 * The SDK version is `function defineTool(name, config) { return { name, ...config }; }`
 * — a pure data-merge with no SDK runtime dependency. Re-implemented here so
 * it can be called synchronously without loading the ESM-only SDK module.
 */
export function defineTool<T = unknown>(
    name: string,
    config: {
        description?: string;
        parameters?: ZodSchema<T> | Record<string, unknown>;
        handler: ToolHandler<T>;
        overridesBuiltInTool?: boolean;
        skipPermission?: boolean;
    },
): Tool<T> {
    return { name, ...config };
}

/**
 * Local implementation of the SDK's `approveAll` permission handler.
 * The SDK version is `const approveAll = () => ({ kind: "approved" })`.
 */
export const approveAll: _PermissionHandler = () => ({ kind: 'approve-once' });

export { loadCopilotSdk } from './sdk-esm-loader';

/**
 * Tool result — either a plain string or a structured result object.
 * (`ToolResultType` and `ToolResultObject` are defined in the tool-contract
 * section above.)
 */
export type ToolResult = string | ToolResultObject;

/**
 * Reasoning effort level for models that support extended thinking.
 * Not re-exported from the SDK's public API, so kept locally.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

// Re-export model types for convenience
export { AIModel, DEFAULT_MODEL_ID, getActiveModels, getAllModels, getModelCount, getModelDefinition, getModelDescription, getModelLabel, getModelsByTier, isValidModelId, MODEL_REGISTRY, ModelDefinition, VALID_MODELS } from './model-registry';

// Re-export dynamic model info types
export { ModelBilling, ModelInfo, ModelPolicy } from './model-info';

// ============================================================================
// MCP Server Configuration Types
//
// Forge defines its own MCP types that are a superset of the SDK's:
// - `tools` is optional (SDK requires it)
// - `args` is optional on local configs (SDK requires it)
// - `MCPServerConfigBase` adds `enabled` field
// These differences are relied upon by mcp-config-loader and downstream
// consumers, so we keep local definitions.
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
// Extended Permission Request
// ============================================================================

/**
 * Extended permission request that includes additional runtime properties
 * (`resource` and `operation`) that exist in the SDK's request object at runtime
 * but are absent from the published SDK types.
 *
 * NOTE: This interface must be re-verified if the SDK's published types are updated
 * to include these fields natively — at that point this local extension becomes redundant.
 */
export interface ExtendedSdkRequest {
    kind: string;
    toolCallId?: string;
    resource?: string;
    operation?: string;
    [key: string]: unknown;
}

// ============================================================================
// User Input Types
//
// These mirror the SDK's UserInputRequest / UserInputResponse / UserInputHandler
// which are defined in `@github/copilot-sdk/dist/types.d.ts` but NOT publicly
// exported from the package index. Re-defined locally to avoid deep-path imports.
// ============================================================================

/**
 * Request for user input from the agent (enables SDK built-in ask_user tool).
 */
export interface UserInputRequest {
    /** The question to ask the user */
    question: string;
    /** Optional choices for multiple-choice questions */
    choices?: string[];
    /**
     * Whether to allow freeform text input in addition to choices.
     * @default true
     */
    allowFreeform?: boolean;
}

/**
 * Response to a user input request.
 */
export interface UserInputResponse {
    /** The user's answer */
    answer: string;
    /** Whether the answer was freeform (not from choices) */
    wasFreeform: boolean;
}

/**
 * Handler for user input requests from the agent.
 */
export type UserInputHandler = (
    request: UserInputRequest,
    invocation: { sessionId: string },
) => Promise<UserInputResponse> | UserInputResponse;

// ============================================================================
// Token Usage
// ============================================================================

/**
 * Aggregated token usage data from SDK events.
 *
 * Accumulated from provider usage events:
 * - Copilot `assistant.usage` events (per-turn) and `session.usage_info`
 *   events (session-level quota info)
 * - Codex `turn.completed.usage` events (per-turn totals only)
 * - Claude `result.usage` events plus optional `getContextUsage()` context
 *   window data
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
    /** Estimated USD token cost derived from published Copilot per-token pricing */
    estimatedUsdCost?: number;
    /** Estimated USD token cost by billing category */
    costBreakdown?: {
        inputUsd: number;
        cachedInputUsd: number;
        cacheWriteUsd: number;
        outputUsd: number;
    };
    /** Pricing table source for estimatedUsdCost */
    pricingSource?: string;
    /** True when one or more models did not have a matching pricing table entry */
    pricingUnavailable?: boolean;
    /** Cumulative duration in ms across all turns (if reported by the SDK) */
    duration?: number;
    /** Number of assistant.usage events received (one per turn) */
    turnCount: number;
    /** Session-level token limit (last seen from session.usage_info) */
    tokenLimit?: number;
    /** Session-level current token count (last seen from session.usage_info) */
    currentTokens?: number;
    /** Tokens consumed by the system prompt (from session.usage_info breakdown) */
    systemTokens?: number;
    /** Tokens consumed by tool definitions (from session.usage_info breakdown) */
    toolDefinitionsTokens?: number;
    /** Tokens consumed by conversation history (from session.usage_info breakdown) */
    conversationTokens?: number;
}

// ============================================================================
// System Message Configuration
//
// Forge uses a simplified union (`mode: 'append' | 'replace'` + `content`)
// while the SDK uses a discriminated union of two separate interfaces.
// Keep the forge version for backward compatibility — it's structurally
// compatible with the SDK's union at the call site.
// ============================================================================

/**
 * Configuration for customizing the system message on a Copilot SDK session.
 *
 * - `append` — Keeps the SDK's default system message and appends your content after it.
 * - `replace` — Replaces the entire default system message with your own.
 */
export interface SystemMessageConfig {
    /** How the content interacts with the default system message. */
    mode: 'append' | 'replace';
    /** The system message content to append or use as replacement. */
    content: string;
}

// ============================================================================
// Attachment Types
// ============================================================================

/**
 * File or directory attachment for SDK messages.
 * The SDK send-side accepts a missing display name, but its persisted session
 * resume schema requires one for every attachment.
 */
export interface Attachment {
    /** Attachment type: file or directory */
    type: 'file' | 'directory';
    /** Absolute path to the file or directory */
    path: string;
    /** Display name shown to the AI and persisted for SDK session resume */
    displayName: string;
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
    /**
     * Pre-created CopilotClient to reuse for this request.
     * When provided, `RequestRunner` will use this client instead of spawning
     * a new child process, and will **not** call `client.stop()` in the finally
     * block (the caller owns the client's lifecycle).
     *
     * Session `destroy()` is still called per-request to release in-memory
     * resources, but the underlying CLI process stays alive for future calls.
     */
    client?: import('@github/copilot-sdk').CopilotClient;
    /** Optional model override (e.g., 'gpt-5', 'claude-sonnet-4.6') */
    model?: string;
    /**
     * SDK session ID to resume. When provided, `sendMessage()` calls
     * `client.resumeSession()` instead of `client.createSession()`, letting
     * the SDK server supply full conversation history natively.
     *
     * If resume fails (session expired/invalid), falls back to
     * `createSession()` automatically. The caller detects the new session ID
     * via `onSessionCreated`.
     */
    sessionId?: string;
    /** Optional working directory for context (set at client level) */
    workingDirectory?: string;
    /**
     * Extra absolute directories the agent is allowed to access beyond the
     * working directory. Consumed by the Claude and Codex providers, which map
     * these to the SDK's `additionalDirectories` permission scope. Both services
     * additionally always grant access to `~/.coc`; the Claude service also
     * always grants the system temp directory.
     */
    additionalDirectories?: string[];
    /** Optional timeout in milliseconds (default: DEFAULT_AI_TIMEOUT_MS = 6 hours) */
    timeoutMs?: number;
    /** Abort signal for cooperative request cancellation. */
    signal?: AbortSignal;
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
     * Directories containing additional skills to load into the session.
     * Each directory should contain subdirectories representing individual skills.
     */
    skillDirectories?: string[];
    /**
     * Deny-list of skill names to disable. Skills loaded from `skillDirectories`
     * whose name matches an entry in this list will not be available in the session.
     */
    disabledSkills?: string[];

    /**
     * Handler for permission requests from the Copilot CLI.
     * Without a handler, all permission requests are denied by default.
     */
    onPermissionRequest?: import('@github/copilot-sdk').PermissionHandler;

    /**
     * Handler for user input requests from the agent.
     * When provided, the SDK enables its built-in `ask_user` tool so the model
     * can ask the user a question and receive an answer.
     *
     * NOTE: Do not provide this alongside a custom `ask_user` tool in the
     * `tools` array — only one ask-user authority should be active per session.
     */
    onUserInputRequest?: UserInputHandler;

    /**
     * Callback invoked immediately after the SDK session is created.
     * Receives the new session ID before any messages are sent.
     */
    onSessionCreated?: (sessionId: string) => void;

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
     * Per-tool-name observational callbacks. Keyed by exact tool name
     * (e.g. 'edit_file', 'str_replace_editor'). Each fires once per successful
     * tool completion. Does not affect tool execution or onToolEvent semantics.
     */
    toolResultInterceptors?: Record<string, ToolResultInterceptor>;

    /**
     * Callback invoked whenever background task state changes (agents/shells start or stop).
     * Receives a snapshot of active background tasks.
     */
    onBackgroundTasksChanged?: (tasks: import('./streaming-session').BackgroundTasksInfo) => void;

    /**
     * Custom tools to register on the AI session.
     * These are SDK-native tools (not MCP) — each tool has a name, optional
     * description/parameters, and a handler function invoked by the AI.
     */
    tools?: Tool<any>[];

    /**
     * System message configuration for the SDK session.
     * Use `mode: "append"` to add extra instructions after the default system prompt,
     * or `mode: "replace"` for full control over the system prompt.
     */
    systemMessage?: SystemMessageConfig;

    /**
     * Agent mode to set on the session after creation.
     * Controls how the AI interacts: 'interactive' (ask), 'plan', or 'autopilot'.
     * When not specified, the SDK default mode is used.
     */
    mode?: AgentMode;

    /**
     * Reasoning effort level for models that support extended thinking (e.g. o-series, claude-3-7-sonnet).
     * The SDK silently ignores this field for models that do not support it.
     */
    reasoningEffort?: ReasoningEffort;

    /**
     * Infinite session configuration for automatic context compaction.
     * When enabled, the SDK automatically manages context window limits
     * by summarizing older conversation history when thresholds are reached.
     * Maps directly to the SDK's `InfiniteSessionConfig`.
     */
    infiniteSessions?: {
        enabled?: boolean;
        backgroundCompactionThreshold?: number;
        bufferExhaustionThreshold?: number;
    };

    /**
     * Controls when the message is dispatched.
     * Defaults to `'immediate'` when omitted.
     */
    deliveryMode?: DeliveryMode;

    /**
     * Callback invoked when the underlying SDK session emits an
     * `mcp.oauth_required` event for an MCP server requiring OAuth.
     *
     * The runner subscribes to the event on the per-request session and
     * forwards each occurrence to this callback. When the SDK exposes a
     * proactive `session.rpc.mcp.oauth.login` RPC, the runner invokes it
     * defensively and includes the resulting `authorizationUrl` in the
     * event. Otherwise `authorizationUrl` is left undefined and consumers
     * should surface the `serverName`/`serverUrl` so the user can complete
     * authentication out-of-band.
     *
     * The handler is observational only: it must not throw, and it must
     * not block message dispatch.
     *
     * @experimental Subject to change as the SDK exposes a stable RPC.
     */
    onMcpOAuthRequired?: (event: McpOAuthEvent) => void;
}

/**
 * Event emitted when an MCP server requires OAuth authentication during a
 * Copilot SDK session.
 *
 * @experimental
 */
export interface McpOAuthEvent {
    /** Display name of the MCP server requiring OAuth. */
    serverName: string;
    /** URL of the MCP server requiring OAuth. */
    serverUrl: string;
    /**
     * Authorization URL the user must open in a browser to complete the
     * OAuth flow. Undefined if cached tokens are valid or the proactive
     * login RPC is not exposed by the SDK build in use.
     */
    authorizationUrl?: string;
    /** Unique identifier for this OAuth request (matches the SDK event id). */
    requestId: string;
    /** SDK session that emitted the event. */
    sessionId: string;
}

/**
 * Observational callback invoked after a specific MCP or SDK tool completes
 * successfully. The tool's own execution is unaffected — this is a pure
 * side-channel for callers that want to react to tool results (e.g. for
 * UI feedback, auditing, caching).
 *
 * Called after onToolEvent fires, so timeline state is already committed.
 */
export type ToolResultInterceptor = (
    params: Record<string, unknown>,
    result: string | undefined,
    toolCallId: string,
) => void;

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
// Agent Mode Types
// ============================================================================

/**
 * Agent mode controlling how the AI interacts with the user.
 * - `interactive` (ask): AI asks for confirmation before actions
 * - `plan`: AI creates a plan but doesn't execute
 * - `autopilot`: AI executes autonomously
 */
export type AgentMode = 'interactive' | 'plan' | 'autopilot';

/**
 * Controls when a message is dispatched to the Copilot session.
 * - `immediate` (default): send as soon as the caller invokes the method.
 * - `enqueue`: add to an ordered queue; dispatched when the session is idle.
 */
export type DeliveryMode = 'immediate' | 'enqueue';

// ============================================================================
// Read-Only Mode Constants
// ============================================================================

/**
 * System message injected when the chat is in `ask` (read-only) mode.
 * Instructs the AI to avoid using any file-modification tools.
 */
export const READ_ONLY_SYSTEM_MESSAGE = `
<coc-read-only-mode>
You are in read-only mode, with the exception of the plan file, the attached note file (if any), and .goal.md specification files. You may write .goal.md files (e.g. feature-name.goal.md) when explicitly asked. You may only read files, search code, and answer questions for all other file types. If the user asks you to make other changes, explain that you are in read-only/ask mode and suggest they switch to autopilot or plan mode.
</coc-read-only-mode>`;

// ============================================================================
// Permission Handler Helpers
// ============================================================================

/**
 * Permission handler that approves all permission requests.
 * 
 * **WARNING**: This allows the AI to perform any operation without restrictions.
 * Only use this in trusted environments or for testing purposes.
 */
export const approveAllPermissions: import('@github/copilot-sdk').PermissionHandler = () => {
    return { kind: 'approve-once' };
};

/**
 * Permission handler that denies all permission requests.
 * This is the default behavior when no handler is provided.
 */
export const denyAllPermissions: import('@github/copilot-sdk').PermissionHandler = () => {
    return { kind: 'reject' };
};

/**
 * Check whether a permission result represents an approval.
 * v0.3.0 of the SDK has three approval kinds: approve-once, approve-for-session, approve-for-location.
 */
export function isPermissionApproved(result: { kind: string }): boolean {
    return result.kind === 'approve-once' || result.kind === 'approve-for-session' || result.kind === 'approve-for-location';
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

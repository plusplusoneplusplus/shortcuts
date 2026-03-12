/**
 * Copilot SDK Service
 *
 * Provides a wrapper around the @github/copilot-sdk for structured AI interactions.
 * This service manages the SDK client lifecycle and provides a clean API for
 * sending messages and managing sessions.
 *
 * Key Features:
 * - Creates a new client per working directory (cwd is set at client init time)
 * - Lazy initialization with ESM dynamic import workaround
 * - Graceful fallback when SDK is unavailable
 * - Session-per-request pattern for simple one-off requests
 *
 * @see https://github.com/github/copilot-sdk
 */

import * as path from 'path';
import * as fs from 'fs';
import { AIInvocationResult } from '../ai/types';
import { ToolCall, ToolCallPermissionRequest, ToolCallPermissionResult } from '../ai/process-types';
import { getAIServiceLogger, createSessionLogger } from '../ai-logger';
import { loadDefaultMcpConfig, mergeMcpConfigs } from './mcp-config-loader';
import { ensureFolderTrusted } from './trusted-folder';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/timeouts';
import { DEFAULT_AI_IDLE_TIMEOUT_MS } from '../config/defaults';
import {
    Attachment,
    DeliveryMode,
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    approveAllPermissions,
    denyAllPermissions,
    ToolEvent,
    AgentMode,
} from './types';

// Re-export types that were previously exported from this file
export {
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    approveAllPermissions,
    denyAllPermissions,
} from './types';

/**
 * Internal result from sendWithStreaming, including token usage.
 */
interface StreamingResult {
    response: string;
    tokenUsage?: TokenUsage;
    /** Number of assistant turns completed during the session.
     *  A value > 0 with an empty response indicates the AI performed
     *  work via tool execution (file edits, shell commands) without
     *  producing a text summary. */
    turnCount: number;
    /** Tool calls captured during this streaming session (if any). */
    toolCalls?: ToolCall[];
}

/**
 * Options for creating a CopilotClient
 */
interface ICopilotClientOptions {
    /** Working directory for the CLI process */
    cwd?: string;
}

/**
 * Options for creating a session.
 * Maps to the SDK's SessionConfig interface.
 */
interface ISessionOptions {
    /** AI model to use (e.g., 'gpt-5', 'claude-sonnet-4.6') */
    model?: string;
    /** Enable streaming for real-time response chunks */
    streaming?: boolean;
    /** Whitelist of tool names to make available (takes precedence over excludedTools) */
    availableTools?: string[];
    /** Blacklist of tool names to exclude */
    excludedTools?: string[];
    /** Custom MCP server configurations */
    mcpServers?: Record<string, MCPServerConfig>;
    /** Handler for permission requests from the CLI */
    onPermissionRequest?: PermissionHandler;
    /** Custom tools to register on the session */
    tools?: any[];
    /** Directories containing additional skills */
    skillDirectories?: string[];
    /** Deny-list of skill names to disable */
    disabledSkills?: string[];
    /** System message configuration */
    systemMessage?: SystemMessageConfig;
}

/**
 * Interface for the CopilotClient from @github/copilot-sdk
 * We define this interface to avoid direct type dependency on the SDK
 */
interface ICopilotClient {
    createSession(options?: ISessionOptions): Promise<ICopilotSession>;
    /**
     * Resume an existing server-side session by ID.
     * The SDK server retains full conversation history so the caller does not
     * need to replay prior turns.
     */
    resumeSession?(sessionId: string, options?: ISessionOptions): Promise<ICopilotSession>;
    stop(): Promise<void>;
}

/**
 * Interface for the CopilotSession from @github/copilot-sdk
 */
interface ICopilotSession {
    sessionId: string;
    /**
     * Send a message and wait for the session to become idle.
     * @param options - Message options including prompt
     * @param timeout - Timeout in milliseconds (SDK default: 60000)
     */
    sendAndWait(options: { prompt: string; attachments?: Attachment[] }, timeout?: number): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
    /** Event handler for streaming responses. Returns an unsubscribe function. */
    on?(handler: (event: ISessionEvent) => void): (() => void);
    /** Send a message without waiting (for streaming) */
    send?(options: { prompt: string; attachments?: Attachment[]; deliveryMode?: DeliveryMode }): Promise<void>;
    /** RPC API for session control (mode, model, etc.) */
    rpc?: {
        mode: {
            get(): Promise<{ mode: string }>;
            set(options: { mode: string }): Promise<void>;
        };
        model: {
            switchTo(options: { modelId: string }): Promise<void>;
        };
    };
}

/**
 * Interface for session events (streaming)
 * 
 * The Copilot SDK fires events with `type` as a plain string (e.g., "session.idle"),
 * not as an object with a `.value` property.
 * 
 * Known event types:
 * - "session.idle" - Session finished processing (data: {})
 * - "session.error" - Session error (data: { message, stack? })
 * - "session.info" - Informational message (data: { infoType, message })
 * - "assistant.message" - Final assistant message (data: { messageId, content, toolRequests? })
 * - "assistant.message_delta" - Streaming chunk (data: { messageId, deltaContent })
 * - "assistant.intent" - AI's declared intent (data: { intent })
 * - "session.agent_mode_change" - Agent mode changed (data: { previous_mode, new_mode })
 * - "assistant.turn_start" - Turn started (data: { turnId })
 * - "assistant.turn_end" - Turn ended (data: { turnId })
 * - "assistant.usage" - Per-turn token usage (data: { inputTokens, outputTokens, ... })
 * - "session.usage_info" - Session-level quota info (data: { tokenLimit, currentTokens })
 * - "tool.execution_start" - Tool execution began (data: { toolCallId, toolName, arguments? })
 * - "tool.execution_complete" - Tool execution finished (data: { toolCallId, success, result?, error? })
 * - "tool.execution_progress" - Tool execution progress (data: { toolCallId, progressMessage })
 * - "abort" - Session aborted (data: { reason })
 * 
 * Completion detection order:
 * 1. `session.idle` settles immediately
 * 2. `assistant.turn_end` starts a 500ms grace period, then settles if content exists
 */
interface ISessionEvent {
    type: string;
    data?: {
        content?: string;
        deltaContent?: string;
        message?: string;
        stack?: string;
        turnId?: string;
        // Token usage fields (from assistant.usage)
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cost?: number;
        duration?: number;
        // Session quota fields (from session.usage_info)
        tokenLimit?: number;
        currentTokens?: number;
        // Tool execution fields (from tool.execution_start / tool.execution_complete)
        toolCallId?: string;
        toolName?: string;
        arguments?: unknown;
        parentToolCallId?: string;
        success?: boolean;
        result?: { content?: string };
        error?: { message?: string; code?: string };
        toolTelemetry?: Record<string, unknown>;
        // Tool execution progress (from tool.execution_progress)
        progressMessage?: string;
        // Tool execution partial result (from tool.execution_partial_result)
        partialOutput?: string;
        // Session info (from session.info)
        infoType?: string;
        // Assistant intent (from assistant.intent)
        intent?: string;
        // Agent mode change (from session.agent_mode_change)
        previous_mode?: string;
        new_mode?: string;
        // Assistant message tool requests
        toolRequests?: Array<{ toolCallId: string; name: string; arguments?: unknown }>;
        // Abort reason
        reason?: string;
    };
}

/**
 * Singleton service for interacting with the Copilot SDK.
 * 
 * Creates a new client per working directory since the SDK's `cwd` option
 * is set at client initialization time (not per-request).
 *
 * Usage:
 * ```typescript
 * const service = CopilotSDKService.getInstance();
 * if (await service.isAvailable()) {
 *     // Request with working directory (creates client with cwd, then session)
 *     const result = await service.sendMessage({ 
 *         prompt: 'Hello',
 *         workingDirectory: '/path/to/project'
 *     });
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Image file → data URL conversion (for view tool results)
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
};

/** Max image file size we'll convert to a data URL (10 MB). */
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * If `filePath` points to a readable image file (by extension), read it and
 * return a `data:image/<mime>;base64,…` string.  Returns `null` when the file
 * is not an image, doesn't exist, is too large, or any other error occurs.
 */
export function tryConvertImageFileToDataUrl(filePath: string): string | null {
    try {
        const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
        const mime = IMAGE_EXTENSIONS[ext];
        if (!mime) return null;

        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_SIZE) return null;

        const data = fs.readFileSync(filePath);
        return `data:${mime};base64,${data.toString('base64')}`;
    } catch {
        return null;
    }
}

export class CopilotSDKService {
    private static instance: CopilotSDKService | null = null;

    private sdkModule: { CopilotClient: new (options?: ICopilotClientOptions) => ICopilotClient } | null = null;
    private availabilityCache: SDKAvailabilityResult | null = null;
    private disposed = false;

    /** Map of active sessions for cancellation support */
    private activeSessions: Map<string, ICopilotSession> = new Map();

    /** Default timeout for SDK requests */
    private static readonly DEFAULT_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;

    /** Default idle timeout for streaming sessions */
    private static readonly DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_AI_IDLE_TIMEOUT_MS;

    /** Error patterns that indicate the underlying JSON-RPC stream is broken */
    private static readonly STREAM_DESTROYED_PATTERNS = [
        'stream was destroyed',
        'ERR_STREAM_DESTROYED',
        'cannot call write after a stream was destroyed',
        'EPIPE',
        'ECONNRESET',
    ];

    /** Patterns indicating a disposed/closed JSON-RPC connection */
    private static readonly CONNECTION_DISPOSED_PATTERNS = [
        'Connection is disposed',
        'connection closed',
        'Connection got disposed',
    ];

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Get the singleton instance of CopilotSDKService
     */
    public static getInstance(): CopilotSDKService {
        if (!CopilotSDKService.instance) {
            CopilotSDKService.instance = new CopilotSDKService();
        }
        return CopilotSDKService.instance;
    }

    /**
     * Reset the singleton instance (primarily for testing)
     */
    public static resetInstance(): void {
        if (CopilotSDKService.instance) {
            CopilotSDKService.instance.dispose();
            CopilotSDKService.instance = null;
        }
    }

    /**
     * Check if the Copilot SDK is available and can be used.
     * Results are cached after the first check.
     *
     * @returns Availability result with status and optional error
     */
    public async isAvailable(): Promise<SDKAvailabilityResult> {
        if (this.disposed) {
            return { available: false, error: 'Service has been disposed' };
        }

        if (this.availabilityCache) {
            return this.availabilityCache;
        }

        const aiLog = getAIServiceLogger();
        aiLog.debug('Checking SDK availability');

        try {
            const sdkPath = this.findSDKPath();
            if (!sdkPath) {
                this.availabilityCache = {
                    available: false,
                    error: 'Copilot SDK not found. Please ensure @github/copilot-sdk is installed.'
                };
                aiLog.debug('SDK not found');
                return this.availabilityCache;
            }

            // Try to load the SDK module to verify it works
            await this.loadSDKModule(sdkPath);

            this.availabilityCache = {
                available: true,
                sdkPath
            };
            aiLog.debug({ sdkPath }, 'SDK available');
            return this.availabilityCache;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.availabilityCache = {
                available: false,
                error: `Failed to load Copilot SDK: ${errorMessage}`
            };
            aiLog.error({ err: error instanceof Error ? error : undefined }, 'SDK availability check failed');
            return this.availabilityCache;
        }
    }

    /**
     * Clear the availability cache, forcing a re-check on next isAvailable() call.
     * Useful when the SDK might have been installed after initial check.
     */
    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
    }

    /**
     * Check whether an error message indicates the underlying JSON-RPC stream
     * has been destroyed (broken pipe, reset, etc.).  These errors mean the
     * current client can no longer communicate and must be replaced.
     */
    public static isStreamDestroyedError(errorMessage: string): boolean {
        const lower = errorMessage.toLowerCase();
        return CopilotSDKService.STREAM_DESTROYED_PATTERNS.some(
            p => lower.includes(p.toLowerCase())
        );
    }

    /**
     * Discard the given client without waiting for a graceful stop.
     * Called when the underlying stream is known to be broken.
     */
    private invalidateClient(client: ICopilotClient): void {
        client.stop().catch(() => {});
    }

    /**
     * Create a new SDK client with the specified working directory.
     * Each session gets its own client (child process) for full isolation.
     *
     * @param cwd Optional working directory for the client
     * @throws Error if SDK is not available or initialization fails
     */
    public async createClient(cwd?: string): Promise<ICopilotClient> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        await this.ensureSDKModule();

        if (!this.sdkModule) {
            throw new Error('Failed to load Copilot SDK module');
        }

        const aiLog = getAIServiceLogger();

        const options: ICopilotClientOptions = {};
        if (cwd) {
            if (!fs.existsSync(cwd)) {
                aiLog.warn({ cwd },
                    'Working directory does not exist. ' +
                    'The SDK will fail with ERR_STREAM_DESTROYED because child_process.spawn ' +
                    'requires an existing cwd. Ensure the caller passes a valid directory.');
            }
            options.cwd = cwd;
            try {
                ensureFolderTrusted(cwd);
            } catch {
                // Non-fatal: trust dialog will appear if this fails
            }
        }

        aiLog.debug({ clientOptions: options }, 'Creating new CopilotClient');
        const client = new this.sdkModule.CopilotClient(options);
        return client;
    }

    /**
     * Send a message to Copilot via the SDK.
     * Creates a new session for each request (session-per-request pattern).
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    public async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const aiLog = getAIServiceLogger();
        const startTime = Date.now();

        // Check availability first
        const availability = await this.isAvailable();
        if (!availability.available) {
            return {
                success: false,
                error: availability.error || 'Copilot SDK is not available'
            };
        }

        let session: ICopilotSession | null = null;
        let client: ICopilotClient | null = null;
        let result: SDKInvocationResult | null = null;

        try {
            // Create a fresh client for this session (per-session isolation)
            client = await this.createClient(options.workingDirectory);

            // Build session options
            const sessionOptions: ISessionOptions = {};
            if (options.model) {
                sessionOptions.model = options.model;
            }
            if (options.streaming) {
                sessionOptions.streaming = options.streaming;
            }
            if (options.tools) {
                sessionOptions.tools = options.tools;
            }
            if (options.systemMessage) {
                sessionOptions.systemMessage = options.systemMessage;
            }

            // MCP control options (tool filtering)
            if (options.availableTools) {
                sessionOptions.availableTools = options.availableTools;
            }
            if (options.excludedTools) {
                sessionOptions.excludedTools = options.excludedTools;
            }

            // Skill directories and disabled skills
            if (options.skillDirectories && options.skillDirectories.length > 0) {
                sessionOptions.skillDirectories = options.skillDirectories;
            }
            if (options.disabledSkills && options.disabledSkills.length > 0) {
                sessionOptions.disabledSkills = options.disabledSkills;
            }

            // Load and merge MCP server configurations
            // Default is to load from ~/.copilot/mcp-config.json unless explicitly disabled
            const shouldLoadDefaultMcp = options.loadDefaultMcpConfig !== false;
            if (shouldLoadDefaultMcp || options.mcpServers !== undefined) {
                let finalMcpServers: Record<string, MCPServerConfig> | undefined;

                if (shouldLoadDefaultMcp) {
                    // Load default config from ~/.copilot/mcp-config.json
                    const defaultConfig = loadDefaultMcpConfig();
                    aiLog.debug({ success: defaultConfig.success, fileExists: defaultConfig.fileExists, serverCount: Object.keys(defaultConfig.mcpServers).length }, 'Default MCP config loaded');
                    if (defaultConfig.error) {
                        aiLog.debug({ error: defaultConfig.error }, 'Default MCP config error');
                    }
                    if (defaultConfig.success && Object.keys(defaultConfig.mcpServers).length > 0) {
                        aiLog.debug({ serverCount: Object.keys(defaultConfig.mcpServers).length }, 'Default MCP servers loaded');
                    }
                    // Merge with explicit config (explicit takes precedence)
                    finalMcpServers = mergeMcpConfigs(defaultConfig.mcpServers, options.mcpServers);
                } else if (options.mcpServers !== undefined) {
                    // Only use explicit config
                    finalMcpServers = options.mcpServers;
                }

                if (finalMcpServers && Object.keys(finalMcpServers).length > 0) {
                    sessionOptions.mcpServers = finalMcpServers;
                    aiLog.debug({ serverCount: Object.keys(finalMcpServers).length, serverNames: Object.keys(finalMcpServers) }, 'Using MCP servers');
                } else if (options.mcpServers !== undefined && Object.keys(options.mcpServers).length === 0) {
                    // Explicit empty object means disable all MCP servers
                    sessionOptions.mcpServers = {};
                    aiLog.debug('MCP servers explicitly disabled');
                }
            }

            // Shared tool calls map — bridged between permission handler and sendWithStreaming
            const toolCallsMap = new Map<string, ToolCall>();

            // Permission handler — wrap with logging to track permission requests.
            // The SDK requires onPermissionRequest; default to denyAll when none is provided.
            const effectiveHandler = options.onPermissionRequest || denyAllPermissions;
            sessionOptions.onPermissionRequest = (request, invocation) => {
                const sessionLog = createSessionLogger(invocation.sessionId);
                sessionLog.debug({ kind: request.kind, toolCallId: request.toolCallId || undefined, resource: (request as any).resource, operation: (request as any).operation }, 'Permission request');
                const capturePermission = (permResult: PermissionRequestResult) => {
                    if (request.toolCallId) {
                        const tc = toolCallsMap.get(request.toolCallId);
                        if (tc) {
                            tc.permissionRequest = {
                                kind: request.kind,
                                timestamp: new Date(),
                                resource: (request as any).resource,
                                operation: (request as any).operation,
                            };
                            tc.permissionResult = {
                                approved: permResult.kind === 'approved',
                                timestamp: new Date(),
                                reason: permResult.kind !== 'approved' ? permResult.kind : undefined,
                            };
                        }
                    }
                };
                const result = effectiveHandler(request, invocation);
                // Handle both sync and async permission handlers
                if (result && typeof (result as Promise<PermissionRequestResult>).then === 'function') {
                    return (result as Promise<PermissionRequestResult>).then(r => {
                        createSessionLogger(invocation.sessionId).debug({ kind: r.kind, requestKind: request.kind }, 'Permission result');
                        capturePermission(r);
                        return r;
                    });
                }
                createSessionLogger(invocation.sessionId).debug({ kind: (result as PermissionRequestResult).kind, requestKind: request.kind }, 'Permission result');
                capturePermission(result as PermissionRequestResult);
                return result;
            };

            const sessionOptionsStr = Object.keys(sessionOptions).length > 0 
                ? JSON.stringify(sessionOptions) 
                : '(default)';

            // Resume an existing SDK session or create a new one
            if (options.sessionId && client.resumeSession) {
                aiLog.debug({ cwd: options.workingDirectory, sessionId: options.sessionId, sessionOptionsStr }, 'Resuming session');
                try {
                    session = await client.resumeSession(options.sessionId, sessionOptions);
                    aiLog.debug({ sessionId: session.sessionId }, 'Session resumed');
                } catch (resumeError) {
                    const resumeMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
                    aiLog.warn({ sessionId: options.sessionId, error: resumeMsg }, 'Session resume failed — falling back to createSession');
                    session = await client.createSession(sessionOptions);
                    aiLog.debug({ sessionId: session.sessionId }, 'Fallback session created');
                }
            } else {
                aiLog.debug({ cwd: options.workingDirectory, sessionOptionsStr }, 'Creating session');
                session = await client.createSession(sessionOptions);
                aiLog.debug({ sessionId: session.sessionId }, 'Session created');
            }

            const sessionLog = createSessionLogger(session.sessionId);
            options.onSessionCreated?.(session.sessionId);

            // Set agent mode if specified
            if (options.mode && session.rpc?.mode) {
                await session.rpc.mode.set({ mode: options.mode });
                sessionLog.debug({ mode: options.mode }, 'Mode set');
            }

            // Track the session for potential cancellation
            this.trackSession(session);

            // Send the message with timeout
            const timeoutMs = options.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS;

            // Use streaming mode if enabled and supported, OR if timeout > 120s,
            // OR if an onStreamingChunk callback is provided
            // (SDK's sendAndWait has hardcoded 120s timeout for session.idle)
            let response: string;
            let tokenUsage: TokenUsage | undefined;
            let turnCount = 0;
            let capturedToolCalls: ToolCall[] | undefined;
            if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
                const idleTimeoutMs = options.idleTimeoutMs ?? CopilotSDKService.DEFAULT_IDLE_TIMEOUT_MS;
                const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs, options.attachments);
                response = streamingResult.response;
                tokenUsage = streamingResult.tokenUsage;
                turnCount = streamingResult.turnCount;
                capturedToolCalls = streamingResult.toolCalls;
            } else {
                const result = await this.sendWithTimeout(session, options.prompt, timeoutMs, options.attachments);
                response = result?.data?.content || '';
            }

            const durationMs = Date.now() - startTime;

            sessionLog.debug({ durationMs }, 'Request completed');

            if (!response) {
                // For tool-heavy sessions (e.g., impl skill), the AI may complete
                // all work via tool execution (file edits, shell commands) without
                // producing a text summary. If turns occurred, the work was done
                // successfully — treat empty text as success, not failure.
                if (turnCount > 0) {
                    sessionLog.debug({ durationMs, turnCount }, 'Empty text response — treating as success (tool-based execution)');
                    result = {
                        success: true,
                        response: '',
                        sessionId: session.sessionId,
                        tokenUsage,
                        toolCalls: capturedToolCalls,
                    };
                    return result;
                }
                result = {
                    success: false,
                    error: 'No response received from Copilot SDK',
                    sessionId: session.sessionId,
                    tokenUsage,
                    toolCalls: capturedToolCalls,
                };
                return result;
            }

            result = {
                success: true,
                response,
                sessionId: session.sessionId,
                tokenUsage,
                toolCalls: capturedToolCalls,
            };
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            if (session) {
                createSessionLogger(session.sessionId).error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed');
            } else {
                aiLog.error({ durationMs, err: error instanceof Error ? error : undefined }, 'Request failed (no session)');
            }

            // When the underlying JSON-RPC stream is destroyed, the client is
            // no longer usable. Invalidate it so it doesn't leak.
            if (CopilotSDKService.isStreamDestroyedError(errorMessage) && client) {
                aiLog.debug('Stream destroyed — invalidating client');
                this.invalidateClient(client);
                client = null; // prevent double-stop in finally
            }

            result = {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`,
                sessionId: session?.sessionId
            };
            return result;

        } finally {
            // Clean up session
            if (session) {
                this.untrackSession(session.sessionId);
                const finalSessionLog = createSessionLogger(session.sessionId);
                try {
                    await session.destroy();
                    finalSessionLog.debug('Session destroyed');
                } catch (destroyError) {
                    finalSessionLog.debug({ err: destroyError }, 'Warning: Error destroying session');
                }
                // Stop the per-session client
                if (client) {
                    try {
                        await client.stop();
                    } catch {
                        // ignore — client may already be dead
                    }
                }
            } else if (client) {
                // Session was never created but client was — clean up client
                try {
                    await client.stop();
                } catch {
                    // ignore
                }
            }
        }
    }

    /**
     * Abort an active session by its ID.
     * This destroys the session and removes it from tracking.
     * Used for cancellation support in the AI Processes panel.
     *
     * @param sessionId The session ID to abort
     * @returns True if the session was found and aborted, false otherwise
     */
    public async abortSession(sessionId: string): Promise<boolean> {
        const sessionLog = createSessionLogger(sessionId);
        
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            sessionLog.debug('Session not found for abort');
            return false;
        }

        sessionLog.debug('Aborting session');

        try {
            await session.destroy();
            this.activeSessions.delete(sessionId);
            sessionLog.debug('Session aborted successfully');
            return true;
        } catch (error) {
            sessionLog.error({ err: error instanceof Error ? error : undefined }, 'Error aborting session');
            // Still remove from tracking even if destroy failed
            this.activeSessions.delete(sessionId);
            return false;
        }
    }

    /**
     * Check if a session is currently active.
     *
     * @param sessionId The session ID to check
     * @returns True if the session is active
     */
    public hasActiveSession(sessionId: string): boolean {
        return this.activeSessions.has(sessionId);
    }

    /**
     * Get the count of currently active sessions.
     *
     * @returns Number of active sessions
     */
    public getActiveSessionCount(): number {
        return this.activeSessions.size;
    }

    /**
     * Track an active session for potential cancellation.
     * Called internally when a session is created.
     *
     * @param session The session to track
     */
    private trackSession(session: ICopilotSession): void {
        this.activeSessions.set(session.sessionId, session);
    }

    /**
     * Untrack a session (called when session is destroyed normally).
     *
     * @param sessionId The session ID to untrack
     */
    private untrackSession(sessionId: string): void {
        this.activeSessions.delete(sessionId);
    }

    /**
     * Check whether an error indicates a disposed/closed JSON-RPC connection.
     */
    private static isConnectionDisposedError(error: unknown): boolean {
        if (error instanceof Error) {
            const msg = error.message;
            if (CopilotSDKService.CONNECTION_DISPOSED_PATTERNS.some(p => msg.includes(p))) {
                return true;
            }
            if ('code' in error && (error as any).code === 2) {
                return true;
            }
        }
        return false;
    }

    /**
     * Clean up resources. Should be called when the extension deactivates.
     */
    public async cleanup(): Promise<void> {
        const aiLog = getAIServiceLogger();
        aiLog.debug('Cleaning up SDK service');

        // Abort all active sessions first
        const abortPromises: Promise<void>[] = [];
        for (const [sessionId] of this.activeSessions) {
            abortPromises.push(this.abortSession(sessionId).then(() => {}));
        }
        await Promise.allSettled(abortPromises);
        this.activeSessions.clear();

        this.removeStreamErrorGuard();
        this.sdkModule = null;
        this.availabilityCache = null;
    }

    /**
     * Sends a one-shot prompt and returns a parsed value of type T.
     * Uses `gpt-4.1` by default. Throws on AI unavailability or parse failure.
     *
     * @param prompt  The instruction sent to the model.
     * @param parse   Map the raw AI response string to T. Defaults to identity cast.
     * @param options Override model, timeout, or working directory.
     */
    public async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T> {
        const aiLog = getAIServiceLogger();
        try {
            const result = await this.sendMessage({
                prompt,
                model: options?.model ?? 'gpt-4.1',
                timeoutMs: options?.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS,
                workingDirectory: options?.cwd,
            });

            if (!result.success) {
                throw new Error(result.error || 'AI transform failed');
            }

            const raw = result.response ?? '';
            return parse ? parse(raw) : raw as unknown as T;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            aiLog.error({ err: error instanceof Error ? error : undefined }, `transform: ${msg}`);
            throw error instanceof Error ? error : new Error(msg);
        }
    }

    /**
     * Dispose of the service and release all resources.
     */
    public dispose(): void {
        this.disposed = true;
        // Fire and forget cleanup
        this.cleanup().catch(() => {
            // Ignore cleanup errors during dispose
        });
    }

    /**
     * Find the SDK package path by checking multiple possible locations.
     * This handles both development and packaged extension scenarios.
     */
    private findSDKPath(): string | undefined {
        const possiblePaths = [
            // Development: running from dist/
            path.join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk'),
            // Development: running from out/shortcuts/ai-service
            path.join(__dirname, '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
            // Packaged extension
            path.join(__dirname, 'node_modules', '@github', 'copilot-sdk'),
            // Workspace root (for development)
            path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
        ];

        for (const testPath of possiblePaths) {
            const indexPath = path.join(testPath, 'dist', 'index.js');
            if (fs.existsSync(indexPath)) {
                return testPath;
            }
        }

        return undefined;
    }

    /**
     * Load the SDK module using ESM dynamic import workaround.
     * This is necessary because webpack transforms import() in ways that break ESM loading.
     */
    private async loadSDKModule(sdkPath: string): Promise<void> {
        if (this.sdkModule) {
            return;
        }

        const sdkIndexPath = path.join(sdkPath, 'dist', 'index.js');

        // Import using file URL for ESM compatibility
        // Use Function constructor to bypass webpack's import() transformation
        const { pathToFileURL } = await import('url');
        const sdkUrl = pathToFileURL(sdkIndexPath).href;

        // Bypass webpack's import transformation using Function constructor
        // This is necessary because webpack transforms import() in ways that break ESM loading
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        const sdk = await dynamicImport(sdkUrl);

        if (!sdk.CopilotClient) {
            throw new Error('CopilotClient not found in SDK module');
        }

        this.sdkModule = sdk;
    }

    /**
     * Ensure the SDK module is loaded (lazy initialization).
     * Does NOT create a client — clients are created per-session by createClient().
     */
    private async ensureSDKModule(): Promise<void> {
        if (this.sdkModule) {
            return;
        }

        const sdkPath = this.findSDKPath();
        if (!sdkPath) {
            throw new Error('Copilot SDK not found');
        }

        await this.loadSDKModule(sdkPath);

        if (!this.sdkModule) {
            throw new Error('SDK module not loaded');
        }

        // Install the stream error guard once when SDK is first loaded
        this.installStreamErrorGuard();
    }

    /**
     * Initialize the SDK client with optional working directory.
     * @deprecated Use createClient() instead. Kept for test compatibility.
     * @param cwd Optional working directory for the CLI process
     */
    private async initializeClient(cwd?: string): Promise<void> {
        await this.ensureSDKModule();
    }

    // ------------------------------------------------------------------
    // Stream-error safety net
    // ------------------------------------------------------------------

    /** Active `uncaughtException` handler that absorbs stream-destroyed errors. */
    private streamErrorGuardHandler: ((err: Error) => void) | null = null;

    /**
     * Install a process-level `uncaughtException` handler that absorbs
     * `ERR_STREAM_DESTROYED` errors originating from the SDK's stdio layer.
     *
     * The Copilot SDK's `connectViaStdio()` installs an `error` listener on
     * the child process's stdin that **re-throws** if `forceStopping` is false.
     * When the CLI process exits unexpectedly, any subsequent JSON-RPC write
     * triggers this re-throw, which surfaces as an uncaught exception that
     * crashes the host process.
     *
     * This handler catches exactly that class of errors so the normal
     * error-return path in `sendMessage` can surface them gracefully.
     */
    private installStreamErrorGuard(): void {
        this.removeStreamErrorGuard();

        const aiLog = getAIServiceLogger();
        this.streamErrorGuardHandler = (err: Error) => {
            if (CopilotSDKService.isStreamDestroyedError(err.message || String(err))) {
                aiLog.debug({ errMessage: err.message }, 'Absorbed uncaught stream error');
                return; // Swallow — per-session error path already handles this
            }
            // Not ours — re-throw so the default handler picks it up
            throw err;
        };
        process.on('uncaughtException', this.streamErrorGuardHandler);
    }

    /**
     * Remove the stream-error guard.
     */
    private removeStreamErrorGuard(): void {
        if (this.streamErrorGuardHandler) {
            process.removeListener('uncaughtException', this.streamErrorGuardHandler);
            this.streamErrorGuardHandler = null;
        }
    }

    /**
     * Send a message with timeout support (non-streaming).
     * WARNING: SDK's sendAndWait has a hardcoded 120-second timeout for session.idle event.
     * For longer timeouts, use sendWithStreaming instead (automatically done for timeoutMs > 120s).
     */
    private async sendWithTimeout(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number,
        attachments?: Attachment[]
    ): Promise<{ data?: { content?: string } }> {
        // Pass timeout directly to SDK's sendAndWait method
        // Note: SDK internally limits this to 120 seconds for the session.idle event
        return session.sendAndWait({ prompt, attachments }, timeoutMs);
    }

    /**
     * Send a message with streaming support.
     * Accumulates deltaContent chunks until a completion event fires.
     * 
     * The Copilot SDK fires events with `event.type` as a plain string:
     * - "assistant.message_delta" with `data.deltaContent` for streaming chunks
     * - "assistant.message" with `data.content` for the final message
     * - "assistant.turn_end" with `data.turnId` when the turn is complete
     * - "session.idle" with empty data when the session finishes processing
     * - "session.error" with `data.message` for errors
     * 
     * Completion is detected by:
     * 1. `session.idle` — the most explicit signal that the session is done
     * 2. `assistant.turn_end` — indicates the assistant's turn ended; used as a
     *    fallback completion signal because some SDK versions may not fire
     *    `session.idle` reliably or may delay it significantly.
     * 
     * When `assistant.turn_end` fires and we already have content (from deltas
     * or a final message), we schedule a short grace period to allow a
     * `session.idle` or `assistant.message` event to arrive. If nothing else
     * arrives within the grace period, we settle with the content we have.
     */
    private async sendWithStreaming(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number,
        onStreamingChunk?: (chunk: string) => void,
        toolCallsMap?: Map<string, ToolCall>,
        onToolEvent?: (event: ToolEvent) => void,
        idleTimeoutMs?: number,
        attachments?: Attachment[]
    ): Promise<StreamingResult> {
        return new Promise((resolve, reject) => {
            const sessionLog = createSessionLogger(session.sessionId);
            const streamingStartTime = Date.now();
            let response = '';
            // Accumulate ALL assistant.message content across turns.
            // With multi-turn MCP tool usage, the AI may produce multiple messages
            // (e.g., "Let me read the files..." on turn 1, then the actual JSON on turn 2+).
            // We keep ALL messages so we don't lose the final output.
            let allMessages: string[] = [];
            let settled = false;
            let turnEndGraceTimer: ReturnType<typeof setTimeout> | null = null;
            let turnCount = 0;
            // Track active tool executions for debugging stuck sessions
            const activeToolCalls = new Map<string, { toolName: string; startTime: number }>();
            // Build ToolCall objects for captured tool events (shared with permission handler via parameter)
            if (!toolCallsMap) {
                toolCallsMap = new Map<string, ToolCall>();
            }

            // Token usage accumulator
            let usageInputTokens = 0;
            let usageOutputTokens = 0;
            let usageCacheReadTokens = 0;
            let usageCacheWriteTokens = 0;
            let usageCost: number | undefined;
            let usageDuration: number | undefined;
            let usageTurnCount = 0;
            let usageTokenLimit: number | undefined;
            let usageCurrentTokens: number | undefined;

            const cleanup = () => {
                if (unsubscribe) {
                    unsubscribe();
                }
                clearTimeout(timeoutId);
                if (idleTimerId !== undefined) {
                    clearTimeout(idleTimerId);
                }
                if (turnEndGraceTimer) {
                    clearTimeout(turnEndGraceTimer);
                    turnEndGraceTimer = null;
                }
            };

            const settle = (resolver: (value: StreamingResult) => void, value: StreamingResult) => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    resolver(value);
                }
            };

            const settleError = (error: Error) => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    reject(error);
                }
            };

            const buildTokenUsage = (): TokenUsage | undefined => {
                if (usageTurnCount === 0) {
                    return undefined;
                }
                return {
                    inputTokens: usageInputTokens,
                    outputTokens: usageOutputTokens,
                    cacheReadTokens: usageCacheReadTokens,
                    cacheWriteTokens: usageCacheWriteTokens,
                    totalTokens: usageInputTokens + usageOutputTokens,
                    cost: usageCost,
                    duration: usageDuration,
                    turnCount: usageTurnCount,
                    tokenLimit: usageTokenLimit,
                    currentTokens: usageCurrentTokens,
                };
            };

            const settleWithResult = () => {
                // Join ALL non-empty messages across turns to preserve the full
                // conversation narrative. For tool-heavy sessions (e.g., impl skill),
                // intermediate messages like "I'll read the files...", "Making changes
                // to X...", "All tests pass" provide valuable context for the final
                // report. Fall back to accumulated delta response if no messages exist.
                const joinedMessages = allMessages.length > 0
                    ? allMessages.filter(m => m.trim()).join('\n\n')
                    : '';
                const result = joinedMessages || response;
                const elapsedMs = Date.now() - streamingStartTime;
                sessionLog.info({ totalChars: result.length, turns: turnCount, messages: allMessages.length, elapsedMs }, 'Streaming completed');
                if (activeToolCalls.size > 0) {
                    const staleTools = [...activeToolCalls.entries()].map(([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`);
                    sessionLog.debug({ activeToolCount: activeToolCalls.size, staleTools }, 'WARNING: tool call(s) still active at settle');
                }
                const capturedToolCalls = toolCallsMap!.size > 0 ? Array.from(toolCallsMap!.values()) : undefined;
                settle(resolve, { response: result, tokenUsage: buildTokenUsage(), turnCount, toolCalls: capturedToolCalls });
            };

            const timeoutId = setTimeout(() => {
                if (activeToolCalls.size > 0) {
                    const staleTools = [...activeToolCalls.entries()].map(([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`);
                    sessionLog.error({ activeToolCount: activeToolCalls.size, activeTools: staleTools }, 'Timeout with active tool call(s)');
                }
                sessionLog.error({ elapsedMs: timeoutMs, activeTools: [...activeToolCalls.keys()] }, 'Force-destroying session due to timeout');
                session.destroy().catch(() => {});
                settleError(new Error(`Request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Idle timeout: resets on each streaming chunk/message event.
            // If no activity arrives within the idle window, force-destroy.
            const effectiveIdleMs = idleTimeoutMs ?? 0;
            let idleTimerId: ReturnType<typeof setTimeout> | undefined;

            const resetIdleTimer = () => {
                if (effectiveIdleMs <= 0) { return; }
                if (idleTimerId !== undefined) { clearTimeout(idleTimerId); }
                idleTimerId = setTimeout(() => {
                    sessionLog.error({ elapsedMs: effectiveIdleMs }, 'Force-destroying session due to idle timeout');
                    session.destroy().catch(() => {});
                    settleError(new Error(`Request idle-timed out after ${effectiveIdleMs}ms with no activity`));
                }, effectiveIdleMs);
            };

            // Start the idle timer
            resetIdleTimer();

            // Set up event handler for streaming
            // SDK's session.on() returns an unsubscribe function
            const unsubscribe = session.on!((event: ISessionEvent) => {
                const eventType = event.type;

                if (eventType === 'assistant.message_delta') {
                    // Accumulate streaming chunks
                    const delta = event.data?.deltaContent || '';
                    response += delta;
                    // Reset idle timer — we received content activity
                    if (delta) { resetIdleTimer(); }
                    // Invoke the streaming callback if provided
                    if (onStreamingChunk && delta) {
                        try {
                            onStreamingChunk(delta);
                        } catch (cbError) {
                            sessionLog.debug({ err: cbError }, 'onStreamingChunk callback error');
                        }
                    }
                } else if (eventType === 'assistant.message') {
                    // Accumulate messages across turns.
                    // Each turn may produce an assistant.message event.
                    // With MCP tools, the first message(s) may be tool-use intent
                    // while the final message contains the actual output.
                    const messageContent = event.data?.content || '';
                    if (messageContent) {
                        allMessages.push(messageContent);
                    }
                    sessionLog.debug({ messageNum: allMessages.length, chars: messageContent.length }, 'Received message');
                    // Log tool requests if present — shows which tools the AI wants to invoke
                    if (event.data?.toolRequests?.length) {
                        const toolNames = event.data.toolRequests.map(t => t.name);
                        sessionLog.debug({ toolRequestCount: event.data.toolRequests.length, toolNames }, 'Message includes tool requests');
                    }
                    // If no delta chunks were received but we have a streaming callback,
                    // emit the message as a single chunk so SSE consumers get content
                    if (onStreamingChunk && messageContent && !response) {
                        // Reset idle timer — content activity via fallback path
                        resetIdleTimer();
                        try {
                            onStreamingChunk(messageContent);
                        } catch (cbError) {
                            sessionLog.debug({ err: cbError }, 'onStreamingChunk callback error');
                        }
                    }
                } else if (eventType === 'assistant.turn_start') {
                    // A new turn is starting — cancel any pending turn_end grace timer.
                    // This is critical for multi-turn MCP tool conversations:
                    // after the AI uses tools, the SDK fires turn_end then immediately
                    // starts a new turn (turn_start) to process tool results. If we
                    // don't cancel the grace timer, we'd settle with just the intent
                    // message from the first turn instead of waiting for the full response.
                    const elapsedMs = Date.now() - streamingStartTime;
                    sessionLog.debug({ elapsedMs, activeToolCalls: activeToolCalls.size }, 'Turn starting');
                    if (turnEndGraceTimer) {
                        clearTimeout(turnEndGraceTimer);
                        turnEndGraceTimer = null;
                        sessionLog.debug('Cancelled turn_end grace timer — new turn starting');
                    }
                } else if (eventType === 'assistant.turn_end') {
                    // Turn ended — the assistant finished its current turn.
                    // In multi-turn conversations (MCP tool usage), there can be many turns:
                    //   Turn 1: AI expresses intent + tool calls → turn_end → tool execution → turn_start
                    //   Turn 2: AI processes tool results + more tool calls → turn_end → tool execution → turn_start
                    //   ...
                    //   Turn N: AI produces final output → turn_end → session.idle
                    //
                    // We prefer settling on session.idle which signals the entire conversation
                    // is done. The turn_end grace period is only a safety net for sessions
                    // that don't fire session.idle.
                    turnCount++;
                    sessionLog.debug({ turn: turnCount, messages: allMessages.length }, 'Turn ended');

                    // Start a grace timer. If a new turn starts (turn_start), this timer
                    // will be cancelled. If nothing else happens, we settle after the grace period.
                    if (!settled && !turnEndGraceTimer) {
                        turnEndGraceTimer = setTimeout(() => {
                            turnEndGraceTimer = null;
                            if (!settled && (allMessages.length > 0 || response)) {
                                sessionLog.debug({ turn: turnCount }, 'Settling after turn_end grace period');
                                settleWithResult();
                            }
                        }, 2000); // 2 second grace period to allow tool execution + new turn
                    }
                } else if (eventType === 'session.idle') {
                    // Session finished processing — settle immediately
                    sessionLog.debug({ turns: turnCount }, 'Session idle');
                    settleWithResult();
                } else if (eventType === 'session.error') {
                    // Session error
                    const errorMessage = event.data?.message || 'Unknown session error';
                    sessionLog.error({ errorMessage }, 'Session error');
                    settleError(new Error(`Copilot session error: ${errorMessage}`));
                } else if (eventType === 'assistant.usage') {
                    // Per-turn token usage — accumulate across turns
                    usageTurnCount++;
                    usageInputTokens += event.data?.inputTokens ?? 0;
                    usageOutputTokens += event.data?.outputTokens ?? 0;
                    usageCacheReadTokens += event.data?.cacheReadTokens ?? 0;
                    usageCacheWriteTokens += event.data?.cacheWriteTokens ?? 0;
                    if (event.data?.cost != null) {
                        usageCost = (usageCost ?? 0) + event.data.cost;
                    }
                    if (event.data?.duration != null) {
                        usageDuration = (usageDuration ?? 0) + event.data.duration;
                    }
                    sessionLog.debug({ turn: usageTurnCount, inputTokens: event.data?.inputTokens ?? 0, outputTokens: event.data?.outputTokens ?? 0 }, 'Token usage');
                } else if (eventType === 'session.usage_info') {
                    // Session-level quota info — store last-seen values
                    if (event.data?.tokenLimit != null) {
                        usageTokenLimit = event.data.tokenLimit;
                    }
                    if (event.data?.currentTokens != null) {
                        usageCurrentTokens = event.data.currentTokens;
                    }
                    sessionLog.debug({ tokenLimit: usageTokenLimit, currentTokens: usageCurrentTokens }, 'Session usage info');
                } else if (eventType === 'tool.execution_start') {
                    // Tool execution is starting — track it for debugging stuck sessions
                    // Reset idle timer — tool execution is legitimate activity
                    resetIdleTimer();
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const toolName = event.data?.toolName || '(unknown)';
                    const parentToolCallId = event.data?.parentToolCallId;
                    activeToolCalls.set(toolCallId, { toolName, startTime: Date.now() });
                    const truncatedArgs = event.data?.arguments
                        ? JSON.stringify(event.data.arguments).substring(0, 200)
                        : undefined;
                    sessionLog.debug({ toolName, toolCallId, args: truncatedArgs }, 'Tool execution started');
                    // Build a ToolCall object for downstream consumption
                    const toolCall: ToolCall = {
                        id: toolCallId !== '(unknown)' ? toolCallId : `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: toolName !== '(unknown)' ? toolName : 'unknown',
                        status: 'running',
                        startTime: new Date(),
                        args: (event.data?.arguments ?? {}) as Record<string, unknown>,
                        ...(parentToolCallId ? { parentToolCallId } : {}),
                    };
                    toolCallsMap!.set(toolCall.id, toolCall);
                    // Emit tool-start event for real-time UI updates
                    if (onToolEvent) {
                        try {
                            onToolEvent({
                                type: 'tool-start',
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                parentToolCallId: toolCall.parentToolCallId,
                                parameters: toolCall.args,
                            });
                        } catch { /* non-fatal */ }
                    }
                } else if (eventType === 'tool.execution_complete') {
                    // Tool execution finished — remove from active tracking
                    // Reset idle timer — tool completion is legitimate activity
                    resetIdleTimer();
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const tracked = activeToolCalls.get(toolCallId);
                    const durationMs = tracked ? Date.now() - tracked.startTime : undefined;
                    activeToolCalls.delete(toolCallId);
                    const toolSuccess = event.data?.success;
                    if (toolSuccess) {
                        const resultChars = event.data?.result?.content?.length ?? 0;
                        sessionLog.debug({ toolName: tracked?.toolName, toolCallId, durationMs, resultChars, success: true }, 'Tool execution completed');
                    } else {
                        const errorMsg = event.data?.error?.message || '(no error message)';
                        sessionLog.debug({ toolName: tracked?.toolName, toolCallId, durationMs, success: false, errorMsg }, 'Tool execution failed');
                    }
                    // Update the captured ToolCall object
                    const capturedTool = toolCallsMap!.get(toolCallId);
                    let resultContent = event.data?.result?.content;
                    if (capturedTool) {
                        capturedTool.status = toolSuccess ? 'completed' : 'failed';
                        capturedTool.endTime = new Date();
                        if (toolSuccess) {
                            // If the view tool completed on an image file, replace
                            // the plain-text result with a base64 data URL so the
                            // dashboard can render it inline.
                            if (tracked?.toolName === 'view') {
                                const filePath = capturedTool.args?.path as string | undefined;
                                if (filePath) {
                                    const dataUrl = tryConvertImageFileToDataUrl(filePath);
                                    if (dataUrl) {
                                        resultContent = dataUrl;
                                    }
                                }
                            }
                            capturedTool.result = resultContent;
                        } else {
                            capturedTool.error = event.data?.error?.message || 'Unknown error';
                        }
                    } else {
                        // Orphaned complete event — tool started outside observation window
                        toolCallsMap!.set(toolCallId, {
                            id: toolCallId,
                            name: tracked?.toolName || 'unknown',
                            status: 'failed',
                            startTime: new Date(tracked?.startTime ?? Date.now()),
                            endTime: new Date(),
                            args: {},
                            ...(event.data?.parentToolCallId ? { parentToolCallId: event.data.parentToolCallId } : {}),
                            error: 'Started outside observation window',
                        });
                    }
                    // Emit tool-complete or tool-failed event for real-time UI updates
                    // Prefer event-data parentToolCallId (freshest from SDK) over captured-start value
                    const completeParentId = event.data?.parentToolCallId || capturedTool?.parentToolCallId;
                    if (onToolEvent) {
                        try {
                            if (toolSuccess) {
                                onToolEvent({
                                    type: 'tool-complete',
                                    toolCallId,
                                    toolName: tracked?.toolName,
                                    parentToolCallId: completeParentId,
                                    result: resultContent,
                                });
                            } else {
                                onToolEvent({
                                    type: 'tool-failed',
                                    toolCallId,
                                    toolName: tracked?.toolName,
                                    parentToolCallId: completeParentId,
                                    error: event.data?.error?.message || 'Unknown error',
                                });
                            }
                        } catch { /* non-fatal */ }
                    }
                } else if (eventType === 'tool.execution_progress') {
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const tracked = activeToolCalls.get(toolCallId);
                    sessionLog.debug({ toolName: tracked?.toolName, toolCallId, progressMessage: event.data?.progressMessage }, 'Tool progress');
                    // Capture progress message in the ToolCall object (latest wins)
                    const capturedProgress = toolCallsMap!.get(toolCallId);
                    if (capturedProgress && event.data?.progressMessage) {
                        (capturedProgress as any).progressMessage = event.data.progressMessage;
                    }
                } else if (eventType === 'assistant.intent') {
                    sessionLog.debug({ intent: event.data?.intent }, 'Assistant intent');
                } else if (eventType === 'session.info') {
                    sessionLog.debug({ infoType: event.data?.infoType, message: event.data?.message }, 'Session info');
                } else if (eventType === 'abort') {
                    sessionLog.debug({ reason: event.data?.reason }, 'Session aborted');
                }
            });

            // Send the message (without waiting)
            session.send!({ prompt, attachments }).catch(error => {
                settleError(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the singleton CopilotSDKService instance.
 * Convenience function for cleaner imports.
 */
export function getCopilotSDKService(): CopilotSDKService {
    return CopilotSDKService.getInstance();
}

/**
 * Reset the CopilotSDKService singleton (primarily for testing).
 */
export function resetCopilotSDKService(): void {
    CopilotSDKService.resetInstance();
}

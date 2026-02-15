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
import { getLogger, LogCategory } from '../logger';
// Note: SessionPool is kept for backward compatibility but not used for clarification requests
import { SessionPool, IPoolableSession, SessionPoolStats } from './session-pool';
import { loadDefaultMcpConfig, mergeMcpConfigs } from './mcp-config-loader';
import { ensureFolderTrusted } from './trusted-folder';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/timeouts';
import {
    MCPServerConfig,
    MCPControlOptions,
    SendMessageOptions,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    approveAllPermissions,
    denyAllPermissions,
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
    SessionPoolConfig,
    DEFAULT_SESSION_POOL_CONFIG,
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
    /** AI model to use (e.g., 'gpt-5', 'claude-sonnet-4.5') */
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
}

/**
 * Interface for the CopilotClient from @github/copilot-sdk
 * We define this interface to avoid direct type dependency on the SDK
 */
interface ICopilotClient {
    createSession(options?: ISessionOptions): Promise<ICopilotSession>;
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
    sendAndWait(options: { prompt: string }, timeout?: number): Promise<{ data?: { content?: string } }>;
    destroy(): Promise<void>;
    /** Event handler for streaming responses. Returns an unsubscribe function. */
    on?(handler: (event: ISessionEvent) => void): (() => void);
    /** Send a message without waiting (for streaming) */
    send?(options: { prompt: string }): Promise<void>;
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
export class CopilotSDKService {
    private static instance: CopilotSDKService | null = null;

    private client: ICopilotClient | null = null;
    private clientCwd: string | undefined = undefined;
    private sdkModule: { CopilotClient: new (options?: ICopilotClientOptions) => ICopilotClient } | null = null;
    private initializationPromise: Promise<void> | null = null;
    private availabilityCache: SDKAvailabilityResult | null = null;
    private sessionPool: SessionPool | null = null;
    private sessionPoolConfig: Required<SessionPoolConfig> = { ...DEFAULT_SESSION_POOL_CONFIG };
    private disposed = false;

    /** Map of active sessions for cancellation support */
    private activeSessions: Map<string, ICopilotSession> = new Map();

    /** Default timeout for SDK requests */
    private static readonly DEFAULT_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;

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
     * Configure the session pool settings.
     * Call this before using the session pool to override default values.
     * Typically called during extension activation with values from VS Code settings.
     *
     * @param config Session pool configuration
     */
    public configureSessionPool(config: SessionPoolConfig): void {
        this.sessionPoolConfig = {
            maxSessions: config.maxSessions ?? DEFAULT_SESSION_POOL_CONFIG.maxSessions,
            idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_SESSION_POOL_CONFIG.idleTimeoutMs
        };

        const logger = getLogger();
        logger.debug(
            LogCategory.AI,
            `CopilotSDKService: Session pool configured with maxSessions=${this.sessionPoolConfig.maxSessions}, idleTimeoutMs=${this.sessionPoolConfig.idleTimeoutMs}`
        );
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

        const logger = getLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Checking SDK availability');

        try {
            const sdkPath = this.findSDKPath();
            if (!sdkPath) {
                this.availabilityCache = {
                    available: false,
                    error: 'Copilot SDK not found. Please ensure @github/copilot-sdk is installed.'
                };
                logger.debug(LogCategory.AI, 'CopilotSDKService: SDK not found');
                return this.availabilityCache;
            }

            // Try to load the SDK module to verify it works
            await this.loadSDKModule(sdkPath);

            this.availabilityCache = {
                available: true,
                sdkPath
            };
            logger.debug(LogCategory.AI, `CopilotSDKService: SDK available at: ${sdkPath}`);
            return this.availabilityCache;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.availabilityCache = {
                available: false,
                error: `Failed to load Copilot SDK: ${errorMessage}`
            };
            logger.error(LogCategory.AI, 'CopilotSDKService: SDK availability check failed', error instanceof Error ? error : undefined);
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
     * Ensure the SDK client is initialized with the specified working directory.
     * If the working directory changes, a new client is created.
     * Uses lazy initialization to avoid startup overhead.
     *
     * @param cwd Optional working directory for the client
     * @throws Error if SDK is not available or initialization fails
     */
    public async ensureClient(cwd?: string): Promise<ICopilotClient> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        // Check if we can reuse the existing client (same cwd)
        if (this.client && this.clientCwd === cwd) {
            return this.client;
        }

        // If cwd changed, stop the old client first
        if (this.client && this.clientCwd !== cwd) {
            const logger = getLogger();
            logger.debug(LogCategory.AI, `CopilotSDKService: Working directory changed from '${this.clientCwd}' to '${cwd}', creating new client`);
            try {
                await this.client.stop();
            } catch (error) {
                logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error stopping old client: ${error}`);
            }
            this.client = null;
            this.clientCwd = undefined;
        }

        // Use a promise to prevent concurrent initialization
        if (this.initializationPromise) {
            await this.initializationPromise;
            if (this.client && this.clientCwd === cwd) {
                return this.client;
            }
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, `CopilotSDKService: Initializing SDK client with cwd: ${cwd || '(default)'}`);

        this.initializationPromise = this.initializeClient(cwd);
        await this.initializationPromise;
        this.initializationPromise = null;

        if (!this.client) {
            throw new Error('Failed to initialize Copilot SDK client');
        }

        return this.client;
    }

    /**
     * Send a message to Copilot via the SDK.
     * By default, creates a new session for each request (session-per-request pattern).
     * When usePool is true, uses the session pool for efficient parallel requests.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    public async sendMessage(options: SendMessageOptions): Promise<SDKInvocationResult> {
        if (options.usePool) {
            return this.sendMessageWithPool(options);
        }
        return this.sendMessageDirect(options);
    }

    /**
     * Send a message using a session from the pool.
     * This is more efficient for parallel workloads as sessions are reused.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    private async sendMessageWithPool(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const logger = getLogger();
        const startTime = Date.now();

        // Check availability first
        const availability = await this.isAvailable();
        if (!availability.available) {
            return {
                success: false,
                error: availability.error || 'Copilot SDK is not available'
            };
        }

        let session: IPoolableSession | null = null;
        let shouldDestroySession = false;

        try {
            const pool = await this.ensureSessionPool();
            const timeoutMs = options.timeoutMs ?? CopilotSDKService.DEFAULT_TIMEOUT_MS;

            logger.debug(LogCategory.AI, 'CopilotSDKService: Acquiring session from pool');
            session = await pool.acquire(timeoutMs);
            logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Acquired session from pool`);

            // Send the message with timeout
            const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);

            const response = result?.data?.content || '';
            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Pooled request completed in ${durationMs}ms`);

            if (!response) {
                return {
                    success: false,
                    error: 'No response received from Copilot SDK',
                    sessionId: session.sessionId
                };
            }

            return {
                success: true,
                response,
                sessionId: session.sessionId,
                rawResponse: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            logger.error(LogCategory.AI, `CopilotSDKService [${session?.sessionId ?? 'no-session'}]: Pooled request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

            // Mark session for destruction on error (don't reuse potentially broken sessions)
            shouldDestroySession = true;

            return {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`,
                sessionId: session?.sessionId
            };

        } finally {
            // Release or destroy session
            if (session && this.sessionPool) {
                if (shouldDestroySession) {
                    try {
                        await this.sessionPool.destroy(session);
                        logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Session destroyed after error`);
                    } catch (destroyError) {
                        logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Warning: Error destroying session: ${destroyError}`);
                    }
                } else {
                    this.sessionPool.release(session);
                    logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Session released back to pool`);
                }
            }
        }
    }

    /**
     * Send a message directly (creates client with cwd, creates session, destroys session).
     * This creates a fresh client with the specified working directory.
     *
     * @param options Message options including prompt and optional settings
     * @returns Invocation result with response or error
     */
    private async sendMessageDirect(options: SendMessageOptions): Promise<SDKInvocationResult> {
        const logger = getLogger();
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

        try {
            // Create/reuse client with the specified working directory
            const client = await this.ensureClient(options.workingDirectory);

            // Build session options
            const sessionOptions: ISessionOptions = {};
            if (options.model) {
                sessionOptions.model = options.model;
            }
            if (options.streaming) {
                sessionOptions.streaming = options.streaming;
            }

            // MCP control options (tool filtering)
            if (options.availableTools) {
                sessionOptions.availableTools = options.availableTools;
            }
            if (options.excludedTools) {
                sessionOptions.excludedTools = options.excludedTools;
            }

            // Load and merge MCP server configurations
            // Default is to load from ~/.copilot/mcp-config.json unless explicitly disabled
            const shouldLoadDefaultMcp = options.loadDefaultMcpConfig !== false;
            if (shouldLoadDefaultMcp || options.mcpServers !== undefined) {
                let finalMcpServers: Record<string, MCPServerConfig> | undefined;

                if (shouldLoadDefaultMcp) {
                    // Load default config from ~/.copilot/mcp-config.json
                    const defaultConfig = loadDefaultMcpConfig();
                    logger.debug(LogCategory.AI, `CopilotSDKService: Default MCP config load result: success=${defaultConfig.success}, fileExists=${defaultConfig.fileExists}, serverCount=${Object.keys(defaultConfig.mcpServers).length}`);
                    if (defaultConfig.error) {
                        logger.debug(LogCategory.AI, `CopilotSDKService: Default MCP config error: ${defaultConfig.error}`);
                    }
                    if (defaultConfig.success && Object.keys(defaultConfig.mcpServers).length > 0) {
                        logger.debug(LogCategory.AI, `CopilotSDKService: Loaded ${Object.keys(defaultConfig.mcpServers).length} default MCP server(s): ${JSON.stringify(defaultConfig.mcpServers)}`);
                    }
                    // Merge with explicit config (explicit takes precedence)
                    finalMcpServers = mergeMcpConfigs(defaultConfig.mcpServers, options.mcpServers);
                } else if (options.mcpServers !== undefined) {
                    // Only use explicit config
                    finalMcpServers = options.mcpServers;
                }

                if (finalMcpServers && Object.keys(finalMcpServers).length > 0) {
                    sessionOptions.mcpServers = finalMcpServers;
                    logger.debug(LogCategory.AI, `CopilotSDKService: Using ${Object.keys(finalMcpServers).length} MCP server(s): ${Object.keys(finalMcpServers).join(', ')}`);
                    logger.debug(LogCategory.AI, `CopilotSDKService: MCP servers config: ${JSON.stringify(finalMcpServers)}`);
                } else if (options.mcpServers !== undefined && Object.keys(options.mcpServers).length === 0) {
                    // Explicit empty object means disable all MCP servers
                    sessionOptions.mcpServers = {};
                    logger.debug(LogCategory.AI, 'CopilotSDKService: MCP servers explicitly disabled');
                }
            }

            // Permission handler — wrap with logging to track permission requests
            if (options.onPermissionRequest) {
                const originalHandler = options.onPermissionRequest;
                sessionOptions.onPermissionRequest = (request, invocation) => {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${invocation.sessionId}]: Permission request: kind=${request.kind}, toolCallId=${request.toolCallId || '(none)'}`);
                    const result = originalHandler(request, invocation);
                    // Handle both sync and async permission handlers
                    if (result && typeof (result as Promise<PermissionRequestResult>).then === 'function') {
                        return (result as Promise<PermissionRequestResult>).then(r => {
                            logger.debug(LogCategory.AI, `CopilotSDKService [${invocation.sessionId}]: Permission result: ${r.kind} (for ${request.kind})`);
                            return r;
                        });
                    }
                    logger.debug(LogCategory.AI, `CopilotSDKService [${invocation.sessionId}]: Permission result: ${(result as PermissionRequestResult).kind} (for ${request.kind})`);
                    return result;
                };
            }

            const sessionOptionsStr = Object.keys(sessionOptions).length > 0 
                ? JSON.stringify(sessionOptions) 
                : '(default)';
            logger.debug(LogCategory.AI, `CopilotSDKService: Creating session (cwd: ${options.workingDirectory || '(default)'}, options: ${sessionOptionsStr})`);

            session = await client.createSession(sessionOptions);
            logger.debug(LogCategory.AI, `CopilotSDKService: Session created: ${session.sessionId}`);

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
            if ((options.streaming || options.onStreamingChunk || timeoutMs > 120000) && session.on && session.send) {
                const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk);
                response = streamingResult.response;
                tokenUsage = streamingResult.tokenUsage;
                turnCount = streamingResult.turnCount;
            } else {
                const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);
                response = result?.data?.content || '';
            }

            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Request completed in ${durationMs}ms`);

            if (!response) {
                // For tool-heavy sessions (e.g., impl skill), the AI may complete
                // all work via tool execution (file edits, shell commands) without
                // producing a text summary. If turns occurred, the work was done
                // successfully — treat empty text as success, not failure.
                if (turnCount > 0) {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Empty text response but ${turnCount} turns completed — treating as success (tool-based execution)`);
                    return {
                        success: true,
                        response: '',
                        sessionId: session.sessionId,
                        tokenUsage,
                    };
                }
                return {
                    success: false,
                    error: 'No response received from Copilot SDK',
                    sessionId: session.sessionId,
                    tokenUsage,
                };
            }

            return {
                success: true,
                response,
                sessionId: session.sessionId,
                tokenUsage,
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            logger.error(LogCategory.AI, `CopilotSDKService [${session?.sessionId ?? 'no-session'}]: Request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

            return {
                success: false,
                error: `Copilot SDK error: ${errorMessage}`,
                sessionId: session?.sessionId
            };

        } finally {
            // Clean up session
            if (session) {
                // Untrack the session first
                this.untrackSession(session.sessionId);
                try {
                    await session.destroy();
                    logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Session destroyed`);
                } catch (destroyError) {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${session.sessionId}]: Warning: Error destroying session: ${destroyError}`);
                }
            }
        }
    }

    /**
     * Get the session pool, creating it if necessary.
     * The pool is lazily initialized on first use.
     *
     * @returns The session pool
     * @throws Error if SDK is not available
     */
    private async ensureSessionPool(): Promise<SessionPool> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        if (this.sessionPool) {
            return this.sessionPool;
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Creating session pool');

        // Ensure client is initialized first
        const client = await this.ensureClient();

        // Create the session pool with a factory that creates sessions from the client
        this.sessionPool = new SessionPool(
            async () => {
                const session = await client.createSession();
                return session as IPoolableSession;
            },
            {
                maxSessions: this.sessionPoolConfig.maxSessions,
                idleTimeoutMs: this.sessionPoolConfig.idleTimeoutMs
            }
        );

        logger.debug(LogCategory.AI, 'CopilotSDKService: Session pool created');
        return this.sessionPool;
    }

    /**
     * Get statistics about the session pool.
     * Returns null if the pool has not been initialized.
     *
     * @returns Pool statistics or null
     */
    public getPoolStats(): SessionPoolStats | null {
        return this.sessionPool?.getStats() ?? null;
    }

    /**
     * Check if the session pool is active.
     *
     * @returns True if the pool exists and is not disposed
     */
    public hasActivePool(): boolean {
        return this.sessionPool !== null && !this.sessionPool.isDisposed();
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
        const logger = getLogger();
        
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            logger.debug(LogCategory.AI, `CopilotSDKService [${sessionId}]: Session not found for abort`);
            return false;
        }

        logger.debug(LogCategory.AI, `CopilotSDKService [${sessionId}]: Aborting session`);

        try {
            await session.destroy();
            this.activeSessions.delete(sessionId);
            logger.debug(LogCategory.AI, `CopilotSDKService [${sessionId}]: Session aborted successfully`);
            return true;
        } catch (error) {
            logger.error(LogCategory.AI, `CopilotSDKService [${sessionId}]: Error aborting session`, error instanceof Error ? error : undefined);
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
     * Clean up resources. Should be called when the extension deactivates.
     */
    public async cleanup(): Promise<void> {
        const logger = getLogger();
        logger.debug(LogCategory.AI, 'CopilotSDKService: Cleaning up SDK service');

        // Abort all active sessions first
        const abortPromises: Promise<void>[] = [];
        for (const [sessionId] of this.activeSessions) {
            abortPromises.push(this.abortSession(sessionId).then(() => {}));
        }
        await Promise.allSettled(abortPromises);
        this.activeSessions.clear();

        // Dispose session pool
        if (this.sessionPool) {
            try {
                await this.sessionPool.dispose();
                logger.debug(LogCategory.AI, 'CopilotSDKService: Session pool disposed');
            } catch (error) {
                logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error disposing session pool: ${error}`);
            }
            this.sessionPool = null;
        }

        if (this.client) {
            try {
                await this.client.stop();
                logger.debug(LogCategory.AI, 'CopilotSDKService: Client stopped');
            } catch (error) {
                logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error stopping client: ${error}`);
            }
            this.client = null;
            this.clientCwd = undefined;
        }

        this.sdkModule = null;
        this.availabilityCache = null;
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
     * Initialize the SDK client with optional working directory.
     * 
     * @param cwd Optional working directory for the CLI process
     */
    private async initializeClient(cwd?: string): Promise<void> {
        const sdkPath = this.findSDKPath();
        if (!sdkPath) {
            throw new Error('Copilot SDK not found');
        }

        await this.loadSDKModule(sdkPath);

        if (!this.sdkModule) {
            throw new Error('SDK module not loaded');
        }

        // Create client with cwd option if specified
        const options: ICopilotClientOptions = {};
        if (cwd) {
            options.cwd = cwd;
            // Pre-register the working directory as trusted to bypass the
            // interactive folder trust confirmation dialog
            try {
                ensureFolderTrusted(cwd);
            } catch {
                // Non-fatal: trust dialog will appear if this fails
            }
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, `CopilotSDKService: Creating CopilotClient with options: ${JSON.stringify(options)}`);

        this.client = new this.sdkModule.CopilotClient(options);
        this.clientCwd = cwd;
    }

    /**
     * Send a message with timeout support (non-streaming).
     * WARNING: SDK's sendAndWait has a hardcoded 120-second timeout for session.idle event.
     * For longer timeouts, use sendWithStreaming instead (automatically done for timeoutMs > 120s).
     */
    private async sendWithTimeout(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number
    ): Promise<{ data?: { content?: string } }> {
        // Pass timeout directly to SDK's sendAndWait method
        // Note: SDK internally limits this to 120 seconds for the session.idle event
        return session.sendAndWait({ prompt }, timeoutMs);
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
        onStreamingChunk?: (chunk: string) => void
    ): Promise<StreamingResult> {
        return new Promise((resolve, reject) => {
            const logger = getLogger();
            const sid = session.sessionId;
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
                logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Streaming completed (${result.length} chars, ${turnCount} turns, ${allMessages.length} messages, ${elapsedMs}ms elapsed)`);
                if (activeToolCalls.size > 0) {
                    const staleTools = [...activeToolCalls.entries()].map(([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`);
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: WARNING: ${activeToolCalls.size} tool call(s) still active at settle: ${staleTools.join(', ')}`);
                }
                settle(resolve, { response: result, tokenUsage: buildTokenUsage(), turnCount });
            };

            const timeoutId = setTimeout(() => {
                if (activeToolCalls.size > 0) {
                    const staleTools = [...activeToolCalls.entries()].map(([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`);
                    logger.error(LogCategory.AI, `CopilotSDKService [${sid}]: Timeout with ${activeToolCalls.size} active tool call(s): ${staleTools.join(', ')}`);
                }
                settleError(new Error(`Request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Set up event handler for streaming
            // SDK's session.on() returns an unsubscribe function
            const unsubscribe = session.on!((event: ISessionEvent) => {
                const eventType = event.type;

                if (eventType === 'assistant.message_delta') {
                    // Accumulate streaming chunks
                    const delta = event.data?.deltaContent || '';
                    response += delta;
                    // Invoke the streaming callback if provided
                    if (onStreamingChunk && delta) {
                        try {
                            onStreamingChunk(delta);
                        } catch (cbError) {
                            logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: onStreamingChunk callback error: ${cbError}`);
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
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Received message #${allMessages.length} (${messageContent.length} chars)`);
                    // Log tool requests if present — shows which tools the AI wants to invoke
                    if (event.data?.toolRequests?.length) {
                        const toolNames = event.data.toolRequests.map(t => t.name).join(', ');
                        logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Message includes ${event.data.toolRequests.length} tool request(s): ${toolNames}`);
                    }
                    // If no delta chunks were received but we have a streaming callback,
                    // emit the message as a single chunk so SSE consumers get content
                    if (onStreamingChunk && messageContent && !response) {
                        try {
                            onStreamingChunk(messageContent);
                        } catch (cbError) {
                            logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: onStreamingChunk callback error: ${cbError}`);
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
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Turn starting (${elapsedMs}ms elapsed, ${activeToolCalls.size} active tool calls)`);
                    if (turnEndGraceTimer) {
                        clearTimeout(turnEndGraceTimer);
                        turnEndGraceTimer = null;
                        logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Cancelled turn_end grace timer — new turn starting`);
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
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Turn ${turnCount} ended (${allMessages.length} messages so far)`);

                    // Start a grace timer. If a new turn starts (turn_start), this timer
                    // will be cancelled. If nothing else happens, we settle after the grace period.
                    if (!settled && !turnEndGraceTimer) {
                        turnEndGraceTimer = setTimeout(() => {
                            turnEndGraceTimer = null;
                            if (!settled && (allMessages.length > 0 || response)) {
                                logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Settling after turn_end grace period (turn ${turnCount})`);
                                settleWithResult();
                            }
                        }, 2000); // 2 second grace period to allow tool execution + new turn
                    }
                } else if (eventType === 'session.idle') {
                    // Session finished processing — settle immediately
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Session idle after ${turnCount} turns`);
                    settleWithResult();
                } else if (eventType === 'session.error') {
                    // Session error
                    const errorMessage = event.data?.message || 'Unknown session error';
                    logger.error(LogCategory.AI, `CopilotSDKService [${sid}]: Session error: ${errorMessage}`);
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
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Usage turn ${usageTurnCount}: in=${event.data?.inputTokens ?? 0} out=${event.data?.outputTokens ?? 0}`);
                } else if (eventType === 'session.usage_info') {
                    // Session-level quota info — store last-seen values
                    if (event.data?.tokenLimit != null) {
                        usageTokenLimit = event.data.tokenLimit;
                    }
                    if (event.data?.currentTokens != null) {
                        usageCurrentTokens = event.data.currentTokens;
                    }
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Session usage info: limit=${usageTokenLimit} current=${usageCurrentTokens}`);
                } else if (eventType === 'tool.execution_start') {
                    // Tool execution is starting — track it for debugging stuck sessions
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const toolName = event.data?.toolName || '(unknown)';
                    activeToolCalls.set(toolCallId, { toolName, startTime: Date.now() });
                    const argsStr = event.data?.arguments ? ` args=${JSON.stringify(event.data.arguments).substring(0, 200)}` : '';
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Tool execution started: ${toolName} [${toolCallId}]${argsStr}`);
                } else if (eventType === 'tool.execution_complete') {
                    // Tool execution finished — remove from active tracking
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const tracked = activeToolCalls.get(toolCallId);
                    const durationStr = tracked ? ` (${Date.now() - tracked.startTime}ms)` : '';
                    activeToolCalls.delete(toolCallId);
                    const toolSuccess = event.data?.success;
                    if (toolSuccess) {
                        const resultLen = event.data?.result?.content?.length ?? 0;
                        logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Tool execution completed: ${tracked?.toolName || '?'} [${toolCallId}] success${durationStr} (${resultLen} chars)`);
                    } else {
                        const errorMsg = event.data?.error?.message || '(no error message)';
                        logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Tool execution FAILED: ${tracked?.toolName || '?'} [${toolCallId}]${durationStr} error=${errorMsg}`);
                    }
                } else if (eventType === 'tool.execution_progress') {
                    const toolCallId = event.data?.toolCallId || '(unknown)';
                    const tracked = activeToolCalls.get(toolCallId);
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Tool progress: ${tracked?.toolName || '?'} [${toolCallId}]: ${event.data?.progressMessage || ''}`);
                } else if (eventType === 'assistant.intent') {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Assistant intent: ${event.data?.intent || '(none)'}`);
                } else if (eventType === 'session.info') {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Session info [${event.data?.infoType || '?'}]: ${event.data?.message || ''}`);
                } else if (eventType === 'abort') {
                    logger.debug(LogCategory.AI, `CopilotSDKService [${sid}]: Session aborted: ${event.data?.reason || '(no reason)'}`);
                }
            });

            // Send the message (without waiting)
            session.send!({ prompt }).catch(error => {
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

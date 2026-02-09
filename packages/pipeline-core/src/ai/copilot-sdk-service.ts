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
import { AIInvocationResult } from './types';
import { getLogger, LogCategory } from '../logger';
// Note: SessionPool is kept for backward compatibility but not used for clarification requests
import { SessionPool, IPoolableSession, SessionPoolStats } from './session-pool';
import { loadDefaultMcpConfig, mergeMcpConfigs } from './mcp-config-loader';
import { DEFAULT_AI_TIMEOUT_MS } from './timeouts';

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
 * 
 * @example Local server
 * ```typescript
 * const localServer: MCPServerConfig = {
 *     type: 'local',
 *     command: 'my-mcp-server',
 *     args: ['--port', '8080'],
 *     tools: ['*']
 * };
 * ```
 * 
 * @example Remote SSE server
 * ```typescript
 * const remoteServer: MCPServerConfig = {
 *     type: 'sse',
 *     url: 'http://localhost:8000/sse',
 *     headers: { 'Authorization': 'Bearer token' },
 *     tools: ['*']
 * };
 * ```
 */
export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

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
    /**
     * Whitelist of tool names to make available.
     * When specified, only these tools will be available for the session.
     * Takes precedence over `excludedTools`.
     * 
     * @example ['bash', 'view', 'edit'] - Only allow these specific tools
     */
    availableTools?: string[];

    /**
     * Blacklist of tool names to exclude.
     * When specified, these tools will be disabled for the session.
     * Ignored if `availableTools` is also specified.
     * 
     * @example ['github_*', 'mcp_*'] - Disable all github and mcp tools
     */
    excludedTools?: string[];

    /**
     * Custom MCP server configurations.
     * Allows overriding or adding MCP servers for the session.
     * Pass an empty object `{}` to disable all MCP servers.
     * 
     * @example { 'my-server': { command: 'my-mcp-server', args: ['--port', '8080'] } }
     */
    mcpServers?: Record<string, MCPServerConfig>;
}

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

    // ========================================================================
    // MCP Control Options (Session-level tool filtering)
    // ========================================================================

    /**
     * Whitelist of tool names to make available.
     * When specified, only these tools will be available for the session.
     * Takes precedence over `excludedTools`.
     * 
     * Note: Only applies to direct sessions (usePool: false).
     * Session pool sessions use default tool configuration.
     * 
     * @example ['bash', 'view', 'edit'] - Only allow these specific tools
     */
    availableTools?: string[];

    /**
     * Blacklist of tool names to exclude.
     * When specified, these tools will be disabled for the session.
     * Ignored if `availableTools` is also specified.
     * 
     * Note: Only applies to direct sessions (usePool: false).
     * Session pool sessions use default tool configuration.
     * 
     * @example ['github_*', 'mcp_*'] - Disable all github and mcp tools
     */
    excludedTools?: string[];

    /**
     * Custom MCP server configurations.
     * Allows overriding or adding MCP servers for the session.
     * Pass an empty object `{}` to disable all MCP servers.
     * 
     * Note: Only applies to direct sessions (usePool: false).
     * Session pool sessions use default MCP configuration.
     * 
     * @example { 'my-server': { command: 'my-mcp-server', args: ['--port', '8080'] } }
     */
    mcpServers?: Record<string, MCPServerConfig>;

    /**
     * Whether to automatically load MCP server configuration from ~/.copilot/mcp-config.json.
     * When enabled, the default config is loaded and merged with any explicit mcpServers option.
     * Explicit mcpServers take precedence over the default config.
     * 
     * Note: Only applies to direct sessions (usePool: false).
     * Session pool sessions do not load default MCP config.
     * 
     * @default true
     */
    loadDefaultMcpConfig?: boolean;

    /**
     * Handler for permission requests from the Copilot CLI.
     * When the AI needs permission to perform operations (file reads/writes, shell commands, etc.),
     * this handler is called to approve or deny the request.
     * 
     * Without a handler, all permission requests are denied by default.
     * 
     * Note: Only applies to direct sessions (usePool: false).
     * Session pool sessions use default permission handling (deny all).
     * 
     * @example
     * // Approve all permissions
     * onPermissionRequest: () => ({ kind: 'approved' })
     * 
     * @example
     * // Selective approval
     * onPermissionRequest: (request) => {
     *   if (request.kind === 'read') return { kind: 'approved' };
     *   return { kind: 'denied-by-rules' };
     * }
     */
    onPermissionRequest?: PermissionHandler;
}

/**
 * Result from SDK invocation, extends AIInvocationResult with SDK-specific fields
 */
export interface SDKInvocationResult extends AIInvocationResult {
    /** Session ID used for this request (if session was created) */
    sessionId?: string;
    /** Raw SDK response data */
    rawResponse?: unknown;
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

/**
 * Options for creating a CopilotClient
 */
interface ICopilotClientOptions {
    /** Working directory for the CLI process */
    cwd?: string;
    /** Extra arguments to pass to the CLI executable (inserted before SDK-managed args) */
    cliArgs?: string[];
}

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
    /** Event handler for streaming responses */
    on?(handler: (event: ISessionEvent) => void): void;
    /** Send a message without waiting (for streaming) */
    send?(options: { prompt: string }): Promise<void>;
}

/**
 * Interface for session events (streaming)
 */
interface ISessionEvent {
    type: { value: string };
    data?: {
        content?: string;
        delta_content?: string;
    };
}

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
            logger.debug(LogCategory.AI, `CopilotSDKService: Acquired session from pool: ${session.sessionId}`);

            // Send the message with timeout
            const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);

            const response = result?.data?.content || '';
            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService: Pooled request completed in ${durationMs}ms`);

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

            logger.error(LogCategory.AI, `CopilotSDKService: Pooled request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

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
                        logger.debug(LogCategory.AI, 'CopilotSDKService: Session destroyed after error');
                    } catch (destroyError) {
                        logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error destroying session: ${destroyError}`);
                    }
                } else {
                    this.sessionPool.release(session);
                    logger.debug(LogCategory.AI, 'CopilotSDKService: Session released back to pool');
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

            // Permission handler
            if (options.onPermissionRequest) {
                sessionOptions.onPermissionRequest = options.onPermissionRequest;
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

            // Use streaming mode if enabled and supported, OR if timeout > 120s
            // (SDK's sendAndWait has hardcoded 120s timeout for session.idle)
            let response: string;
            if ((options.streaming || timeoutMs > 120000) && session.on && session.send) {
                response = await this.sendWithStreaming(session, options.prompt, timeoutMs);
            } else {
                const result = await this.sendWithTimeout(session, options.prompt, timeoutMs);
                response = result?.data?.content || '';
            }

            const durationMs = Date.now() - startTime;

            logger.debug(LogCategory.AI, `CopilotSDKService: Request completed in ${durationMs}ms`);

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
                sessionId: session.sessionId
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;

            logger.error(LogCategory.AI, `CopilotSDKService: Request failed after ${durationMs}ms`, error instanceof Error ? error : undefined);

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
                    logger.debug(LogCategory.AI, 'CopilotSDKService: Session destroyed');
                } catch (destroyError) {
                    logger.debug(LogCategory.AI, `CopilotSDKService: Warning: Error destroying session: ${destroyError}`);
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
            logger.debug(LogCategory.AI, `CopilotSDKService: Session ${sessionId} not found for abort`);
            return false;
        }

        logger.debug(LogCategory.AI, `CopilotSDKService: Aborting session ${sessionId}`);

        try {
            await session.destroy();
            this.activeSessions.delete(sessionId);
            logger.debug(LogCategory.AI, `CopilotSDKService: Session ${sessionId} aborted successfully`);
            return true;
        } catch (error) {
            logger.error(LogCategory.AI, `CopilotSDKService: Error aborting session ${sessionId}`, error instanceof Error ? error : undefined);
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
        }
        // Bypass the interactive folder trust dialog by allowing all paths
        options.cliArgs = ['--allow-all-paths'];

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
     * Accumulates delta_content chunks until session.idle event.
     */
    private async sendWithStreaming(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const logger = getLogger();
            let response = '';
            let finalMessage = '';

            const timeoutId = setTimeout(() => {
                reject(new Error(`Request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Set up event handler for streaming
            session.on!((event: ISessionEvent) => {
                const eventType = event.type?.value;

                if (eventType === 'assistant.message_delta') {
                    // Accumulate streaming chunks
                    const delta = event.data?.delta_content || '';
                    response += delta;
                    logger.debug(LogCategory.AI, `CopilotSDKService: Received delta chunk (${delta.length} chars)`);
                } else if (eventType === 'assistant.message') {
                    // Final message - use this as the complete content
                    finalMessage = event.data?.content || '';
                    logger.debug(LogCategory.AI, `CopilotSDKService: Received final message (${finalMessage.length} chars)`);
                } else if (eventType === 'session.idle') {
                    // Session finished processing
                    clearTimeout(timeoutId);
                    // Prefer final message if available, otherwise use accumulated response
                    const result = finalMessage || response;
                    logger.debug(LogCategory.AI, `CopilotSDKService: Streaming completed (${result.length} chars total)`);
                    resolve(result);
                }
            });

            // Send the message (without waiting)
            session.send!({ prompt }).catch(error => {
                clearTimeout(timeoutId);
                reject(error);
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

// ============================================================================
// Permission Handler Helpers
// ============================================================================

/**
 * Permission handler that approves all permission requests.
 * 
 * **WARNING**: This allows the AI to perform any operation without restrictions:
 * - Read/write any file
 * - Execute any shell command
 * - Access any URL
 * - Use any MCP server
 * 
 * Only use this in trusted environments or for testing purposes.
 * 
 * @example
 * ```typescript
 * const result = await copilotSDKService.sendMessage({
 *     prompt: 'List files in the current directory',
 *     onPermissionRequest: approveAllPermissions
 * });
 * ```
 */
export const approveAllPermissions: PermissionHandler = () => {
    return { kind: 'approved' };
};

/**
 * Permission handler that denies all permission requests.
 * This is the default behavior when no handler is provided.
 * 
 * @example
 * ```typescript
 * const result = await copilotSDKService.sendMessage({
 *     prompt: 'Just answer this question',
 *     onPermissionRequest: denyAllPermissions
 * });
 * ```
 */
export const denyAllPermissions: PermissionHandler = () => {
    return { kind: 'denied-by-rules' };
};

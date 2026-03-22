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

import { findSdkBinaryPath, loadSdk, SdkModule } from './sdk-loader';
import { ToolCall } from '../ai/process-types';
import { getAIServiceLogger, createSessionLogger } from '../ai-logger';
import { loadDefaultMcpConfig, mergeMcpConfigs } from './mcp-config-loader';
import { createSdkClient } from './sdk-client-factory';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/timeouts';
import { DEFAULT_AI_IDLE_TIMEOUT_MS } from '../config/defaults';
import {
    Attachment,
    DeliveryMode,
    MCPServerConfig,
    ReasoningEffort,
    SendMessageOptions,
    SystemMessageConfig,
    TokenUsage,
    SDKInvocationResult,
    SDKAvailabilityResult,
    PermissionRequest,
    PermissionRequestResult,
    PermissionHandler,
    ExtendedSdkRequest,
    approveAllPermissions,
    denyAllPermissions,
    ToolEvent,
} from './types';
import { ModelInfo } from './model-info';
import { fetchModelsFromClient } from './model-registry';
import { StreamingSession, ISessionEvent, StreamingResult } from './streaming-session';
export type { StreamingResult, IStreamableSession, StreamingState, StreamingSessionRunOptions } from './streaming-session';
import { SessionManager } from './session-manager';

// Re-export types that were previously exported from this file
export {
    MCPServerConfigBase,
    MCPLocalServerConfig,
    MCPRemoteServerConfig,
    MCPServerConfig,
    MCPControlOptions,
    ReasoningEffort,
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
    /** Reasoning effort for models that support extended thinking */
    reasoningEffort?: ReasoningEffort;
}

/**
 * Interface for the CopilotClient from @github/copilot-sdk
 * We define this interface to avoid direct type dependency on the SDK
 */
interface ICopilotClient {
    start(): Promise<void>;
    createSession(options?: ISessionOptions): Promise<ICopilotSession>;
    /**
     * Resume an existing server-side session by ID.
     * The SDK server retains full conversation history so the caller does not
     * need to replay prior turns.
     */
    resumeSession?(sessionId: string, options?: ISessionOptions): Promise<ICopilotSession>;
    stop(): Promise<void>;
    listModels(): Promise<ModelInfo[]>;
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

export { tryConvertImageFileToDataUrl } from './image-converter';

export class CopilotSDKService {
    private static instance: CopilotSDKService | null = null;

    private sdkModule: SdkModule | null = null;
    private availabilityCache: SDKAvailabilityResult | null = null;
    private disposed = false;

    /** Manages active sessions for cancellation support */
    private readonly sessionManager = new SessionManager();

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

        return createSdkClient(this.sdkModule, { cwd });
    }

    /**
     * List all models available to the authenticated user via the Copilot API.
     *
     * Creates a short-lived client (no cwd needed) and delegates to
     * `fetchModelsFromClient` from `model-registry`.
     *
     * @returns Array of ModelInfo objects from the SDK.
     * @throws Error if the SDK is unavailable or the API call fails.
     */
    public async listModels(): Promise<ModelInfo[]> {
        if (this.disposed) {
            throw new Error('CopilotSDKService has been disposed');
        }

        const availability = await this.isAvailable();
        if (!availability.available) {
            throw new Error(availability.error ?? 'Copilot SDK is not available');
        }

        const client = await this.createClient();
        return fetchModelsFromClient(client);
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
            if (options.reasoningEffort) {
                sessionOptions.reasoningEffort = options.reasoningEffort;
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
                sessionLog.debug({ kind: request.kind, toolCallId: request.toolCallId || undefined, resource: (request as ExtendedSdkRequest).resource, operation: (request as ExtendedSdkRequest).operation }, 'Permission request');
                const capturePermission = (permResult: PermissionRequestResult) => {
                    if (request.toolCallId) {
                        const tc = toolCallsMap.get(request.toolCallId);
                        if (tc) {
                            tc.permissionRequest = {
                                kind: request.kind,
                                timestamp: new Date(),
                                resource: (request as ExtendedSdkRequest).resource,
                                operation: (request as ExtendedSdkRequest).operation,
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
                const streamingResult = await this.sendWithStreaming(session, options.prompt, timeoutMs, options.onStreamingChunk, toolCallsMap, options.onToolEvent, idleTimeoutMs, options.attachments, options.deliveryMode, options.sessionId);
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
        return this.sessionManager.abort(sessionId);
    }

    /**
     * Check if a session is currently active.
     *
     * @param sessionId The session ID to check
     * @returns True if the session is active
     */
    public hasActiveSession(sessionId: string): boolean {
        return this.sessionManager.has(sessionId);
    }

    /**
     * Get the count of currently active sessions.
     *
     * @returns Number of active sessions
     */
    public getActiveSessionCount(): number {
        return this.sessionManager.count();
    }

    /**
     * Track an active session for potential cancellation.
     * Called internally when a session is created.
     *
     * @param session The session to track
     */
    private trackSession(session: ICopilotSession): void {
        this.sessionManager.track(session);
    }

    /**
     * Untrack a session (called when session is destroyed normally).
     *
     * @param sessionId The session ID to untrack
     */
    private untrackSession(sessionId: string): void {
        this.sessionManager.untrack(sessionId);
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
        await this.sessionManager.abortAll();

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
     * Delegates to the standalone findSdkBinaryPath() from sdk-loader.ts.
     */
    private findSDKPath(): string | undefined {
        return findSdkBinaryPath();
    }

    /**
     * Load the SDK module using ESM dynamic import workaround.
     * Delegates to the standalone loadSdk() from sdk-loader.ts.
     */
    private async loadSDKModule(sdkPath: string): Promise<void> {
        if (this.sdkModule) {
            return;
        }

        this.sdkModule = await loadSdk(sdkPath);
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

    // ------------------------------------------------------------------
    // Stream-error safety net
    // ------------------------------------------------------------------

    /** Active `uncaughtException` handler that absorbs stream-destroyed errors. */
    private streamErrorGuardHandler: ((err: Error) => void) | null = null;

    /**
     * Active `unhandledRejection` handler that absorbs stream-destroyed errors
     * that surface as unhandled promise rejections.
     *
     * When `vscode-jsonrpc`'s `WritableStreamWrapper.write()` calls
     * `stream.write()` on a destroyed Node.js stream, Node.js calls the write
     * callback synchronously with `ERR_STREAM_DESTROYED`. That callback invokes
     * `reject(error)` inside `new Promise(executor)`, producing a rejected
     * promise. If the rejection escapes the `vscode-jsonrpc` promise chain
     * without being caught, Node.js >= 15 terminates the process with an
     * unhandled rejection. This handler intercepts those rejections before they
     * reach the default fatal handler.
     */
    private streamErrorGuardRejectionHandler: ((reason: unknown) => void) | null = null;

    /**
     * Install process-level `uncaughtException` and `unhandledRejection`
     * handlers that absorb `ERR_STREAM_DESTROYED` errors originating from the
     * SDK's stdio layer.
     *
     * The Copilot SDK's `connectViaStdio()` installs an `error` listener on
     * the child process's stdin that **re-throws** if `forceStopping` is false.
     * When the CLI process exits unexpectedly, any subsequent JSON-RPC write
     * triggers this re-throw, which surfaces as an uncaught exception that
     * crashes the host process.
     *
     * Additionally, `vscode-jsonrpc` wraps stream writes inside `new Promise()`,
     * so the same `ERR_STREAM_DESTROYED` can also arrive as an unhandled
     * rejection (the common path in Node.js >= 15).
     *
     * Both handlers catch exactly that class of errors so the normal
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

        this.streamErrorGuardRejectionHandler = (reason: unknown) => {
            const msg = reason instanceof Error
                ? (reason.message || String(reason))
                : String(reason);
            if (CopilotSDKService.isStreamDestroyedError(msg)) {
                aiLog.debug({ errMessage: msg }, 'Absorbed unhandled stream rejection');
                return; // Swallow — per-session error path already handles this
            }
            // Not ours — let Node.js default unhandled-rejection handling run.
            // Re-emitting would cause infinite recursion, so we log and do nothing;
            // this preserves the existing default behaviour for non-stream errors
            // because we are one of potentially many `unhandledRejection` listeners
            // and the default handler still fires for rejections we don't swallow.
        };
        process.on('unhandledRejection', this.streamErrorGuardRejectionHandler);
    }

    /**
     * Remove the stream-error guard.
     */
    private removeStreamErrorGuard(): void {
        if (this.streamErrorGuardHandler) {
            process.removeListener('uncaughtException', this.streamErrorGuardHandler);
            this.streamErrorGuardHandler = null;
        }
        if (this.streamErrorGuardRejectionHandler) {
            process.removeListener('unhandledRejection', this.streamErrorGuardRejectionHandler);
            this.streamErrorGuardRejectionHandler = null;
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
        // DeliveryMode (immediate/enqueue) is a streaming-only concept and
        // does not apply to sendAndWait(). options.deliveryMode is intentionally
        // not forwarded here.
        return session.sendAndWait({ prompt, attachments }, timeoutMs);
    }

    /**
     * Send a message with streaming support.
     * Delegates to StreamingSession which encapsulates the full state machine.
     */
    private sendWithStreaming(
        session: ICopilotSession,
        prompt: string,
        timeoutMs: number,
        onStreamingChunk?: (chunk: string) => void,
        toolCallsMap?: Map<string, ToolCall>,
        onToolEvent?: (event: ToolEvent) => void,
        idleTimeoutMs?: number,
        attachments?: Attachment[],
        deliveryMode?: DeliveryMode,
        callerSessionId?: string
    ): Promise<StreamingResult> {
        return new StreamingSession().run(session, {
            prompt,
            timeoutMs,
            onStreamingChunk,
            toolCallsMap,
            onToolEvent,
            idleTimeoutMs,
            attachments,
            deliveryMode,
            callerSessionId,
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
